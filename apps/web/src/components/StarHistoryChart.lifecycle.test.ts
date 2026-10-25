// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { StarHistoryChart } from './StarHistoryChart';

const engine = vi.hoisted(() => ({
  init: vi.fn(),
  setOption: vi.fn(),
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

async function renderChart() {
  await act(async () => root.render(createElement(StarHistoryChart, { matches })));
  const chart = host.querySelector('[role="img"]')!;
  return chart;
}

function makeVisible(element: Element) {
  Object.defineProperties(element, {
    clientWidth: { value: 320, configurable: true },
    clientHeight: { value: 192, configurable: true },
  });
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
    expect(engine.resize).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
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
    const element = await renderChart();
    makeVisible(element);
    await act(async () => {
      resize();
      await vi.dynamicImportSettled();
    });
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => root.render(null));
    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it('shows a fallback instead of breaking history when chart initialization fails', async () => {
    engine.init.mockImplementationOnce(() => {
      throw new Error('chart initialization failed');
    });
    const element = await renderChart();
    makeVisible(element);
    await act(async () => {
      resize();
      await vi.dynamicImportSettled();
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      '下方对局列表仍可查看评分',
    );
  });
});
