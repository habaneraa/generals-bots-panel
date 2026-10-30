// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, type Dashboard } from '../../../../packages/contracts/src/index';
import { api, ApiRequestError } from '../api/client';
import type * as Client from '../api/client';
import { useDashboard } from './useDashboard';

vi.mock('../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof Client>();
  return {
    ...original,
    api: {
      dashboard: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      save: vi.fn(),
      selectPlayer: vi.fn(),
      addPlayer: vi.fn(),
      deletePlayer: vi.fn(),
    },
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

function snapshot(turn = 0, playerId = 'player-a'): Dashboard {
  return {
    player: { id: playerId, server: 'generals', userId: `secret-${playerId}`, nickname: playerId },
    players: ['player-a', 'player-b'].map((id) => ({
      id,
      server: 'generals',
      userId: `secret-${id}`,
      nickname: id,
    })),
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

  constructor(readonly url: string) {
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

describe('useDashboard Player isolation', () => {
  it('loads the Player from a standalone return URL instead of the server default', async () => {
    window.history.replaceState(null, '', '/?playerId=player-b');
    vi.mocked(api.dashboard).mockResolvedValue(snapshot(1, 'player-b'));
    try {
      await mount();
      expect(api.dashboard).toHaveBeenCalledWith(expect.any(AbortSignal), 'player-b');
      expect(current.dashboard?.player?.id).toBe('player-b');
      expect(MockEventSource.instances[0]!.url).toBe('/api/events?playerId=player-b');
      vi.mocked(api.selectPlayer).mockResolvedValue(snapshot(2));
      await act(async () => {
        expect(await current.selectPlayer('player-a')).toBe(true);
      });
      expect(new URLSearchParams(window.location.search).get('playerId')).toBe('player-a');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it.each(['missing', ''])(
    'does not fall back to another Player when explicit URL id %j is invalid',
    async (id) => {
      window.history.replaceState(null, '', `/?${new URLSearchParams({ playerId: id })}`);
      vi.mocked(api.dashboard).mockRejectedValue(new ApiRequestError('Player 不存在', 404));
      try {
        await mount();
        expect(api.dashboard).toHaveBeenCalledWith(expect.any(AbortSignal), id);
        expect(current.dashboard).toBeNull();
        expect(current.loadError).toBe('Player 不存在');
        expect(MockEventSource.instances).toHaveLength(0);
        expect(api.dashboard).toHaveBeenCalledTimes(1);
        await act(async () => current.retry());
        expect(api.dashboard).toHaveBeenCalledTimes(2);
        expect(api.dashboard).toHaveBeenLastCalledWith(expect.any(AbortSignal), id);
        expect(new URLSearchParams(window.location.search).get('playerId')).toBe(id);
        expect(current.dashboard).toBeNull();
      } finally {
        window.history.replaceState(null, '', '/');
      }
    },
  );
  it('does not open an unscoped stream or permit run actions with no Players', async () => {
    vi.mocked(api.dashboard).mockResolvedValue({ ...snapshot(), player: null, players: [] });
    await mount();
    expect(current.dashboard?.player).toBeNull();
    expect(current.connection).toBe('connected');
    expect(MockEventSource.instances).toHaveLength(0);
    await act(async () => {
      expect(await current.start(defaultConfig)).toBe(false);
      expect(await current.save(defaultConfig)).toBe(false);
      expect(await current.stop()).toBe(false);
    });
    expect(api.start).not.toHaveBeenCalled();
    expect(api.stop).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('closes old SSE immediately, clears data, and ignores queued old events after switching', async () => {
    await mount();
    const old = MockEventSource.instances[0]!;
    const initialSignal = vi.mocked(api.dashboard).mock.calls[0]![0];
    const response = deferred<Dashboard>();
    vi.mocked(api.selectPlayer).mockReturnValue(response.promise);
    let switching!: Promise<boolean>;
    await act(async () => {
      switching = current.selectPlayer('player-b');
    });
    expect(old.close).toHaveBeenCalledOnce();
    expect(initialSignal.aborted).toBe(true);
    expect(current.dashboard).toBeNull();
    expect(current.playerPending).toBe(true);
    expect(api.selectPlayer).toHaveBeenCalledWith('player-b', expect.any(AbortSignal));
    await act(async () => old.send(snapshot(99)));
    expect(current.dashboard).toBeNull();
    await act(async () => {
      response.resolve(snapshot(8, 'player-b'));
      expect(await switching).toBe(true);
    });
    expect(MockEventSource.instances[1]!.url).toBe('/api/events?playerId=player-b');
    await act(async () => old.send(snapshot(100)));
    expect(current.dashboard).toEqual(snapshot(8, 'player-b'));
    await act(async () => MockEventSource.instances[1]!.send(snapshot(200)));
    expect(current.dashboard).toEqual(snapshot(8, 'player-b'));
    expect(api.stop).not.toHaveBeenCalled();
  });

  it.each(['start', 'save', 'stop'] as const)(
    'aborts a pending %s and ignores its old success after switching',
    async (action) => {
      await mount();
      const old = deferred<Dashboard>();
      vi.mocked(api.start).mockReturnValue(old.promise);
      vi.mocked(api.stop).mockReturnValue(old.promise);
      vi.mocked(api.save).mockReturnValue(old.promise.then((data) => data.config));
      let running!: Promise<boolean>;
      await act(async () => {
        running = action === 'stop' ? current.stop() : current[action](defaultConfig);
      });
      const signal =
        action === 'stop'
          ? vi.mocked(api.stop).mock.calls[0]![1]!
          : vi.mocked(api[action]).mock.calls[0]![2]!;
      vi.mocked(api.selectPlayer).mockResolvedValue(snapshot(5, 'player-b'));
      await act(async () => {
        expect(await current.selectPlayer('player-b')).toBe(true);
      });
      expect(signal.aborted).toBe(true);
      await act(async () => {
        old.resolve(snapshot(99));
        expect(await running).toBe(false);
      });
      expect(current.dashboard).toEqual(snapshot(5, 'player-b'));
      expect(current.pending).toBeNull();
      expect(current.actionError).toBeNull();
    },
  );

  it('does not let an old rejection/finally clear the new Player action lock', async () => {
    await mount();
    const old = deferred<Dashboard>();
    vi.mocked(api.start).mockReturnValueOnce(old.promise);
    let first!: Promise<boolean>;
    await act(async () => {
      first = current.start(defaultConfig);
    });
    vi.mocked(api.selectPlayer).mockResolvedValue(snapshot(5, 'player-b'));
    await act(async () => {
      await current.selectPlayer('player-b');
    });
    const latest = deferred<Dashboard>();
    vi.mocked(api.start).mockReturnValueOnce(latest.promise);
    let second!: Promise<boolean>;
    await act(async () => {
      second = current.start(defaultConfig);
    });
    await act(async () => {
      old.reject(new Error('old-player-error'));
      expect(await first).toBe(false);
    });
    expect(current.pending).toBe('start');
    expect(current.actionError).toBeNull();
    await act(async () => expect(await current.stop()).toBe(false));
    expect(api.stop).not.toHaveBeenCalled();
    expect(api.start).toHaveBeenLastCalledWith(defaultConfig, 'player-b', expect.any(AbortSignal));
    await act(async () => {
      latest.resolve(snapshot(10, 'player-b'));
      expect(await second).toBe(true);
    });
    expect(current.pending).toBeNull();
  });

  it('ignores a delayed bootstrap GET after selecting an explicit Player', async () => {
    const initial = deferred<Dashboard>();
    vi.mocked(api.dashboard).mockReturnValue(initial.promise);
    await mount();
    vi.mocked(api.selectPlayer).mockResolvedValue(snapshot(3, 'player-b'));
    await act(async () => {
      await current.selectPlayer('player-b');
    });
    await act(async () => initial.resolve(snapshot(99)));
    expect(current.dashboard).toEqual(snapshot(3, 'player-b'));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toBe('/api/events?playerId=player-b');
  });

  it('retries with its selected Player even if the server default changed elsewhere', async () => {
    await mount();
    vi.mocked(api.dashboard).mockResolvedValue(snapshot(1));
    await act(async () => current.retry());
    expect(api.dashboard).toHaveBeenLastCalledWith(expect.any(AbortSignal), 'player-a');
    expect(MockEventSource.instances[0]!.close).toHaveBeenCalled();
  });

  it('adds and selects a new Player and retains the old workspace if creation fails', async () => {
    await mount();
    const input = { server: 'bots' as const, userId: 'new-secret' };
    vi.mocked(api.addPlayer).mockRejectedValueOnce(new Error('Player 已存在'));
    await act(async () => expect(await current.addPlayer(input)).toBe(false));
    expect(current.dashboard).toEqual(snapshot());
    expect(current.actionError).toBe('Player 已存在');
    expect(current.playerPending).toBe(false);
    vi.mocked(api.addPlayer).mockResolvedValueOnce(snapshot(0, 'player-b'));
    await act(async () => expect(await current.addPlayer(input)).toBe(true));
    expect(api.addPlayer).toHaveBeenLastCalledWith(input, expect.any(AbortSignal));
    expect(current.dashboard?.player?.id).toBe('player-b');
    expect(current.playerPending).toBe(false);
    expect(MockEventSource.instances[0]!.close).toHaveBeenCalledOnce();
    expect(MockEventSource.instances[1]!.url).toBe('/api/events?playerId=player-b');
  });
});

describe('useDashboard missed deletion recovery', () => {
  function fallbackSnapshot(id: string | null): Dashboard {
    const data = snapshot(4, id ?? 'player-a');
    return {
      ...data,
      player: id ? data.player : null,
      players: id ? data.players.filter((item) => item.id === id) : [],
    };
  }
  function streamError(source = MockEventSource.instances[0]!) {
    source.readyState = MockEventSource.CLOSED;
    source.dispatchEvent(new Event('error'));
  }

  it.each([
    { opened: true, fallback: 'player-b' },
    { opened: true, fallback: null },
    { opened: false, fallback: 'player-b' },
    { opened: false, fallback: null },
  ])(
    'recovers a missed deletion to $fallback with SSE opened=$opened and updates explicit URL scope',
    async ({ opened, fallback }) => {
      window.history.replaceState(null, '', '/?playerId=player-a&view=keep#anchor');
      try {
        await mount();
        const old = MockEventSource.instances[0]!;
        if (opened) await act(async () => old.dispatchEvent(new Event('open')));
        const next = fallbackSnapshot(fallback);
        vi.mocked(api.dashboard)
          .mockRejectedValueOnce(new ApiRequestError('Gone', 404))
          .mockResolvedValueOnce(next);
        await act(async () => streamError(old));
        expect(api.dashboard).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), 'player-a');
        expect(api.dashboard).toHaveBeenNthCalledWith(3, expect.any(AbortSignal), undefined);
        expect(current.dashboard).toEqual(next);
        expect(current.player?.id ?? null).toBe(fallback);
        expect(current.connection).toBe(fallback ? 'connecting' : 'connected');
        expect(old.close).toHaveBeenCalledOnce();
        const url = new URL(window.location.href);
        expect(url.searchParams.get('playerId')).toBe(fallback);
        expect(url.searchParams.get('view')).toBe('keep');
        expect(url.hash).toBe('#anchor');
        expect(MockEventSource.instances).toHaveLength(fallback ? 2 : 1);
        if (fallback)
          expect(MockEventSource.instances[1]!.url).toBe('/api/events?playerId=player-b');
        await act(async () => {
          streamError(old);
          old.send(snapshot(99));
        });
        expect(api.dashboard).toHaveBeenCalledTimes(3);
        expect(current.dashboard).toEqual(next);
      } finally {
        window.history.replaceState(null, '', '/');
      }
    },
  );

  it.each(['player-b', null])(
    'retry of a previously confirmed scope recovers 404 to %s',
    async (fallback) => {
      window.history.replaceState(null, '', '/?playerId=player-a');
      try {
        await mount();
        vi.mocked(api.dashboard)
          .mockRejectedValueOnce(new ApiRequestError('Gone', 404))
          .mockResolvedValueOnce(fallbackSnapshot(fallback));
        await act(async () => current.retry());
        expect(api.dashboard).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), 'player-a');
        expect(api.dashboard).toHaveBeenNthCalledWith(3, expect.any(AbortSignal), undefined);
        expect(current.dashboard).toEqual(fallbackSnapshot(fallback));
        expect(new URLSearchParams(window.location.search).get('playerId')).toBe(fallback);
        expect(current.loadError).toBeNull();
      } finally {
        window.history.replaceState(null, '', '/');
      }
    },
  );

  it('uses a successful existence probe only as proof of presence, preserving the current dashboard and fixed stream', async () => {
    await mount();
    const initial = current.dashboard;
    const old = MockEventSource.instances[0]!;
    const response = deferred<Dashboard>();
    vi.mocked(api.dashboard).mockReturnValueOnce(response.promise);
    await act(async () => {
      streamError(old);
      streamError(old);
      streamError(old);
    });
    expect(api.dashboard).toHaveBeenCalledTimes(2);
    expect(current.dashboard).toBe(initial);
    await act(async () => response.resolve(snapshot(99)));
    expect(current.dashboard).toBe(initial);
    expect(current.player?.id).toBe('player-a');
    expect(old.close).not.toHaveBeenCalled();
    expect(current.connection).toBe('disconnected');
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it.each([
    ['403', new ApiRequestError('Player 不存在', 403)],
    ['500', new ApiRequestError('Player 不存在', 500)],
    ['network', new TypeError('Failed to fetch')],
    ['unstructured 404 text', new Error('Player 不存在（HTTP 404）')],
  ])('does not infer deletion from a %s probe error', async (_label, error) => {
    window.history.replaceState(null, '', '/?playerId=player-a');
    try {
      await mount();
      const initial = current.dashboard;
      vi.mocked(api.dashboard).mockRejectedValueOnce(error);
      await act(async () => streamError());
      expect(current.dashboard).toBe(initial);
      expect(current.player?.id).toBe('player-a');
      expect(new URLSearchParams(window.location.search).get('playerId')).toBe('player-a');
      expect(api.dashboard).toHaveBeenCalledTimes(2);
      expect(api.dashboard).toHaveBeenLastCalledWith(expect.any(AbortSignal), 'player-a');
      expect(MockEventSource.instances[0]!.close).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it.each([
    ['403', new ApiRequestError('Player 不存在', 403)],
    ['500', new ApiRequestError('Player 不存在', 500)],
    ['network', new TypeError('Failed to fetch')],
  ])(
    'does not fall back from a %s retry error even after a valid bootstrap',
    async (_label, error) => {
      await mount();
      vi.mocked(api.dashboard).mockRejectedValueOnce(error);
      await act(async () => current.retry());
      expect(current.player?.id).toBe('player-a');
      expect(current.loadError).toBe(error.message);
      expect(api.dashboard).toHaveBeenCalledTimes(2);
      expect(api.dashboard).toHaveBeenLastCalledWith(expect.any(AbortSignal), 'player-a');
      expect(MockEventSource.instances).toHaveLength(1);
    },
  );

  it.each(['open', 'dashboard'])(
    'a fresh SSE %s cancels a probe and ignores its late 404',
    async (event) => {
      await mount();
      const source = MockEventSource.instances[0]!;
      const response = deferred<Dashboard>();
      vi.mocked(api.dashboard).mockReturnValueOnce(response.promise);
      await act(async () => streamError(source));
      const signal = vi.mocked(api.dashboard).mock.calls[1]![0];
      await act(async () =>
        event === 'open' ? source.dispatchEvent(new Event('open')) : source.send(snapshot(7)),
      );
      const latest = current.dashboard;
      expect(signal.aborted).toBe(true);
      await act(async () => response.reject(new ApiRequestError('Gone', 404)));
      expect(current.dashboard).toBe(latest);
      expect(current.connection).toBe('connected');
      expect(current.player?.id).toBe('player-a');
      expect(api.dashboard).toHaveBeenCalledTimes(2);
      expect(source.close).not.toHaveBeenCalled();
    },
  );

  it('keeps only one in-flight probe and an old cancelled finally cannot release a newer probe', async () => {
    await mount();
    const source = MockEventSource.instances[0]!;
    const old = deferred<Dashboard>();
    const latest = deferred<Dashboard>();
    vi.mocked(api.dashboard).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    await act(async () => {
      streamError(source);
      streamError(source);
    });
    expect(api.dashboard).toHaveBeenCalledTimes(2);
    const oldSignal = vi.mocked(api.dashboard).mock.calls[1]![0];
    await act(async () => source.dispatchEvent(new Event('open')));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => {
      streamError(source);
      streamError(source);
    });
    expect(api.dashboard).toHaveBeenCalledTimes(3);
    await act(async () => old.reject(new ApiRequestError('Gone', 404)));
    await act(async () => streamError(source));
    expect(api.dashboard).toHaveBeenCalledTimes(3);
    expect(current.player?.id).toBe('player-a');
    await act(async () => latest.resolve(snapshot(99)));
    expect(current.dashboard).toEqual(snapshot());
    await act(async () => streamError(source));
    expect(api.dashboard).toHaveBeenCalledTimes(4);
  });

  it('cancels a probe on scope switch and its late 404 cannot replace the new scope or its probe', async () => {
    await mount();
    const old = deferred<Dashboard>();
    const latest = deferred<Dashboard>();
    vi.mocked(api.dashboard).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    await act(async () => streamError());
    const oldSignal = vi.mocked(api.dashboard).mock.calls[1]![0];
    vi.mocked(api.selectPlayer).mockResolvedValueOnce(snapshot(8, 'player-b'));
    await act(async () => {
      await current.selectPlayer('player-b');
    });
    expect(oldSignal.aborted).toBe(true);
    const source = MockEventSource.instances[1]!;
    await act(async () => streamError(source));
    await act(async () => old.reject(new ApiRequestError('Gone', 404)));
    await act(async () => streamError(source));
    expect(api.dashboard).toHaveBeenCalledTimes(3);
    expect(api.dashboard).toHaveBeenLastCalledWith(expect.any(AbortSignal), 'player-b');
    expect(current.dashboard).toEqual(snapshot(8, 'player-b'));
    await act(async () => latest.resolve(snapshot(99, 'player-b')));
    expect(current.dashboard).toEqual(snapshot(8, 'player-b'));
  });

  it('cancels an in-flight probe on unmount and ignores its late 404', async () => {
    await mount();
    const response = deferred<Dashboard>();
    vi.mocked(api.dashboard).mockReturnValueOnce(response.promise);
    await act(async () => streamError());
    const signal = vi.mocked(api.dashboard).mock.calls[1]![0];
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    await act(async () => response.reject(new ApiRequestError('Gone', 404)));
    expect(api.dashboard).toHaveBeenCalledTimes(2);
  });

  it('a player-deleted event wins over a pending probe without performing duplicate fallback loads', async () => {
    await mount();
    const response = deferred<Dashboard>();
    vi.mocked(api.dashboard)
      .mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce(fallbackSnapshot('player-b'));
    const source = MockEventSource.instances[0]!;
    await act(async () => streamError(source));
    const signal = vi.mocked(api.dashboard).mock.calls[1]![0];
    await act(async () =>
      source.dispatchEvent(
        new MessageEvent('player-deleted', { data: JSON.stringify({ playerId: 'player-a' }) }),
      ),
    );
    expect(signal.aborted).toBe(true);
    await act(async () => response.reject(new ApiRequestError('Gone', 404)));
    expect(current.dashboard).toEqual(fallbackSnapshot('player-b'));
    expect(api.dashboard).toHaveBeenCalledTimes(3);
    expect(MockEventSource.instances).toHaveLength(2);
  });
});

describe('useDashboard deletion and creation races', () => {
  function deleted(id: string, source = MockEventSource.instances[0]!) {
    source.dispatchEvent(
      new MessageEvent('player-deleted', { data: JSON.stringify({ playerId: id }) }),
    );
  }
  function remaining(id: string | null): Dashboard {
    const data = snapshot(4, id ?? 'player-a');
    return {
      ...data,
      player: id ? data.player : null,
      players: id ? data.players.filter((item) => item.id === id) : [],
    };
  }

  it('deletes another Player without replacing current config/state or restarting the fixed stream', async () => {
    await mount();
    const initial = current.dashboard!;
    const source = MockEventSource.instances[0]!;
    vi.mocked(api.deletePlayer).mockResolvedValue({
      ...remaining('player-a'),
      config: { ...defaultConfig, command: 'should-not-replace-draft' },
    });
    await act(async () =>
      expect(await current.deletePlayer('player-b', new AbortController().signal)).toBe(true),
    );
    expect(api.deletePlayer).toHaveBeenCalledWith('player-b', 'player-a', expect.any(AbortSignal));
    expect(current.dashboard?.player).toBe(initial.player);
    expect(current.dashboard?.config).toBe(initial.config);
    expect(current.dashboard?.state).toBe(initial.state);
    expect(current.players.map((item) => item.id)).toEqual(['player-a']);
    expect(current.dashboard?.players).toEqual(current.players);
    expect(source.close).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(1);
    await act(async () => source.send(snapshot(99)));
    expect(current.players.map((item) => item.id)).toEqual(['player-a']);
    expect(current.dashboard?.players).toEqual(current.players);
  });

  it.each(['player-b', null])(
    'deletes current Player and adopts fallback %s or first-use empty state',
    async (fallback) => {
      window.history.replaceState(null, '', '/?playerId=player-a');
      try {
        await mount();
        const old = MockEventSource.instances[0]!;
        vi.mocked(api.deletePlayer).mockResolvedValue(remaining(fallback));
        await act(async () =>
          expect(await current.deletePlayer('player-a', new AbortController().signal)).toBe(true),
        );
        expect(old.close).toHaveBeenCalledOnce();
        expect(current.player?.id ?? null).toBe(fallback);
        expect(current.dashboard).toEqual(remaining(fallback));
        expect(new URLSearchParams(window.location.search).get('playerId')).toBe(fallback);
        expect(MockEventSource.instances).toHaveLength(fallback ? 2 : 1);
        await act(async () => {
          deleted('player-a', old);
          old.send(snapshot(99));
        });
        expect(current.dashboard).toEqual(remaining(fallback));
      } finally {
        window.history.replaceState(null, '', '/');
      }
    },
  );

  it('preserves newer fixed-scope SSE state and list when a noncurrent delete response is delayed', async () => {
    await mount();
    const response = deferred<Dashboard>();
    vi.mocked(api.deletePlayer).mockReturnValue(response.promise);
    let removal!: Promise<boolean>;
    await act(async () => {
      removal = current.deletePlayer('player-b', new AbortController().signal);
    });
    const newer = {
      ...snapshot(90),
      players: [snapshot().players[0]!, { ...snapshot().players[1]!, id: 'player-c' }],
    };
    await act(async () => MockEventSource.instances[0]!.send(newer));
    await act(async () => {
      response.resolve(remaining('player-a'));
      expect(await removal).toBe(true);
    });
    expect(current.dashboard?.state.turn).toBe(90);
    expect(current.players.map((item) => item.id)).toEqual(['player-a', 'player-c']);
  });

  it('keeps current workspace on running rejection and permits a later retry', async () => {
    await mount();
    vi.mocked(api.deletePlayer)
      .mockRejectedValueOnce(new Error('请先停止 Player（409）'))
      .mockResolvedValueOnce(remaining('player-a'));
    await act(async () => {
      await expect(current.deletePlayer('player-b', new AbortController().signal)).rejects.toThrow(
        '请先停止',
      );
    });
    expect(current.dashboard).toEqual(snapshot());
    expect(MockEventSource.instances[0]!.close).not.toHaveBeenCalled();
    await act(async () =>
      expect(await current.deletePlayer('player-b', new AbortController().signal)).toBe(true),
    );
  });

  it('locks duplicate deletion calls and ignores a late old response after switching workspace', async () => {
    await mount();
    const response = deferred<Dashboard>();
    vi.mocked(api.deletePlayer).mockReturnValue(response.promise);
    let removal!: Promise<boolean>;
    await act(async () => {
      removal = current.deletePlayer('player-a', new AbortController().signal);
      expect(await current.deletePlayer('player-b', new AbortController().signal)).toBe(false);
    });
    expect(api.deletePlayer).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(api.deletePlayer).mock.calls[0]![2];
    vi.mocked(api.selectPlayer).mockResolvedValue(snapshot(3, 'player-b'));
    await act(async () => {
      await current.selectPlayer('player-b');
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      response.resolve(remaining(null));
      expect(await removal).toBe(false);
    });
    expect(current.dashboard).toEqual(snapshot(3, 'player-b'));
  });

  it('cancels a closed delete and does not let its finally release a newer deletion lock', async () => {
    await mount();
    const old = deferred<Dashboard>();
    const next = deferred<Dashboard>();
    vi.mocked(api.deletePlayer).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const cancel = new AbortController();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = current.deletePlayer('player-a', cancel.signal);
      cancel.abort();
      second = current.deletePlayer('player-b', new AbortController().signal);
    });
    expect(vi.mocked(api.deletePlayer).mock.calls[0]![2].aborted).toBe(true);
    await act(async () => {
      old.reject(new Error('old-delete'));
      expect(await first).toBe(false);
    });
    await act(async () =>
      expect(await current.deletePlayer('player-a', new AbortController().signal)).toBe(false),
    );
    expect(api.deletePlayer).toHaveBeenCalledTimes(2);
    await act(async () => {
      next.resolve(remaining('player-a'));
      expect(await second).toBe(true);
    });
    expect(current.player?.id).toBe('player-a');
  });

  it.each(['start', 'save', 'stop'] as const)(
    'external current deletion aborts old %s and selects fallback without old data/error leakage',
    async (action) => {
      await mount();
      const old = deferred<Dashboard>();
      vi.mocked(api.start).mockReturnValue(old.promise);
      vi.mocked(api.stop).mockReturnValue(old.promise);
      vi.mocked(api.save).mockReturnValue(old.promise.then((data) => data.config));
      let operation!: Promise<boolean>;
      await act(async () => {
        operation = action === 'stop' ? current.stop() : current[action](defaultConfig);
      });
      const signal =
        action === 'stop'
          ? vi.mocked(api.stop).mock.calls[0]![1]!
          : vi.mocked(api[action]).mock.calls[0]![2]!;
      vi.mocked(api.dashboard).mockResolvedValue(remaining('player-b'));
      await act(async () => deleted('player-a'));
      expect(signal.aborted).toBe(true);
      expect(api.dashboard).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined);
      await act(async () => {
        old.resolve(snapshot(99));
        expect(await operation).toBe(false);
      });
      expect(current.dashboard).toEqual(remaining('player-b'));
      expect(current.actionError).toBeNull();
      expect(current.pending).toBeNull();
      expect(MockEventSource.instances[1]!.url).toBe('/api/events?playerId=player-b');
    },
  );

  it('handles SSE-before-own-DELETE response once and ignores unrelated deletion events', async () => {
    await mount();
    const source = MockEventSource.instances[0]!;
    await act(async () => deleted('player-b'));
    expect(current.player?.id).toBe('player-a');
    const response = deferred<Dashboard>();
    vi.mocked(api.deletePlayer).mockReturnValue(response.promise);
    let removal!: Promise<boolean>;
    await act(async () => {
      removal = current.deletePlayer('player-a', new AbortController().signal);
    });
    const signal = vi.mocked(api.deletePlayer).mock.calls[0]![2];
    vi.mocked(api.dashboard).mockResolvedValue(remaining('player-b'));
    await act(async () => deleted('player-a'));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      response.resolve(remaining(null));
      expect(await removal).toBe(false);
      deleted('player-a', source);
    });
    expect(current.dashboard).toEqual(remaining('player-b'));
    expect(api.dashboard).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it('external deletion of the last Player enters empty state and stops fixed streams', async () => {
    await mount();
    vi.mocked(api.dashboard).mockResolvedValue(remaining(null));
    await act(async () => deleted('player-a'));
    expect(current.player).toBeNull();
    expect(current.players).toEqual([]);
    expect(current.connection).toBe('connected');
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.close).toHaveBeenCalledOnce();
  });

  it('updates other-account deletions from scoped dashboard events without switching current scope', async () => {
    await mount();
    const source = MockEventSource.instances[0]!;
    await act(async () => source.send(remaining('player-a')));
    expect(current.player?.id).toBe('player-a');
    expect(current.players.map((item) => item.id)).toEqual(['player-a']);
    expect(source.close).not.toHaveBeenCalled();
  });

  it('cancels nickname lookup and ignores old success/finally while a newer lookup is pending', async () => {
    await mount();
    const first = deferred<Dashboard>();
    const second = deferred<Dashboard>();
    vi.mocked(api.addPlayer).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let old!: Promise<boolean>;
    let latest!: Promise<boolean>;
    await act(async () => {
      old = current.addPlayer({ server: 'bots', userId: 'first' });
      expect(await current.addPlayer({ server: 'bots', userId: 'duplicate' })).toBe(false);
    });
    const signal = vi.mocked(api.addPlayer).mock.calls[0]![1];
    await act(async () => {
      current.cancelAddPlayer();
      latest = current.addPlayer({ server: 'bots', userId: 'second' });
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      first.resolve(snapshot(99, 'player-b'));
      expect(await old).toBe(false);
    });
    expect(current.dashboard).toEqual(snapshot());
    expect(current.playerAction).toBe('add');
    await act(async () => {
      second.resolve(snapshot(7, 'player-b'));
      expect(await latest).toBe(true);
    });
    expect(current.dashboard).toEqual(snapshot(7, 'player-b'));
    expect(current.playerPending).toBe(false);
  });
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

  it('resolves the default Player before opening a fixed Player stream', async () => {
    const initial = deferred<Dashboard>();
    vi.mocked(api.dashboard).mockReturnValue(initial.promise);
    await mount();
    expect(MockEventSource.instances).toHaveLength(0);
    await act(async () => initial.resolve(snapshot()));
    expect(MockEventSource.instances[0]!.url).toBe('/api/events?playerId=player-a');
    const newer = snapshot(20);
    await act(async () => MockEventSource.instances[0]!.send(newer));
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
