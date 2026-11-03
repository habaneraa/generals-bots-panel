import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import type { RunConfig } from '../../../../packages/contracts/src/index.js';
import type { AgentAction, Observation } from '../game/types.js';
import { decodeAction, encodeEnd, encodeObservation, encodeStart } from './protocol.js';

interface PendingReply {
  resolve: (action: AgentAction) => void;
  reject: (error: Error) => void;
}

export class AgentProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private pending: PendingReply | null = null;
  private failure: Error | null = null;
  private stdout = '';
  private stderr = '';
  private closing = false;

  private constructor(
    private readonly config: RunConfig,
    onDiagnostic: (message: string) => void,
  ) {
    this.child = spawn(config.command, config.args, {
      cwd: config.cwd || undefined,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    const reportDiagnostic = (message: string) => {
      for (let offset = 0; offset < message.length; offset += 16000) {
        onDiagnostic(message.slice(offset, offset + 16000));
      }
    };
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
      let boundary: number;
      while ((boundary = this.stderr.indexOf('\n')) !== -1) {
        const line = this.stderr.slice(0, boundary).replace(/\r$/, '');
        this.stderr = this.stderr.slice(boundary + 1);
        if (line.trim()) reportDiagnostic(line);
      }
      while (this.stderr.length >= 16000) {
        reportDiagnostic(this.stderr.slice(0, 16000));
        this.stderr = this.stderr.slice(16000);
      }
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('close', (code, signal) => {
      if (this.stderr.length > 0) reportDiagnostic(this.stderr);
      if (!this.closing) this.fail(new Error(`agent 已退出（code=${code}, signal=${signal}）`));
    });
    this.child.stdout.on('end', () => {
      if (!this.closing) this.fail(new Error('agent 关闭了 stdout'));
    });
  }

  static async start(
    config: RunConfig,
    diagnostic: (message: string) => void,
  ): Promise<AgentProcess> {
    const agent = new AgentProcess(config, diagnostic);
    await once(agent.child, 'spawn');
    return agent;
  }

  private fail(error: Error): void {
    this.stdout = '';
    this.failure ??= error;
    this.pending?.reject(error);
    this.pending = null;
  }

  private onStdout(chunk: string): void {
    if (this.failure || this.closing) return;
    this.stdout += chunk;
    let boundary: number;
    while ((boundary = this.stdout.indexOf('\n')) !== -1) {
      const line = this.stdout.slice(0, boundary).replace(/\r$/, '');
      this.stdout = this.stdout.slice(boundary + 1);
      if (line.length > 65536) {
        this.fail(new Error('agent stdout 单行超过 64 KiB'));
        return;
      }
      if (!this.pending) {
        this.fail(new Error('agent 输出了非请求响应；每个 observation 只能输出一行动作'));
        return;
      }
      const pending = this.pending;
      this.pending = null;
      try {
        pending.resolve(decodeAction(line));
      } catch (error) {
        this.fail(error as Error);
        pending.reject(error as Error);
      }
    }
    if (this.stdout.length > 65536) this.fail(new Error('agent stdout 单行超过 64 KiB'));
  }

  private write(value: string): void {
    if (this.failure) throw this.failure;
    if (this.closing) throw new Error('agent 正在关闭');
    this.child.stdin.write(value);
  }

  begin(frame: Observation): void {
    this.write(encodeStart(frame, this.config.protocol));
  }

  end(): void {
    this.write(encodeEnd(this.config.protocol));
  }

  act(frame: Observation, signal: AbortSignal): Promise<AgentAction> {
    signal.throwIfAborted();
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) return Promise.reject(new Error('不允许并发 agent 推理'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pending = null;
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const abort = () => {
        const error = new Error('运行已取消');
        this.failure = error;
        fail(error);
      };
      const timer = setTimeout(() => {
        const error = new Error(`agent 响应超时（${this.config.agentTimeoutMs} ms）`);
        this.failure = error; // Never reuse a stream whose reply alignment is unknown.
        fail(error);
      }, this.config.agentTimeoutMs);
      this.pending = {
        resolve: (action) => {
          cleanup();
          resolve(action);
        },
        reject: fail,
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.write(encodeObservation(frame, this.config.protocol));
      } catch (error) {
        fail(error as Error);
      }
    });
  }

  private signalGroup(signal: NodeJS.Signals): void {
    if (!this.child.pid) return;
    try {
      if (process.platform === 'win32') this.child.kill(signal);
      else process.kill(-this.child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }

  private waitForExit(ms: number): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null)
      return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.child.removeListener('close', done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.child.removeListener('close', done);
        resolve(false);
      }, ms);
      this.child.once('close', done);
    });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.fail(new Error('agent 已关闭'));
    this.child.stdin.end();
    await this.waitForExit(500);
    // Signal the group even if a launcher exited but left its model process alive.
    this.signalGroup('SIGTERM');
    await this.waitForExit(1000);
    this.signalGroup('SIGKILL');
    await this.waitForExit(500);
  }
}
