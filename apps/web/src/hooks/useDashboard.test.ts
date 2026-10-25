// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type Dashboard } from '../../../../packages/contracts/src/index';
import { api } from '../api/client';
import type * as Client from '../api/client';
import { useDashboard } from './useDashboard';

vi.mock('../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof Client>();
  return {
    ...original,
    api: { dashboard: vi.fn(), start: vi.fn(), stop: vi.fn(), save: vi.fn() },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function snapshot(turn = 0): Dashboard {
  return {
    state: {
      run: null,
      phase: turn ? 'playing' : 'starting',
      match: null,
      turn,
      agentLatencyMs: null,
      completedGames: 0,
      nextGameAt: null,
    },
    config: { ...defaultConfig, command: `agent-${turn}` },
    stats: { total: 0, won: 0, lost: 0, draw: 0, interrupted: 0, winRate: 0 },
    matches: [],
    logs: [],
    dataDir: 'data',
  };
}

class MockEventSource extends EventTarget {
  static CLOSED = 2;
  static instances: MockEventSource[] = [];
  readyState = 1;
  close = vi.fn();

  constructor() {
    super();
    MockEventSource.instances.push(this);
  }

  send(data: Dashboard) {
    this.dispatchEvent(new MessageEvent('dashboard', { data: JSON.stringify(data) }));
  }
}

let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useDashboard>;

function Harness() {
  current = useDashboard();
  return createElement('output', null, current.dashboard?.state.turn);
}

async function mount() {
  await act(async () => root.render(createElement(Harness)));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('EventSource', MockEventSource);
  MockEventSource.instances = [];
  vi.mocked(api.dashboard).mockResolvedValue(snapshot());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useDashboard response ordering', () => {
  it.each(['start', 'stop', 'save'] as const)(
    'does not overwrite a newer SSE snapshot with a delayed %s response',
    async (action) => {
      const response = deferred<Dashboard>();
      vi.mocked(api.start).mockReturnValue(response.promise);
      vi.mocked(api.stop).mockReturnValue(response.promise);
      vi.mocked(api.save).mockReturnValue(response.promise.then((data) => data.config));
      await mount();
      let result!: Promise<boolean>;
      await act(async () => {
        result = action === 'stop' ? current.stop() : current[action](defaultConfig);
      });
      expect(current.pending).toBe(action);
      const newer = snapshot(40);
      await act(async () => MockEventSource.instances[0]!.send(newer));
      await act(async () => {
        response.resolve(snapshot());
        expect(await result).toBe(true);
      });
      expect(current.dashboard).toEqual(newer);
      expect(current.pending).toBeNull();
      expect(current.actionError).toBeNull();
    },
  );

  it.each(['start', 'stop', 'save'] as const)(
    'still applies a %s response when no newer SSE event arrived',
    async (action) => {
      const response = snapshot(12);
      vi.mocked(api.start).mockResolvedValue(response);
      vi.mocked(api.stop).mockResolvedValue(response);
      vi.mocked(api.save).mockResolvedValue(response.config);
      await mount();
      await act(async () => {
        const success = await (action === 'stop' ? current.stop() : current[action](defaultConfig));
        expect(success).toBe(true);
      });
      expect(current.dashboard).toEqual(
        action === 'save' ? { ...snapshot(), config: response.config } : response,
      );
      expect(current.pending).toBeNull();
    },
  );

  it('also keeps a newer SSE snapshot when the initial GET resolves late', async () => {
    const initial = deferred<Dashboard>();
    vi.mocked(api.dashboard).mockReturnValue(initial.promise);
    await mount();
    const newer = snapshot(20);
    await act(async () => MockEventSource.instances[0]!.send(newer));
    await act(async () => initial.resolve(snapshot()));
    expect(current.dashboard).toEqual(newer);
  });

  it('does not count malformed events as newer data and still clears pending on errors', async () => {
    const response = deferred<Dashboard>();
    vi.mocked(api.start).mockReturnValue(response.promise);
    await mount();
    let result!: Promise<boolean>;
    await act(async () => {
      result = current.start(defaultConfig);
      MockEventSource.instances[0]!.dispatchEvent(new MessageEvent('dashboard', { data: '{' }));
    });
    await act(async () => {
      response.resolve(snapshot(10));
      await result;
    });
    expect(current.dashboard).toEqual(snapshot(10));
    vi.mocked(api.stop).mockRejectedValue(new Error('stop failed'));
    await act(async () => expect(await current.stop()).toBe(false));
    expect(current.pending).toBeNull();
    expect(current.actionError).toBe('stop failed');
  });
});
