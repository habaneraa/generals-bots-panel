import { z } from 'zod';
import type { Outcome } from './index.js';

export interface ReplayPlayer {
  index: number;
  username: string;
  team: number;
}
export interface ReplayScore {
  index: number;
  land: number;
  army: number;
}
export interface ReplayFrame {
  turn: number;
  at: number;
  /** Row-major interleaved [type, raw server player, army]. */
  keyframe?: number[];
  /** Repeated [cell index, type, raw server player, army] tuples. */
  delta?: number[];
  scores: ReplayScore[];
}
export type ReplaySubmitStatus = 'sent' | 'pass' | 'stale' | 'rejected' | 'dry-run';
export interface ReplayAction {
  frame: number;
  turn: number;
  player: number;
  from: number;
  to: number;
  split: boolean;
  status: ReplaySubmitStatus;
}
/** A recorded playing perspective, not an omniscient server replay. */
export interface Replay {
  format: 'generals-replay';
  version: 1;
  server: 'generals' | 'bots';
  gameId: string;
  startedAt: string;
  endedAt: string | null;
  outcome: Outcome | null;
  winnerIndex: number | null;
  perspective: number;
  width: number;
  height: number;
  tickMs: 500;
  keyframeInterval: 64;
  players: ReplayPlayer[];
  frames: ReplayFrame[];
  actions: ReplayAction[];
  /** Capture stopped early; only the valid prefix is available. */
  truncated?: true;
}

export const MAX_REPLAY_BYTES = 64 * 1024 * 1024;
export const MAX_REPLAY_FRAMES = 100000;
export const MAX_REPLAY_VALUES = 8_000_000;
const MAX_CELLS = 65536;
const nonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const playerIndex = z.number().int().min(0).max(1);
const frameSchema = z
  .object({
    turn: nonnegative,
    at: nonnegative,
    keyframe: z
      .array(z.number().int())
      .max(MAX_CELLS * 3)
      .optional(),
    delta: z
      .array(z.number().int())
      .max(MAX_CELLS * 4)
      .optional(),
    scores: z
      .array(z.object({ index: playerIndex, land: nonnegative, army: nonnegative }).strict())
      .length(2),
  })
  .strict();
const replaySchema = z
  .object({
    format: z.literal('generals-replay'),
    version: z.literal(1),
    truncated: z.literal(true).optional(),
    server: z.enum(['generals', 'bots']),
    gameId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }).nullable(),
    outcome: z.enum(['won', 'lost', 'draw', 'interrupted']).nullable(),
    winnerIndex: playerIndex.nullable(),
    perspective: playerIndex,
    width: z.number().int().min(1).max(256),
    height: z.number().int().min(1).max(256),
    tickMs: z.literal(500),
    keyframeInterval: z.literal(64),
    players: z
      .array(
        z
          .object({ index: playerIndex, username: z.string().max(200), team: z.number().int() })
          .strict(),
      )
      .length(2),
    frames: z.array(frameSchema).min(1).max(MAX_REPLAY_FRAMES),
    actions: z
      .array(
        z
          .object({
            frame: nonnegative,
            turn: nonnegative,
            player: playerIndex,
            from: nonnegative,
            to: nonnegative,
            split: z.boolean(),
            status: z.enum(['sent', 'pass', 'stale', 'rejected', 'dry-run']),
          })
          .strict(),
      )
      .max(MAX_REPLAY_FRAMES),
  })
  .strict();

function validCell(type: number, player: number, army: number): boolean {
  return (
    Number.isSafeInteger(type) &&
    type >= 0 &&
    type <= 5 &&
    Number.isSafeInteger(player) &&
    player >= -4 &&
    player <= 1 &&
    Number.isSafeInteger(army) &&
    army >= 0 &&
    (type === 0
      ? player === -3 && army === 0
      : type === 5
        ? player === -4 && army === 0
        : type === 2
          ? player === -2
          : player >= -1)
  );
}

