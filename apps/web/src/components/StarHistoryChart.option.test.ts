import { init, use as registerECharts } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { describe, expect, it } from 'vitest';
import type { StarHistoryItem } from '../../../../packages/contracts/src/index';
import '../lib/starChartEngine';
import { groupStarHistory, starHistoryOption, type StarHistoryAxis } from './StarHistoryChart';

registerECharts([SVGRenderer]);

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
function series(records: StarHistoryItem[], axis: StarHistoryAxis = 'matches') {
  return starHistoryOption(records, axis).series as {
    id: string;
    type: string;
    data: (
      | {
          value: [number, number | null];
          record?: StarHistoryItem;
          symbolSize: number;
          gameNumber?: number;
          baseline?: boolean;
        }
      | [number, number | null]
    )[];
    lineStyle: { type?: string };
    connectNulls: boolean;
    areaStyle?: unknown;
  }[];
}
function values(records: StarHistoryItem[], axis: StarHistoryAxis = 'matches') {
  return (series(records, axis)[0]!.data as { value: [number, number | null] }[]).map(
    (point) => point.value,
  );
}

type Bounds = { min: number; max: number };
function yAxis(records: StarHistoryItem[]) {
  return starHistoryOption(records).yAxis as {
    scale: boolean;
    min: (bounds: Bounds) => number;
    max: (bounds: Bounds) => number;
    minInterval: number;
    axisLabel: { formatter: (n: number) => string };
  };
}

