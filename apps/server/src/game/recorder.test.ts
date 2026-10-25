import { describe, expect, it, vi } from 'vitest';
import { parseReplay, ReplayTimeline } from '../../../../packages/contracts/src/replay.js';
import { fixtureObservation } from '../../../../test/fixtures/game.js';
import { ReplayRecorder } from './recorder.js';
import type { GameFrame, SubmitStatus } from './types.js';

function frame(turn = 0): GameFrame {
  return {
    gameId: 'recorded-game',
    startedAt: '2026-10-25T00:00:00.000Z',
    attackIndex: 0,
    observation: { ...fixtureObservation(), turn },
  };
}
const action = { pass: false, row: 0, col: 0, direction: 3, split: true, value: 0.5 };

function changedFrame(turn: number): GameFrame {
  const next = frame(turn);
  next.observation.armies[0]![0]! += turn;
  return next;
}

describe('in-memory perspective recording', () => {
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

  it('retains the valid prefix if an incoming turn moves backwards', () => {
    const recorder = new ReplayRecorder('bots');
    recorder.capture(frame(1));
    expect(() => recorder.capture(frame(0))).toThrow('backwards');
    expect(parseReplay(recorder.getReplay()).frames.map((entry) => entry.turn)).toEqual([1]);
  });
});

describe('bounded recording with small injected budgets', () => {
  it.each([
    { frames: 2, values: 1000, bytes: 100000, length: 2 },
    { frames: 100, values: 30, bytes: 100000, length: 1 },
    { frames: 100, values: 1000, bytes: 9500, length: 1 },
  ])('retains a valid prefix at $frames frames / $values values / $bytes bytes', (limits) => {
    const log = vi.fn();
    const recorder = new ReplayRecorder('bots', log, limits);
    const first = frame(0);
    recorder.capture(first);
    for (let turn = 1; turn < 10; turn++) recorder.capture(changedFrame(turn));
    const replay = parseReplay(recorder.getReplay());
    expect(replay.truncated).toBe(true);
    expect(replay.frames).toHaveLength(limits.length);
    recorder.recordAction(first, action, 'sent');
    recorder.capture(changedFrame(10));
    recorder.truncate();
    expect(recorder.getReplay()).toEqual(replay);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('also reserves space for actions before appending them', () => {
    const log = vi.fn();
    const recorder = new ReplayRecorder('bots', log, { frames: 100, values: 1000, bytes: 9500 });
    const first = frame(0);
    recorder.capture(first);
    recorder.recordAction(first, action, 'sent');
    expect(parseReplay(recorder.getReplay())).toMatchObject({ truncated: true, actions: [] });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
