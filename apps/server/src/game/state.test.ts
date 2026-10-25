import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameState } from './state.js';

function start(stars?: unknown) {
  const state = new GameState();
  state.update('game_start', {
    game_type: '1v1',
    replay_id: 'rating-game',
    playerIndex: 1,
    usernames: ['opponent', 'self'],
    stars,
  });
  return state;
}

afterEach(() => vi.useRealTimers());

function terminalState() {
  const state = new GameState();
  state.update('game_start', {
    game_type: '1v1',
    replay_id: 'terminal-game',
    playerIndex: 0,
    usernames: ['self', 'opponent'],
    stars: [10, 20],
    turn: 1,
    map: [2, 1, 10, 8, 0, 1],
    scores: [
      { i: 0, tiles: 1, total: 10 },
      { i: 1, tiles: 1, total: 8 },
    ],
  });
  return state;
}

const finalMetadata = {
  replay_id: 'terminal-game',
  winnerIndex: 0,
  turn: 3,
  stars: [11, 19],
  scores: [
    { i: 0, tiles: 2, total: 18 },
    { i: 1, tiles: 0, total: 0 },
  ],
};

describe('terminal event enrichment', () => {
  it.each(['game_won', 'game_lost'] as const)(
    'merges later game_over metadata while preserving the first %s result',
    (event) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
      const state = terminalState();
      state.update(event);
      const first = state.current();
      vi.setSystemTime(new Date('2026-10-25T00:00:01.000Z'));
      state.update('game_over', finalMetadata);
      expect(state.current()).toMatchObject({
        outcome: event === 'game_won' ? 'won' : 'lost',
        endedAt: '2026-10-25T00:00:00.000Z',
        winnerIndex: event === 'game_won' ? 0 : 1,
        endReason: event,
        turn: 2,
        rating: { before: 10, after: 11, delta: 1, source: 'terminal' },
        snapshot: {
          turn: 2,
          serverTurn: 3,
          players: [
            { stars: 11, land: 2, army: 18 },
            { stars: 19, land: 0, army: 0 },
          ],
        },
      });
      expect(first).toMatchObject({ turn: 0, rating: { after: null } });
      const enriched = structuredClone(state.current());
      vi.setSystemTime(new Date('2026-10-25T00:00:02.000Z'));
      state.update('game_over', finalMetadata);
      state.update(event);
      expect(state.current()).toEqual(enriched);
      expect(state.getSnapshot()?.snapshot).toEqual(
        enriched && 'outcome' in enriched ? enriched.snapshot : null,
      );
    },
  );

  it('prioritizes terminal stars over earlier and later public-profile samples', () => {
    const state = terminalState();
    state.update('game_won');
    expect(state.setRatingAfter('terminal-game', 10.5, 'public-profile')).toBe(true);
    state.update('game_over', finalMetadata);
    expect(state.setRatingAfter('terminal-game', 12, 'public-profile')).toBe(false);
    expect(state.current()).toMatchObject({
      rating: { before: 10, after: 11, delta: 1, source: 'terminal' },
    });
  });

  it.each(['replay_id', 'gameId', 'game_id'])(
    'rejects terminal metadata from another game identified by %s',
    (key) => {
      const state = terminalState();
      state.update('game_over', { ...finalMetadata, [key]: 'other-game' });
      expect(state.current()).not.toHaveProperty('outcome');
      state.update('game_won');
      const first = structuredClone(state.current());
      state.update('game_over', { ...finalMetadata, [key]: 'other-game' });
      expect(state.current()).toEqual(first);
    },
  );

  it('ignores invalid enrichment and nonterminal updates after completion', () => {
    const state = terminalState();
    state.update('game_won');
    const first = structuredClone(state.current());
    state.update('game_over', {
      turn: -1,
      stars: [NaN, -1],
      scores: [
        { i: 0, tiles: 2, total: 18 },
        { i: 0, tiles: 0, total: 0 },
      ],
    });
    state.update('game_update', { turn: 99, stars: [999, 999] });
    expect(state.current()).toEqual(first);
  });
});

