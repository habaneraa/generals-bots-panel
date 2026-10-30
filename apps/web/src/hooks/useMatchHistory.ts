import { useEffect, useRef, useState } from 'react';
import type { MatchFilters, MatchPage } from '../../../../packages/contracts/src/index';
import { api, errorMessage, isAbortError } from '../api/client';
import { usePlayerId } from './PlayerScope';

type HistoryResult = { key: string; data: MatchPage };
type HistoryQuery = { filters: MatchFilters; page: number };

export function useMatchHistory(refreshKey: string) {
  const playerId = usePlayerId();
  const [query, setQuery] = useState<HistoryQuery>({ filters: {}, page: 1 });
  const { filters, page } = query;
  const key = JSON.stringify({ playerId, ...query });
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const refresh = useRef<(() => void) | null>(null);
  const lastRefreshKey = useRef(refreshKey);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    let queued = false;

    async function load() {
      if (controller.signal.aborted || !playerId) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      setLoading(true);
      setError(null);
      try {
        const data = await api.matches(filters, page, controller.signal, playerId);
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
        if (page > lastPage) setQuery({ filters, page: lastPage });
        else setResult({ key, data });
      } catch (cause) {
        if (!controller.signal.aborted && !isAbortError(cause)) setError(errorMessage(cause));
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (queued) {
            queued = false;
            void load();
          }
        }
      }
    }

    refresh.current = () => void load();
    void load();
    return () => {
      controller.abort();
      refresh.current = null;
    };
  }, [playerId, filters, page, key, attempt]);

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    refresh.current?.();
  }, [refreshKey]);

  return {
    data: result?.key === key ? result.data : null,
    filters,
    page,
    loading,
    error,
    applyFilters: (nextFilters: MatchFilters) => setQuery({ filters: nextFilters, page: 1 }),
    setPage: (nextPage: number) =>
      setQuery((current) => ({ ...current, page: Math.max(1, nextPage) })),
    retry: () => setAttempt((current) => current + 1),
  };
}