/** Validate imported JSON before allocating or indexing a board. */
export function parseReplay(value: unknown): Replay {
  const replay = replaySchema.parse(value);
  const size = replay.width * replay.height;
  if (new Set(replay.players.map((player) => player.index)).size !== 2) {
    throw new Error('Replay players must have unique indices');
  }
  if (replay.endedAt && Date.parse(replay.endedAt) < Date.parse(replay.startedAt)) {
    throw new Error('Replay ends before it starts');
  }
  let values = 0;
  let lastKeyframe = -1;
  for (const [index, frame] of replay.frames.entries()) {
    const previous = replay.frames[index - 1];
    if (previous && (frame.turn < previous.turn || frame.at < previous.at)) {
      throw new Error('Replay frames must be ordered');
    }
    if (new Set(frame.scores.map((score) => score.index)).size !== 2) {
      throw new Error('Replay scores must have unique player indices');
    }
    if ((frame.keyframe === undefined) === (frame.delta === undefined)) {
      throw new Error('Replay frame must contain exactly one board encoding');
    }
    if (frame.keyframe) {
      if (frame.keyframe.length !== size * 3) throw new Error('Invalid replay keyframe size');
      lastKeyframe = index;
      for (let offset = 0; offset < frame.keyframe.length; offset += 3) {
        if (
          !validCell(
            frame.keyframe[offset]!,
            frame.keyframe[offset + 1]!,
            frame.keyframe[offset + 2]!,
          )
        ) {
          throw new Error('Invalid replay cell');
        }
      }
    } else {
      if (lastKeyframe < 0 || index - lastKeyframe >= replay.keyframeInterval) {
        throw new Error('Replay is missing a keyframe');
      }
      const delta = frame.delta!;
      if (delta.length % 4 !== 0) throw new Error('Invalid replay delta size');
      const changed = new Set<number>();
      for (let offset = 0; offset < delta.length; offset += 4) {
        const cell = delta[offset]!;
        if (
          cell < 0 ||
          cell >= size ||
          changed.has(cell) ||
          !validCell(delta[offset + 1]!, delta[offset + 2]!, delta[offset + 3]!)
        ) {
          throw new Error('Invalid replay delta cell');
        }
        changed.add(cell);
      }
    }
    values += frame.keyframe?.length ?? frame.delta!.length;
    if (values > MAX_REPLAY_VALUES) throw new Error('Replay board data is too large');
  }
  let lastActionFrame = -1;
  let lastActionTurn = -1;
  for (const action of replay.actions) {
    if (
      action.turn <= lastActionTurn ||
      action.frame < lastActionFrame ||
      action.frame >= replay.frames.length ||
      replay.frames[action.frame]!.turn !== action.turn ||
      action.from >= size ||
      action.to >= size ||
      action.player !== replay.perspective
    ) {
      throw new Error('Invalid replay action reference');
    }
    lastActionFrame = action.frame;
    lastActionTurn = action.turn;
  }
  return replay;
}

/** Random access starts at a nearby keyframe; sequential playback reuses the previous board. */
export class ReplayTimeline {
  private index = -1;
  private cells: number[] = [];
  private readonly keyframes: number[] = [];

  constructor(readonly replay: Replay) {
    for (let index = 0; index < replay.frames.length; index++) {
      if (replay.frames[index]!.keyframe) this.keyframes.push(index);
    }
    if (this.keyframes[0] !== 0) throw new Error('Replay must start with a keyframe');
  }

  seek(frameIndex: number): { cells: number[]; frame: ReplayFrame } {
    if (
      !Number.isInteger(frameIndex) ||
      frameIndex < 0 ||
      frameIndex >= this.replay.frames.length
    ) {
      throw new RangeError('Replay frame index is out of range');
    }
    if (frameIndex !== this.index) {
      let start = this.index + 1;
      let low = 0;
      let high = this.keyframes.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (this.keyframes[middle]! <= frameIndex) low = middle + 1;
        else high = middle;
      }
      const keyframe = this.keyframes[low - 1]!;
      if (frameIndex < this.index || this.index < keyframe) {
        this.cells = [...this.replay.frames[keyframe]!.keyframe!];
        start = keyframe + 1;
      }
      for (let index = start; index <= frameIndex; index++) {
        const frame = this.replay.frames[index]!;
        if (frame.keyframe) this.cells = [...frame.keyframe];
        else {
          for (let offset = 0; offset < frame.delta!.length; offset += 4) {
            const target = frame.delta![offset]! * 3;
            this.cells[target] = frame.delta![offset + 1]!;
            this.cells[target + 1] = frame.delta![offset + 2]!;
            this.cells[target + 2] = frame.delta![offset + 3]!;
          }
        }
      }
      this.index = frameIndex;
    }
    return { cells: [...this.cells], frame: this.replay.frames[frameIndex]! };
  }
}
