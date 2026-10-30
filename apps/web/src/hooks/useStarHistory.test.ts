// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchFilters, StarHistoryItem } from '../../../../packages/contracts/src/index';
import { PlayerScope } from './PlayerScope';
import { useStarHistory } from './useStarHistory';

function item(id: string): StarHistoryItem {
  return {
    id,
    runId: 'run-1',
    server: 'generals',
    gameId: id,
    startedAt: '2026-10-25T06:00:00Z',
    endedAt: null,
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    promise,
    resolve: (items: StarHistoryItem[]) => resolve(new Response(JSON.stringify({ items }))),
    reject,
  };
}

let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useStarHistory>;
let filters: MatchFilters;
let refreshKey: string;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function Harness() {
  result = useStarHistory(filters, refreshKey);
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
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  filters = {};
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

describe('useStarHistory', () => {
  it('cancels old Player history and ignores its response after a scope remount', async () => {
    const old = deferredResponse();
    fetchMock.mockReturnValueOnce(old.promise);
    await render();
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    const latest = deferredResponse();
    fetchMock.mockReturnValueOnce(latest.promise);
    await render('player-b');
    expect(signal.aborted).toBe(true);
    expect(
      new URL(String(fetchMock.mock.calls[1]![0]), 'http://localhost').searchParams.get('playerId'),
    ).toBe('player-b');
    expect(result.data).toBeNull();
    await act(async () => latest.resolve([item('player-b-match')]));
    await act(async () => old.resolve([item('player-a-match')]));
    expect(result.data?.items[0]?.id).toBe('player-b-match');
  });
  it('requests complete history by default and sends only applied filters, never pagination', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [item('unrated')] })));
    await render();
    const initial = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(initial.pathname).toBe('/api/matches/star-history');
    expect([...initial.searchParams]).toEqual([['playerId', 'player-a']]);
    expect(result.data?.items).toEqual([item('unrated')]);
    filters = { server: 'bots', outcome: 'won', opponent: 'a b', minTurns: 0 };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    await render();
    const filtered = new URL(String(fetchMock.mock.calls[1]![0]), 'http://localhost');
    expect(Object.fromEntries(filtered.searchParams)).toEqual({
      server: 'bots',
      outcome: 'won',
      opponent: 'a b',
      minTurns: '0',
      playerId: 'player-a',
    });
    expect(filtered.searchParams.has('page')).toBe(false);
    expect(filtered.searchParams.has('pageSize')).toBe(false);
  });

  it('aborts a previous filter request, hides old data, and ignores out-of-order responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [item('initial')] })));
    await render();
    const old = deferredResponse();
    fetchMock.mockReturnValueOnce(old.promise);
    filters = { server: 'generals' };
    await render();
    expect(result.data).toBeNull();
    const oldSignal = fetchMock.mock.calls[1]![1]!.signal!;
    const latest = deferredResponse();
    fetchMock.mockReturnValueOnce(latest.promise);
    filters = { server: 'bots' };
    await render();
    expect(oldSignal.aborted).toBe(true);
    await act(async () => latest.resolve([item('latest')]));
    expect(result.data?.items[0]?.id).toBe('latest');
    await act(async () => old.resolve([item('stale')]));
    expect(result.data?.items[0]?.id).toBe('latest');
  });

  it('retains data during rating refresh and coalesces in-flight refreshes', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [item('initial')] })));
    await render();
    const oldData = result.data;
    const refreshed = deferredResponse();
    fetchMock.mockReturnValueOnce(refreshed.promise);
    refreshKey = 'rating-1';
    await render();
    expect(result.loading).toBe(true);
    expect(result.data).toBe(oldData);
    refreshKey = 'rating-2';
    await render();
    refreshKey = 'rating-3';
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const queued = deferredResponse();
    fetchMock.mockReturnValueOnce(queued.promise);
    await act(async () => refreshed.resolve([item('refreshed')]));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.data?.items[0]?.id).toBe('refreshed');
    expect(result.loading).toBe(true);
    await act(async () => queued.resolve([item('latest')]));
    expect(result.data?.items[0]?.id).toBe('latest');
    expect(result.loading).toBe(false);
  });

  it('preserves existing history on refresh failure and allows retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [item('initial')] })));
    await render();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    refreshKey = 'rating-1';
    await render();
    expect(result.error).toBe('offline');
    expect(result.data?.items[0]?.id).toBe('initial');
    const retry = deferredResponse();
    fetchMock.mockReturnValueOnce(retry.promise);
    await act(async () => result.retry());
    expect(result.error).toBeNull();
    expect(result.data?.items[0]?.id).toBe('initial');
    await act(async () => retry.resolve([item('retried')]));
    expect(result.data?.items[0]?.id).toBe('retried');
  });

  it('aborts on unmount and ignores cancellation errors', async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render();
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new DOMException('Aborted', 'AbortError')));
    expect(result.error).toBeNull();
    root = createRoot(container);
  });
});
