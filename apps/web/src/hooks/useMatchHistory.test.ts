// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchPage } from '../../../../packages/contracts/src/index';
import { api } from '../api/client';
import { PlayerScope } from './PlayerScope';
import { useMatchHistory } from './useMatchHistory';

function page(total = 60, current = 1): MatchPage {
  return { items: [], total, page: current, pageSize: 20 };
}

function deferredPage() {
  let resolve!: (value: MatchPage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MatchPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useMatchHistory>;
let refreshKey: string;

function Harness() {
  result = useMatchHistory(refreshKey);
  return null;
}

async function render(playerId = 'player-a') {
  await act(async () =>
    root.render(
      createElement(
        PlayerScope.Provider,
        { key: playerId, value: playerId },
        createElement(Harness),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(api, 'matches').mockResolvedValue(page());
  refreshKey = 'initial';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useMatchHistory', () => {
  it('aborts old Player requests, resets filters/page and ignores late responses on remount', async () => {
    await render();
    await act(async () => result.applyFilters({ outcome: 'won' }));
    const old = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(old.promise);
    await act(async () => result.setPage(2));
    const signal = vi.mocked(api.matches).mock.lastCall![2];
    const latest = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(latest.promise);
    await render('player-b');
    expect(signal.aborted).toBe(true);
    expect(result.filters).toEqual({});
    expect(result.page).toBe(1);
    expect(result.data).toBeNull();
    expect(api.matches).toHaveBeenLastCalledWith({}, 1, expect.any(AbortSignal), 'player-b');
    await act(async () => latest.resolve(page(2)));
    await act(async () => old.resolve(page(999, 2)));
    expect(result.data).toEqual(page(2));
  });
  it('loads the first page and resets pagination when applying filters', async () => {
    await render();
    expect(api.matches).toHaveBeenCalledWith({}, 1, expect.any(AbortSignal), 'player-a');
    expect(result.data).toEqual(page());
    expect(result.loading).toBe(false);
    vi.mocked(api.matches).mockResolvedValueOnce(page(60, 2));
    await act(async () => result.setPage(2));
    expect(result.page).toBe(2);
    await act(async () => result.applyFilters({ server: 'bots', minTurns: 0 }));
    expect(result.page).toBe(1);
    expect(result.filters).toEqual({ server: 'bots', minTurns: 0 });
    expect(api.matches).toHaveBeenLastCalledWith(
      { server: 'bots', minTurns: 0 },
      1,
      expect.any(AbortSignal),
      'player-a',
    );
  });

  it('aborts superseded page requests and ignores late responses after filters change', async () => {
    await render();
    const old = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(old.promise);
    await act(async () => result.setPage(2));
    expect(result.data).toBeNull();
    expect(result.loading).toBe(true);
    const oldSignal = vi.mocked(api.matches).mock.calls[1]![2];
    const latest = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(latest.promise);
    await act(async () => result.applyFilters({ server: 'bots' }));
    expect(oldSignal.aborted).toBe(true);
    expect(result.data).toBeNull();
    await act(async () => latest.resolve(page(5)));
    expect(result.data).toEqual(page(5));
    await act(async () => old.resolve(page(99, 2)));
    expect(result.data).toEqual(page(5));
    expect(result.page).toBe(1);
    expect(result.loading).toBe(false);
    expect(api.matches).toHaveBeenCalledTimes(3);
  });

  it('ignores a superseded request failure while the latest request is still loading', async () => {
    const old = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(old.promise);
    await render();
    const latest = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(latest.promise);
    await act(async () => result.applyFilters({ outcome: 'won' }));
    await act(async () => old.reject(new Error('old request failed')));
    expect(result.error).toBeNull();
    expect(result.loading).toBe(true);
    await act(async () => latest.resolve(page(3)));
    expect(result.data).toEqual(page(3));
    expect(result.error).toBeNull();
    expect(result.loading).toBe(false);
  });

  it('keeps data during refresh and coalesces multiple in-flight refreshes into one follow-up', async () => {
    await render();
    const initialData = result.data;
    const refreshed = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(refreshed.promise);
    refreshKey = 'update-1';
    await render();
    expect(result.data).toBe(initialData);
    expect(result.loading).toBe(true);
    const signal = vi.mocked(api.matches).mock.calls[1]![2];
    refreshKey = 'update-2';
    await render();
    refreshKey = 'update-3';
    await render();
    expect(api.matches).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(false);
    const queued = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(queued.promise);
    await act(async () => refreshed.resolve(page(61)));
    expect(api.matches).toHaveBeenCalledTimes(3);
    expect(result.data).toEqual(page(61));
    expect(result.loading).toBe(true);
    await act(async () => queued.resolve(page(62)));
    expect(result.data).toEqual(page(62));
    expect(result.loading).toBe(false);
    expect(api.matches).toHaveBeenCalledTimes(3);
  });

  it.each([
    { total: 21, lastPage: 2 },
    { total: 0, lastPage: 1 },
  ])(
    'falls back to page $lastPage when the total shrinks to $total',
    async ({ total, lastPage }) => {
      await render();
      const outOfRange = deferredPage();
      const corrected = deferredPage();
      vi.mocked(api.matches)
        .mockReturnValueOnce(outOfRange.promise)
        .mockReturnValueOnce(corrected.promise);
      await act(async () => result.setPage(3));
      const signal = vi.mocked(api.matches).mock.calls[1]![2];
      await act(async () => outOfRange.resolve(page(total, 3)));
      expect(result.page).toBe(lastPage);
      expect(result.data).toEqual(lastPage === 1 ? page() : null);
      expect(result.loading).toBe(true);
      expect(signal.aborted).toBe(true);
      expect(api.matches).toHaveBeenLastCalledWith(
        {},
        lastPage,
        expect.any(AbortSignal),
        'player-a',
      );
      await act(async () => corrected.resolve(page(total, lastPage)));
      expect(result.data).toEqual(page(total, lastPage));
      expect(result.loading).toBe(false);
      expect(api.matches).toHaveBeenCalledTimes(3);
    },
  );

  it('preserves data on refresh failure and clears the error when retrying', async () => {
    await render();
    const initialData = result.data;
    vi.mocked(api.matches).mockRejectedValueOnce(new Error('offline'));
    refreshKey = 'update-1';
    await render();
    expect(result.error).toBe('offline');
    expect(result.data).toBe(initialData);
    expect(result.loading).toBe(false);
    const retried = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(retried.promise);
    await act(async () => result.retry());
    expect(result.error).toBeNull();
    expect(result.loading).toBe(true);
    expect(result.data).toBe(initialData);
    await act(async () => retried.resolve(page(63)));
    expect(result.data).toEqual(page(63));
    expect(result.error).toBeNull();
    expect(result.loading).toBe(false);
  });

  it('aborts on unmount and does not run a queued refresh after a late response', async () => {
    const pending = deferredPage();
    vi.mocked(api.matches).mockReturnValueOnce(pending.promise);
    await render();
    const signal = vi.mocked(api.matches).mock.calls[0]![2];
    refreshKey = 'queued-update';
    await render();
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(page()));
    expect(api.matches).toHaveBeenCalledOnce();
    expect(result.data).toBeNull();
  });

  it('does not expose cancellation as a request failure', async () => {
    vi.mocked(api.matches).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await render();
    expect(result.error).toBeNull();
    expect(result.loading).toBe(false);
  });
});
