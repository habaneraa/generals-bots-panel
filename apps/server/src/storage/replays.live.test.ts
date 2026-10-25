import { describe, expect, it, vi } from 'vitest';
import { parseReplay, ReplayTimeline } from '../../../../packages/contracts/src/replay.js';
import { SocketGame } from '../game/live.js';
import { isGameEnd } from '../game/types.js';

const socket = vi.hoisted(() => ({
  event: null as ((event: string, args: unknown[]) => void) | null,
  joined: 0,
  sent: [] as unknown[][],
}));
vi.mock('../game/socket.js', () => ({
  abortError: (signal: AbortSignal) => signal.reason,
  GameSocket: class {
    constructor(_endpoint: string, callbacks: { event: typeof socket.event }) {
      socket.event = callbacks.event;
      socket.joined = 0;
      socket.sent = [];
    }
    async connect() {}
    async request() {
      return ['[Bot]self'];
    }
    emit(event: string, ...args: unknown[]) {
      socket.sent.push([event, ...args]);
      if (event !== 'join_1v1') return;
      socket.event!('game_start', [
        {
          game_type: '1v1',
          replay_id: `capture-${++socket.joined}`,
          playerIndex: 1,
          usernames: ['enemy', 'self'],
        },
      ]);
      socket.event!('game_update', [
        {
          turn: 1,
          attackIndex: 0,
          map: [3, 1, 5, 0, 8, 0, -3, 1],
          generals: [0, 2],
          cities: [],
          scores: [
            { i: 0, tiles: 1, total: 5 },
            { i: 1, tiles: 1, total: 8 },
          ],
        },
      ]);
    }
    close() {}
  },
}));

describe('recording at the decoded game event boundary', () => {
  it('retains intermediate updates while no next frame is being requested', async () => {
    const game = new SocketGame('bots', 'private-account-id');
    const signal = new AbortController().signal;
    await game.connect(signal);
    const first = await game.join(signal);
    if (isGameEnd(first)) throw new Error('Expected opening frame');
    socket.event!('game_update', [{ turn: 2, map_diff: [4, 1, 9, 3] }]);
    socket.event!('game_update', [{ turn: 3, map_diff: [4, 1, 10, 3] }]);
    const action = { pass: false, row: 0, col: 2, direction: 2, split: false, value: null };
    const status = game.submit(first, action);
    expect(status).toBe('stale');
    game.recordAction(first, action, status);
    const latest = await game.next(0, signal);
    expect(latest).toMatchObject({ observation: { turn: 2 } });
    const replay = parseReplay(game.getReplay());
    expect(replay.frames.map((frame) => frame.turn)).toEqual([0, 1, 2]);
    expect(new ReplayTimeline(replay).seek(2).cells).toEqual([4, 0, 5, 0, -3, 0, 4, 1, 10]);
    expect(replay.actions).toEqual([
      { frame: 0, turn: 0, player: 1, from: 2, to: 1, split: false, status: 'stale' },
    ]);
    expect(JSON.stringify(replay)).not.toContain('private-account-id');
    socket.event!('game_won', []);
    expect(await game.next(2, signal)).toMatchObject({ outcome: 'won' });
    expect(game.getReplay()!.frames).toHaveLength(3);
    game.close();
  });

  it('binds a decision to its original board when the same turn is updated during inference', async () => {
    const game = new SocketGame('bots', 'private-account-id');
    const signal = new AbortController().signal;
    await game.connect(signal);
    const first = await game.join(signal);
    if (isGameEnd(first)) throw new Error('Expected opening frame');
    expect(first.replayFrameIndex).toBe(0);
    socket.event!('game_update', [{ turn: 1, map_diff: [4, 1, 9, 3] }]);
    const action = { pass: false, row: 0, col: 2, direction: 2, split: false, value: null };
    game.recordAction(first, action, game.submit(first, action));
    const replay = parseReplay(game.getReplay());
    expect(replay.frames.map((entry) => entry.turn)).toEqual([0, 0]);
    expect(replay.actions[0]!.frame).toBe(0);
    const timeline = new ReplayTimeline(replay);
    expect(timeline.seek(0).cells[8]).toBe(8);
    expect(timeline.seek(1).cells[8]).toBe(9);
    socket.event!('game_update', [{ turn: 2, attackIndex: 1 }]);
    const next = await game.next(0, signal);
    expect(next).toMatchObject({ replayFrameIndex: 2 });
    game.close();
  });

  it('seals a valid prefix and warns once when capture fails', async () => {
    const log = vi.fn();
    const game = new SocketGame('bots', 'private-account-id', undefined, log);
    const signal = new AbortController().signal;
    await game.connect(signal);
    await game.join(signal);
    socket.event!('game_update', [{ turn: 2 }]);
    socket.event!('game_update', [{ turn: 1 }]);
    socket.event!('game_update', [{ turn: 1 }]);
    expect(parseReplay(game.getReplay())).toMatchObject({ truncated: true });
    expect(game.getReplay()!.frames).toHaveLength(2);
    expect(
      log.mock.calls.filter(([message]) => String(message).startsWith('本地录像')),
    ).toHaveLength(1);
    game.close();
  });

  it('records sent actions only explicitly and resets the recorder for the next game', async () => {
    const game = new SocketGame('bots', 'private-account-id');
    const signal = new AbortController().signal;
    await game.connect(signal);
    const first = await game.join(signal);
    if (isGameEnd(first)) throw new Error('Expected opening frame');
    const action = { pass: false, row: 0, col: 2, direction: 2, split: true, value: null };
    const status = game.submit(first, action);
    expect(status).toBe('sent');
    expect(socket.sent).toContainEqual(['attack', 2, 1, true, 1]);
    expect(game.getReplay()!.actions).toEqual([]);
    game.recordAction(first, action, status);
    expect(game.getReplay()!.actions).toHaveLength(1);
    socket.event!('game_lost', []);
    await game.next(0, signal);
    await game.join(signal);
    expect(game.getReplay()).toMatchObject({
      gameId: 'capture-2',
      actions: [],
      frames: [expect.any(Object)],
    });
    game.close();
  });
});
