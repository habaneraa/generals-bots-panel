import type {
  MatchPlayerSnapshot,
  MatchRecord,
  Outcome,
} from '../../../../packages/contracts/src/index';
import { describe, expect, it } from 'vitest';
import { summarizeMatchStatistics } from './statsEngine';

function match(
  id: string,
  outcome: Outcome | null,
  turns = 100,
  opponent = 'Opponent',
): MatchRecord {
  return {
    id,
    runId: 'run-1',
    mode: 'live',
    server: 'generals',
    gameId: `game-${id}`,
    opponent,
    startedAt: '2026-11-03T00:00:00.000Z',
    endedAt: null,
    outcome,
    turns,
    replayUrl: null,
  };
}

function matchWithOpponentStars(
  id: string,
  outcome: Outcome | null,
  startedAt: string,
  stars: number | null,
): MatchRecord {
  const player = (
    index: number,
    isSelf: boolean,
    username: string,
    playerStars: number | null,
  ): MatchPlayerSnapshot => ({
    index,
    isSelf,
    userId: null,
    username,
    stars: playerStars,
    team: null,
    land: null,
    army: null,
    cities: null,
    visibleCities: null,
    alive: null,
  });
  return {
    ...match(id, outcome, 100, 'Opponent'),
    startedAt,
    details: {
      initial: null,
      last: {
        turn: 100,
        serverTurn: 100,
        capturedAt: startedAt,
        gameType: '1v1',
        teams: [],
        modifiers: [],
        torus: false,
        map: null,
        players: [player(0, true, 'Self', 40), player(1, false, 'Opponent', stars)],
      },
      durationMs: null,
      winnerIndex: null,
      endReason: null,
      agent: {
        observations: 0,
        decisions: 0,
        submittedMoves: 0,
        passes: 0,
        skippedMoves: 0,
        staleMoves: 0,
        rejectedMoves: 0,
        skippedTurns: 0,
        retriedMoves: 0,
        splitMoves: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0,
      },
    },
  };
}

describe('summarizeMatchStatistics', () => {
  it('uses disjoint turn boundaries and leaves invalid turns unclassified', () => {
    const result = summarizeMatchStatistics([
      match('99', 'won', 99),
      match('100', 'lost', 100),
      match('499', 'interrupted', 499),
      match('500', 'won', 500),
      match('negative', 'draw', -1),
      match('invalid', null, Number.NaN),
    ]);

    expect(result.turnGroups).toMatchObject([
      { label: '0–99', records: 1, won: 1, completed: 1, winRate: 1 },
      {
        label: '100–499',
        records: 2,
        lost: 1,
        interrupted: 1,
        completed: 1,
        winRate: 0,
      },
      { label: '500+', records: 1, won: 1, completed: 1, winRate: 1 },
    ]);
    expect(result.unclassifiedTurns).toBe(2);
  });

  it('ranks frequent opponents and only compares win rates with three completed games', () => {
    const result = summarizeMatchStatistics([
      match('a1', 'won', 100, 'Alpha'),
      match('a2', 'won', 100, 'Alpha'),
      match('a3', 'won', 100, 'Alpha'),
      match('a4', 'lost', 100, ' alpha '),
      match('a5', 'interrupted', 100, 'Alpha'),
      match('a6', null, 100, 'Alpha'),
      match('b1', 'won', 100, 'Beta'),
      match('b2', 'won', 100, 'Beta'),
      match('b3', 'won', 100, 'Beta'),
      match('c1', 'lost', 100, 'Gamma'),
      match('c2', 'lost', 100, 'Gamma'),
      match('c3', 'lost', 100, 'Gamma'),
      match('d1', 'won', 100, 'One-off'),
      match('empty', 'won', 100, '   '),
    ]);

    expect(result.frequentOpponents[0]).toMatchObject({
      name: 'Alpha',
      games: 6,
      won: 3,
      lost: 1,
      interrupted: 1,
      playing: 1,
      completed: 4,
      winRate: 0.75,
    });
    expect(result.eligibleOpponentCount).toBe(3);
    expect(result.highestWinRateOpponents[0]).toMatchObject({ name: 'Beta', winRate: 1 });
    expect(result.lowestWinRateOpponents[0]).toMatchObject({ name: 'Gamma', winRate: 0 });
    expect(result.opponents).toHaveLength(4);
  });

  it('uses the latest completed opponent snapshot and ignores a later ongoing match', () => {
    const result = summarizeMatchStatistics([
      matchWithOpponentStars('older', 'won', '2026-11-01T00:00:00.000Z', 68.5),
      matchWithOpponentStars('latest', 'lost', '2026-11-02T00:00:00.000Z', 72.25),
      matchWithOpponentStars('ongoing', null, '2026-11-03T00:00:00.000Z', 99),
    ]);

    expect(result.opponents[0]?.stars).toBe(72.25);
  });

  it('does not fall back to older stars when the latest completed snapshot has none', () => {
    const result = summarizeMatchStatistics([
      matchWithOpponentStars('older', 'won', '2026-11-01T00:00:00.000Z', 68.5),
      matchWithOpponentStars('latest', 'lost', '2026-11-02T00:00:00.000Z', null),
    ]);

    expect(result.opponents[0]?.stars).toBeNull();
  });
});
