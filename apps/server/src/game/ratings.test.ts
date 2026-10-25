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
  it('retries transient lookup failures before returning a rating', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ stars: { duel: 12.5 } }));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBe(12.5);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('ignores lookup failure without affecting a game', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBeNull();
  });
  it('retries rate limits and server errors', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ stars: { duel: 7 } }));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBe(7);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not retry client errors', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 404 }));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('stops retrying when the caller aborts', async () => {
    const controller = new AbortController();
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const pending = fetchDuelStars('player', controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('ignores unsuccessful HTTP responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBeNull();
  });
});
