// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { StarHistoryChart } from './StarHistoryChart';

const engine = vi.hoisted(() => ({
  init: vi.fn(),
  setOption: vi.fn(),
  getOption: vi.fn(),
  dispatchAction: vi.fn(),
  on: vi.fn(),
  getZr: vi.fn(),
  zrOn: vi.fn(),
  containPixel: vi.fn(),
  convertFromPixel: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../lib/starChartEngine', () => ({ init: engine.init }));

const matches: MatchRecord[] = [
  {
    id: 'chart-match',
    runId: 'chart-run',
    mode: 'live',
    server: 'generals',
    gameId: 'chart-game',
    opponent: 'opponent',
    startedAt: '2026-10-25T06:00:00Z',
    endedAt: '2026-10-25T06:05:00Z',
    outcome: 'won',
    turns: 50,
    replayUrl: null,
    rating: {
      username: 'self',
      before: 10,
      after: 11,
      delta: 1,
      source: 'terminal',
      capturedAt: '2026-10-25T06:05:00Z',
    },
  },
];
let host: HTMLDivElement;
let root: Root;
let resize: () => void;
const disconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  engine.init.mockReturnValue(engine);
  engine.getOption.mockReturnValue({ dataZoom: [{ start: 0, end: 100 }] });
  engine.getZr.mockReturnValue({ on: engine.zrOn });
  engine.containPixel.mockReturnValue(true);
  engine.convertFromPixel.mockReturnValue(1);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderChart(props: Partial<ComponentProps<typeof StarHistoryChart>> = {}) {
  await act(async () => root.render(createElement(StarHistoryChart, { matches, ...props })));
  return host.querySelector('[role="img"]')!;
}

function makeVisible(element: Element) {
  Object.defineProperties(element, {
    clientWidth: { value: 320, configurable: true },
    clientHeight: { value: 192, configurable: true },
  });
}

async function initializeChart(props: Partial<ComponentProps<typeof StarHistoryChart>> = {}) {
  const element = await renderChart(props);
  makeVisible(element);
  await act(async () => {
    resize();
    await vi.dynamicImportSettled();
  });
  return element;
}

function history(count = 3): MatchRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    ...matches[0]!,
    id: `chart-match-${index + 1}`,
    gameId: `chart-game-${index + 1}`,
    startedAt: new Date(Date.parse(matches[0]!.startedAt) + index * 600000).toISOString(),
    endedAt: new Date(Date.parse(matches[0]!.endedAt!) + index * 600000).toISOString(),
    rating: { ...matches[0]!.rating!, after: 11 + index },
  }));
}

function button(label: string) {
  const element = [...host.querySelectorAll('button')].find(
    (element) => element.textContent?.replace(/\s/g, '') === label.replace(/\s/g, ''),
  );
  expect(element, `button ${label}`).toBeDefined();
  return element!;
}

async function clickButton(label: string) {
  await act(async () => button(label).click());
}

async function emitChart(name: string, event: unknown) {
  const listener = engine.on.mock.calls.find(([eventName]) => eventName === name)?.[1] as
    ((event: unknown) => void) | undefined;
  expect(listener, `chart event ${name}`).toBeTypeOf('function');
  await act(async () => listener!(event));
}

async function emitZr(name: string, x = 100, y = 50) {
  const listener = engine.zrOn.mock.calls.find(([eventName]) => eventName === name)?.[1] as
    ((event: { offsetX: number; offsetY: number }) => void) | undefined;
  expect(listener, `ZRender event ${name}`).toBeTypeOf('function');
  await act(async () => listener!({ offsetX: x, offsetY: y }));
}

async function press(element: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => element.dispatchEvent(event));
  return event;
}

function selectedText() {
  return host.querySelector('[aria-live="polite"]')?.textContent;
}

