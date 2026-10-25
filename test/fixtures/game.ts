import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  AgentAction,
  GameConnection,
  GameEnd,
  GameFrame,
  Observation,
  SubmitStatus,
} from '../../apps/server/src/game/types.js';

// Unit-test input only. Never imported by the application entrypoint.
export class FixtureGame implements GameConnection {
  private id = '';
  async connect(signal: AbortSignal): Promise<void> {
    await delay(100, undefined, { signal });
  }
  async join(signal: AbortSignal): Promise<GameFrame> {
    await delay(300, undefined, { signal });
    this.id = `fixture-${randomUUID().slice(0, 8)}`;
    return { gameId: this.id, observation: fixtureObservation(), attackIndex: 0 };
  }
  async next(_lastTurn: number, signal: AbortSignal): Promise<GameEnd> {
    signal.throwIfAborted();
    return { gameId: this.id, outcome: 'won', turn: 1 };
  }
  submit(_frame: GameFrame, action: AgentAction): SubmitStatus {
    return action.pass ? 'pass' : 'sent';
  }
  close(): void {}
}

export function fixtureObservation(): Observation {
  return {
    player_id: 0,
    turn: 0,
    my_land: 1,
    my_army: 10,
    opp_land: 1,
    opp_army: 8,
    allied_land: 0,
    allied_army: 0,
    mode: '1v1',
    teams: [0, 1],
    players: [
      { i: 0, username: 'self fixture', team: 0, relation: 'self', tiles: 1, total: 10 },
      { i: 1, username: 'opponent fixture', team: 1, relation: 'enemy', tiles: 1, total: 8 },
    ],
    types: [
      [4, 1, 1],
      [1, 2, 1],
      [1, 1, 4],
    ],
    owners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 2],
    ],
    armies: [
      [10, 0, 0],
      [0, 0, 0],
      [0, 0, 8],
    ],
    player_grid: [
      [0, -1, -1],
      [-1, -2, -1],
      [-1, -1, 1],
    ],
    rules: { game_type: '1v1', modifiers: [], torus: false },
    features: { deserts: [], swamps: [], tunnels: [] },
  };
}
