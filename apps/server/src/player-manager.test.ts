import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { get, type ClientRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultConfig,
  type Dashboard,
  type MatchRecord,
} from '../../../packages/contracts/src/index.js';
import { fixtureObservation, FixtureGame } from '../../../test/fixtures/game.js';
import { createApp } from './app.js';
import { PlayerManager } from './player-manager.js';
import type { PlayerRegistry } from './storage/player-registry.js';
import type { NicknameLookup } from './game/username.js';
import type { GameConnection, GameFactory } from './game/types.js';
import { ReplayRecorder } from './game/recorder.js';
import { RunLog } from './storage/logs.js';
import { Repository } from './storage/repository.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const nicknameLookup: NicknameLookup = async (player) =>
  player.userId === 'second-account' ? 'second' : 'first';
function setup(factory?: GameFactory, lookup: NicknameLookup = nicknameLookup) {
  const dir = mkdtempSync(join(tmpdir(), 'panel-players-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const manager = new PlayerManager(dir, resolve('.'), factory, lookup);
  cleanups.push(() => manager.close());
  return { manager, dir };
}
async function api(factory?: GameFactory, lookup?: NicknameLookup) {
  const resource = setup(factory, lookup);
  const app = await createApp(resource.manager, join(resource.dir, 'no-web'));
  cleanups.push(() => app.close());
  return { ...resource, app };
}
const headers = { host: '127.0.0.1:3000' };
const input = { server: 'generals' as const, userId: 'same-account' };
async function addPair(manager: PlayerManager) {
  const a = (await manager.add(input)).player!;
  const b = (await manager.add({ ...input, userId: 'second-account' })).player!;
  return { a, b };
}
function match(runId: string): MatchRecord {
  return {
    id: randomUUID(),
    runId,
    mode: 'live',
    server: 'generals',
    gameId: 'private-game',
    opponent: 'private opponent',
    startedAt: '2026-10-25T00:00:00.000Z',
    endedAt: '2026-10-25T00:01:00.000Z',
    outcome: 'won',
    turns: 5,
    replayUrl: null,
    rating: {
      username: 'first',
      before: 1,
      after: 2,
      delta: 1,
      capturedAt: '2026-10-25T00:01:00.000Z',
      source: 'terminal',
    },
  };
}
async function events(app: FastifyInstance, playerId?: string) {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const snapshots = Object.assign([] as Dashboard[], { deleted: [] as string[], ended: false });
  let request: ClientRequest;
  await new Promise<void>((resolveReady, reject) => {
    request = get(
      {
        host: '127.0.0.1',
        port: address.port,
        path: `/api/events${playerId === undefined ? '' : `?playerId=${playerId}`}`,
        headers,
      },
      (response) => {
        let buffered = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          buffered += chunk;
          let boundary: number;
          while ((boundary = buffered.indexOf('\n\n')) >= 0) {
            const event = buffered.slice(0, boundary);
            buffered = buffered.slice(boundary + 2);
            const data = event.split('\n').find((line) => line.startsWith('data: '));
            if (data) {
              if (event.startsWith('event: player-deleted'))
                snapshots.deleted.push(JSON.parse(data.slice(6)).playerId);
              else snapshots.push(JSON.parse(data.slice(6)));
              resolveReady();
            }
          }
        });
        response.on('end', () => {
          snapshots.ended = true;
        });
        response.on('error', reject);
      },
    );
    request.on('error', reject);
  });
  cleanups.push(() => {
    request.destroy();
  });
  return snapshots;
}

