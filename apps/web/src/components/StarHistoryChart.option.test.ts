import { describe, expect, it, vi } from 'vitest';
import type { StarHistoryItem } from '../../../../packages/contracts/src/index';
import { groupStarHistory, starHistoryOption } from './StarHistoryChart';

const start = Date.parse('2026-10-25T06:00:00Z');
function match(
  index: number,
  after: number | null,
  overrides: Partial<StarHistoryItem> = {},
): StarHistoryItem {
  return {
    id: `match-${index}`,
    runId: 'run',
    server: 'generals',
    gameId: `game-${index}`,
    startedAt: new Date(start + index * 600000).toISOString(),
    endedAt: new Date(start + index * 600000 + 300000).toISOString(),
    rating: {
      username: 'self',
      before: null,
      after,
      delta: null,
      source: 'public-profile',
      capturedAt: null,
    },
    ...overrides,
  };
}
function series(records: StarHistoryItem[]) {
  return starHistoryOption(records).series as {
    id: string;
    type: string;
    data: (
      | { value: [number, number | null]; record?: StarHistoryItem; symbolSize: number }
      | [number, number | null]
    )[];
    lineStyle: { type?: string };
    connectNulls: boolean;
    areaStyle?: unknown;
  }[];
}
function values(records: StarHistoryItem[]) {
  return (series(records)[0]!.data as { value: [number, number | null] }[]).map((p) => p.value);
}

describe('complete Star history options', () => {
  it('defaults to the full range with inside pan, box selection and a clean slider', () => {
    const option = starHistoryOption([match(0, 10), match(1, 11)]);
    expect(option.dataZoom).toEqual([
      expect.objectContaining({
        type: 'inside',
        start: 0,
        end: 100,
        moveOnMouseMove: true,
        zoomOnMouseWheel: true,
      }),
      expect.objectContaining({
        type: 'slider',
        start: 0,
        end: 100,
        showDataShadow: false,
        showDetail: false,
        fillerColor: 'transparent',
      }),
    ]);
    for (const zoom of option.dataZoom as Record<string, unknown>[]) {
      expect(zoom).not.toHaveProperty('minSpan');
    }
    expect(option.toolbox).toMatchObject({
      feature: {
        dataZoom: { yAxisIndex: 'none', title: { zoom: '框选放大' } },
        restore: { title: '恢复完整历史' },
      },
    });
    expect(option.tooltip).toMatchObject({ shadowBlur: 0 });
    expect(series([match(0, 10)]).every((s) => s.type === 'line' && !s.areaStyle)).toBe(true);
  });

  it('switches the toolbox back from box selection to drag panning', () => {
    const toolbox = starHistoryOption([]).toolbox as {
      feature: { myPan: { onclick: (model: unknown, api: unknown) => void } };
    };
    const dispatchAction = vi.fn();
    toolbox.feature.myPan.onclick(null, { dispatchAction });
    expect(dispatchAction).toHaveBeenCalledWith({
      type: 'takeGlobalCursor',
      key: 'dataZoomSelect',
      dataZoomSelectActive: false,
    });
  });

  it('uses measured after values and time coordinates, not an incomparable integer baseline', () => {
    const record = match(0, 84.25927300637274);
    record.rating!.before = 84;
    expect(values([record])).toEqual([[start + 300000, 84.25927300637274]]);
    const option = starHistoryOption([record]);
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    const data = series([record])[0]!.data[0];
    const text = tooltip.formatter([{ seriesId: 'stars', data }]);
    expect(text).toContain('84.3 Star');
    expect(text).toContain('公开采样');
    expect(text).not.toContain('+0.3');
    expect(text).not.toContain('84.0');
  });

  it('keeps a comparable first baseline and raw precision without negative zero labels', () => {
    const record = match(0, 1235.789);
    Object.assign(record.rating!, { before: 1234.56, delta: 1.229 });
    expect(values([record])).toEqual([
      [start, 1234.56],
      [start + 300000, 1235.789],
    ]);
    const axis = starHistoryOption([record]).yAxis as {
      minInterval: number;
      axisLabel: { formatter: (n: number) => string };
    };
    expect(axis.minInterval).toBe(0.1);
    expect(axis.axisLabel.formatter(12)).toBe('12.0');
    expect(axis.axisLabel.formatter(-0.04)).toBe('0.0');
  });

  it('connects only measured endpoints across missing records with a dashed segment', () => {
    const records = [
      match(0, 10),
      match(1, null, { rating: undefined }),
      match(2, null),
      match(3, 12),
    ];
    expect(values(records)).toEqual([
      [start + 300000, 10],
      [start + 900000, null],
      [start + 1500000, null],
      [start + 2100000, 12],
    ]);
    const gaps = series(records)[1]!;
    expect(gaps.lineStyle.type).toBe('dashed');
    expect(gaps.connectNulls).toBe(false);
    expect(gaps.data).toEqual([
      [start + 300000, 10],
      [start + 2100000, 12],
      [start + 2100000, null],
    ]);
  });

  it('does not connect separate missing intervals together', () => {
    const gaps = series([
      match(0, 10),
      match(1, null),
      match(2, 11),
      match(3, null),
      match(4, 12),
    ])[1]!;
    expect(gaps.data).toHaveLength(6);
    expect(gaps.data[2]).toEqual([start + 1500000, null]);
    expect(gaps.data[5]).toEqual([start + 2700000, null]);
  });

  it('does not invent endpoints for leading, trailing or wholly missing scores', () => {
    const records = [match(0, null), match(1, 0), match(2, null)];
    expect(values(records).map((p) => p[1])).toEqual([null, 0, null]);
    expect(series(records)[1]!.data).toEqual([]);
    expect(series([match(0, null)])[1]!.data).toEqual([]);
    const known = series(records)[0]!.data[1] as { symbolSize: number };
    expect(known.symbolSize).toBe(4);
  });

  it('breaks the solid line and never adds a dashed comparison across different sources', () => {
    const terminal = match(0, 84);
    terminal.rating!.source = 'terminal';
    const profile = match(1, 84.25927300637274);
    expect(values([terminal, profile]).map((p) => p[1])).toEqual([84, null, 84.25927300637274]);
    expect(series([terminal, match(1, null), match(2, 84.2)])[1]!.data).toEqual([]);
  });

  it('does not assume that two unknown sources are comparable', () => {
    const a = match(0, 12),
      b = match(1, 13);
    a.rating!.source = null;
    b.rating!.source = null;
    expect(values([a, b]).map((p) => p[1])).toEqual([12, null, 13]);
  });

  it('orders observations by end time and falls back to start time for pending records', () => {
    const a = match(1, 12, { endedAt: null }),
      b = match(0, 10);
    expect(values([a, b])).toEqual([
      [start + 300000, 10],
      [start + 600000, 12],
    ]);
  });

  it('retains missing records for a run with one known account and merges that account across runs', () => {
    const a = match(0, 12),
      missing = match(1, null, { rating: undefined }),
      b = match(2, 13, { runId: 'other-run' });
    const groups = [...groupStarHistory([b, missing, a]).values()];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((r) => r.id)).toEqual([a.id, missing.id, b.id]);
  });

  it('does not assign an account to an ambiguous run or mix accounts and servers', () => {
    const a = match(0, 12),
      b = match(1, 13),
      unknown = match(2, null, { rating: undefined });
    b.rating!.username = 'other';
    const groups = groupStarHistory([a, b, unknown, match(3, 14, { server: 'bots' })]);
    expect(groups.size).toBe(3);
    expect([...groups.values()].flat().some((r) => r.id === unknown.id)).toBe(false);
  });
});
