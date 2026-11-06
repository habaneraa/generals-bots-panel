import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index.js';
import { parseReplay } from '../../../../packages/contracts/src/replay.js';
import { fixtureObservation, FixtureGame } from '../../../../test/fixtures/game.js';
import { AgentProcess } from '../agent/process.js';
import { createApp } from '../app.js';
import type { Controller } from '../controller.js';
import type { GameConnection, GameEnd, GameFrame, SubmitStatus } from '../game/types.js';
import { PlayerManager } from '../player-manager.js';
import { ReplayRecorder } from '../game/recorder.js';
import { ReplayStore } from './replays.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'panel-replay-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function frame(turn = 0): GameFrame {
  return {
    gameId: 'recorded-game',
    startedAt: '2026-10-25T00:00:00.000Z',
    attackIndex: 0,
    observation: { ...fixtureObservation(), turn },
  };
}
function recorded() {
  const recorder = new ReplayRecorder('bots');
  recorder.capture(frame());
  return recorder.getReplay()!;
}

describe('isolated replay storage', () => {
  it('stores gzip atomically in the selected server and game directory and reloads it', async () => {
    const dir = directory();
    const store = new ReplayStore(dir);
    const replay = recorded();
    await store.save(replay);
    expect(store.path('bots', replay.gameId)).toBe(
      join(dir, 'server-bots', 'recorded-game', 'replay.json.gz'),
    );
    expect(JSON.parse(gunzipSync((await store.packed('bots', replay.gameId))!).toString())).toEqual(
      replay,
    );
    expect(await store.load('bots', replay.gameId)).toEqual(replay);
    expect(await new ReplayStore(dir).load('bots', replay.gameId)).toEqual(replay);
    expect(await store.load('generals', replay.gameId)).toBeNull();
    expect(statSync(store.path('bots', replay.gameId)).mode & 0o777).toBe(0o600);
    expect(() => store.path('bots', '../secret')).toThrow();
    expect(() => store.path('bad' as 'bots', 'recorded-game')).toThrow();
  });

  it('rejects invalid data without replacing an existing recording', async () => {
    const store = new ReplayStore(directory());
    const replay = recorded();
    await store.save(replay);
    const invalid = structuredClone(replay);
    invalid.frames[0]!.keyframe = [];
    await expect(store.save(invalid)).rejects.toThrow();
    expect(await store.load('bots', replay.gameId)).toEqual(replay);
  });
});

