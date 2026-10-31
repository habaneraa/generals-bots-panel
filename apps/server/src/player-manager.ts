import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  defaultConfig,
  playerInputSchema,
  type Dashboard,
  type Player,
  type PlayerDetails,
  type PlayerInput,
} from '../../../packages/contracts/src/index.js';
import { Controller } from './controller.js';
import { HttpError } from './errors.js';
import type { GameFactory } from './game/types.js';
import { lookupNickname, validNickname, type NicknameLookup } from './game/username.js';
import { Repository } from './storage/repository.js';
import { readRegistry, writeRegistry, type PlayerRegistry } from './storage/player-registry.js';

function verifyDirectory(path: string): void {
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path)
    throw new Error('Player 数据目录不能包含符号链接');
}

/** Count local artifacts only, never traverse symlinks (including a linked parent). */
function countFiles(path: string, filename: (name: string) => boolean): number {
  if (!existsSync(path)) return 0;
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((count, entry) => {
    if (entry.isSymbolicLink()) return count;
    if (entry.isDirectory()) return count + countFiles(join(path, entry.name), filename);
    return count + Number(entry.isFile() && filename(entry.name));
  }, 0);
}

export class PlayerManager {
  readonly dataDir: string;
  private readonly lock: DatabaseSync;
  private registry: PlayerRegistry;
  private readonly controllers = new Map<string, Controller>();
  private readonly listeners = new Set<() => void>();
  private readonly deleting = new Set<string>();
  private readonly deletions = new Set<Promise<Dashboard>>();
  private readonly lookups = new Set<Promise<string>>();
  private readonly lifetime = new AbortController();
  private closed = false;
  private readonly idleAt = new Date().toISOString();

  constructor(
    dataDir: string,
    private readonly root: string,
    private readonly gameFactory?: GameFactory,
    private readonly nicknameLookup: NicknameLookup = lookupNickname,
  ) {
    mkdirSync(resolve(dataDir), { recursive: true, mode: 0o700 });
    this.dataDir = realpathSync(resolve(dataDir));
    this.lock = new DatabaseSync(join(this.dataDir, '.players-lock.sqlite'));
    try {
      // OS-backed SQLite locks survive neither a crash nor PID reuse; no stale-PID guessing.
      this.lock.exec('PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;');
      const registryPath = join(this.dataDir, 'players.json');
      const existing = readRegistry(registryPath);
      this.registry = existing ?? { version: 1, activePlayerId: null, players: [] };
      for (const player of this.registry.players) this.openController(player);
      if (!existing) writeRegistry(registryPath, this.registry);
    } catch (error) {
      for (const controller of this.controllers.values()) controller.repository.close();
      this.lock.close();
      throw error;
    }
    // One refresh per startup, not per dashboard/SSE snapshot. Failed lookups retain valid cache.
    for (const player of this.registry.players) void this.refreshNickname(player);
  }

  get players(): Player[] {
    return structuredClone(this.registry.players);
  }

  controller(playerId?: string): Controller {
    const id = playerId === undefined ? this.registry.activePlayerId : playerId;
    if (id === null) throw new HttpError(409, '请先创建 Player');
    const controller = this.controllers.get(id);
    if (!controller) throw new HttpError(404, 'Player 不存在');
    return controller;
  }

  dashboard(playerId?: string): Dashboard {
    if (playerId !== undefined || this.registry.activePlayerId !== null) {
      return { ...this.controller(playerId).dashboard(), players: this.players };
    }
    return {
      player: null,
      players: this.players,
      state: {
        run: null,
        phase: 'idle',
        phaseStartedAt: this.idleAt,
        match: null,
        turn: 0,
        agentLatencyMs: null,
        completedGames: 0,
        nextGameAt: null,
      },
      config: structuredClone(defaultConfig),
      stats: { total: 0, won: 0, lost: 0, draw: 0, interrupted: 0, winRate: 0 },
      matches: [],
      logs: [],
      dataDir: this.dataDir,
    };
  }

