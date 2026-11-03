import { z } from 'zod';

export const playerInputSchema = z
  .object({
    server: z.enum(['generals', 'bots']),
    userId: z.string().trim().min(1).max(4096),
  })
  .strict();
export type PlayerInput = z.infer<typeof playerInputSchema>;
export interface Player extends PlayerInput {
  id: string;
  nickname: string;
}
export interface PlayerDetails {
  player: Player;
  dataDir: string;
  phase: RunPhase;
  active: boolean;
  runs: number;
  matches: number;
  stats: Stats;
  logs: number;
  replays: number;
  lastRunAt: string | null;
}

export const runConfigSchema = z
  .object({
    mode: z.literal('live').default('live'),
    command: z.string().trim().max(4096).default('bash'),
    args: z.array(z.string().max(4096)).max(100).default(['../AverageJoe/run.sh']),
    cwd: z.string().trim().max(4096).default(''),
    protocol: z.enum(['jsonl', 'stdio']).default('jsonl'),
    agentTimeoutMs: z.number().int().min(100).max(300000).default(60000),
    autopilot: z.boolean().default(true),
    cooldownMs: z.number().int().min(0).max(300000).default(15000),
    maxGames: z.number().int().min(1).max(10000).default(10),
    dryRun: z.boolean().default(false),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const key of ['command'] as const) {
      if (!config[key]) ctx.addIssue({ code: 'custom', path: [key], message: '此项不能为空' });
    }
  });

export type RunConfig = z.infer<typeof runConfigSchema>;
export const defaultConfig: RunConfig = runConfigSchema.parse({});
export type RunPhase =
  'idle' | 'starting' | 'queueing' | 'playing' | 'cooldown' | 'stopping' | 'stopped' | 'failed';
export type Outcome = 'won' | 'lost' | 'draw' | 'interrupted';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export interface LogEntry {
  id: number;
  time: string;
  runId: string;
  level: LogLevel;
  message: string;
}
export const logPageQuerySchema = z
  .object({
    beforeId: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    afterId: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(200),
  })
  .strict()
  .superRefine((query, ctx) => {
    if ((query.beforeId === undefined) === (query.afterId === undefined)) {
      ctx.addIssue({ code: 'custom', message: '必须指定 beforeId 或 afterId，且不能同时指定' });
    }
  });
export type LogPageQuery = z.infer<typeof logPageQuerySchema>;
export type LogPageCursor = Pick<LogPageQuery, 'beforeId' | 'afterId'>;
export interface LogPage {
  entries: LogEntry[];
  hasMore: boolean;
}
export interface MatchPlayerSnapshot {
  index: number;
  isSelf: boolean;
  userId: string | null;
  username: string | null;
  stars: number | null;
  team: number | null;
  land: number | null;
  army: number | null;
  cities: number | null;
  visibleCities: number | null;
  alive: boolean | null;
}
export interface MatchSnapshot {
  turn: number | null;
  serverTurn: number | null;
  capturedAt: string;
  gameType: string;
  teams: number[];
  modifiers: string[];
  torus: boolean;
  map: { width: number; height: number } | null;
  players: MatchPlayerSnapshot[];
}
export interface MatchAgentStats {
  observations: number;
  decisions: number;
  submittedMoves: number;
  passes: number;
  skippedMoves: number;
  splitMoves: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
}
export interface MatchDetails {
  initial: MatchSnapshot | null;
  last: MatchSnapshot | null;
  durationMs: number | null;
  winnerIndex: number | null;
  endReason: string | null;
  agent: MatchAgentStats;
}
/** Self player's 1v1 stars; unknown values are never inferred from the outcome. */
export interface MatchRating {
  username: string | null;
  /** First pre-game public profile sample when available, otherwise server-observed stars. */
  before: number | null;
  /** Terminal stars or a post-game public profile sample, which may lag settlement. */
  after: number | null;
  source: 'terminal' | 'public-profile' | null;
  /** Time the after value was observed. */
  capturedAt: string | null;
  /** after - before, only when both values are known and come from the same source. */
  delta: number | null;
}
export interface MatchRecord {
  id: string;
  runId: string;
  mode: 'live';
  server: Player['server'];
  gameId: string;
  opponent: string;
  startedAt: string;
  endedAt: string | null;
  outcome: Outcome | null;
  turns: number;
  replayUrl: string | null;
  localReplay?: boolean;
  details?: MatchDetails;
  rating?: MatchRating;
}
export type StarHistoryItem = Pick<
  MatchRecord,
  'id' | 'runId' | 'server' | 'gameId' | 'startedAt' | 'endedAt' | 'rating'
>;
export interface StarHistoryResponse {
  items: StarHistoryItem[];
}
export interface RunRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  phase: RunPhase;
  config: RunConfig;
  error: string | null;
}
export interface RunState {
  run: RunRecord | null;
  phase: RunPhase;
  phaseStartedAt: string;
  match: MatchRecord | null;
  turn: number;
  agentLatencyMs: number | null;
  completedGames: number;
  nextGameAt: string | null;
}
export interface Stats {
  total: number;
  won: number;
  lost: number;
  draw: number;
  interrupted: number;
  winRate: number;
}
export const matchFiltersSchema = z
  .object({
    server: z.enum(['generals', 'bots']).optional(),
    outcome: z.enum(['won', 'lost', 'draw', 'interrupted', 'playing']).optional(),
    opponent: z.string().trim().max(200).optional(),
    gameId: z.string().trim().max(256).optional(),
    startedAfter: z.iso.datetime({ offset: true }).optional(),
    startedBefore: z.iso.datetime({ offset: true }).optional(),
    minTurns: z.coerce.number().int().min(0).max(10000000).optional(),
    maxTurns: z.coerce.number().int().min(0).max(10000000).optional(),
  })
  .strict()
  .superRefine((filters, ctx) => {
    if (
      filters.startedAfter &&
      filters.startedBefore &&
      Date.parse(filters.startedAfter) > Date.parse(filters.startedBefore)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['startedBefore'],
        message: '结束时间不能早于开始时间',
      });
    }
    if (
      filters.minTurns !== undefined &&
      filters.maxTurns !== undefined &&
      filters.minTurns > filters.maxTurns
    ) {
      ctx.addIssue({ code: 'custom', path: ['maxTurns'], message: '最大回合数不能小于最小回合数' });
    }
  });
export type MatchFilters = z.infer<typeof matchFiltersSchema>;
export const matchQuerySchema = matchFiltersSchema.safeExtend({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export interface Dashboard {
  player: Player | null;
  players: Player[];
  state: RunState;
  config: RunConfig;
  stats: Stats;
  matches: MatchRecord[];
  logs: LogEntry[];
  dataDir: string;
}
export interface MatchPage {
  items: MatchRecord[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ApiError {
  message: string;
}