describe('Player registry and API ownership', () => {
  it('serves an empty dashboard/events, rejects data/mutations without a Player, and 404s every explicit invalid identity', async () => {
    const { app, manager } = await api();
    const dashboard = await app.inject({ url: '/api/dashboard', headers });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toMatchObject({
      player: null,
      players: [],
      state: { phase: 'idle' },
      config: defaultConfig,
      matches: [],
      logs: [],
    });
    const snapshots = await events(app);
    expect(snapshots[0]!.player).toBeNull();
    for (const [method, url] of [
      ['PUT', '/api/config'],
      ['POST', '/api/runs'],
      ['POST', '/api/runs/stop'],
      ['GET', '/api/matches'],
      ['GET', '/api/matches/star-history'],
      ['GET', '/api/replays/generals/game'],
      ['GET', '/api/replays/generals/game/download'],
      ['GET', `/api/runs/${randomUUID()}/logs/download`],
    ] as const) {
      expect(
        (
          await app.inject({
            method,
            url,
            headers,
            ...(method === 'GET' ? {} : { payload: defaultConfig }),
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method,
            url: `${url}?playerId=not-found`,
            headers,
            ...(method === 'GET' ? {} : { payload: defaultConfig }),
          })
        ).statusCode,
      ).toBe(404);
    }
    for (const url of ['/api/dashboard', '/api/events'])
      expect((await app.inject({ url: `${url}?playerId=not-found`, headers })).statusCode).toBe(
        404,
      );
    const response = await app.inject({
      method: 'POST',
      url: '/api/players',
      headers,
      payload: { ...input, userId: ' same-account ' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().player).toMatchObject(input);
    await vi.waitFor(() => expect(snapshots.at(-1)!.player?.id).toBe(manager.players[0]!.id));
  });

  it('enforces trimmed server/userId uniqueness, persists active selection, and holds an exclusive root lock', async () => {
    const { app, manager, dir } = await api();
    const { a, b } = await addPair(manager);
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/players',
      headers,
      payload: { ...input, userId: ' same-account ' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(manager.players).toHaveLength(2);
    expect((await manager.add({ ...input, server: 'bots' })).players).toHaveLength(3);
    expect(() => new PlayerManager(dir, resolve('.'), undefined, nicknameLookup)).toThrow();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/players/active',
          headers,
          payload: { playerId: 'missing' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/players/active',
          headers,
          payload: { playerId: a.id },
        })
      ).json().player.id,
    ).toBe(a.id);
    expect(
      (await app.inject({ url: `/api/dashboard?playerId=${b.id}`, headers })).json().player.id,
    ).toBe(b.id);
    expect(manager.dashboard().player!.id).toBe(a.id);
    await app.close();
    const restarted = new PlayerManager(dir, resolve('.'), undefined, nicknameLookup);
    cleanups.push(() => restarted.close());
    expect(restarted.dashboard().player!.id).toBe(a.id);
    expect(restarted.players).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(dir, 'players.json'), 'utf8'))).toMatchObject({
      version: 1,
      activePlayerId: a.id,
    });
  });

  it('isolates configs, runs, matches, stats, star history, logs and replays including explicit download addresses', async () => {
    const { app, manager } = await api();
    const { a, b } = await addPair(manager);
    const first = manager.controller(a.id);
    const second = manager.controller(b.id);
    first.saveConfig({ ...defaultConfig, command: 'first-agent' });
    second.saveConfig({ ...defaultConfig, command: 'second-agent' });
    const runId = randomUUID();
    first.repository.putRun({
      id: runId,
      startedAt: '2026-10-25T00:00:00.000Z',
      endedAt: '2026-10-25T00:01:00.000Z',
      phase: 'stopped',
      config: first.repository.getConfig(),
      error: null,
    });
    new RunLog(runId, first.repository.logPath(runId)).write('info', 'only first player');
    first.repository.putMatch(match(runId));
    const recorder = new ReplayRecorder('generals');
    recorder.capture({ gameId: 'private-game', attackIndex: 0, observation: fixtureObservation() });
    await first.replays.save(recorder.getReplay()!);
    expect(first.repository.dataDir).not.toBe(second.repository.dataDir);
    expect(second.repository.getRun(runId)).toBeNull();
    for (const [id, total, command] of [
      [a.id, 1, 'first-agent'],
      [b.id, 0, 'second-agent'],
    ] as const) {
      const dashboard = (
        await app.inject({ url: `/api/dashboard?playerId=${id}`, headers })
      ).json();
      expect(dashboard.config.command).toBe(command);
      expect(dashboard.stats.total).toBe(total);
      expect((await app.inject({ url: `/api/matches?playerId=${id}`, headers })).json().total).toBe(
        total,
      );
      expect(
        (await app.inject({ url: `/api/matches/star-history?playerId=${id}`, headers })).json()
          .items,
      ).toHaveLength(total);
    }
    for (const path of [
      `/api/runs/${runId}/logs/download`,
      '/api/replays/generals/private-game',
      '/api/replays/generals/private-game/download',
    ]) {
      expect((await app.inject({ url: `${path}?playerId=${a.id}`, headers })).statusCode).toBe(200);
      expect((await app.inject({ url: `${path}?playerId=${b.id}`, headers })).statusCode).toBe(404);
    }
    const log = await app.inject({
      url: `/api/runs/${runId}/logs/download?playerId=${a.id}`,
      headers,
    });
    expect(log.body).toContain('only first player');
    expect((await app.inject({ url: '/api/players', headers })).json()).toHaveLength(2);
  });

  it('pins explicit SSE streams while switching active player and running two independent controllers', async () => {
    const identities: string[] = [];
    const factory: GameFactory = async (_config, player) => {
      identities.push(`${player.server}:${player.userId}`);
      const game: GameConnection = {
        connect: async () => {},
        join: (signal) =>
          new Promise((_resolve, reject) => {
            signal.throwIfAborted();
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
        next: async () => {
          throw new Error('Not reached');
        },
        submit: () => 'pass',
        close: () => {},
      };
      return game;
    };
    const { app, manager } = await api(factory);
    const { a, b } = await addPair(manager);
    const streamA = await events(app, a.id);
    const streamB = await events(app, b.id);
    for (const player of [a, b]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/runs?playerId=${player.id}`,
        headers,
        payload: defaultConfig,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().players).toHaveLength(2);
    }
    await vi.waitFor(() => expect(manager.dashboard(a.id).state.phase).toBe('queueing'));
    manager.select(a.id);
    manager.select(b.id);
    expect(manager.controller(a.id).active).toBe(true);
    expect(manager.controller(b.id).active).toBe(true);
    await app.inject({ method: 'POST', url: `/api/runs/stop?playerId=${a.id}`, headers });
    expect(manager.controller(a.id).active).toBe(false);
    expect(manager.controller(b.id).active).toBe(true);
    await vi.waitFor(() => expect(streamA.at(-1)!.state.phase).toBe('stopped'));
    expect(streamA.every((snapshot) => snapshot.player?.id === a.id)).toBe(true);
    expect(streamB.every((snapshot) => snapshot.player?.id === b.id)).toBe(true);
    expect(identities).toEqual(['generals:same-account', 'generals:second-account']);
    await manager.controller(b.id).stop();
  });

  it('recovers interrupted records independently for every Player after a restart', async () => {
    const { manager, dir } = setup();
    const { a, b } = await addPair(manager);
    const runIds = [randomUUID(), randomUUID()];
    for (const [index, player] of [a, b].entries()) {
      const repository = manager.controller(player.id).repository;
      repository.saveConfig({ ...defaultConfig, command: player.nickname });
      repository.putRun({
        id: runIds[index]!,
        startedAt: '2026-10-25T00:00:00.000Z',
        endedAt: null,
        phase: 'playing',
        config: repository.getConfig(),
        error: null,
      });
      repository.putMatch({ ...match(runIds[index]!), outcome: null, endedAt: null });
    }
    await manager.close();
    const restarted = new PlayerManager(dir, resolve('.'), undefined, nicknameLookup);
    cleanups.push(() => restarted.close());
    for (const [index, player] of [a, b].entries()) {
      const dashboard = restarted.dashboard(player.id);
      expect(dashboard.state).toMatchObject({
        phase: 'failed',
        run: { id: runIds[index], error: '服务重启，前次运行已中断' },
      });
      expect(dashboard.config.command).toBe(player.nickname);
      expect(dashboard.stats.interrupted).toBe(1);
      expect(dashboard.matches).toHaveLength(1);
      expect(dashboard.matches[0]!.outcome).toBe('interrupted');
    }
  });

  it('waits for every controller shutdown before closing any repository when one shutdown fails', async () => {
    const { manager } = setup();
    const { a, b } = await addPair(manager);
    const first = manager.controller(a.id);
    const second = manager.controller(b.id);
    const firstRepository = vi.spyOn(first.repository, 'close');
    const secondRepository = vi.spyOn(second.repository, 'close');
    vi.spyOn(first, 'close').mockRejectedValue(new Error('first shutdown failed'));
    let finish!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      finish = resolveGate;
    });
    const closeSecond = second.close.bind(second);
    vi.spyOn(second, 'close').mockImplementation(async () => {
      await gate;
      await closeSecond();
    });
    const result = manager.close().catch((error: unknown) => error);
    await Promise.resolve();
    expect(firstRepository).not.toHaveBeenCalled();
    expect(secondRepository).not.toHaveBeenCalled();
    finish();
    expect(await result).toBeInstanceOf(AggregateError);
    expect(firstRepository).toHaveBeenCalledOnce();
    expect(secondRepository).toHaveBeenCalledOnce();
  });

  it('refuses missing registered Player data instead of replacing it with an empty repository', async () => {
    const { manager, dir } = setup();
    await manager.add(input);
    const configPath = join(manager.controller().repository.dataDir, 'config.json');
    await manager.close();
    rmSync(configPath);
    expect(() => new PlayerManager(dir, resolve('.'), undefined, nicknameLookup)).toThrow(
      'Player 数据目录不完整',
    );
    expect(() => readFileSync(configPath)).toThrow();
  });

  it('does not replace server nickname cache with match observations', async () => {
    const { manager, dir } = setup(async () => new FixtureGame());
    const { a, b } = await addPair(manager);
    manager.controller(a.id).start({
      ...defaultConfig,
      autopilot: false,
      command: process.execPath,
      args: [resolve('test/fixtures/pass-agent.mjs')],
    });
    await vi.waitFor(() => expect(manager.controller(a.id).active).toBe(false), { timeout: 5000 });
    expect(manager.dashboard(a.id).player!.nickname).toBe('first');
    expect(manager.dashboard(b.id).players.find((player) => player.id === a.id)!.nickname).toBe(
      'first',
    );
    expect(manager.dashboard(b.id).player!.nickname).toBe('second');
    await manager.close();
    const restarted = new PlayerManager(dir, resolve('.'), undefined, nicknameLookup);
    cleanups.push(() => restarted.close());
    expect(restarted.dashboard(a.id).player!.nickname).toBe('first');
    expect(restarted.dashboard(a.id).stats.won).toBe(1);
    expect(restarted.dashboard(b.id).stats.total).toBe(0);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function persisted(manager: PlayerManager) {
  return JSON.parse(readFileSync(join(manager.dataDir, 'players.json'), 'utf8')) as PlayerRegistry;
}

describe('server nickname cache lifecycle', () => {
  it('rejects manually supplied nicknames before any lookup', async () => {
    const lookup = vi.fn(nicknameLookup);
    const { app, manager } = await api(undefined, lookup);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/players',
          headers,
          payload: { ...input, nickname: 'manual' },
        })
      ).statusCode,
    ).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
    expect(manager.players).toEqual([]);
  });

  it.each(['offline', '', ' ', 'x'.repeat(201)])(
    'does not create/cache a fake nickname for %j',
    async (nickname) => {
      const lookup = vi.fn(async () => {
        if (nickname === 'offline') throw new Error('secret-userId');
        return nickname;
      });
      const { app, manager, dir } = await api(undefined, lookup);
      const response = await app.inject({
        method: 'POST',
        url: '/api/players',
        headers,
        payload: input,
      });
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain('secret-userId');
      expect(manager.players).toEqual([]);
      expect(persisted(manager).players).toEqual([]);
      expect(existsSync(join(dir, 'players'))).toBe(false);
    },
  );

  it('checks duplicate identity both before and after awaiting a concurrent lookup', async () => {
    const gate = deferred<string>();
    const lookup = vi.fn(() => gate.promise);
    const { manager } = setup(undefined, lookup);
    const first = manager.add(input);
    const second = manager.add({ ...input, userId: ' same-account ' });
    const results = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    gate.resolve('server-name');
    expect((await results).map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(manager.players).toHaveLength(1);
    await expect(manager.add(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each(['cancel', 'close'] as const)(
    'discards late lookup after %s and never publishes a Player',
    async (mode) => {
      const gate = deferred<string>();
      const lookup = vi.fn(() => gate.promise);
      const { manager, dir } = setup(undefined, lookup);
      const abort = new AbortController();
      const pending = manager.add(input, abort.signal).catch((error: unknown) => error);
      await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
      if (mode === 'close') await manager.close();
      else abort.abort();
      expect(await pending).toMatchObject({ statusCode: 502 });
      gate.resolve('too late');
      await Promise.resolve();
      await Promise.resolve();
      expect(manager.players).toEqual([]);
      expect(persisted(manager).players).toEqual([]);
      expect(existsSync(join(dir, 'players'))).toBe(false);
      if (mode === 'close')
        await expect(manager.add(input)).rejects.toMatchObject({ statusCode: 409 });
    },
  );

  it('persists successful startup refresh once and never queries for dashboard/SSE snapshots', async () => {
    const { manager, dir } = setup();
    const player = (await manager.add(input)).player!;
    await manager.close();
    const gate = deferred<string>();
    const lookup = vi.fn(() => gate.promise);
    const restarted = new PlayerManager(dir, dir, undefined, lookup);
    cleanups.push(() => restarted.close());
    expect(restarted.dashboard().player!.nickname).toBe('first');
    gate.resolve('renamed on server');
    await vi.waitFor(() =>
      expect(restarted.dashboard().player!.nickname).toBe('renamed on server'),
    );
    const app = await createApp(restarted, join(dir, 'no-web'));
    cleanups.push(() => app.close());
    const stream = await events(app, player.id);
    for (let i = 0; i < 10; i++) restarted.select(player.id);
    await vi.waitFor(() => expect(stream.length).toBeGreaterThan(1));
    expect(lookup).toHaveBeenCalledOnce();
    expect(persisted(restarted).players[0]!.nickname).toBe('renamed on server');
    await app.close();
    const offline = new PlayerManager(dir, dir, undefined, async () => {
      throw new Error('offline');
    });
    cleanups.push(() => offline.close());
    await Promise.resolve();
    expect(offline.dashboard().player!.nickname).toBe('renamed on server');
  });

  it('keeps the cached nickname and logs its cause when persistence fails', async () => {
    const { manager } = setup();
    const player = (await manager.add(input)).player!;
    const failure = new Error('registry disk unavailable');
    vi.spyOn(
      manager as unknown as { persist(registry: PlayerRegistry): void },
      'persist',
    ).mockImplementationOnce(() => {
      throw failure;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateNickname = (
      manager as unknown as {
        updateNickname(playerId: string, nickname: string): void;
      }
    ).updateNickname;

    updateNickname.call(manager, player.id, 'new server nickname');

    expect(manager.players[0]!.nickname).toBe(player.nickname);
    expect(persisted(manager).players[0]!.nickname).toBe(player.nickname);
    expect(log).toHaveBeenCalledWith('无法持久化 Player 昵称缓存，已保留原缓存', failure);
  });

  it.each(['delete', 'close'] as const)('discards late startup refresh after %s', async (mode) => {
    const { manager, dir } = setup();
    const player = (await manager.add(input)).player!;
    await manager.close();
    const gate = deferred<string>();
    const lookup = vi.fn(() => gate.promise);
    const restarted = new PlayerManager(dir, dir, undefined, lookup);
    cleanups.push(() => restarted.close());
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    if (mode === 'delete') await restarted.remove(player.id);
    else await restarted.close();
    gate.resolve('late server-name');
    await Promise.resolve();
    await Promise.resolve();
    expect(persisted(restarted).players).toEqual(mode === 'delete' ? [] : [player]);
  });

  it('initializes an empty current registry without reading root legacy data or account files', async () => {
    const { manager, dir } = setup();
    await manager.close();
    rmSync(join(dir, 'players.json'));
    writeFileSync(join(dir, 'config.json'), '{old invalid config');
    writeFileSync(join(dir, 'panel.sqlite'), 'do not open this old database');
    const lookup = vi.fn(nicknameLookup);
    const restarted = new PlayerManager(dir, join(dir, 'missing-root'), undefined, lookup);
    cleanups.push(() => restarted.close());
    expect(restarted.players).toEqual([]);
    expect(persisted(restarted)).toEqual({ version: 1, activePlayerId: null, players: [] });
    expect(readFileSync(join(dir, 'panel.sqlite'), 'utf8')).toBe('do not open this old database');
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{old invalid config');
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('local Player deletion', () => {
  it('provides complete confirmation details, including durable runs/logs/replays and stats', async () => {
    const { manager, app } = await api();
    const { a, b } = await addPair(manager);
    const first = manager.controller(a.id);
    const runId = randomUUID();
    first.repository.putRun({
      id: runId,
      startedAt: '2026-10-25T00:00:00.000Z',
      endedAt: '2026-10-25T00:01:00.000Z',
      phase: 'stopped',
      config: defaultConfig,
      error: null,
    });
    first.repository.putMatch(match(runId));
    new RunLog(runId, first.repository.logPath(runId)).write('info', 'one local log');
    const recorder = new ReplayRecorder('generals');
    recorder.capture({ gameId: 'private-game', attackIndex: 0, observation: fixtureObservation() });
    await first.replays.save(recorder.getReplay()!);
    const response = await app.inject({ url: `/api/players/${a.id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      player: a,
      dataDir: first.repository.dataDir,
      phase: 'idle',
      active: false,
      runs: 1,
      matches: 1,
      stats: { total: 1, won: 1, lost: 0, draw: 0, interrupted: 0, winRate: 1 },
      logs: 1,
      replays: 1,
      lastRunAt: '2026-10-25T00:00:00.000Z',
    });
    expect((await app.inject({ url: `/api/players/${b.id}`, headers })).json()).toMatchObject({
      runs: 0,
      matches: 0,
      logs: 0,
      replays: 0,
      lastRunAt: null,
    });
    expect((await app.inject({ url: '/api/players/missing', headers })).statusCode).toBe(404);
  });

  it('removes Players from the registry while retaining their files across restart', async () => {
    const lookup = vi.fn(nicknameLookup);
    const { manager, app, dir } = await api(undefined, lookup);
    const { a, b } = await addPair(manager);
    const first = manager.controller(a.id);
    const second = manager.controller(b.id);
    second.saveConfig({ ...defaultConfig, command: 'remaining-agent' });
    mkdirSync(join(second.repository.dataDir, 'server-generals', 'remaining'), { recursive: true });
    const replay = join(
      second.repository.dataDir,
      'server-generals',
      'remaining',
      'replay.json.gz',
    );
    writeFileSync(replay, 'other replay bytes');
    const log = join(second.repository.dataDir, 'logs', 'other.jsonl');
    writeFileSync(log, 'other log bytes');
    first.saveConfig({ ...defaultConfig, command: 'removed-agent' });
    const runId = randomUUID();
    first.repository.putMatch(match(runId));
    const firstDir = first.repository.dataDir;
    const firstConfig = readFileSync(join(firstDir, 'config.json'));
    const firstLog = join(firstDir, 'logs', 'retained.jsonl');
    writeFileSync(firstLog, 'removed log bytes');
    const replayDir = join(firstDir, 'server-generals', 'retained');
    mkdirSync(replayDir, { recursive: true });
    const firstReplay = join(replayDir, 'replay.json.gz');
    writeFileSync(firstReplay, 'removed replay bytes');
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/players/${a.id}?playerId=${b.id}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      player: b,
      players: [b],
      config: { command: 'remaining-agent' },
    });
    expect(existsSync(firstDir)).toBe(true);
    expect(readFileSync(join(firstDir, 'config.json'))).toEqual(firstConfig);
    const retained = new Repository(firstDir);
    expect(retained.getConfig().command).toBe('removed-agent');
    expect(retained.matches(1, 1).total).toBe(1);
    retained.close();
    expect(readFileSync(firstLog, 'utf8')).toBe('removed log bytes');
    expect(readFileSync(firstReplay, 'utf8')).toBe('removed replay bytes');
    expect(() => manager.controller(a.id)).toThrow('Player 不存在');
    expect(readFileSync(replay, 'utf8')).toBe('other replay bytes');
    expect(readFileSync(log, 'utf8')).toBe('other log bytes');
    expect(lookup).toHaveBeenCalledTimes(2); // Deletion never touches the remote account.
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/players/${b.id}?playerId=${b.id}`,
          headers,
        })
      ).json(),
    ).toMatchObject({ player: null, players: [], dataDir: dir });
    expect(persisted(manager)).toEqual({ version: 1, activePlayerId: null, players: [] });
    await app.close();
    const restarted = new PlayerManager(dir, dir, undefined, nicknameLookup);
    cleanups.push(() => restarted.close());
    expect(restarted.dashboard().player).toBeNull();
    expect(restarted.players).toEqual([]);
    expect(existsSync(firstDir)).toBe(true);
    expect(readFileSync(replay, 'utf8')).toBe('other replay bytes');
    expect(readFileSync(log, 'utf8')).toBe('other log bytes');
  });

  it('chooses a remaining fallback when deleting the selected Player, without changing another workspace response', async () => {
    const { manager, app } = await api();
    const { a, b } = await addPair(manager);
    const c = (await manager.add({ ...input, userId: 'third' })).player!;
    manager.select(a.id);
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/players/${a.id}?playerId=${c.id}`,
      headers,
    });
    expect(response.json().player.id).toBe(c.id);
    expect(manager.dashboard().player!.id).toBe(b.id);
    expect(persisted(manager).activePlayerId).toBe(b.id);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/players/missing', headers })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/players/${b.id}?playerId=missing`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(manager.players).toHaveLength(2);
  });

  it('rejects a running target even if the confirmation details were previously idle', async () => {
    const gate = deferred<void>();
    const game = new FixtureGame();
    vi.spyOn(game, 'connect').mockImplementation(async (signal) => {
      await Promise.race([
        gate.promise,
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
      ]);
    });
    const { manager, app } = await api(async () => game);
    const a = (await manager.add(input)).player!;
    expect(manager.details(a.id).active).toBe(false);
    manager.controller(a.id).start(defaultConfig);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/players/${a.id}`, headers })).statusCode,
    ).toBe(409);
    expect(manager.details(a.id).active).toBe(true);
    expect(manager.players).toHaveLength(1);
    await manager.controller(a.id).stop();
    gate.resolve();
  });

  it('locks starts/config/select and duplicate deletion throughout asynchronous close', async () => {
    const { manager, app } = await api();
    const a = (await manager.add(input)).player!;
    const controller = manager.controller(a.id);
    const gate = deferred<void>();
    const close = controller.close.bind(controller);
    vi.spyOn(controller, 'close').mockImplementation(async () => {
      const pending = close();
      await gate.promise;
      await pending;
    });
    const deleting = manager.remove(a.id);
    expect(() => controller.start(defaultConfig)).toThrow('正在关闭');
    expect(() => controller.saveConfig(defaultConfig)).toThrow('正在关闭');
    expect(() => manager.select(a.id)).toThrow('正在删除');
    expect(() => manager.remove(a.id)).toThrow('停止');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/runs?playerId=${a.id}`,
          headers,
          payload: defaultConfig,
        })
      ).statusCode,
    ).toBe(409);
    gate.resolve();
    expect((await deleting).player).toBeNull();
    expect(() => controller.start(defaultConfig)).toThrow('正在关闭');
  });

  it('retains the directory and reopens the Player if registry persistence fails', async () => {
    const { manager, dir } = setup();
    const { a, b } = await addPair(manager);
    const first = manager.controller(a.id);
    first.saveConfig({ ...defaultConfig, command: 'retained-agent' });
    const original = readFileSync(join(dir, 'players.json'), 'utf8');
    const persist = vi
      .spyOn(manager as unknown as { persist(registry: PlayerRegistry): void }, 'persist')
      .mockImplementationOnce(() => {
        throw new Error('disk unavailable');
      });
    await expect(manager.remove(a.id, b.id)).rejects.toThrow('disk unavailable');
    persist.mockRestore();
    expect(readFileSync(join(dir, 'players.json'), 'utf8')).toBe(original);
    expect(manager.dashboard(a.id).config.command).toBe('retained-agent');
    expect(manager.players).toHaveLength(2);
    expect(existsSync(join(dir, '.player-trash'))).toBe(false);
    manager.controller(a.id).saveConfig(defaultConfig);
    await manager.remove(a.id);
    expect(manager.players).toEqual([b]);
  });

  it('continues failed-Player rollback and retains the persistence and cleanup errors', async () => {
    const { manager, dir } = setup();
    const persistError = new Error('registry unavailable');
    const closeError = new Error('repository close failed');
    const directoryError = new Error('player directory unavailable');
    const closeRepository = Repository.prototype.close;
    vi.spyOn(Repository.prototype, 'close').mockImplementationOnce(function (this: Repository) {
      closeRepository.call(this);
      throw closeError;
    });
    const paths = manager as unknown as {
      playerDirectory(playerId: string, create?: boolean): string;
    };
    const resolvePlayerDirectory = paths.playerDirectory.bind(manager);
    const playerDirectory = vi.spyOn(paths, 'playerDirectory').mockImplementation((id, create) => {
      if (!create) throw directoryError;
      return resolvePlayerDirectory(id, create);
    });
    vi.spyOn(
      manager as unknown as { persist(registry: PlayerRegistry): void },
      'persist',
    ).mockImplementationOnce(() => {
      throw persistError;
    });

    const failure = await manager.add(input).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([persistError, closeError, directoryError]);
    expect((failure as AggregateError).cause).toBe(persistError);
    expect(playerDirectory).toHaveBeenCalledTimes(2);
    const [playerId] = readdirSync(join(dir, 'players'));
    expect(playerId).toBeDefined();
    expect(() => manager.controller(playerId!)).toThrow('Player 不存在');
    expect(manager.players).toEqual([]);
  });

  it('keeps the original directory in place when removal is published', async () => {
    const { manager, dir } = setup();
    const player = (await manager.add(input)).player!;
    const directory = manager.controller(player.id).repository.dataDir;
    const published = vi.fn(() => {
      expect(existsSync(directory)).toBe(true);
      expect(existsSync(join(dir, '.player-trash'))).toBe(false);
    });
    const unsubscribe = manager.subscribe(published);
    try {
      expect((await manager.remove(player.id)).player).toBeNull();
    } finally {
      unsubscribe();
    }
    expect(published).toHaveBeenCalledOnce();
    expect(manager.players).toEqual([]);
  });

  it('signals deleted pinned SSE streams and only updates player lists on other streams', async () => {
    const { manager, app } = await api();
    const { a, b } = await addPair(manager);
    const target = await events(app, a.id);
    const other = await events(app, b.id);
    const snapshot = other[0]!;
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/players/${a.id}?playerId=${a.id}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().player.id).toBe(b.id);
    await vi.waitFor(() => expect(target.ended).toBe(true));
    expect(target.deleted).toEqual([a.id]);
    expect(target).toHaveLength(1);
    await vi.waitFor(() => expect(other.at(-1)!.players).toEqual([b]));
    expect(other.at(-1)).toEqual({ ...snapshot, players: [b] });
    expect(other.deleted).toEqual([]);
    expect(other.ended).toBe(false);
  });

  it('never follows symlinked Player parents or artifacts outside the target', async () => {
    const { manager, dir } = setup();
    const { a, b } = await addPair(manager);
    const other = manager.controller(b.id).repository.dataDir;
    const sentinel = join(other, 'keep');
    writeFileSync(sentinel, 'outside bytes');
    const first = manager.controller(a.id).repository.dataDir;
    symlinkSync(other, join(first, 'outside'));
    const logs = join(first, 'logs');
    rmSync(logs, { recursive: true });
    symlinkSync(other, logs);
    expect(manager.details(a.id).logs).toBe(0);
    const parent = join(dir, 'players');
    const saved = join(dir, 'players-saved');
    renameSync(parent, saved);
    symlinkSync(saved, parent);
    expect(() => manager.remove(a.id)).toThrow('符号链接');
    rmSync(parent);
    renameSync(saved, parent);
    await manager.remove(a.id);
    expect(readFileSync(sentinel, 'utf8')).toBe('outside bytes');
    expect(manager.players).toEqual([b]);
  });
});
