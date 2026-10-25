import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { starHistoryOption } from './StarHistoryChart';

function ratedMatch(before: number | null, after: number | null, delta: number | null) {
  return {
    id: 'match',
    runId: 'run',
    mode: 'live',
    server: 'generals',
    gameId: 'game',
    opponent: 'opponent',
    startedAt: '2026-10-25T06:00:00Z',
    endedAt: '2026-10-25T06:05:00Z',
    outcome: 'won',
    turns: 50,
    replayUrl: null,
    rating: { username: 'self', before, after, delta, source: 'public-profile', capturedAt: null },
  } as MatchRecord;
}

function seriesFor(record: MatchRecord) {
  return (
    starHistoryOption([record]).series as {
      data: unknown;
      tooltip: { formatter: () => string };
    }[]
  )[0]!;
}

describe('StarHistoryChart rating trust', () => {
  it('retains only the after observation when two known values are not comparable', () => {
    const series = seriesFor(ratedMatch(84, 84.25927300637274, null));
    expect(series.data).toEqual([
      [0, null],
      [1, 84.25927300637274],
    ]);
    expect(series.tooltip.formatter()).toContain('不可比较');
    expect(series.tooltip.formatter()).toContain('不计算涨跌');
    expect(series.tooltip.formatter()).not.toContain('+0.3');
  });

  it('preserves null gaps and genuine comparable zero values', () => {
    expect(seriesFor(ratedMatch(0, null, null)).data).toEqual([
      [0, 0],
      [1, null],
    ]);
    expect(seriesFor(ratedMatch(null, 0, null)).data).toEqual([
      [0, null],
      [1, 0],
    ]);
    expect(seriesFor(ratedMatch(0, 0, 0)).data).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(seriesFor(ratedMatch(1, 0, -1)).data).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });
});