describe('per-game self rating metadata', () => {
  it.each([
    [12.5, 13.75, 1.25],
    [1, 0, -1],
    [0, 0, 0],
  ])('keeps before %s separate from terminal after %s', (before, after, delta) => {
    const state = start([99, before]);
    state.update('game_update', { stars: [100, before + 1] });
    state.update('game_won', { stars: [101, after] });
    expect(state.current()).toMatchObject({
      rating: { username: 'self', before, after, delta, source: 'terminal' },
    });
    expect(state.getSnapshot()?.rating.capturedAt).toEqual(expect.any(String));
  });

  it('does not reuse a last snapshot as a settled rating', () => {
    const state = start([99, 12.5]);
    state.update('game_lost');
    expect(state.current()).toMatchObject({
      rating: { before: 12.5, after: null, delta: null, source: null, capturedAt: null },
    });
  });

  it('does not backfill before from a late opening lookup', () => {
    const state = start();
    state.update('game_lost', { stars: [99, 13] });
    state.setPlayerStars('rating-game', 0, 100);
    expect(state.current()).toMatchObject({ rating: { before: null, after: 13, delta: null } });
    const unknown = start();
    unknown.update('game_lost');
    unknown.setPlayerStars('rating-game', 1, 13);
    expect(unknown.current()).toMatchObject({ rating: { before: null, after: null, delta: null } });
  });

  it('prefers the first precise public baseline without replacing snapshot stars', () => {
    const state = start([99, 84]);
    expect(state.setRatingBefore('rating-game', 83.876173960723037)).toBe(true);
    expect(state.setRatingBefore('rating-game', 85)).toBe(false);
    state.update('game_update', { stars: [99, 84] });
    state.update('game_won');
    expect(state.setRatingAfter('rating-game', 84.117323068167025, 'public-profile')).toBe(true);
    expect(state.current()?.rating?.before).toBe(83.876173960723037);
    expect(state.current()?.rating?.after).toBe(84.117323068167025);
    expect(state.current()?.rating?.delta).toBeCloseTo(0.241149107443988, 10);
    expect(state.getSnapshot()?.snapshot.players[1]?.stars).toBe(84);
  });

  it('does not turn a precise loss into a gain by using rounded server stars', () => {
    const state = start([99, 10]);
    state.setRatingBefore('rating-game', 10.9);
    state.update('game_lost');
    state.setRatingAfter('rating-game', 10.8, 'public-profile');
    expect(state.current()?.rating?.delta).toBeCloseTo(-0.1);
  });

  it.each(['public-profile', 'terminal'] as const)(
    'does not subtract mismatched baseline sources for %s',
    (source) => {
      const state = start([99, 84]);
      if (source === 'terminal') state.setRatingBefore('rating-game', 83.876173960723037);
      state.update('game_won');
      state.setRatingAfter('rating-game', 84.117323068167025, source);
      expect(state.current()?.rating?.delta).toBeNull();
    },
  );

  it('rejects invalid, cross-game and late precise baselines', () => {
    const state = start([99, 84]);
    expect(state.setRatingBefore('other-game', 1)).toBe(false);
    for (const value of [NaN, Infinity, -1]) {
      expect(state.setRatingBefore('rating-game', value)).toBe(false);
    }
    state.update('game_won');
    expect(state.setRatingBefore('rating-game', 83.876173960723037)).toBe(false);
    expect(state.current()?.rating?.before).toBe(84);
    state.reset();
    expect(state.setRatingBefore('rating-game', 0)).toBe(false);
  });

  it('accepts zero as an exact baseline before the game ends', () => {
    const state = start([99, 1]);
    expect(state.setRatingBefore('rating-game', 0)).toBe(true);
    state.update('game_won');
    state.setRatingAfter('rating-game', 0, 'public-profile');
    expect(state.current()?.rating).toMatchObject({ before: 0, after: 0, delta: 0 });
  });

  it('keeps the first opening lookup and rejects invalid or stale post-game samples', () => {
    const state = start();
    state.setPlayerStars('rating-game', 1, 0);
    state.update('game_lost');
    expect(state.setRatingAfter('other-game', 1, 'public-profile')).toBe(false);
    expect(state.setRatingAfter('rating-game', NaN, 'public-profile')).toBe(false);
    expect(state.setRatingAfter('rating-game', -1, 'public-profile')).toBe(false);
    expect(state.setRatingAfter('rating-game', 0.5, 'public-profile')).toBe(true);
    expect(state.current()).toMatchObject({
      rating: { username: 'self', before: 0, after: 0.5, delta: 0.5, source: 'public-profile' },
    });
    state.reset();
    expect(state.getSnapshot()).toBeNull();
  });
});
