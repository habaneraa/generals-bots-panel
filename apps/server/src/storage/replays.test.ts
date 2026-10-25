import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index.js';
import { parseReplay, ReplayTimeline } from '../../../../packages/contracts/src/replay.js';
import { fixtureObservation, FixtureGame } from '../../../../test/fixtures/game.js';
import { createApp } from '../app.js';
import { Controller } from '../controller.js';
import type { GameConnection, GameEnd, GameFrame, SubmitStatus } from '../game/types.js';
import { Repository } from './repository.js';
import { ReplayRecorder, ReplayStore } from './replays.js';

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
const action = { pass: false, row: 0, col: 0, direction: 3, split: true, value: 0.5 };

describe('perspective capture and isolated replay storage', () => {
  it('captures full boards, deltas and 64-frame keyframes using raw player IDs', () => {
    const recorder = new ReplayRecorder('bots');
    for (let turn = 0; turn < 66; turn++) {
      const next = frame(turn);
      next.observation.armies[0]![0] = turn + 10;
      next.observation.types[0]![1] = 0;
      next.observation.player_grid[0]![1] = -3;
      next.observation.armies[0]![1] = 999;
      recorder.capture(next);
    }
    const replay = parseReplay(recorder.getReplay());
    expect(replay.frames[0]!.keyframe!.slice(0, 6)).toEqual([4, 0, 10, 0, -3, 0]);
    expect(replay.frames[1]!.delta).toEqual([0, 4, 0, 11]);
    expect(replay.frames[64]!.keyframe).toHaveLength(27);
    expect(new ReplayTimeline(replay).seek(65).cells[2]).toBe(75);
    expect(JSON.stringify(replay)).not.toContain('account');
  });

  it.each(['sent', 'stale', 'rejected', 'dry-run'] as SubmitStatus[])(
    'records %s once against the decision frame',
    (status) => {
      const recorder = new ReplayRecorder('bots');
      const first = frame();
      recorder.capture(first);
      recorder.capture(frame(1));
      recorder.recordAction(first, action, status);
      recorder.recordAction(first, { ...action, pass: true }, 'pass');
      expect(parseReplay(recorder.getReplay()).actions).toEqual([
        { frame: 0, turn: 0, player: 0, from: 0, to: 1, split: true, status },
      ]);
    },
  );

  it('keeps same-turn decisions tied to their source board, not the latest update', () => {
    const recorder = new ReplayRecorder('bots');
    const first = frame();
    recorder.capture(first);
    const updated = frame();
    updated.observation.armies[0]![0] = 99;
    recorder.capture(updated);
    recorder.recordAction(first, action, 'sent');
    const replay = parseReplay(recorder.getReplay());
    expect(first.replayFrameIndex).toBe(0);
    expect(updated.replayFrameIndex).toBe(1);
    expect(replay.actions[0]!.frame).toBe(0);
    const timeline = new ReplayTimeline(replay);
    expect(timeline.seek(0).cells[2]).toBe(10);
    expect(timeline.seek(1).cells[2]).toBe(99);
  });

  it('uses an earlier keyframe when a delta would be larger than the full board', () => {
    const recorder = new ReplayRecorder('bots');
    recorder.capture(frame());
    const updated = frame(1);
    updated.observation.armies = updated.observation.armies.map((row) =>
      row.map((army) => army + 1),
    );
    recorder.capture(updated);
    const replay = parseReplay(recorder.getReplay());
    expect(replay.frames[1]!.keyframe).toHaveLength(27);
    expect(replay.frames[1]!.delta).toBeUndefined();
  });

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

  it('retains the valid prefix if an incoming turn moves backwards', () => {
    const recorder = new ReplayRecorder('bots');
    recorder.capture(frame(1));
    expect(() => recorder.capture(frame(0))).toThrow('backwards');
    expect(parseReplay(recorder.getReplay()).frames.map((entry) => entry.turn)).toEqual([1]);
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
  server: 'bots',
  autopilot: false,
  command: process.execPath,
  args: [resolve('test/fixtures/pass-agent.mjs')],
};
function setup(game: GameConnection = new FixtureGame()) {
  const dir = directory();
  const repository = new Repository(dir);
  const controller = new Controller(repository, resolve('.'), async () => game);
  cleanups.push(async () => {
    await controller.close();
    repository.close();
  });
  return { dir, repository, controller };
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
    const { controller, repository } = setup();
    controller.start(config);
    await idle(controller);
    const match = repository.matches().items[0]!;
    expect(match).toMatchObject({ outcome: 'won', localReplay: true });
    const app = await createApp(controller, resolve('nonexistent-web'));
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
    const { controller, repository } = setup();
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
    const { controller, repository } = setup(new WaitingGame());
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
    const { controller, repository } = setup();
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

  it('saves a distinct recording for each autopilot game', async () => {
    const { controller, repository } = setup();
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
    const { controller, repository } = setup();
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
    const { controller, repository } = setup(game);
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
