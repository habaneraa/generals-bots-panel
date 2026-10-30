import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../packages/contracts/src/index.js';
import { Controller } from './controller.js';
import { RunLog } from './storage/logs.js';
import { Repository } from './storage/repository.js';
import { SocketGame } from './game/live.js';
import { isGameEnd } from './game/types.js';

const socket = vi.hoisted(() => ({
  event: null as ((event: string, args: unknown[]) => void) | null,
  sent: [] as unknown[][],
  joined: 0,
  player: 0,
  openingArmy: 10,
}));
vi.mock('./game/socket.js', () => ({
  abortError: (signal: AbortSignal) => signal.reason,
  GameSocket: class {
    constructor(_endpoint: string, handlers: { event: typeof socket.event }) {
      socket.event = handlers.event;
    }
    async connect() {}
    async request() {
      return ['[Bot]self'];
    }
    emit(event: string, ...args: unknown[]) {
      socket.sent.push([event, ...args]);
      if (event === 'surrender' && socket.openingArmy === 0) socket.event!('game_lost', []);
      if (event !== 'join_1v1') return;
      socket.event!('game_start', [
        {
          game_type: '1v1',
          replay_id: `surrender-${++socket.joined}`,
          playerIndex: socket.player,
          usernames: ['first', 'second'],
          turn: 1,
          map: [2, 1, 10, 10, 0, 1],
          scores: [
            { i: socket.player, tiles: 1, total: socket.openingArmy },
            { i: 1 - socket.player, tiles: 1, total: 1000 },
          ],
        },
      ]);
    }
    close() {}
  },
}));

beforeEach(() => {
  socket.sent = [];
  socket.joined = 0;
  socket.player = 0;
  socket.openingArmy = 10;
});

async function connected() {
  const log = vi.fn();
  const game = new SocketGame('bots', 'private-account-id', undefined, log);
  const signal = new AbortController().signal;
  await game.connect(signal);
  const frame = await game.join(signal);
  if (isGameEnd(frame)) throw new Error('Expected opening frame');
  return { game, signal, frame, log };
}

function update(myArmy: number, oppArmy: number, myLand: number, oppLand: number) {
  socket.event!('game_update', [
    {
      turn: 2,
      scores: [
        { i: 1 - socket.player, tiles: oppLand, total: oppArmy },
        { i: socket.player, tiles: myLand, total: myArmy },
      ],
    },
  ]);
}

const surrenders = () => socket.sent.filter(([event]) => event === 'surrender');

describe('automatic surrender outside the agent process', () => {
  it('persists the surrender trigger and scores at info level through the controller', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-surrender-'));
    const repository = new Repository(join(dir, 'data'));
    const controller = new Controller(repository, dir, {
      id: 'surrender-test',
      server: 'bots',
      userId: 'private-account-id',
      nickname: 'test',
    });
    socket.openingArmy = 0;
    try {
      controller.start({
        ...defaultConfig,
        autopilot: false,
      });
      await vi.waitFor(() => expect(controller.active).toBe(false));
      const dashboard = controller.dashboard();
      expect(dashboard.state.phase).toBe('stopped');
      const entries = dashboard.logs.filter((entry) => entry.message.startsWith('自动投降：'));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        level: 'info',
        message: '自动投降：兵力 0/1000，领地 1/1，低于敌方的 1%',
      });
      const runId = dashboard.state.run!.id;
      expect(new RunLog(runId, repository.logPath(runId)).tail()).toContainEqual(entries[0]);
    } finally {
      await controller.close();
      repository.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([0, 1])(
    'uses player %i scores and surrenders immediately without next()',
    async (player) => {
      socket.player = player;
      const { game, log } = await connected();
      expect(surrenders()).toEqual([]);
      update(10, 1001, 1, 1);
      expect(surrenders()).toEqual([['surrender']]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('自动投降'));
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-account-id');
      expect(game.getResult()).toBeNull();
      game.close();
    },
  );

  it.each([
    [10, 1001, 1, 1],
    [100, 100, 1, 101],
    [1, 101, 1, 101],
    [0, 1, 1, 1],
    [1, 1, 0, 1],
  ])('surrenders when either score is below 1%%: %j/%j army, %j/%j land', async (...scores) => {
    const { game } = await connected();
    update(...scores);
    expect(surrenders()).toEqual([['surrender']]);
    game.close();
  });

  it.each([
    [10, 1000, 1, 100],
    [11, 1000, 2, 100],
    [1000, 1, 100, 1],
    [1, 0, 1, 0],
    [0, 0, 0, 0],
  ])('does not surrender at or above 1%%: %j/%j army, %j/%j land', async (...scores) => {
    const { game } = await connected();
    update(...scores);
    expect(surrenders()).toEqual([]);
    game.close();
  });

  it('also checks the opening frame', async () => {
    socket.openingArmy = 9;
    const { game } = await connected();
    expect(surrenders()).toEqual([['surrender']]);
    game.close();
  });

  it('sends once per game and waits for the server to confirm the loss', async () => {
    const { game, signal } = await connected();
    update(1, 101, 1, 1);
    update(1, 102, 1, 1);
    expect(surrenders()).toEqual([['surrender']]);
    expect(game.getResult()).toBeNull();
    socket.event!('game_lost', []);
    expect(await game.next(0, signal)).toMatchObject({ outcome: 'lost', endReason: 'game_lost' });
    await game.join(signal);
    update(1, 101, 1, 1);
    expect(surrenders()).toEqual([['surrender'], ['surrender']]);
    game.close();
  });

  it('rejects attacks after surrender while the server result is pending', async () => {
    const { game, signal } = await connected();
    update(1, 101, 1, 1);
    const frame = await game.next(0, signal);
    if (isGameEnd(frame)) throw new Error('Expected pending server result');
    expect(
      game.submit(frame, { pass: false, row: 0, col: 0, direction: 3, split: false, value: null }),
    ).toBe('rejected');
    expect(socket.sent.some(([event]) => event === 'attack')).toBe(false);
    game.close();
  });

  it('still checks scores while an earlier attack is awaiting acknowledgment', async () => {
    const { game, frame } = await connected();
    expect(
      game.submit(frame, { pass: false, row: 0, col: 0, direction: 3, split: false, value: null }),
    ).toBe('sent');
    update(1, 101, 1, 1);
    expect(surrenders()).toEqual([['surrender']]);
    game.close();
  });

  it('does not surrender on updates after the game has ended', async () => {
    const { game } = await connected();
    socket.event!('game_won', []);
    update(1, 101, 1, 101);
    expect(surrenders()).toEqual([]);
    game.close();
  });
});
