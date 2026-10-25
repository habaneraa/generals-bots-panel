import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  runConfigSchema,
  type Dashboard,
  type LogLevel,
  type MatchRecord,
  type RunConfig,
  type RunPhase,
  type RunState,
} from '../../../packages/contracts/src/index.js';
import { AgentProcess } from './agent/process.js';
import { SocketGame } from './game/live.js';
import {
  isGameEnd,
  type GameConnection,
  type GameEnd,
  type GameFactory,
  type GameFrame,
} from './game/types.js';
import { HttpError } from './errors.js';
import { RunLog } from './storage/logs.js';
import type { Repository } from './storage/repository.js';

export class Controller {
  private state: RunState;
  private log: RunLog | null;
  private task: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private listeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly repository: Repository,
    private readonly root: string,
    private readonly gameFactory: GameFactory = async (config) => {
      const userId = (await readFile(resolve(root, config.userIdFile), 'utf8')).trim();
      if (!userId || userId.length > 4096) throw new Error('账号文件为空或长度非法');
      return new SocketGame(config.server, userId);
    },
  ) {
    const run = repository.latestRun();
    this.state = {
      run,
      phase: run?.phase ?? 'idle',
      match: null,
      turn: 0,
      agentLatencyMs: null,
      completedGames: 0,
      nextGameAt: null,
    };
    this.log = run ? new RunLog(run.id, repository.logPath(run.id)) : null;
  }

  get active(): boolean {
    return this.task !== null;
  }

  dashboard(): Dashboard {
    return {
      state: structuredClone(this.state),
      config: this.repository.getConfig(),
      stats: this.repository.stats(),
      matches: this.repository.matches(1, 50).items,
      logs: this.log?.tail() ?? [],
      dataDir: this.repository.dataDir,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.listeners) listener();
    }, 100);
    this.notifyTimer.unref();
  }

  private writeLog(level: LogLevel, message: string): void {
    this.log?.write(level, message);
    this.notify();
  }

  private setPhase(phase: RunPhase): void {
    this.state.phase = phase;
    if (this.state.run) {
      this.state.run.phase = phase;
      this.repository.putRun(this.state.run);
    }
    this.notify();
  }

  saveConfig(value: unknown): RunConfig {
    if (this.active) throw new HttpError(409, '请停止当前运行后再修改参数');
    const config = runConfigSchema.parse(value);
    this.repository.saveConfig(config);
    this.notify();
    return config;
  }

  start(value: unknown): Dashboard {
    if (this.active) throw new HttpError(409, '已有运行中的 agent');
    const config = this.saveConfig(value);
    const run = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      phase: 'starting' as const,
      config,
      error: null,
    };
    this.repository.putRun(run);
    this.log = new RunLog(run.id, this.repository.logPath(run.id));
    this.state = {
      run,
      phase: 'starting',
      match: null,
      turn: 0,
      agentLatencyMs: null,
      completedGames: 0,
      nextGameAt: null,
    };
    this.abort = new AbortController();
    this.writeLog('info', `启动 WebSocket 会话：${config.server}`);
    this.task = this.execute(config, this.abort.signal).finally(() => {
      this.task = null;
      this.abort = null;
      this.notify();
    });
    return this.dashboard();
  }

  async stop(): Promise<Dashboard> {
    if (this.task) {
      this.setPhase('stopping');
      this.writeLog('info', '收到停止请求，取消等待并关闭 agent / WebSocket');
      this.abort?.abort();
      await this.task;
    }
    return this.dashboard();
  }

  private newMatch(frame: GameFrame | GameEnd, config: RunConfig): MatchRecord {
    const snapshot = frame.snapshot ?? null;
    const match: MatchRecord = {
      id: randomUUID(),
      runId: this.state.run!.id,
      mode: config.mode,
      server: config.server,
      gameId: frame.gameId,
      opponent:
        (isGameEnd(frame)
          ? snapshot?.players.find((player) => !player.isSelf)?.username
          : frame.observation.players.find((player) => player.relation === 'enemy')?.username) ??
        '未知对手',
      startedAt: frame.startedAt ?? new Date().toISOString(),
      endedAt: null,
      outcome: null,
      turns: Math.max(0, (isGameEnd(frame) ? frame.turn : frame.observation.turn) + 1),
      replayUrl: `https://${config.server === 'bots' ? 'bot.' : ''}generals.io/replays/${encodeURIComponent(frame.gameId)}`,
      rating: structuredClone(
        frame.rating ?? {
          username:
            snapshot?.players.find((player) => player.isSelf)?.username ??
            (!isGameEnd(frame)
              ? frame.observation.players.find((player) => player.relation === 'self')?.username
              : null) ??
            null,
          before: !isGameEnd(frame)
            ? (snapshot?.players.find((player) => player.isSelf)?.stars ?? null)
            : null,
          after: null,
          source: null,
          capturedAt: null,
          delta: null,
        },
      ),
      details: {
        initial: isGameEnd(frame) ? null : structuredClone(snapshot),
        last: structuredClone(snapshot),
        durationMs: null,
        winnerIndex: null,
        endReason: null,
        agent: {
          observations: 0,
          decisions: 0,
          submittedMoves: 0,
          passes: 0,
          skippedMoves: 0,
          splitMoves: 0,
          totalLatencyMs: 0,
          maxLatencyMs: 0,
        },
      },
    };
    this.repository.putMatch(match);
    this.state.match = match;
    return match;
  }

  private refreshSnapshot(match: MatchRecord, game: GameConnection | null): void {
    if (!match.details) return;
    try {
      const latest = game?.getSnapshot?.();
      if (latest?.gameId === match.gameId) {
        match.details.last = structuredClone(latest.snapshot);
        if (latest.rating) match.rating = structuredClone(latest.rating);
      }
    } catch {
      // Retain the last valid snapshot if a server update was malformed.
    }
  }

  private agentConfig(config: RunConfig): RunConfig {
    return { ...config, cwd: config.cwd ? resolve(this.root, config.cwd) : this.root };
  }

  private async execute(config: RunConfig, signal: AbortSignal): Promise<void> {
    let game: GameConnection | null = null;
    let agent: AgentProcess | null = null;
    let failed: Error | null = null;
    try {
      game = await this.gameFactory(config);
      signal.throwIfAborted();
      await game.connect(signal);
      this.writeLog('info', '连接已就绪');
      const limit = config.autopilot ? config.maxGames : 1;
      for (let index = 0; index < limit; index++) {
        signal.throwIfAborted();
        this.state.nextGameAt = null;
        this.state.match = null;
        this.state.turn = 0;
        this.state.agentLatencyMs = null;
        this.setPhase('queueing');
        this.writeLog('info', `等待 1v1 对局（${index + 1}/${limit}）`);
        let current = await game.join(signal);
        const match = this.newMatch(current, config);
        const details = match.details!;
        let began = false;
        if (!isGameEnd(current)) {
          if (!agent) {
            agent = await AgentProcess.start(this.agentConfig(config), (message) =>
              this.writeLog('debug', `[agent stderr] ${message}`),
            );
          }
          signal.throwIfAborted();
          agent.begin(current.observation);
          began = true;
          this.setPhase('playing');
          this.writeLog('info', `对局开始：${match.gameId} · 对手 ${match.opponent}`);
          const identity = JSON.stringify([
            current.gameId,
            current.observation.player_id,
            current.observation.types.length,
            current.observation.types[0]?.length,
          ]);
          let lastTurn = -1;
          while (!isGameEnd(current)) {
            signal.throwIfAborted();
            const frame = current;
            const frameIdentity = JSON.stringify([
              frame.gameId,
              frame.observation.player_id,
              frame.observation.types.length,
              frame.observation.types[0]?.length,
            ]);
            if (frameIdentity !== identity || frame.observation.turn <= lastTurn) {
              throw new Error('服务器对局身份变化或回合倒退');
            }
            if (frame.snapshot) details.last = structuredClone(frame.snapshot);
            if (frame.rating) match.rating = structuredClone(frame.rating);
            details.agent.observations++;
            this.state.turn = frame.observation.turn;
            match.turns = Math.max(match.turns, frame.observation.turn + 1);
            this.repository.putMatch(match);
            this.notify();
            const started = performance.now();
            const action = await agent.act(frame.observation, signal);
            signal.throwIfAborted();
            this.state.agentLatencyMs = Math.round((performance.now() - started) * 10) / 10;
            const status = config.dryRun ? 'dry-run' : game.submit(frame, action);
            details.agent.decisions++;
            details.agent.totalLatencyMs += this.state.agentLatencyMs;
            details.agent.maxLatencyMs = Math.max(
              details.agent.maxLatencyMs,
              this.state.agentLatencyMs,
            );
            if (status === 'sent') {
              details.agent.submittedMoves++;
              if (action.split) details.agent.splitMoves++;
            } else if (status === 'pass') details.agent.passes++;
            else details.agent.skippedMoves++;
            lastTurn = frame.observation.turn;
            this.state.turn = lastTurn;
            match.turns = lastTurn + 1;
            this.repository.putMatch(match);
            this.writeLog(
              'debug',
              `turn=${lastTurn} action=${JSON.stringify(action)} status=${status} agent=${this.state.agentLatencyMs}ms`,
            );
            current = await game.next(lastTurn, signal);
          }
        }
        if (current.gameId !== match.gameId) throw new Error('终局与当前对局不匹配');
        match.outcome = current.outcome;
        match.endedAt = current.endedAt ?? new Date().toISOString();
        match.turns = Math.max(match.turns, current.turn + 1);
        if (current.snapshot) details.last = structuredClone(current.snapshot);
        if (current.rating) match.rating = structuredClone(current.rating);
        details.durationMs =
          began || current.startedAt
            ? Math.max(0, Date.parse(match.endedAt) - Date.parse(match.startedAt))
            : null;
        details.winnerIndex = current.winnerIndex ?? null;
        details.endReason = current.endReason ?? current.outcome;
        this.repository.putMatch(match);
        this.state.completedGames++;
        this.writeLog(
          'info',
          `对局结束：${match.outcome} · ${match.turns} 回合 · ${match.replayUrl}`,
        );
        if (began) agent?.end();
        if (index + 1 < limit) {
          this.state.nextGameAt = new Date(Date.now() + config.cooldownMs).toISOString();
          this.setPhase('cooldown');
          this.writeLog('info', `${config.cooldownMs / 1000} 秒后重新入队，复用同一 agent 进程`);
          await delay(config.cooldownMs, undefined, { signal });
          this.refreshSnapshot(match, game);
          this.repository.putMatch(match);
          this.notify();
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        failed = error instanceof Error ? error : new Error(String(error));
        this.writeLog('error', failed.message);
      }
    } finally {
      const match = this.state.match;
      if (match) this.refreshSnapshot(match, game);
      if (match && !match.outcome) {
        match.outcome = 'interrupted';
        match.endedAt = new Date().toISOString();
        if (match.details) {
          match.details.durationMs = Math.max(
            0,
            Date.parse(match.endedAt) - Date.parse(match.startedAt),
          );
          match.details.endReason = signal.aborted ? 'stopped' : 'error';
        }
      }
      if (match) this.repository.putMatch(match);
      // Close the game first so a slow external process cannot leave matchmaking active.
      try {
        game?.close();
      } catch (error) {
        failed ??= error as Error;
      }
      try {
        await agent?.close();
      } catch (error) {
        failed ??= error as Error;
      }
      this.state.nextGameAt = null;
      this.state.run!.endedAt = new Date().toISOString();
      this.state.run!.error = failed?.message ?? null;
      this.setPhase(failed ? 'failed' : 'stopped');
      this.writeLog(
        failed ? 'error' : 'info',
        failed ? '运行失败，资源已关闭' : '运行已停止，资源已关闭',
      );
    }
  }

  async close(): Promise<void> {
    await this.stop();
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.listeners.clear();
  }
}
