import { describe, expect, it } from 'vitest';
import { fixtureObservation } from '../../../../test/fixtures/game.js';
import { frameIdentity, type GameFrame } from './types.js';

function frame(): GameFrame {
  return { gameId: 'identity-game', attackIndex: 0, observation: fixtureObservation() };
}

describe('game frame identity', () => {
  it('remains stable as turns, armies and acknowledged attacks advance', () => {
    const first = frame();
    const next = structuredClone(first);
    next.observation.turn++;
    next.observation.armies[0]![0]!++;
    next.attackIndex++;
    expect(frameIdentity(next)).toBe(frameIdentity(first));
  });

  it.each<[string, (value: GameFrame) => void]>([
    [
      'game ID',
      (value) => {
        value.gameId = 'another-game';
      },
    ],
    [
      'perspective',
      (value) => {
        value.observation.player_id++;
      },
    ],
    [
      'height',
      (value) => {
        value.observation.types.pop();
      },
    ],
    [
      'width',
      (value) => {
        value.observation.types = value.observation.types.map((row) => row.slice(1));
      },
    ],
  ])('changes when the %s changes', (_name, change) => {
    const first = frame();
    const next = structuredClone(first);
    change(next);
    expect(frameIdentity(next)).not.toBe(frameIdentity(first));
  });
});
