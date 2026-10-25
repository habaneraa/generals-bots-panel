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

async function connected(
  server: 'generals' | 'bots' = 'generals',
  debug?: (message: string) => void,
) {
  const game = new SocketGame(server, 'private-account-id', undefined, debug);
  const controller = new AbortController();
  await game.connect(controller.signal);
  await game.join(controller.signal);
  return { game, controller };
}

describe('post-game public rating sampling', () => {
  it('exposes the latest confirmed result synchronously after abort and close', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    const { game, controller } = await connected('bots');
    expect(game.getResult()).toBeNull();
    socket.event!('game_won', []);
    const endedAt = game.getResult()?.endedAt;
    controller.abort();
    socket.event!('game_over', [
      {
        winnerIndex: 0,
        turn: 3,
        stars: [13.5, 98],
        scores: [
          { i: 0, tiles: 2, total: 18 },
          { i: 1, tiles: 0, total: 0 },
        ],
      },
    ]);
    game.close();
    expect(game.getResult()).toMatchObject({
      gameId: 'rating-game',
      outcome: 'won',
      endedAt,
      turn: 2,
      winnerIndex: 0,
      rating: { before: 12.5, after: 13.5, delta: 1, source: 'terminal' },
      snapshot: {
        players: [
          { land: 2, army: 18 },
          { land: 0, army: 0 },
        ],
      },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('logs the game, phase, skipped opening lookup and rejected post-game value', async () => {
    const debug = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ stars: { duel: '13.25' } }));
    const { game, controller } = await connected('generals', debug);
    socket.event!('game_won', []);
    expect(await game.next(0, controller.signal)).toMatchObject({
      outcome: 'won',
      rating: { before: 12.5, after: null, delta: null },
    });
    expect(debug).toHaveBeenCalledWith(
      '[rating] game=rating-game phase=before player=0 self=true lookup skipped stars=12.5 reason=existing-snapshot-stars',
    );
    expect(debug).toHaveBeenCalledWith(
      '[rating] game=rating-game phase=after parsed stars.duel type=string value="13.25"',
    );
    expect(debug).toHaveBeenCalledWith(
      '[rating] game=rating-game phase=after sampling finished after=null delta=null source=null aborted=false',
    );
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private-account-id');
    game.close();
  });

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

  it('returns terminal enrichment received while optional sampling is cancelled', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    const { game, controller } = await connected();
    socket.event!('game_won', []);
    const pending = game.next(0, controller.signal);
    socket.event!('game_over', [{ winnerIndex: 0, turn: 3, stars: [13.5, 98] }]);
    controller.abort();
    expect(await pending).toMatchObject({
      outcome: 'won',
      turn: 2,
      rating: { after: 13.5, delta: 1, source: 'terminal' },
    });
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
