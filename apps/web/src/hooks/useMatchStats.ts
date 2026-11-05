import { useEffect, useState } from 'react';
import type { MatchRecord } from '../../../../packages/contracts/src/index';
import { api, errorMessage, isAbortError } from '../api/client';
import { usePlayerId } from './PlayerScope';

const PAGE_SIZE = 100;

type MatchResult = { playerId: string; matches: MatchRecord[] };
type MatchError = { playerId: string; message: string };

export function useMatchStats(enabled: boolean, refreshKey: string) {
  const playerId = usePlayerId();
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<MatchError | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !playerId) {
      setLoading(false);
      return;
    }

    const selectedPlayerId = playerId;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const matches = new Map<string, MatchRecord>();
        let page = 1;
        let total = 0;
        do {
          const response = await api.matches(
            {},
            page,
            controller.signal,
            selectedPlayerId,
            PAGE_SIZE,
          );
          total = response.total;
          for (const match of response.items) matches.set(match.id, match);
          if (response.items.length === 0) break;
          page++;
        } while (matches.size < total);

        if (matches.size < total) throw new Error('读取期间对局记录发生变化，请重试。');
        if (!controller.signal.aborted)
          setResult({ playerId: selectedPlayerId, matches: [...matches.values()] });
      } catch (cause) {
        if (!controller.signal.aborted && !isAbortError(cause)) {
          setError({ playerId: selectedPlayerId, message: errorMessage(cause) });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [enabled, playerId, refreshKey, attempt]);

  return {
    matches: result && result.playerId === playerId ? result.matches : null,
    loading: enabled && loading,
    error: error && error.playerId === playerId ? error.message : null,
    retry: () => setAttempt((current) => current + 1),
  };
}
