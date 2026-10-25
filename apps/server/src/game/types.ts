import type {
  RunConfig,
  Outcome,
  MatchSnapshot,
  MatchRating,
} from '../../../../packages/contracts/src/index.js';

export interface Player {
  i: number;
  username: string;
  team: number;
  relation: 'self' | 'enemy';
  tiles: number;
  total: number;
}
export interface Observation {
  player_id: number;
  turn: number;
  my_land: number;
  my_army: number;
  opp_land: number;
  opp_army: number;
  allied_land: number;
  allied_army: number;
  mode: '1v1';
  teams: number[];
  players: Player[];
  types: number[][];
  owners: number[][];
  armies: number[][];
  player_grid: number[][];
  rules: { game_type: string; modifiers: unknown[]; torus: boolean };
  features: { deserts: number[]; swamps: number[]; tunnels: number[][] };
}
export interface GameFrame {
  gameId: string;
  startedAt?: string;
  observation: Observation;
  attackIndex: number;
  snapshot?: MatchSnapshot;
  rating?: MatchRating;
}
export interface GameEnd {
  gameId: string;
  startedAt?: string;
  endedAt?: string;
  outcome: Exclude<Outcome, 'interrupted'>;
  turn: number;
  snapshot?: MatchSnapshot;
  rating?: MatchRating;
  winnerIndex?: number;
  endReason?: string;
}
export interface AgentAction {
  pass: boolean;
  row: number;
  col: number;
  direction: number;
  split: boolean;
  value: number | null;
}
export type SubmitStatus = 'sent' | 'pass' | 'stale' | 'rejected' | 'dry-run';
export interface GameConnection {
  getSnapshot?(): { gameId: string; snapshot: MatchSnapshot; rating?: MatchRating } | null;
  connect(signal: AbortSignal): Promise<void>;
  join(signal: AbortSignal): Promise<GameFrame | GameEnd>;
  next(lastTurn: number, signal: AbortSignal): Promise<GameFrame | GameEnd>;
  submit(frame: GameFrame, action: AgentAction): SubmitStatus;
  close(): void;
}
export type GameFactory = (config: RunConfig) => Promise<GameConnection>;
export function isGameEnd(value: GameFrame | GameEnd): value is GameEnd {
  return 'outcome' in value;
}