describe('StarHistoryChart lifecycle', () => {
  it('waits until visible to initialize and reuses the chart on resize', async () => {
    const element = await renderChart();
    await vi.dynamicImportSettled();
    expect(engine.init).not.toHaveBeenCalled();
    makeVisible(element);
    await act(async () => {
      resize();
      await vi.dynamicImportSettled();
    });
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.init).toHaveBeenCalledWith(element);
    expect(engine.setOption).toHaveBeenCalledOnce();
    await act(async () => resize());
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.resize).not.toHaveBeenCalled();
    Object.defineProperty(element, 'clientWidth', { value: 400, configurable: true });
    await act(async () => resize());
    expect(engine.resize).toHaveBeenCalledOnce();
    await act(async () => resize());
    expect(engine.resize).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the instance and tooltip untouched for equivalent history refreshes', async () => {
    await initializeChart();
    await act(async () =>
      root.render(
        createElement(StarHistoryChart, {
          matches: matches.map((match) => ({
            ...match,
            turns: match.turns + 1,
            rating: { ...match.rating! },
          })),
        }),
      ),
    );
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.setOption).toHaveBeenCalledOnce();
    expect(engine.dispose).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('updates actual ratings on the existing instance without retaining deleted observations', async () => {
    await initializeChart();
    const updated = { ...matches[0]!, rating: { ...matches[0]!.rating!, after: 12, delta: 2 } };
    await act(async () =>
      root.render(
        createElement(StarHistoryChart, { matches: [updated, { ...updated, id: 'second' }] }),
      ),
    );
    expect(engine.setOption).toHaveBeenCalledTimes(2);
    expect(engine.setOption.mock.lastCall?.[0].series).toHaveLength(2);
    await act(async () => root.render(createElement(StarHistoryChart, { matches: [updated] })));
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.dispose).not.toHaveBeenCalled();
    expect(engine.setOption).toHaveBeenCalledTimes(3);
    expect(engine.setOption.mock.lastCall?.[0].series).toHaveLength(2);
    expect(engine.setOption.mock.lastCall?.[0].series[0].data).toHaveLength(2);
    expect(
      engine.setOption.mock.lastCall?.[0].series[0].data.map(
        (point: { value: unknown }) => point.value,
      ),
    ).toEqual([
      [0, 10],
      [1, 12],
    ]);
    expect(engine.setOption.mock.lastCall?.[1]).toEqual({ notMerge: true });
  });

  it('preserves the chosen game window without changing full-range defaults', async () => {
    await initializeChart();
    const startValue = 0.2;
    const endValue = 0.6;
    engine.getOption.mockReturnValueOnce({
      dataZoom: [{ start: 20, end: 60, startValue, endValue }],
    });
    const updated = { ...matches[0]!, rating: { ...matches[0]!.rating!, after: 12, delta: 2 } };
    await act(async () => root.render(createElement(StarHistoryChart, { matches: [updated] })));
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.setOption.mock.lastCall?.[0].dataZoom).toEqual([
      expect.objectContaining({ start: 0, end: 100 }),
      expect.objectContaining({ start: 0, end: 100 }),
    ]);
    expect(engine.dispatchAction).toHaveBeenCalledWith(
      { type: 'dataZoom', startValue, endValue },
      { silent: true },
    );
  });

  it('preserves an explicitly chosen time window when ratings refresh', async () => {
    await initializeChart();
    await clickButton('时间');
    engine.dispatchAction.mockClear();
    const startValue = Date.parse('2026-10-25T06:01:00Z');
    const endValue = Date.parse('2026-10-25T06:03:00Z');
    engine.getOption.mockReturnValueOnce({
      dataZoom: [{ start: 20, end: 60, startValue, endValue }],
    });
    const updated = { ...matches[0]!, rating: { ...matches[0]!.rating!, after: 12 } };
    await renderChart({ matches: [updated] });
    expect(engine.setOption.mock.lastCall?.[0].xAxis.type).toBe('time');
    expect(engine.dispatchAction).toHaveBeenCalledExactlyOnceWith(
      { type: 'dataZoom', startValue, endValue },
      { silent: true },
    );
    expect(engine.init).toHaveBeenCalledOnce();
  });

  it('keeps following the full history when the user has not zoomed in', async () => {
    await initializeChart();
    const updated = { ...matches[0]!, endedAt: '2026-10-25T06:10:00Z' };
    await act(async () => root.render(createElement(StarHistoryChart, { matches: [updated] })));
    expect(engine.setOption.mock.lastCall?.[0].dataZoom).toEqual([
      expect.objectContaining({ start: 0, end: 100 }),
      expect.objectContaining({ start: 0, end: 100 }),
    ]);
    expect(engine.dispatchAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dataZoom' }),
      expect.anything(),
    );
  });

  it('uses the newest ratings if history changes during the engine import', async () => {
    const element = await renderChart();
    makeVisible(element);
    const updated = { ...matches[0]!, rating: { ...matches[0]!.rating!, after: 12, delta: 2 } };
    act(() => {
      resize();
      root.render(createElement(StarHistoryChart, { matches: [updated] }));
    });
    await act(async () => vi.dynamicImportSettled());
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.setOption).toHaveBeenCalledOnce();
    expect(
      engine.setOption.mock.lastCall?.[0].series[0].data.map(
        (point: { value: unknown }) => point.value,
      ),
    ).toEqual([
      [0, 10],
      [1, 12],
    ]);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('does not initialize after an in-flight import outlives the component', async () => {
    const element = await renderChart();
    makeVisible(element);
    await act(async () => {
      resize();
      root.render(null);
    });
    await vi.dynamicImportSettled();
    expect(engine.init).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('waits for visibility again if the tab is hidden during the import', async () => {
    const element = await renderChart();
    makeVisible(element);
    await act(async () => {
      resize();
      Object.defineProperty(element, 'clientWidth', { value: 0, configurable: true });
      await vi.dynamicImportSettled();
    });
    expect(engine.init).not.toHaveBeenCalled();
    makeVisible(element);
    await act(async () => {
      resize();
      await vi.dynamicImportSettled();
    });
    expect(engine.init).toHaveBeenCalledOnce();
  });

  it('disposes a partially initialized chart if setting its options fails', async () => {
    engine.setOption.mockImplementationOnce(() => {
      throw new Error('invalid options');
    });
    await initializeChart();
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => root.render(null));
    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it('shows a fallback instead of breaking history when chart initialization fails', async () => {
    engine.init.mockImplementationOnce(() => {
      throw new Error('chart initialization failed');
    });
    await initializeChart();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      '下方对局列表仍可查看评分',
    );
  });
});

describe('StarHistoryChart controls and navigation', () => {
  it('switches axes in place without replaying incompatible zoom coordinates', async () => {
    const records = history();
    await initializeChart({ matches: records });
    expect(button('局数').getAttribute('aria-pressed')).toBe('true');
    expect(button('时间').getAttribute('aria-pressed')).toBe('false');
    engine.getOption.mockReturnValue({
      dataZoom: [{ start: 20, end: 60, startValue: 1, endValue: 2 }],
    });
    await clickButton('框选');
    await clickButton('时间');
    expect(button('局数').getAttribute('aria-pressed')).toBe('false');
    expect(button('时间').getAttribute('aria-pressed')).toBe('true');
    expect(button('框选').getAttribute('aria-pressed')).toBe('false');
    expect(engine.setOption.mock.lastCall?.[0].xAxis.type).toBe('time');
    expect(engine.setOption.mock.lastCall?.[0].series[0].data.at(-1).value).toEqual([
      Date.parse(records.at(-1)!.endedAt!),
      13,
    ]);
    expect(
      engine.dispatchAction.mock.calls.filter(([action]) => action.type === 'dataZoom'),
    ).toEqual([]);
    await clickButton('局数');
    expect(engine.setOption.mock.lastCall?.[0].xAxis.type).toBe('value');
    expect(engine.setOption.mock.lastCall?.[0].series[0].data.at(-1).value).toEqual([3, 13]);
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.setOption).toHaveBeenCalledTimes(3);
    expect(engine.dispose).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(engine.on).toHaveBeenCalledOnce();
    expect(engine.on).toHaveBeenCalledWith('updateAxisPointer', expect.any(Function));
    expect(engine.zrOn.mock.calls.map(([name]) => name)).toEqual(['mousedown', 'click']);
  });

  it('selects the nearest x coordinate on pointer updates and opens it from the footer', async () => {
    const records = history();
    const onOpenMatch = vi.fn();
    await initializeChart({ matches: records, onOpenMatch });
    expect(selectedText()).toContain('第 3 局');
    await emitChart('updateAxisPointer', {
      axesInfo: [
        { axisDim: 'y', value: 100 },
        { axisDim: 'x', value: 1.8 },
      ],
    });
    expect(selectedText()).toContain('第 2 局');
    expect(selectedText()).toContain('12.0 Star');
    expect(onOpenMatch).not.toHaveBeenCalled();
    await clickButton('查看对局');
    expect(onOpenMatch).toHaveBeenCalledExactlyOnceWith(records[1]);
    await emitChart('updateAxisPointer', { axesInfo: [{ axisDim: 'y', value: 1 }] });
    await emitChart('updateAxisPointer', {});
    expect(selectedText()).toContain('第 2 局');
  });

  it('opens the nearest match from a grid click using pixel conversion, not a point-only event', async () => {
    const records = history();
    const onOpenMatch = vi.fn();
    await initializeChart({ matches: records, onOpenMatch });
    engine.convertFromPixel.mockReturnValue(1.8);
    await emitZr('mousedown', 110, 60);
    await emitZr('click', 110, 60);
    expect(engine.containPixel).toHaveBeenCalledWith('grid', [110, 60]);
    expect(engine.convertFromPixel).toHaveBeenCalledWith({ xAxisIndex: 0 }, 110);
    expect(onOpenMatch).toHaveBeenCalledExactlyOnceWith(records[1]);
  });

  it('finds the nearest actual timestamp after switching to the time axis', async () => {
    const records = history();
    const onOpenMatch = vi.fn();
    await initializeChart({ matches: records, onOpenMatch });
    await clickButton('时间');
    const value = Date.parse(records[1]!.endedAt!) + 1000;
    await emitChart('updateAxisPointer', { axesInfo: [{ axisDim: 'x', value }] });
    expect(selectedText()).toContain('第 2 局');
    engine.convertFromPixel.mockReturnValue(value);
    await emitZr('mousedown');
    await emitZr('click');
    expect(onOpenMatch).toHaveBeenCalledExactlyOnceWith(records[1]);
  });

  it('uses the latest callback and record without rebuilding equivalent chart data', async () => {
    const records = history();
    const previous = vi.fn();
    const current = vi.fn();
    const element = await initializeChart({ matches: records, onOpenMatch: previous });
    const refreshed = records.map((record) => ({ ...record, turns: record.turns + 1 }));
    await renderChart({ matches: refreshed, onOpenMatch: current });
    engine.convertFromPixel.mockReturnValue(2);
    await emitZr('mousedown');
    await emitZr('click');
    expect(current).toHaveBeenLastCalledWith(refreshed[1]);
    expect(current.mock.lastCall?.[0]).toBe(refreshed[1]);
    await press(element, 'Enter');
    expect(current).toHaveBeenLastCalledWith(refreshed[2]);
    await clickButton('查看对局');
    expect(current).toHaveBeenLastCalledWith(refreshed[2]);
    expect(previous).not.toHaveBeenCalled();
    expect(engine.setOption).toHaveBeenCalledOnce();
    expect(engine.on).toHaveBeenCalledOnce();
    expect(engine.zrOn).toHaveBeenCalledTimes(2);
    expect(engine.init).toHaveBeenCalledOnce();
  });

  it('supports bounded left/right selection and Enter without opening on arrow keys', async () => {
    const records = history();
    const onOpenMatch = vi.fn();
    const element = await initializeChart({ matches: records, onOpenMatch });
    expect(element.getAttribute('tabindex')).toBe('0');
    expect((await press(element, 'ArrowLeft')).defaultPrevented).toBe(true);
    expect(selectedText()).toContain('第 2 局');
    await press(element, 'ArrowLeft');
    await press(element, 'ArrowLeft');
    expect(selectedText()).toContain('第 1 局');
    expect(onOpenMatch).not.toHaveBeenCalled();
    expect((await press(element, 'Enter')).defaultPrevented).toBe(true);
    expect(onOpenMatch).toHaveBeenCalledExactlyOnceWith(records[0]);
    await press(element, 'ArrowRight');
    await press(element, 'ArrowRight');
    await press(element, 'ArrowRight');
    expect(selectedText()).toContain('第 3 局');
    await press(element, 'Enter');
    expect(onOpenMatch).toHaveBeenLastCalledWith(records[2]);
    expect((await press(element, 'Escape')).defaultPrevented).toBe(false);
    expect(onOpenMatch).toHaveBeenCalledTimes(2);
    expect(engine.setOption).toHaveBeenCalledOnce();
  });

  it('retains missing-score games as selectable matches rather than skipping them', async () => {
    const records = history();
    records[1] = { ...records[1]!, rating: undefined };
    const onOpenMatch = vi.fn();
    const element = await initializeChart({ matches: records, onOpenMatch });
    await press(element, 'ArrowLeft');
    expect(selectedText()).toContain('第 2 局');
    expect(selectedText()).toContain('未采集评分');
    await press(element, 'Enter');
    expect(onOpenMatch).toHaveBeenCalledExactlyOnceWith(records[1]);
  });

  it('zooms to the last 30 games and restores all history without recreating the chart', async () => {
    const records = history(40);
    await initializeChart({ matches: records });
    expect(button('最近30局').disabled).toBe(false);
    await clickButton('框选');
    expect(button('框选').getAttribute('aria-pressed')).toBe('true');
    expect(engine.dispatchAction).toHaveBeenLastCalledWith({
      type: 'takeGlobalCursor',
      key: 'dataZoomSelect',
      dataZoomSelectActive: true,
    });
    await clickButton('最近30局');
    expect(button('框选').getAttribute('aria-pressed')).toBe('false');
    expect(engine.dispatchAction).toHaveBeenLastCalledWith({
      type: 'dataZoom',
      startValue: 11,
      endValue: 40,
    });
    await clickButton('框选');
    await clickButton('全部');
    expect(button('框选').getAttribute('aria-pressed')).toBe('false');
    expect(engine.dispatchAction).toHaveBeenLastCalledWith({
      type: 'dataZoom',
      start: 0,
      end: 100,
    });
    expect(engine.init).toHaveBeenCalledOnce();
    expect(engine.setOption).toHaveBeenCalledOnce();
  });

  it('uses observation times for the recent-30 range in time mode', async () => {
    const records = history(40);
    await initializeChart({ matches: records });
    await clickButton('时间');
    await clickButton('最近30局');
    expect(engine.dispatchAction).toHaveBeenLastCalledWith({
      type: 'dataZoom',
      startValue: Date.parse(records[10]!.endedAt!),
      endValue: Date.parse(records[39]!.endedAt!),
    });
  });

  it.each([1, 30])(
    'disables the recent-30 shortcut for %s games and opening without a callback',
    async (count) => {
      await initializeChart({ matches: history(count) });
      expect(button('最近30局').disabled).toBe(true);
      expect(button('查看对局').disabled).toBe(true);
      await clickButton('最近30局');
      expect(engine.dispatchAction).not.toHaveBeenCalled();
    },
  );

  it('does not open a match for slider/outside-grid clicks, drags or box selections', async () => {
    const records = history();
    const onOpenMatch = vi.fn();
    await initializeChart({ matches: records, onOpenMatch });
    engine.containPixel.mockReturnValueOnce(false);
    await emitZr('mousedown', 100, 180);
    await emitZr('click', 100, 180);
    expect(engine.convertFromPixel).not.toHaveBeenCalled();
    await emitZr('mousedown', 100, 50);
    await emitZr('click', 130, 50);
    await emitZr('mousedown', 100, 50);
    await emitZr('click', 100, 80);
    expect(engine.convertFromPixel).not.toHaveBeenCalled();
    await clickButton('框选');
    await emitZr('mousedown');
    await emitZr('click');
    expect(onOpenMatch).not.toHaveBeenCalled();
    expect(engine.convertFromPixel).not.toHaveBeenCalled();
    await clickButton('框选');
    expect(button('框选').getAttribute('aria-pressed')).toBe('false');
    await emitZr('mousedown');
    await emitZr('click');
    expect(onOpenMatch).toHaveBeenCalledExactlyOnceWith(records[0]);
  });
});
