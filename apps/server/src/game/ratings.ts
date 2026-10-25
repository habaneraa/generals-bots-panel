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
): Promise<number | null> {
  const url = new URL('https://generals.io/api/starsAndRanks');
  url.searchParams.set('u', username);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
        headers: { accept: 'application/json', 'user-agent': 'generals-bots-panel' },
      });
      if (!response.ok) {
        if (
          (response.status >= 500 || response.status === 429) &&
          attempt < RETRY_DELAYS_MS.length
        ) {
          await waitForRetry(RETRY_DELAYS_MS[attempt]!, signal);
          continue;
        }
        return null;
      }
      const data: unknown = await response.json();
      if (typeof data !== 'object' || data === null || !('stars' in data)) return null;
      const stars = data.stars;
      if (typeof stars !== 'object' || stars === null || !('duel' in stars)) return null;
      return typeof stars.duel === 'number' && Number.isFinite(stars.duel) && stars.duel >= 0
        ? stars.duel
        : null;
    } catch {
      // Ratings are optional: lookup failure must never interrupt gameplay or shutdown.
      if (signal.aborted || attempt >= RETRY_DELAYS_MS.length) return null;
      try {
        await waitForRetry(RETRY_DELAYS_MS[attempt]!, signal);
      } catch {
        return null;
      }
    }
  }
}
