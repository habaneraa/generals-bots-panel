import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { formatStars, StarChange } from './StarChange';
import { StarHistoryChart, starHistoryOption } from './StarHistoryChart';

function match(rating: MatchRecord['rating']): MatchRecord {
  return {
    id: 'precision-match',
    runId: 'precision-run',
    mode: 'live',
    server: 'generals',
    gameId: 'precision-game',
    opponent: 'opponent',
    startedAt: '2026-10-25T06:00:00Z',
    endedAt: '2026-10-25T06:05:00Z',
    outcome: 'won',
    turns: 50,
    replayUrl: null,
    rating,
  };
}

const rating = {
  username: 'player',
  before: 1234.56,
  after: 1235.789,
  delta: 1.229,
  source: 'terminal' as const,
  capturedAt: '2026-10-25T06:05:00Z',
};

function renderChange(value: MatchRecord['rating']) {
  return renderToStaticMarkup(createElement(StarChange, { match: match(value) }));
}

describe('Star display precision', () => {
  it.each([
    [12, '12.0'],
    [12.34, '12.3'],
    [12.36, '12.4'],
    [1234.56, '1,234.6'],
    [-1.26, '-1.3'],
    [0, '0.0'],
    [-0, '0.0'],
    [-0.04, '0.0'],
    [-0.05, '-0.1'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatStars(value)).toBe(expected);
  });

  it('formats positive and negative deltas and rating values to one decimal', () => {
    const html = renderChange(rating);
    expect(html).toContain('+1.2');
    expect(html).toContain('1,234.6');
    expect(html).toContain('1,235.8');
    expect(renderChange({ ...rating, delta: -1.26 })).toContain('-1.3');
  });

  it('keeps zero distinct from unknown ratings without displaying negative zero', () => {
    const zero = renderChange({ ...rating, before: 0, after: 0, delta: 0 });
    expect(zero).toContain('0.0');
    expect(zero).not.toContain('未记录');
    expect(zero).not.toContain('+0.0');
    expect(renderChange({ ...rating, delta: -0.04 })).not.toContain('-0.0');
    const unknown = renderChange({ ...rating, before: 0, after: null, delta: null });
    expect(unknown).toContain('0.0');
    expect(unknown).toContain('—');
    expect(unknown).toContain('未记录');
    expect(renderChange(undefined)).toContain('未记录');
  });

  it('formats axis labels, tooltips and latest stars without rounding chart data', () => {
    const record = match(rating);
    const option = starHistoryOption([record]);
    const axis = option.yAxis as {
      minInterval: number;
      axisLabel: { formatter: (value: number) => string };
    };
    expect(axis.minInterval).toBe(0.1);
    expect(axis.axisLabel.formatter(12)).toBe('12.0');
    expect(axis.axisLabel.formatter(-0.04)).toBe('0.0');
    const series = option.series as {
      data: unknown;
      tooltip: { formatter: () => string };
    }[];
    expect(series[0]?.data).toEqual([
      [0, 1234.56],
      [1, 1235.789],
    ]);
    expect(series[0]?.tooltip.formatter()).toContain('赛前 1,234.6\n赛后 1,235.8\nStar 变化 +1.2');
    const html = renderToStaticMarkup(createElement(StarHistoryChart, { matches: [record] }));
    expect(html).toContain('最近赛后 1,235.8 ★');
  });
});
