import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index.js';
import { fixtureObservation } from '../../../../test/fixtures/game.js';
import { ReplayRecorder } from '../game/recorder.js';
import { ReplayStore, finishReplay } from './replays.js';

const startedAt = '2026-10-25T00:00:00.000Z';
function frame(turn: number) {
  const observation = fixtureObservation();
  observation.turn = turn;
  observation.armies[0]![0] = observation.armies[0]![0]! + turn;
  return { gameId: 'limit-game', startedAt, attackIndex: 0, observation };
}

describe('truncated replay persistence', () => {
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
