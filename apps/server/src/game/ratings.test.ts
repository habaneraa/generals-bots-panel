import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDuelStars } from './ratings.js';

afterEach(() => vi.restoreAllMocks());
describe('public rating metadata without network', () => {
  it.each([0, 12.5])('keeps a real numeric star value %s and encodes usernames', async (stars) => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ stars: { duel: stars } }));
    expect(await fetchDuelStars('name & 玩家', new AbortController().signal)).toBe(stars);
    const url = request.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    expect(new URL(String(url)).searchParams.get('u')).toBe('name & 玩家');
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty('credentials');
  });
  it.each([
    {},
    { stars: null },
    { stars: { duel: null } },
    { stars: { duel: 'unknown' } },
    { stars: { duel: -1 } },
  ])('does not invent a rating for %j', async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBeNull();
  });
  it('ignores lookup failure without affecting a game', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBeNull();
  });
  it('ignores unsuccessful HTTP responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBeNull();
  });
});
