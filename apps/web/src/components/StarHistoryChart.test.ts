import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { MatchHistoryRow } from './MatchHistoryRow';
import { StarChange } from './StarChange';
import { groupStarHistory, StarHistoryChart } from './StarHistoryChart';

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
  it('highlights gains in green, keeps the cell on one line and titles the range', () => {
    const html = renderChange(match());
    expect(html).toContain('text-green-700');
    expect(html).toContain('+1.5');
    expect(html).not.toContain('12.0 → 13.5');
    expect(html).toContain('赛前 12.0，赛后 13.5');
  });

  it('highlights losses in red and preserves a real zero rating', () => {
    const record = match();
    Object.assign(record.rating!, { before: 1, after: 0, delta: -1 });
    const html = renderChange(record);
    expect(html).toContain('text-red-600');
    expect(html).toContain('-1.0');
    expect(html).toContain('赛前 1.0，赛后 0.0');
  });

  it('distinguishes no change from missing measurements and old records', () => {
    const record = match();
    Object.assign(record.rating!, { before: 0, after: 0, delta: 0 });
    expect(renderChange(record)).toContain('赛前 0.0，赛后 0.0');
    expect(renderChange(record)).toContain('bg-amber-100');
    expect(renderChange(record)).not.toContain('未记录');
    Object.assign(record.rating!, { after: null, delta: null });
    expect(renderChange(record)).toContain('缺赛后值');
    expect(renderChange(record)).toContain('bg-surface-subtle');
    expect(renderChange(record)).toContain('赛前 0.0，赛后 —');
    delete record.rating;
    expect(renderChange(record)).toContain('未记录');
    expect(renderChange(record)).toContain('bg-surface-subtle');
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

  it('keeps the single-account chart free of metric cards and decorative labels', () => {
    const html = renderToStaticMarkup(createElement(StarHistoryChart, { matches: [match()] }));
    expect(html).toContain('Star 历史');
    expect(html).not.toContain('最近赛后');
    expect(html).not.toContain('当前页');
    expect(html).not.toContain('绿涨');
    expect(html).not.toContain('场有评分记录');
    expect(html).not.toContain('shadow');
  });

  it('shows only the necessary empty state when no usable observations exist', () => {
    const html = renderToStaticMarkup(createElement(StarHistoryChart, { matches: [] }));
    expect(html).toContain('暂无可用的赛后 Star 记录');
    expect(html).not.toContain('当前页');
    expect(html).not.toContain('结算延迟');
  });
});
