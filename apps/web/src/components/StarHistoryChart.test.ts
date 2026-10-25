import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { MatchHistoryRow } from './MatchHistoryRow';
import { StarChange } from './StarChange';
import { groupStarHistory, StarHistoryChart, starHistoryOption } from './StarHistoryChart';

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'match-1',
    runId: 'run-1',
    mode: 'live',
    server: 'generals',
    gameId: 'game-1',
    opponent: 'opponent',
    startedAt: '2026-10-25T06:00:00Z',
    endedAt: '2026-10-25T06:05:00Z',
    outcome: 'won',
    turns: 50,
    replayUrl: null,
    rating: {
      username: 'player',
      before: 12,
      after: 13.5,
      delta: 1.5,
      source: 'terminal',
      capturedAt: '2026-10-25T06:05:00Z',
    },
    ...overrides,
  };
}

const renderChange = (record: MatchRecord) =>
  renderToStaticMarkup(createElement(StarChange, { match: record }));

describe('StarChange', () => {
  it('highlights gains in green with a plus sign and before/after values', () => {
    const html = renderChange(match());
    expect(html).toContain('text-green-700');
    expect(html).toContain('+1.5');
    expect(html).toContain('12 → 13.5');
  });

  it('highlights losses in red and preserves a real zero rating', () => {
    const record = match();
    Object.assign(record.rating!, { before: 1, after: 0, delta: -1 });
    const html = renderChange(record);
    expect(html).toContain('text-red-600');
    expect(html).toContain('-1');
    expect(html).toContain('1 → 0');
  });

  it('distinguishes no change from missing measurements and old records', () => {
    const record = match();
    Object.assign(record.rating!, { before: 0, after: 0, delta: 0 });
    expect(renderChange(record)).toContain('0 → 0');
    expect(renderChange(record)).not.toContain('未记录');
    Object.assign(record.rating!, { after: null, delta: null });
    expect(renderChange(record)).toContain('未记录');
    expect(renderChange(record)).toContain('0 → —');
    delete record.rating;
    expect(renderChange(record)).toContain('未记录');
  });

  it('includes the rating change in history rows', () => {
    const html = renderToStaticMarkup(
      createElement(
        'table',
        null,
        createElement(
          'tbody',
          null,
          createElement(MatchHistoryRow, { match: match(), onOpen: () => {} }),
        ),
      ),
    );
    expect(html).toContain('Star 变化：');
    expect(html).toContain('+1.5');
  });
});

describe('StarHistoryChart', () => {
  it('orders games chronologically without mutating the history page', () => {
    const newer = match({ id: 'newer', startedAt: '2026-10-25T07:00:00Z' });
    const older = match({ id: 'older' });
    const input = [newer, older];
    const groups = [...groupStarHistory(input).values()];
    expect(groups[0]?.map((record) => record.id)).toEqual(['older', 'newer']);
    expect(input.map((record) => record.id)).toEqual(['newer', 'older']);
  });

  it('separates servers and accounts and ignores wholly missing ratings', () => {
    const otherAccount = match();
    otherAccount.rating = { ...otherAccount.rating!, username: 'other' };
    const unknown = match();
    unknown.rating = { ...unknown.rating!, before: null, after: null, delta: null };
    const groups = groupStarHistory([
      match(),
      match({ server: 'bots' }),
      otherAccount,
      unknown,
      match({ rating: undefined }),
    ]);
    expect(groups.size).toBe(3);
  });

  it('does not bridge missing measurements or invent a zero', () => {
    const pending = match();
    pending.rating = { ...pending.rating!, after: null, delta: null };
    const option = starHistoryOption([pending, match()]);
    const series = option.series as {
      data: unknown;
      connectNulls: boolean;
      lineStyle: { color: string };
    }[];
    expect(series[0]?.data).toEqual([
      [0, 12],
      [1, null],
    ]);
    expect(series[0]?.connectNulls).toBe(false);
    expect(series[1]?.data).toEqual([
      [1, 12],
      [2, 13.5],
    ]);
    expect(series[1]?.lineStyle.color).toBe('#15803d');
  });

  it('labels its page scope and missing-data state', () => {
    const html = renderToStaticMarkup(createElement(StarHistoryChart, { matches: [] }));
    expect(html).toContain('当前页');
    expect(html).toContain('暂无 Star 记录');
    expect(html).toContain('结算延迟');
  });
});
