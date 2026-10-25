/** Public profile metadata only; never receives account credentials or controls a game. */
export async function fetchDuelStars(
  username: string,
  signal: AbortSignal,
): Promise<number | null> {
  try {
    const url = new URL('https://generals.io/api/starsAndRanks');
    url.searchParams.set('u', username);
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
      headers: { accept: 'application/json', 'user-agent': 'generals-bots-panel' },
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('stars' in data)) return null;
    const stars = data.stars;
    if (typeof stars !== 'object' || stars === null || !('duel' in stars)) return null;
    return typeof stars.duel === 'number' && Number.isFinite(stars.duel) && stars.duel >= 0
      ? stars.duel
      : null;
  } catch {
    // Ratings are optional: lookup failure must never interrupt gameplay or shutdown.
    return null;
  }
}
