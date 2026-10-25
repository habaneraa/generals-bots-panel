import { describe, expect, it } from 'vitest';
import { parseReplay, ReplayTimeline, type Replay } from './replay.js';

function fixture(): Replay {
  return {
    format: 'generals-replay',
    version: 1,
    server: 'bots',
    gameId: 'codec-game',
    startedAt: '2026-10-25T00:00:00.000Z',
    endedAt: null,
    outcome: null,
    winnerIndex: null,
    perspective: 1,
    width: 2,
    height: 1,
    tickMs: 500,
    keyframeInterval: 64,
    players: [
      { index: 0, username: 'enemy', team: 0 },
      { index: 1, username: 'self', team: 1 },
    ],
    frames: [
      {
        turn: 0,
        at: 0,
        keyframe: [0, -3, 0, 4, 1, 5],
        scores: [
          { index: 0, land: 1, army: 5 },
          { index: 1, land: 1, army: 5 },
        ],
      },
      {
        turn: 1,
        at: 500,
        delta: [0, 1, -1, 0, 1, 4, 1, 6],
        scores: [
          { index: 0, land: 1, army: 6 },
          { index: 1, land: 1, army: 6 },
        ],
      },
      {
        turn: 2,
        at: 1000,
        delta: [0, 1, 1, 3],
        scores: [
          { index: 0, land: 1, army: 6 },
          { index: 1, land: 2, army: 7 },
        ],
      },
    ],
    actions: [{ frame: 1, turn: 1, player: 1, from: 1, to: 0, split: false, status: 'sent' }],
  };
}

describe('versioned perspective replay codec', () => {
  it('round trips and seeks forward, backward and repeatedly without exposing its cache', () => {
    const replay = parseReplay(JSON.parse(JSON.stringify(fixture())));
    const timeline = new ReplayTimeline(replay);
    expect(timeline.seek(0).cells).toEqual([0, -3, 0, 4, 1, 5]);
    expect(timeline.seek(1).cells).toEqual([1, -1, 0, 4, 1, 6]);
    expect(timeline.seek(2).cells).toEqual([1, 1, 3, 4, 1, 6]);
    const board = timeline.seek(0).cells;
    board[0] = 99;
    expect(timeline.seek(0).cells[0]).toBe(0);
    expect(timeline.seek(2).frame.turn).toBe(2);
    expect(() => timeline.seek(-1)).toThrow(RangeError);
    expect(() => timeline.seek(3)).toThrow(RangeError);
  });

  it('seeks across periodic keyframes', () => {
    const replay = fixture();
    replay.frames = Array.from({ length: 130 }, (_, index) => ({
      turn: index,
      at: index * 500,
      scores: replay.frames[0]!.scores,
      ...(index % 64 === 0
        ? { keyframe: [1, 0, index, 4, 1, index] }
        : { delta: [0, 1, 0, index] }),
    }));
    const timeline = new ReplayTimeline(parseReplay(replay));
    expect(timeline.seek(129).cells).toEqual([1, 0, 129, 4, 1, 128]);
    expect(timeline.seek(63).cells).toEqual([1, 0, 63, 4, 1, 0]);
    expect(timeline.seek(64).cells).toEqual([1, 0, 64, 4, 1, 64]);
  });

  it.each([
    (replay: Replay) => {
      replay.version = 2 as 1;
    },
    (replay: Replay) => {
      replay.width = 100000000;
    },
    (replay: Replay) => {
      replay.gameId = '../secret';
    },
    (replay: Replay) => {
      replay.players[1]!.index = 0;
    },
    (replay: Replay) => {
      replay.frames[0]!.keyframe = [1, 0, 1];
    },
    (replay: Replay) => {
      delete replay.frames[0]!.keyframe;
      replay.frames[0]!.delta = [];
    },
    (replay: Replay) => {
      replay.frames[1]!.delta = [2, 1, 0, 1];
    },
    (replay: Replay) => {
      replay.frames[1]!.delta = [0, 1, 0];
    },
    (replay: Replay) => {
      replay.frames[1]!.delta = [0, 1, 0, 1, 0, 1, 0, 2];
    },
    (replay: Replay) => {
      replay.frames[1]!.delta = [0, 99, 0, 1];
    },
    (replay: Replay) => {
      replay.frames[0]!.keyframe![2] = 100;
    },
    (replay: Replay) => {
      replay.frames[0]!.keyframe![1] = 0;
    },
    (replay: Replay) => {
      replay.actions.push({ ...replay.actions[0]!, frame: 0, turn: 0 });
    },
    (replay: Replay) => {
      replay.frames[2]!.at = 1;
    },
    (replay: Replay) => {
      replay.frames[2]!.turn = 0;
    },
    (replay: Replay) => {
      replay.actions[0]!.frame = 999;
    },
    (replay: Replay) => {
      replay.actions[0]!.to = 2;
    },
    (replay: Replay) => {
      replay.actions[0]!.turn = 0;
    },
    (replay: Replay) => {
      replay.endedAt = '2020-01-01T00:00:00.000Z';
    },
  ])('rejects malformed or unsafe imports %#', (mutate) => {
    const replay = fixture();
    mutate(replay);
    expect(() => parseReplay(replay)).toThrow();
  });

  it('accepts an explicitly truncated prefix but not a false or invalid marker', () => {
    expect(parseReplay({ ...fixture(), truncated: true }).truncated).toBe(true);
    expect(() => parseReplay({ ...fixture(), truncated: false })).toThrow();
  });

  it('rejects repeated actions for the same turn, including across same-turn frames', () => {
    const replay = fixture();
    replay.actions.push({ ...replay.actions[0]! });
    expect(() => parseReplay(replay)).toThrow('action');
    replay.frames[2]!.turn = 1;
    replay.actions[1]!.frame = 2;
    expect(() => parseReplay(replay)).toThrow('action');
  });

  it('requires a keyframe at least every 64 frames', () => {
    const replay = fixture();
    replay.frames = [
      replay.frames[0]!,
      ...Array.from({ length: 64 }, (_, index) => ({
        turn: index + 1,
        at: index * 500,
        delta: [],
        scores: replay.frames[0]!.scores,
      })),
    ];
    expect(() => parseReplay(replay)).toThrow('keyframe');
  });
});