const config = {
  ...defaultConfig,
  autopilot: false,
  command: process.execPath,
  args: [resolve('test/fixtures/pass-agent.mjs')],
};
async function setup(game: GameConnection = new FixtureGame()) {
  const dir = directory();
  const manager = new PlayerManager(
    dir,
    resolve('.'),
    async () => game,
    async () => 'test player',
  );
  await manager.add({ server: 'bots', userId: 'test-account' });
  const controller = manager.controller();
  const repository = controller.repository;
  cleanups.push(async () => {
    await manager.close();
  });
  return { dir: repository.dataDir, repository, controller, manager };
}
async function idle(controller: Controller) {
  if (!controller.active) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Controller did not stop'));
    }, 5000);
    const unsubscribe = controller.subscribe(() => {
      if (!controller.active) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}

describe('replay lifecycle and HTTP API without network games', () => {
  it('marks completed matches only after saving and exposes JSON/gzip with safe paths', async () => {
    const { controller, repository, manager } = await setup();
    controller.start(config);
    await idle(controller);
    const match = repository.matches().items[0]!;
    expect(match).toMatchObject({ outcome: 'won', localReplay: true });
    const app = await createApp(manager, resolve('nonexistent-web'));
    cleanups.push(() => app.close());
    const headers = { host: '127.0.0.1:3000' };
    const path = `/api/replays/bots/${match.gameId}`;
    const response = await app.inject({ url: path, headers });
    expect(response.statusCode).toBe(200);
    expect(parseReplay(response.json())).toMatchObject({
      gameId: match.gameId,
      outcome: 'won',
      server: 'bots',
    });
    const download = await app.inject({ url: `${path}/download`, headers });
    expect(download.headers['content-type']).toBe('application/gzip');
    expect(JSON.parse(gunzipSync(download.rawPayload).toString())).toEqual(response.json());
    expect((await app.inject({ url: '/api/replays/bots/missing', headers })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/replays/generals/${match.gameId}`, headers })).statusCode,
    ).toBe(404);
    expect((await app.inject({ url: '/api/replays/unknown/game', headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/replays/bots/..%2Fsecret', headers })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ url: path, headers: { host: 'attacker.invalid' } })).statusCode,
    ).toBe(403);
  });

  it('saves an interrupted game when agent startup fails', async () => {
    const { controller, repository } = await setup();
    controller.start({ ...config, command: '/nonexistent-replay-test-agent' });
    await idle(controller);
    const match = repository.matches().items[0]!;
    expect(match).toMatchObject({ outcome: 'interrupted', localReplay: true });
    expect(await controller.replays.load('bots', match.gameId)).toMatchObject({
      outcome: 'interrupted',
      endedAt: expect.any(String),
      frames: [expect.any(Object)],
    });
    expect(controller.dashboard().state.phase).toBe('failed');
  });

  it('saves the visible prefix when stopped while waiting for a frame', async () => {
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    class WaitingGame extends FixtureGame {
      override async next(_turn: number, signal: AbortSignal): Promise<GameEnd> {
        signal.throwIfAborted();
        entered();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
    }
    const { controller, repository } = await setup(new WaitingGame());
    controller.start(config);
    await waiting;
    await controller.stop();
    const match = repository.matches().items[0]!;
    expect(match).toMatchObject({ outcome: 'interrupted', localReplay: true });
    expect(await controller.replays.load('bots', match.gameId)).toMatchObject({
      outcome: 'interrupted',
    });
    expect(controller.dashboard().state.phase).toBe('stopped');
  });

  it.each([false, true])('records subprocess move decisions with dryRun=%s', async (dryRun) => {
    const { controller, repository } = await setup();
    controller.start({
      ...config,
      dryRun,
      args: [
        '--input-type=module',
        '-e',
        `
        import { createInterface } from 'node:readline';
        for await (const line of createInterface({ input: process.stdin })) {
          if (JSON.parse(line).event === 'observation') process.stdout.write('0 0 0 3 1\\n');
        }
      `,
      ],
    });
    await idle(controller);
    const match = repository.matches().items[0]!;
    expect((await controller.replays.load('bots', match.gameId))!.actions).toEqual([
      {
        frame: 0,
        turn: 0,
        player: 0,
        from: 0,
        to: 1,
        split: true,
        status: dryRun ? 'dry-run' : 'sent',
      },
    ]);
  });

  it('records a successful retry in the fallback recording', async () => {
    const action = { pass: false, row: 0, col: 0, direction: 3, split: false, value: null };
    class RetryGame extends FixtureGame {
      private gameId = '';
      private calls = 0;
      override async join(signal: AbortSignal) {
        const frame = await super.join(signal);
        this.gameId = frame.gameId;
        return frame;
      }
      currentFrame() {
        return {
          gameId: this.gameId,
          observation: { ...fixtureObservation(), turn: 1 },
          attackIndex: 0,
        };
      }
      override submit(frame: GameFrame): SubmitStatus {
        this.calls++;
        return frame.observation.turn === 0 ? 'stale' : 'sent';
      }
    }
    const game = new RetryGame();
    vi.spyOn(AgentProcess, 'start').mockResolvedValue({
      begin: vi.fn(),
      act: vi.fn(async () => action),
      end: vi.fn(),
      close: vi.fn(async () => {}),
    } as unknown as AgentProcess);
    const { controller, repository } = await setup(game);
    controller.start(config);
    await idle(controller);
    const match = repository.matches().items[0]!;
    const replay = (await controller.replays.load('bots', match.gameId))!;
    // 兜底录像必须补采重投所在帧，否则动作无法绑定。
    expect(replay.frames.map((frame) => frame.turn)).toEqual([0, 1]);
    // 旧帧的过期尝试与重投成功各记一条，保留完整轨迹。
    expect(replay.actions).toEqual([
      expect.objectContaining({ turn: 0, status: 'stale' }),
      expect.objectContaining({ turn: 1, status: 'sent' }),
    ]);
  });

  it('saves a distinct recording for each autopilot game', async () => {
    const { controller, repository } = await setup();
    controller.start({ ...config, autopilot: true, maxGames: 2, cooldownMs: 0 });
    await idle(controller);
    const matches = repository.matches().items;
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(match.localReplay).toBe(true);
      expect(await controller.replays.load('bots', match.gameId)).toMatchObject({
        gameId: match.gameId,
        outcome: 'won',
      });
    }
  });

  it('logs a persistence failure without changing the completed result', async () => {
    const { controller, repository } = await setup();
    vi.spyOn(controller.replays, 'save').mockRejectedValue(new Error('disk unavailable'));
    controller.start(config);
    await idle(controller);
    expect(repository.matches().items[0]).toMatchObject({ outcome: 'won' });
    expect(repository.matches().items[0]!.localReplay).not.toBe(true);
    expect(controller.dashboard().state.phase).toBe('stopped');
    expect(
      controller
        .dashboard()
        .logs.some((entry) => entry.level === 'warn' && entry.message.includes('录像保存失败')),
    ).toBe(true);
  });

  it('does not invent a recording for a game ending before its first board', async () => {
    const game: GameConnection = {
      connect: async () => {},
      join: async () => ({ gameId: 'early-end', outcome: 'lost', turn: 0 }),
      next: async () => {
        throw new Error('Not reached');
      },
      submit: () => 'pass',
      close: () => {},
    };
    const { controller, repository } = await setup(game);
    controller.start(config);
    await idle(controller);
    expect(repository.matches().items[0]!.localReplay).not.toBe(true);
    expect(await controller.replays.load('bots', 'early-end')).toBeNull();
  });

  it('reports file system errors rather than treating them as missing recordings', async () => {
    const dir = directory();
    await mkdir(join(dir, 'server-bots'), { recursive: true });
    await writeFile(join(dir, 'server-bots', 'blocked-game'), 'not a directory');
    await expect(new ReplayStore(dir).packed('bots', 'blocked-game')).rejects.toThrow();
  });
});
