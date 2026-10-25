import { describe, expect, it } from 'vitest';
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
