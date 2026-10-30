import { useEffect, useRef, useState } from 'react';
import type { MatchFilters, StarHistoryResponse } from '../../../../packages/contracts/src/index';
import { api, errorMessage, isAbortError } from '../api/client';
import { usePlayerId } from './PlayerScope';

type HistoryResult = { key: string; data: StarHistoryResponse };

export function useStarHistory(filters: MatchFilters, refreshKey: string) {
  const playerId = usePlayerId();
  const key = JSON.stringify({ playerId, filters });
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
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
        const data = await api.starHistory(filters, controller.signal, playerId);
        if (!controller.signal.aborted) setResult({ key, data });
      } catch (cause) {
        if (!controller.signal.aborted && !isAbortError(cause)) {
          setError({ key, message: errorMessage(cause) });
        }
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
  }, [playerId, filters, key, attempt]);

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    refresh.current?.();
  }, [refreshKey]);

  return {
    data: result?.key === key ? result.data : null,
    loading,
    error: error?.key === key ? error.message : null,
    retry: () => setAttempt((current) => current + 1),
  };
}
