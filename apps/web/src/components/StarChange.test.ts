import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { formatStars, StarChange, starChangePresentation } from './StarChange';

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
    expect(unknown).toContain('缺赛后值');
    expect(renderChange(undefined)).toContain('未记录');
  });
});

describe('Star sampling status', () => {
  it.each([
    [undefined, '未记录'],
    [{ ...rating, before: null, after: null, delta: null }, '未记录'],
    [{ ...rating, before: null, delta: null }, '缺赛前值'],
    [{ ...rating, after: null, delta: null }, '缺赛后值'],
    [{ ...rating, before: 0, after: null, delta: null }, '缺赛后值'],
    [{ ...rating, before: 0, after: 0, delta: null }, '不可比较'],
  ] as const)('describes incomplete samples %# without inventing a delta', (value, label) => {
    expect(starChangePresentation(value).label).toBe(label);
    expect(starChangePresentation(value).note).not.toBeNull();
  });

  it('does not present mixed-precision observations as a gain', () => {
    const value = {
      ...rating,
      before: 84,
      after: 84.25927300637274,
      delta: null,
      source: 'public-profile' as const,
    };
    const html = renderChange(value);
    expect(html).toContain('不可比较');
    expect(html).toContain('采样来源或精度不一致');
    expect(html).not.toContain('未记录');
    expect(html).not.toContain('84.0 → 84.3');
    expect(html).not.toContain('+0.3');
  });

  it('keeps comparable precise samples and real zero changes distinct', () => {
    expect(
      starChangePresentation({
        ...rating,
        before: 84.25927300637274,
        after: 84.05996045942692,
        delta: -0.19931254694581924,
        source: 'public-profile',
      }),
    ).toEqual({ label: '-0.2', note: null });
    expect(starChangePresentation({ ...rating, before: 0, after: 0, delta: 0 })).toEqual({
      label: '0.0',
      note: null,
    });
  });
});
