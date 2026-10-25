import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index.js';
import { parseReplay } from '../../../../packages/contracts/src/replay.js';
import { fixtureObservation } from '../../../../test/fixtures/game.js';
import { ReplayRecorder, ReplayStore, finishReplay } from './replays.js';

const startedAt = '2026-10-25T00:00:00.000Z';
function frame(turn: number) {
  const observation = fixtureObservation();
  observation.turn = turn;
  observation.armies[0]![0] = observation.armies[0]![0]! + turn;
  return { gameId: 'limit-game', startedAt, attackIndex: 0, observation };
}
const action = { pass: false, row: 0, col: 0, direction: 3, split: false, value: null };

describe('bounded in-memory recording with small injected budgets', () => {
  it.each([
    { frames: 2, values: 1000, bytes: 100000, length: 2 },
    { frames: 100, values: 30, bytes: 100000, length: 1 },
    { frames: 100, values: 1000, bytes: 9500, length: 1 },
  ])('retains a valid prefix at $frames frames / $values values / $bytes bytes', (limits) => {
    const log = vi.fn();
    const recorder = new ReplayRecorder('bots', log, limits);
    const first = frame(0);
    recorder.capture(first);
    for (let turn = 1; turn < 10; turn++) recorder.capture(frame(turn));
    const replay = parseReplay(recorder.getReplay());
    expect(replay.truncated).toBe(true);
    expect(replay.frames).toHaveLength(limits.length);
    recorder.recordAction(first, action, 'sent');
    recorder.capture(frame(10));
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

  it('saves a truncated prefix with the actual completed result', async () => {
    const recorder = new ReplayRecorder('bots', undefined, {
      frames: 1,
      values: 1000,
      bytes: 100000,
    });
    recorder.capture(frame(0));
    recorder.capture(frame(1));
    const match: MatchRecord = {
      id: 'test-match',
      runId: 'test-run',
      mode: 'live',
      server: 'bots',
      gameId: 'limit-game',
      opponent: 'opponent fixture',
      startedAt,
      endedAt: '2026-10-25T00:00:30.000Z',
      outcome: 'won',
      turns: 60,
      replayUrl: null,
    };
    const dir = mkdtempSync(join(tmpdir(), 'panel-replay-limit-'));
    try {
      const store = new ReplayStore(dir);
      await store.save(finishReplay(recorder.getReplay()!, match));
      expect(await store.load('bots', 'limit-game')).toMatchObject({
        truncated: true,
        outcome: 'won',
        endedAt: match.endedAt,
        frames: [expect.any(Object)],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
