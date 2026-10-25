/** Public profile metadata only; never receives account credentials or controls a game. */
const RETRY_DELAYS_MS = [250, 500];

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(done, delayMs);
    function done() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function fetchDuelStars(
  username: string,
  signal: AbortSignal,
  debug?: (message: string) => void,
): Promise<number | null> {
  const url = new URL('https://generals.io/api/starsAndRanks');
  url.searchParams.set('u', username);

  for (let attempt = 0; ; attempt += 1) {
    const started = performance.now();
    debug?.(`request attempt=${attempt + 1} timeoutMs=2000`);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
        headers: { accept: 'application/json', 'user-agent': 'generals-bots-panel' },
      });
      debug?.(
        `response attempt=${attempt + 1} status=${response.status} elapsedMs=${Math.round(performance.now() - started)}`,
      );
      if (!response.ok) {
        if (
          (response.status >= 500 || response.status === 429) &&
          attempt < RETRY_DELAYS_MS.length
        ) {
          debug?.(`retry delayMs=${RETRY_DELAYS_MS[attempt]} reason=HTTP-${response.status}`);
          await waitForRetry(RETRY_DELAYS_MS[attempt]!, signal);
          continue;
        }
        debug?.(`result=null reason=HTTP-${response.status}`);
        return null;
      }
      const data: unknown = await response.json();
      if (typeof data !== 'object' || data === null || !('stars' in data)) {
        debug?.('result=null reason=missing-stars');
        return null;
      }
      const stars = data.stars;
      if (typeof stars !== 'object' || stars === null || !('duel' in stars)) {
        debug?.('result=null reason=missing-stars.duel');
        return null;
      }
      const raw = stars.duel;
      const value =
        typeof raw === 'number' || typeof raw === 'string'
          ? JSON.stringify(raw).slice(0, 80)
          : raw === null
            ? 'null'
            : 'unavailable';
      debug?.(`parsed stars.duel type=${typeof raw} value=${value}`);
      const parsed =
        typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw;
      const result =
        typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      debug?.(`result=${result} reason=${result === null ? 'invalid-stars.duel' : 'ok'}`);
      return result;
    } catch (error) {
      // Ratings are optional: lookup failure must never interrupt gameplay or shutdown.
      const reason =
        error instanceof Error &&
        ['TimeoutError', 'AbortError', 'TypeError', 'SyntaxError'].includes(error.name)
          ? error.name
          : 'Error';
      debug?.(
        `request failed attempt=${attempt + 1} reason=${reason} aborted=${signal.aborted} elapsedMs=${Math.round(performance.now() - started)}`,
      );
      if (signal.aborted || attempt >= RETRY_DELAYS_MS.length) {
        debug?.(`result=null reason=${signal.aborted ? 'cancelled' : 'retries-exhausted'}`);
        return null;
      }
      try {
        debug?.(`retry delayMs=${RETRY_DELAYS_MS[attempt]} reason=${reason}`);
        await waitForRetry(RETRY_DELAYS_MS[attempt]!, signal);
      } catch {
        debug?.('result=null reason=cancelled');
        return null;
      }
    }
  }
}
