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
  frameIdentity,
  isGameEnd,
  type GameConnection,
  type GameEnd,
  type GameFactory,
  type GameFrame,
} from './game/types.js';
import { HttpError, toError } from './errors.js';
import { RunLog } from './storage/logs.js';
import { ReplayRecorder } from './game/recorder.js';
import { ReplayStore, finishReplay } from './storage/replays.js';
import type { Repository } from './storage/repository.js';

export class Controller {
  readonly replays: ReplayStore;
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
      return new SocketGame(config.server, userId, undefined, (message) =>
        this.writeLog(message.startsWith('本地录像') ? 'warn' : 'debug', message),
      );
    },
  ) {
    this.replays = new ReplayStore(repository.dataDir);
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

  private writeCleanupError(message: string): void {
    // 磁盘故障不能让诊断阻断其他资源的关闭，写入失败时退回终端。
    try {
      this.writeLog('error', message);
    } catch (error) {
      console.error(message, toError(error));
    }
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

  private completeMatch(match: MatchRecord, result: GameEnd, began: boolean): void {
    if (result.gameId !== match.gameId) throw new Error('终局与当前对局不匹配');
    const completed = match.outcome !== null;
    match.outcome = result.outcome;
    match.endedAt = result.endedAt ?? match.endedAt ?? new Date().toISOString();
    match.turns = Math.max(match.turns, result.turn + 1);
    if (result.rating) match.rating = structuredClone(result.rating);
    const details = match.details;
    if (details) {
      if (result.snapshot) details.last = structuredClone(result.snapshot);
      details.durationMs =
        began || result.startedAt
          ? Math.max(0, Date.parse(match.endedAt) - Date.parse(match.startedAt))
          : null;
      details.winnerIndex = result.winnerIndex ?? null;
      details.endReason = result.endReason ?? result.outcome;
    }
    this.repository.putMatch(match);
    if (!completed) {
      this.state.completedGames++;
      this.writeLog(
        'info',
        `对局结束：${match.outcome} · ${match.turns} 回合 · ${match.replayUrl}`,
      );
    }
  }

  private async saveReplay(
    match: MatchRecord,
    game: GameConnection | null,
    fallback: ReplayRecorder | null,
  ): Promise<void> {
    if (match.localReplay) return;
    try {
      const replay = game?.getReplay?.() ?? fallback?.getReplay();
      if (!replay || replay.gameId !== match.gameId) return;
      await this.replays.save(finishReplay(replay, match));
      match.localReplay = true;
      this.repository.putMatch(match);
      this.notify();
    } catch (error) {
      this.writeLog('warn', `本地录像保存失败：${toError(error).message}`);
    }
  }

  private agentConfig(config: RunConfig): RunConfig {
    return { ...config, cwd: config.cwd ? resolve(this.root, config.cwd) : this.root };
  }

  private async execute(config: RunConfig, signal: AbortSignal): Promise<void> {
    let game: GameConnection | null = null;
    let agent: AgentProcess | null = null;
    let failed: Error | null = null;
    let fallback: ReplayRecorder | null = null;
    let began = false;
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
        fallback = game.getReplay
          ? null
          : new ReplayRecorder(config.server, (message) => this.writeLog('warn', message));
        if (!isGameEnd(current)) fallback?.capture(current);
        const details = match.details!;
        began = false;
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
          const identity = frameIdentity(current);
          let lastTurn = -1;
          while (!isGameEnd(current)) {
            signal.throwIfAborted();
            const frame = current;
            if (frameIdentity(frame) !== identity || frame.observation.turn <= lastTurn) {
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
            game.recordAction?.(frame, action, status);
            fallback?.recordAction(frame, action, status);
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
            if (!isGameEnd(current)) fallback?.capture(current);
          }
        }
        this.completeMatch(match, current, began);
        if (began) agent?.end();
        await this.saveReplay(match, game, fallback);
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
        failed = toError(error);
        this.writeLog('error', failed.message);
      }
    } finally {
      const match = this.state.match;
      if (match) {
        try {
          const result = game?.getResult?.();
          if (result?.gameId === match.gameId) {
            this.completeMatch(match, result, began);
          }
        } catch {
          // An unavailable result must not hide the run's original failure.
        }
        this.refreshSnapshot(match, game);
      }
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
      // 先离开游戏，避免外部进程关闭缓慢时仍留在匹配队列。
      try {
        game?.close();
      } catch (error) {
        const cleanupError = toError(error);
        failed ??= cleanupError;
        this.writeCleanupError(`关闭游戏连接失败：${cleanupError.message}`);
      }
      if (match) await this.saveReplay(match, game, fallback);
      try {
        await agent?.close();
      } catch (error) {
        const cleanupError = toError(error);
        failed ??= cleanupError;
        this.writeCleanupError(`关闭 agent 进程失败：${cleanupError.message}`);
      }
      this.state.nextGameAt = null;
      this.state.run!.endedAt = new Date().toISOString();
      this.state.run!.error = failed?.message ?? null;
      this.setPhase(failed ? 'failed' : 'stopped');
      this.writeLog(
        failed ? 'error' : 'info',
        failed ? '运行失败，已尝试关闭资源' : '运行已停止，资源已关闭',
      );
    }
  }

  async close(): Promise<void> {
    await this.stop();
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.listeners.clear();
  }
}
