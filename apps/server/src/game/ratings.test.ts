import { getDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { Agent } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDuelStars } from './ratings.js';

afterEach(() => vi.restoreAllMocks());
describe('public rating metadata without network', () => {
  it.each([0, 12.5, '0', '12.5', '83.876173960723037', ' 84.117323068167025 '])(
    'parses a real star value %s and encodes usernames',
    async (stars) => {
      const request = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ stars: { duel: stars } }));
      expect(await fetchDuelStars('name & 玩家', new AbortController().signal)).toBe(Number(stars));
      const url = request.mock.calls[0]?.[0];
      expect(url).toBeInstanceOf(URL);
      expect(new URL(String(url)).searchParams.get('u')).toBe('name & 玩家');
      expect(request.mock.calls[0]?.[1]).not.toHaveProperty('credentials');
    },
  );
  it.each([
    {},
    { stars: null },
    { stars: { duel: null } },
    { stars: { duel: 'unknown' } },
    { stars: { duel: -1 } },
    ...['', ' ', '-1', 'NaN', 'Infinity', '12.5stars', '0x10', '1e309', false, [], {}].map(
      (duel) => ({ stars: { duel } }),
    ),
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
  it('accepts and diagnoses the actual numeric-string response without rounding', async () => {
    const debug = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ stars: { duel: '83.876173960723037' } }),
    );
    expect(await fetchDuelStars('player', new AbortController().signal, debug)).toBe(
      83.876173960723037,
    );
    expect(debug).toHaveBeenCalledWith('request attempt=1 timeoutMs=8000 addressAttemptMs=2000');
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('status=200 elapsedMs='));
    expect(debug).toHaveBeenCalledWith('parsed stars.duel type=string value="83.876173960723037"');
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('reason=ok'));
  });

  it('uses an isolated dispatcher and an eight-second request budget without changing global connection settings', async () => {
    const globalTimeout = getDefaultAutoSelectFamilyAttemptTimeout();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ stars: { duel: '84.6' } }));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBe(84.6);
    expect(request.mock.calls[0]?.[1]).toHaveProperty('dispatcher', expect.any(Agent));
    expect(timeout).toHaveBeenCalledWith(8000);
    expect(getDefaultAutoSelectFamilyAttemptTimeout()).toBe(globalTimeout);
  });

  it('reports connection error codes without leaking raw exception details', async () => {
    const debug = vi.fn();
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      controller.abort();
      throw new TypeError('private-account-id', {
        cause: { code: 'ETIMEDOUT', message: 'private-account-id' },
      });
    });
    expect(await fetchDuelStars('player', controller.signal, debug)).toBeNull();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('code=ETIMEDOUT'));
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private-account-id');
  });

  it('reports successful zero ratings', async () => {
    const debug = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ stars: { duel: 0 } }));
    expect(await fetchDuelStars('player', new AbortController().signal, debug)).toBe(0);
    expect(debug).toHaveBeenCalledWith('parsed stars.duel type=number value=0');
    expect(debug).toHaveBeenCalledWith('result=0 reason=ok');
  });

  it('reports timeout attempts without copying raw errors into diagnostics', async () => {
    const debug = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('private-account-id', 'TimeoutError'),
    );
    expect(await fetchDuelStars('player', new AbortController().signal, debug)).toBeNull();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('attempt=3 reason=TimeoutError aborted=false'),
    );
    expect(debug).toHaveBeenCalledWith('result=null reason=retries-exhausted');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private-account-id');
  });

  it('ignores unsuccessful HTTP responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    expect(await fetchDuelStars('player', new AbortController().signal)).toBeNull();
  });
});
