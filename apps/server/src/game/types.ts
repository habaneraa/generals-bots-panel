import type { Replay, ReplaySubmitStatus } from '../../../../packages/contracts/src/replay.js';
import type {
  RunConfig,
  Player as PanelPlayer,
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
  /** Internal recording identity; never sent to the external agent. */
  replayFrameIndex?: number;
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
export type SubmitStatus = ReplaySubmitStatus;
export interface GameConnection {
  getReplay?(): Replay | null;
  recordAction?(frame: GameFrame, action: AgentAction, status: SubmitStatus): void;
  getResult?(): GameEnd | null;
  getSnapshot?(): { gameId: string; snapshot: MatchSnapshot; rating?: MatchRating } | null;
  connect(signal: AbortSignal): Promise<void>;
  join(signal: AbortSignal): Promise<GameFrame | GameEnd>;
  next(lastTurn: number, signal: AbortSignal): Promise<GameFrame | GameEnd>;
  submit(frame: GameFrame, action: AgentAction): SubmitStatus;
  close(): void;
}
export type GameFactory = (config: RunConfig, player: PanelPlayer) => Promise<GameConnection>;
export function isGameEnd(value: GameFrame | GameEnd): value is GameEnd {
  return 'outcome' in value;
}

export function frameIdentity(frame: GameFrame): string {
  // 回合和兵力会持续变化，不能用于识别同一局；视角与地图尺寸必须保持固定。
  const view = frame.observation;
  return JSON.stringify([frame.gameId, view.player_id, view.types.length, view.types[0]?.length]);
}