describe('complete Star history options', () => {
  it('defaults to numbered games, Ctrl-wheel zoom, drag panning and a data-shadow slider', () => {
    const option = starHistoryOption([match(0, 10), match(1, 11)]);
    expect(option.xAxis).toMatchObject({
      type: 'value',
      minInterval: 1,
      min: 0,
      max: 2,
      boundaryGap: false,
      axisLine: { onZero: false },
    });
    const axis = option.xAxis as { axisLabel: { formatter: (value: number) => string } };
    expect(axis.axisLabel.formatter(0)).toBe('0');
    expect(axis.axisLabel.formatter(1)).toBe('1');
    expect(axis.axisLabel.formatter(50)).toBe('50');
    for (const value of [-50, -1, 0.5, 38.6, 49.999])
      expect(axis.axisLabel.formatter(value)).toBe('');
    expect(option.dataZoom).toEqual([
      expect.objectContaining({
        type: 'inside',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        filterMode: 'filter',
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        zoomOnMouseWheel: 'ctrl',
      }),
      expect.objectContaining({
        type: 'slider',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        filterMode: 'filter',
        showDataShadow: true,
        showDetail: false,
        dataBackground: expect.any(Object),
        selectedDataBackground: expect.any(Object),
      }),
    ]);
    for (const zoom of option.dataZoom as Record<string, unknown>[]) {
      expect(zoom).not.toHaveProperty('minSpan');
    }
    expect(option.toolbox).toMatchObject({
      itemSize: 0,
      itemGap: 0,
      showTitle: false,
      feature: { dataZoom: { yAxisIndex: 'none', brushStyle: expect.any(Object) } },
    });
    expect(option.toolbox).not.toHaveProperty('show', false);
    expect(Object.keys((option.toolbox as { feature: object }).feature)).toEqual(['dataZoom']);
    expect(option.tooltip).toMatchObject({ shadowBlur: 0 });
    expect(series([match(0, 10)]).every((item) => item.type === 'line' && !item.areaStyle)).toBe(
      true,
    );
  });

  it('uses measured after values, not an incomparable integer baseline', () => {
    const record = match(0, 84.25927300637274);
    record.rating!.before = 84;
    expect(values([record])).toEqual([[1, 84.25927300637274]]);
    const option = starHistoryOption([record]);
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    const data = series([record])[0]!.data[0];
    const text = tooltip.formatter([{ seriesId: 'stars', data }]);
    expect(text).toContain('第 1 局');
    expect(text).toContain('84.3 Star');
    expect(text).toContain('公开采样');
    expect(text).not.toContain('+0.3');
    expect(text).not.toContain('84.0');
  });

  it('keeps a comparable baseline at game zero and raw precision without negative zero labels', () => {
    const record = match(0, 1235.789);
    Object.assign(record.rating!, { before: 1234.56, delta: 1.229 });
    expect(values([record])).toEqual([
      [0, 1234.56],
      [1, 1235.789],
    ]);
    expect(series([record])[0]!.data[0]).toMatchObject({ baseline: true, record });
    expect(series([record])[0]!.data[1]).toMatchObject({ gameNumber: 1, record });
    const axis = yAxis([record]);
    expect(axis.scale).toBe(true);
    expect(axis.minInterval).toBe(0.1);
    expect(axis.axisLabel.formatter(12)).toBe('12.0');
    expect(axis.axisLabel.formatter(-0.04)).toBe('0.0');
  });

  it('uses actual observation times and a start-time baseline only in explicit time mode', () => {
    const record = match(0, 12);
    Object.assign(record.rating!, { before: 10, delta: 2 });
    expect(starHistoryOption([record], 'time').xAxis).toMatchObject({ type: 'time' });
    expect(values([record], 'time')).toEqual([
      [start, 10],
      [start + 300000, 12],
    ]);
    expect(values([match(0, 10), match(4, 11)], 'time')).toEqual([
      [start + 300000, 10],
      [start + 2700000, 11],
    ]);
    expect(values([match(0, 10), match(4, 11)])).toEqual([
      [1, 10],
      [2, 11],
    ]);
  });

  it('pads the visible score range rather than forcing a zero baseline', () => {
    const axis = yAxis([match(0, 80), match(1, 100)]);
    const bounds = { min: 80, max: 100 };
    expect(axis.scale).toBe(true);
    expect(typeof axis.min).toBe('function');
    expect(typeof axis.max).toBe('function');
    expect(axis.min(bounds)).toBeGreaterThan(0);
    expect(axis.min(bounds)).toBeLessThan(bounds.min);
    expect(axis.max(bounds)).toBeGreaterThan(bounds.max);
    expect(bounds.min - axis.min(bounds)).toBeLessThanOrEqual(5);
    expect(axis.max(bounds) - bounds.max).toBeLessThanOrEqual(5);
  });

  it.each([0, 0.1, 12, 1235.789])('gives a flat %s Star range finite, nonzero bounds', (value) => {
    const axis = yAxis([match(0, value)]);
    const bounds = { min: value, max: value };
    const min = axis.min(bounds);
    const max = axis.max(bounds);
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(min).toBeLessThanOrEqual(value);
    expect(max).toBeGreaterThan(value);
    expect(max - min).toBeGreaterThanOrEqual(0.2);
    expect(max - min).toBeLessThanOrEqual(0.6);
  });

  it.each(['matches', 'time'] as const)(
    'filters out-of-window scores so the %s viewport rescales the y axis',
    (axis) => {
      const records = [match(0, 1000), match(1, 10), match(2, 11), match(3, 12)];
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 300 });
      try {
        chart.setOption(starHistoryOption(records, axis));
        const fullTop = chart.convertFromPixel({ yAxisIndex: 0 }, 18) as number;
        expect(fullTop).toBeGreaterThan(1000);
        chart.dispatchAction({
          type: 'dataZoom',
          startValue: axis === 'matches' ? 2 : start + 900000,
          endValue: axis === 'matches' ? 4 : start + 2100000,
        });
        const visibleTop = chart.convertFromPixel({ yAxisIndex: 0 }, 18) as number;
        const visibleBottom = chart.convertFromPixel({ yAxisIndex: 0 }, 300 - 76) as number;
        expect(visibleBottom).toBeGreaterThan(0);
        expect(visibleBottom).toBeLessThan(10);
        expect(visibleTop).toBeGreaterThan(12);
        expect(visibleTop).toBeLessThan(15);
        chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
        expect(chart.convertFromPixel({ yAxisIndex: 0 }, 18)).toBe(fullTop);
      } finally {
        chart.dispose();
      }
    },
  );

  it('renders only nonnegative integer game ticks, including fractional zoom boundaries', () => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 300 });
    try {
      chart.setOption(
        starHistoryOption(
          Array.from({ length: 244 }, (_, index) => match(index, 80 + index / 100)),
        ),
      );
      expect(chart.convertFromPixel({ xAxisIndex: 0 }, 54)).toBe(0);
      expect(chart.convertFromPixel({ xAxisIndex: 0 }, 580)).toBe(244);
      const labels = () =>
        chart
          .getZr()
          .storage.getDisplayList(true)
          .filter((element) => {
            if (element.type !== 'tspan') return false;
            const rect = element.getBoundingRect().clone();
            const transform = element.getComputedTransform();
            if (transform) rect.applyTransform(transform);
            return rect.y > 224 && rect.y < 250;
          })
          .map((element) => (element as unknown as { style: { text: string } }).style.text)
          .filter(Boolean);
      expect(labels()).toContain('0');
      expect(labels().every((label) => /^\d+$/.test(label))).toBe(true);
      for (const [startValue, endValue] of [
        [38.6, 90.2],
        [38.6, 39.4],
        [0, 244],
      ]) {
        chart.dispatchAction({ type: 'dataZoom', startValue, endValue });
        const ticks = labels();
        expect(ticks.length).toBeGreaterThan(0);
        expect(ticks.every((label) => /^\d+$/.test(label))).toBe(true);
        expect(ticks).not.toContain('赛前');
      }
    } finally {
      chart.dispose();
    }
  });

  it('shows a real observation when the axis pointer picks a same-x source separator', () => {
    const a = match(0, 10);
    a.rating!.source = 'terminal';
    const records = [a, match(1, 11), match(2, 12)];
    const option = starHistoryOption(records);
    const separator = series(records)[0]!.data[1];
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    const text = tooltip.formatter([{ seriesId: 'stars', data: separator }]);
    expect(text).toContain('第 2 局');
    expect(text).toContain('11.0 Star');
    expect(text).toContain('公开采样');
  });

  it('keeps the native box-zoom controller active without visible toolbox icons', () => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 300 });
    try {
      chart.setOption(
        starHistoryOption(Array.from({ length: 5 }, (_, index) => match(index, 10 + index))),
      );
      chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'dataZoomSelect',
        dataZoomSelectActive: true,
      });
      const left = chart.convertToPixel({ xAxisIndex: 0 }, 2) as number;
      const right = chart.convertToPixel({ xAxisIndex: 0 }, 4) as number;
      const event = (offsetX: number) => ({
        offsetX,
        offsetY: 60,
        event: { preventDefault() {}, stopPropagation() {} },
      });
      chart.getZr().trigger('mousedown', event(left));
      chart.getZr().trigger('mousemove', event(right));
      chart.getZr().trigger('mouseup', event(right));
      const zoom = (chart.getOption().dataZoom as { startValue: number; endValue: number }[])[0]!;
      expect(zoom.startValue).toBeCloseTo(2);
      expect(zoom.endValue).toBeCloseTo(4);
    } finally {
      chart.dispose();
    }
  });

  it('connects only measured endpoints across missing records with a dashed segment', () => {
    const records = [
      match(0, 10),
      match(1, null, { rating: undefined }),
      match(2, null),
      match(3, 12),
    ];
    expect(values(records)).toEqual([
      [1, 10],
      [2, null],
      [3, null],
      [4, 12],
    ]);
    const gaps = series(records)[1]!;
    expect(gaps.lineStyle.type).toBe('dashed');
    expect(gaps.connectNulls).toBe(false);
    expect(gaps.data).toEqual([
      [1, 10],
      [4, 12],
      [4, null],
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
    expect(gaps.data[2]).toEqual([3, null]);
    expect(gaps.data[5]).toEqual([5, null]);
  });

  it('does not invent endpoints for leading, trailing or wholly missing scores', () => {
    const records = [match(0, null), match(1, 0), match(2, null)];
    expect(values(records).map((point) => point[1])).toEqual([null, 0, null]);
    expect(series(records)[1]!.data).toEqual([]);
    expect(series([match(0, null)])[1]!.data).toEqual([]);
    const known = series(records)[0]!.data[1] as { symbolSize: number };
    expect(known.symbolSize).toBeGreaterThan(0);
  });

  it('breaks the solid line and never adds a dashed comparison across different sources', () => {
    const terminal = match(0, 84);
    terminal.rating!.source = 'terminal';
    const profile = match(1, 84.25927300637274);
    expect(values([terminal, profile]).map((point) => point[1])).toEqual([
      84,
      null,
      84.25927300637274,
    ]);
    expect(series([terminal, match(1, null), match(2, 84.2)])[1]!.data).toEqual([]);
  });

  it('does not assume that two unknown sources are comparable', () => {
    const a = match(0, 12),
      b = match(1, 13);
    a.rating!.source = null;
    b.rating!.source = null;
    expect(values([a, b]).map((point) => point[1])).toEqual([12, null, 13]);
  });

  it('orders observations by end time and falls back to start time for pending records', () => {
    const a = match(1, 12, { endedAt: null }),
      b = match(0, 10);
    expect(values([a, b])).toEqual([
      [1, 10],
      [2, 12],
    ]);
    expect(values([a, b], 'time')).toEqual([
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
    expect(groups[0]!.map((record) => record.id)).toEqual([a.id, missing.id, b.id]);
  });

  it('does not assign an account to an ambiguous run or mix accounts and servers', () => {
    const a = match(0, 12),
      b = match(1, 13),
      unknown = match(2, null, { rating: undefined });
    b.rating!.username = 'other';
    const groups = groupStarHistory([a, b, unknown, match(3, 14, { server: 'bots' })]);
    expect(groups.size).toBe(3);
    expect([...groups.values()].flat().some((record) => record.id === unknown.id)).toBe(false);
  });
});
