import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocketGame } from './live.js';

const socket = vi.hoisted(() => ({
  event: null as ((event: string, args: unknown[]) => void) | null,
  stars: [12.5, 99] as unknown[],
}));
vi.mock('./socket.js', () => ({
  abortError: (signal: AbortSignal) => signal.reason,
  GameSocket: class {
    constructor(_endpoint: string, handlers: { event: typeof socket.event }) {
      socket.event = handlers.event;
    }
    async connect() {}
    async request() {
      return ['self'];
    }
    emit(event: string) {
      if (event !== 'join_1v1') return;
      socket.event!('game_start', [
        {
          game_type: '1v1',
          replay_id: 'rating-game',
          playerIndex: 0,
          usernames: ['self', 'opponent'],
          stars: socket.stars,
          turn: 1,
          map: [2, 1, 10, 8, 0, 1],
          scores: [
            { i: 0, tiles: 1, total: 10 },
            { i: 1, tiles: 1, total: 8 },
          ],
        },
      ]);
    }
    close() {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  socket.stars = [12.5, 99];
});

async function connected(server: 'generals' | 'bots' = 'generals') {
  const game = new SocketGame(server, 'private-account-id');
  const controller = new AbortController();
  await game.connect(controller.signal);
  await game.join(controller.signal);
  return { game, controller };
}

describe('post-game public rating sampling', () => {
  it('waits for the public sample before returning the terminal result', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ stars: { duel: 13.25 } }));
    const { game, controller } = await connected();
    socket.event!('game_won', []);
    const pending = game.next(0, controller.signal);
    expect(request).not.toHaveBeenCalled();
    expect(await pending).toMatchObject({
      outcome: 'won',
      rating: {
        username: 'self',
        before: 12.5,
        after: 13.25,
        delta: 0.75,
        source: 'public-profile',
      },
    });
    expect(String(request.mock.calls[0]?.[0])).toContain('u=self');
    game.close();
  });

  it.each(['bots', 'terminal'] as const)('does not sample %s ratings', async (kind) => {
    const request = vi.spyOn(globalThis, 'fetch');
    const { game, controller } = await connected(kind === 'bots' ? 'bots' : 'generals');
    socket.event!('game_lost', kind === 'terminal' ? [{ stars: [11.5, 100] }] : []);
    const result = await game.next(0, controller.signal);
    expect(result).toMatchObject({ rating: { after: kind === 'terminal' ? 11.5 : null } });
    expect(request).not.toHaveBeenCalled();
    game.close();
  });

  it('aborts the sampling delay without losing the completed outcome', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    const { game, controller } = await connected();
    socket.event!('game_won', []);
    const pending = game.next(0, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ outcome: 'won', rating: { after: null, delta: null } });
    expect(request).not.toHaveBeenCalled();
    game.close();
  });

  it('samples after even if the opening rating was unavailable', async () => {
    socket.stars = [null, 99];
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ stars: { duel: 13 } }));
    const { game, controller } = await connected();
    socket.event!('game_won', []);
    expect(await game.next(0, controller.signal)).toMatchObject({
      rating: { before: null, after: 13, delta: null, source: 'public-profile' },
    });
    expect(request).toHaveBeenCalledTimes(2);
    game.close();
  });

  it('aborts an in-flight sample without losing the completed outcome', async () => {
    const { game, controller } = await connected();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    socket.event!('game_lost', []);
    expect(await game.next(0, controller.signal)).toMatchObject({
      outcome: 'lost',
      rating: { after: null, delta: null },
    });
    game.close();
  });

  it('leaves failed public lookups unknown after bounded retries', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const { game, controller } = await connected();
    socket.event!('game_lost', []);
    const pending = game.next(0, controller.signal);
    expect(await pending).toMatchObject({
      outcome: 'lost',
      rating: { before: 12.5, after: null, delta: null },
    });
    expect(request).toHaveBeenCalledTimes(3);
    game.close();
  });
});
