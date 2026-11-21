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
  openingArmy: 1000,
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
  socket.openingArmy = 1000;
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
        message: '自动投降：兵力 0/1000，低于敌方的 20%',
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
    [19, 100, 100, 1],
    [10, 1000, 1, 100],
    [11, 1000, 2, 100],
    [1, 101, 1, 101],
    [0, 1, 1, 1],
  ])('surrenders when army is below 20%%: %j/%j army, %j/%j land', async (...scores) => {
    const { game } = await connected();
    update(...scores);
    expect(surrenders()).toEqual([['surrender']]);
    game.close();
  });

  it.each([
    [20, 100, 1, 100],
    [1000, 1, 100, 1],
    [100, 100, 1, 101],
    [20, 100, 0, 100],
    [1, 0, 1, 0],
    [0, 0, 0, 0],
  ])('does not surrender at or above 20%%: %j/%j army, %j/%j land', async (...scores) => {
    const { game } = await connected();
    update(...scores);
    expect(surrenders()).toEqual([]);
    game.close();
  });

  it.each([0, 1])(
    'checks complete scores without waiting for a map or playable turn (%i)',
    async (turn) => {
      const game = new SocketGame('bots', 'private-account-id');
      await game.connect(new AbortController().signal);
      socket.event!('game_start', [
        {
          game_type: '1v1',
          replay_id: 'score-only-game',
          playerIndex: 0,
          usernames: ['self', 'enemy'],
          turn,
          scores: [
            { i: 0, tiles: 19, total: 24 },
            { i: 1, tiles: 346, total: 2866 },
          ],
        },
      ]);
      expect(game.getSnapshot()?.snapshot.map).toBeNull();
      expect(surrenders()).toEqual([['surrender']]);
      game.close();
    },
  );

  it('waits for both scores instead of treating an unknown score as zero', async () => {
    const game = new SocketGame('bots', 'private-account-id');
    await game.connect(new AbortController().signal);
    socket.event!('game_start', [
      {
        game_type: '1v1',
        replay_id: 'partial-score-game',
        playerIndex: 0,
        usernames: ['self', 'enemy'],
        scores: [{ i: 1, tiles: 346, total: 2866 }],
      },
    ]);
    expect(surrenders()).toEqual([]);
    update(24, 2866, 19, 346);
    expect(surrenders()).toEqual([['surrender']]);
    game.close();
  });

  it('waits for the terminal result when the opening frame triggers surrender', async () => {
    socket.openingArmy = 9;
    const game = new SocketGame('bots', 'private-account-id');
    const signal = new AbortController().signal;
    await game.connect(signal);
    const received = vi.fn();
    const pending = game.join(signal).then(received);
    try {
      expect(surrenders()).toEqual([['surrender']]);
      await Promise.resolve();
      expect(received).not.toHaveBeenCalled();
    } finally {
      socket.event!('game_lost', []);
      await pending;
      game.close();
    }
    expect(received).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: 'lost', endReason: 'game_lost' }),
    );
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

  it.each(['before', 'after'] as const)(
    'waits for the terminal result when next() starts %s surrender',
    async (timing) => {
      const { game, signal } = await connected();
      const received = vi.fn();
      if (timing === 'after') update(24, 2866, 19, 346);
      const pending = game.next(0, signal).then(received);
      try {
        if (timing === 'before') update(24, 2866, 19, 346);
        await Promise.resolve();
        socket.event!('game_update', [{ turn: 3, attackIndex: 100 }]);
        await Promise.resolve();
        expect(received).not.toHaveBeenCalled();
        expect(surrenders()).toEqual([['surrender']]);
      } finally {
        socket.event!('game_lost', []);
        await pending;
        game.close();
      }
      expect(received).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ outcome: 'lost', endReason: 'game_lost' }),
      );
    },
  );

  it('rejects an in-flight decision even when surrender arrives on the same turn', async () => {
    const { game, frame } = await connected();
    socket.event!('game_update', [
      {
        turn: 1,
        scores: [
          { i: 0, tiles: 19, total: 24 },
          { i: 1, tiles: 346, total: 2866 },
        ],
      },
    ]);
    expect(
      game.submit(frame, { pass: false, row: 0, col: 0, direction: 3, split: false, value: null }),
    ).toBe('rejected');
    expect(socket.sent.some(([event]) => event === 'attack')).toBe(false);
    game.close();
  });

  it('times out an unconfirmed surrender instead of feeding normal turns to the agent', async () => {
    vi.useFakeTimers();
    const { game, signal } = await connected();
    try {
      update(24, 2866, 19, 346);
      const pending = game.next(0, signal).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      for (let turn = 3; turn <= 10; turn++) {
        socket.event!('game_update', [{ turn }]);
        await vi.advanceTimersByTimeAsync(5_000);
      }
      expect(await pending).toEqual({ error: new Error('Timed out waiting for game state') });
      expect(surrenders()).toEqual([['surrender']]);
    } finally {
      game.close();
      vi.useRealTimers();
    }
  });

  it('allows cancellation while waiting for a surrender confirmation', async () => {
    const { game } = await connected();
    const abort = new AbortController();
    update(24, 2866, 19, 346);
    const pending = game.next(0, abort.signal).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const reason = new Error('cancel surrender wait');
    abort.abort(reason);
    expect(await pending).toEqual({ error: reason });
    game.close();
  });

  it('accepts the surrender result even when an earlier attack is never acknowledged', async () => {
    const { game, frame, signal } = await connected();
    expect(
      game.submit(frame, { pass: false, row: 0, col: 0, direction: 3, split: false, value: null }),
    ).toBe('sent');
    const pending = game.next(0, signal);
    update(24, 2866, 19, 346);
    expect(surrenders()).toEqual([['surrender']]);
    socket.event!('game_lost', []);
    expect(await pending).toMatchObject({ outcome: 'lost', endReason: 'game_lost' });
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