  details(playerId: string): PlayerDetails {
    const controller = this.controller(playerId);
    const snapshot = controller.dashboard();
    const dataDir = this.playerDirectory(playerId);
    return {
      player: snapshot.player!,
      dataDir,
      phase: snapshot.state.phase,
      active: controller.active,
      runs: controller.repository.runCount(),
      matches: controller.repository.matches(1, 1).total,
      stats: snapshot.stats,
      logs: countFiles(join(dataDir, 'logs'), (name) => name.endsWith('.jsonl')),
      replays: ['generals', 'bots'].reduce(
        (count, server) =>
          count +
          countFiles(join(dataDir, `server-${server}`), (name) => name === 'replay.json.gz'),
        0,
      ),
      lastRunAt: controller.repository.latestRun()?.startedAt ?? null,
    };
  }

  private ensureOpen(): void {
    if (this.closed) throw new HttpError(409, 'Player 管理器已关闭');
  }

  private assertUnique(input: PlayerInput): void {
    if (this.registry.players.some((p) => p.server === input.server && p.userId === input.userId))
      throw new HttpError(409, '该服务器的 userId 已存在');
  }

  private async lookup(input: PlayerInput, external?: AbortSignal): Promise<string> {
    const signal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(25_000),
      ...(external ? [external] : []),
    ]);
    try {
      signal.throwIfAborted();
      const task = new Promise<string>((resolveLookup, reject) => {
        const abort = () => reject(new Error('昵称查询已取消'));
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve()
          .then(() => {
            signal.throwIfAborted();
            return this.nicknameLookup(input, signal);
          })
          .then((nickname) => {
            signal.throwIfAborted();
            resolveLookup(validNickname(nickname));
          })
          .catch(reject)
          .finally(() => signal.removeEventListener('abort', abort));
      });
      this.lookups.add(task);
      try {
        return await task;
      } finally {
        this.lookups.delete(task);
      }
    } catch {
      throw new HttpError(
        502,
        signal.aborted ? '昵称查询已取消' : '无法查询游戏昵称，请检查服务器与 userId',
      );
    }
  }

  async add(value: unknown, signal?: AbortSignal): Promise<Dashboard> {
    this.ensureOpen();
    const input = playerInputSchema.parse(value);
    this.assertUnique(input);
    const nickname = await this.lookup(input, signal);
    this.ensureOpen();
    if (signal?.aborted) throw new HttpError(502, '昵称查询已取消');
    this.assertUnique(input);
    const player: Player = { id: randomUUID(), ...input, nickname };
    const controller = this.openController(player, true);
    try {
      this.persist({
        ...this.registry,
        activePlayerId: player.id,
        players: [...this.registry.players, player],
      });
    } catch (error) {
      this.controllers.delete(player.id);
      controller.repository.close();
      rmSync(this.playerDirectory(player.id), { recursive: true });
      throw error;
    }
    this.notify();
    return this.dashboard(player.id);
  }

  select(playerId: string): Dashboard {
    this.ensureOpen();
    this.controller(playerId);
    if (this.deleting.has(playerId)) throw new HttpError(409, 'Player 正在删除');
    this.persist({ ...this.registry, activePlayerId: playerId });
    this.notify();
    return this.dashboard(playerId);
  }

  remove(playerId: string, workspaceId?: string): Promise<Dashboard> {
    this.ensureOpen();
    const controller = this.controller(playerId);
    if (workspaceId !== undefined) this.controller(workspaceId);
    if (controller.active || this.deleting.has(playerId))
      throw new HttpError(409, '请停止 Player 的运行后再删除');
    const directory = this.playerDirectory(playerId);
    this.deleting.add(playerId);
    // close() locks Controller.start synchronously, before its first await.
    const task = this.deletePlayer(controller, directory, workspaceId);
    this.deletions.add(task);
    void task
      .finally(() => {
        this.deleting.delete(playerId);
        this.deletions.delete(task);
      })
      .catch(() => {});
    return task;
  }

  private async deletePlayer(
    controller: Controller,
    directory: string,
    workspaceId?: string,
  ): Promise<Dashboard> {
    const player = controller.player;
    let staged: string | undefined;
    let repositoryClosed = false;
    try {
      await controller.close();
      this.ensureOpen();
      controller.repository.close();
      repositoryClosed = true;
      this.playerDirectory(player.id); // Revalidate after asynchronous close.
      const trash = join(this.dataDir, '.player-trash');
      if (!existsSync(trash)) mkdirSync(trash, { mode: 0o700 });
      verifyDirectory(trash);
      const target = join(trash, `${player.id}-${randomUUID()}`);
      renameSync(directory, target);
      staged = target;
      const players = this.registry.players.filter((entry) => entry.id !== player.id);
      this.persist({
        ...this.registry,
        players,
        activePlayerId:
          this.registry.activePlayerId === player.id
            ? (players[0]?.id ?? null)
            : this.registry.activePlayerId,
      });
    } catch (error) {
      if (staged) {
        verifyDirectory(join(this.dataDir, '.player-trash'));
        verifyDirectory(staged);
        renameSync(staged, directory);
      }
      if (!this.closed) {
        if (!repositoryClosed) controller.repository.close();
        this.controllers.delete(player.id);
        this.openController(player);
      }
      throw error;
    }
    this.controllers.delete(player.id);
    this.notify();
    // Registry publication is the commit point. Cleanup failure leaves only internal trash,
    // never a registered Player pointing at missing files; do not report committed deletion as failed.
    try {
      verifyDirectory(join(this.dataDir, '.player-trash'));
      verifyDirectory(staged!);
      rmSync(staged!, { recursive: true });
    } catch {
      console.error('Player 已删除，但内部回收目录清理失败');
    }
    return this.dashboard(
      workspaceId && this.controllers.has(workspaceId) ? workspaceId : undefined,
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private playerDirectory(playerId: string, create = false): string {
    const parent = join(this.dataDir, 'players');
    if (create && !existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
    verifyDirectory(parent);
    const directory = join(parent, playerId);
    if (create) mkdirSync(directory, { mode: 0o700 });
    verifyDirectory(directory);
    return directory;
  }

  private openController(player: Player, create = false): Controller {
    const directory = this.playerDirectory(player.id, create);
    if (
      !create &&
      (!existsSync(join(directory, 'config.json')) || !existsSync(join(directory, 'panel.sqlite')))
    )
      throw new Error(`Player 数据目录不完整，停止启动以免覆盖历史：${player.id}`);
    const repository = new Repository(directory);
    const controller = new Controller(repository, this.root, player, this.gameFactory, (nickname) =>
      this.updateNickname(player.id, nickname),
    );
    controller.subscribe(() => this.notify());
    this.controllers.set(player.id, controller);
    return controller;
  }

  private async refreshNickname(player: Player): Promise<void> {
    const cached = player.nickname;
    try {
      const nickname = await this.lookup(player);
      if (this.controllers.get(player.id)?.player.nickname === cached)
        this.updateNickname(player.id, nickname);
    } catch {
      // Retain the valid persisted cache when offline, cancelled, or persistence fails.
    }
  }

  private updateNickname(playerId: string, nickname: string): void {
    if (this.closed || this.deleting.has(playerId)) return;
    const known = this.registry.players.find((entry) => entry.id === playerId);
    if (!known || known.nickname === nickname) return;
    try {
      this.persist({
        ...this.registry,
        players: this.registry.players.map((entry) =>
          entry.id === playerId ? { ...entry, nickname } : entry,
        ),
      });
      this.controllers.get(playerId)!.player.nickname = nickname;
      this.notify();
    } catch {
      console.error('无法持久化 Player 昵称缓存，已保留原缓存');
    }
  }

  private persist(registry: PlayerRegistry): void {
    writeRegistry(join(this.dataDir, 'players.json'), registry);
    this.registry = registry;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    try {
      await Promise.allSettled([...this.lookups]);
      await Promise.allSettled([...this.deletions]);
      const results = await Promise.allSettled(
        [...this.controllers.values()].map((controller) => controller.close()),
      );
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, '关闭 Player 资源失败');
    } finally {
      this.listeners.clear();
      for (const controller of this.controllers.values()) controller.repository.close();
      this.controllers.clear();
      this.lock.close();
    }
  }
}
