import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { z } from 'zod';
import type { MatchRecord } from '../../../../packages/contracts/src/index.js';
import {
  MAX_REPLAY_BYTES,
  MAX_REPLAY_FRAMES,
  MAX_REPLAY_VALUES,
  parseReplay,
  type Replay,
} from '../../../../packages/contracts/src/replay.js';
import type { AgentAction, GameFrame, SubmitStatus } from '../game/types.js';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const replayAddressSchema = z
  .object({
    server: z.enum(['generals', 'bots']),
    gameId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();

/** In-memory capture only: disk and compression never run on a game update or action. */
export class ReplayRecorder {
  private replay: Replay | null = null;
  private cells: number[] = [];
  private values = 0;
  // Safe integer JSON takes at most 17 bytes including its comma; metadata has fixed reserves.
  private estimatedBytes = 8192;

  constructor(
    private readonly server: Replay['server'],
    private readonly log?: (message: string) => void,
    private readonly limits = {
      frames: MAX_REPLAY_FRAMES,
      values: MAX_REPLAY_VALUES,
      bytes: MAX_REPLAY_BYTES,
    },
  ) {}

  truncate(message = '本地录像达到录制预算，已保留有效前缀'): void {
    if (!this.replay || this.replay.truncated) return;
    this.replay.truncated = true;
    this.log?.(message);
  }

  private reserve(values: number): boolean {
    const bytes = 512 + values * 17;
    if (
      this.values + values > this.limits.values ||
      this.estimatedBytes + bytes > this.limits.bytes
    ) {
      this.truncate();
      return false;
    }
    this.values += values;
    this.estimatedBytes += bytes;
    return true;
  }

  capture(frame: GameFrame): void {
    if (this.replay?.truncated) return;
    const view = frame.observation;
    const height = view.types.length;
    const width = view.types[0]!.length;
    if (!this.replay) {
      this.replay = {
        format: 'generals-replay',
        version: 1,
        server: this.server,
        gameId: frame.gameId,
        startedAt: frame.startedAt ?? new Date().toISOString(),
        endedAt: null,
        outcome: null,
        winnerIndex: null,
        perspective: view.player_id,
        width,
        height,
        tickMs: 500,
        keyframeInterval: 64,
        players: view.players.map((player) => ({
          index: player.i,
          username: player.username,
          team: player.team,
        })),
        frames: [],
        actions: [],
      };
    }
    const replay = this.replay;
    if (replay.frames.length >= this.limits.frames) {
      this.truncate();
      return;
    }
    if (
      replay.gameId !== frame.gameId ||
      replay.width !== width ||
      replay.height !== height ||
      replay.perspective !== view.player_id
    )
      throw new Error('Replay game identity changed');
    const cells: number[] = [];
    const delta: number[] = [];
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const type = view.types[row]![col]!;
        const player = view.player_grid[row]![col]!;
        const army = type === 0 || type === 5 ? 0 : view.armies[row]![col]!;
        const offset = cells.length;
        if (
          type !== this.cells[offset] ||
          player !== this.cells[offset + 1] ||
          army !== this.cells[offset + 2]
        )
          delta.push(row * width + col, type, player, army);
        cells.push(type, player, army);
      }
    }
    const previous = replay.frames.at(-1);
    if (previous && view.turn < previous.turn) throw new Error('Replay game turn moved backwards');
    const keyframe =
      replay.frames.length % replay.keyframeInterval === 0 || delta.length >= cells.length;
    if (!this.reserve(keyframe ? cells.length : delta.length)) return;
    replay.frames.push({
      turn: view.turn,
      at: Math.max(previous?.at ?? 0, Date.now() - Date.parse(replay.startedAt), 0),
      ...(keyframe ? { keyframe: cells } : { delta }),
      scores: view.players.map((player) => ({
        index: player.i,
        land: player.tiles,
        army: player.total,
      })),
    });
    this.cells = cells;
    frame.replayFrameIndex = replay.frames.length - 1;
  }

  bindFrame(frame: GameFrame): void {
    const replay = this.replay;
    if (!replay || replay.truncated) return;
    const index = replay.frames.length - 1;
    if (
      replay.gameId === frame.gameId &&
      replay.frames[index]?.turn === frame.observation.turn &&
      replay.perspective === frame.observation.player_id &&
      replay.height === frame.observation.types.length &&
      replay.width === frame.observation.types[0]?.length
    )
      frame.replayFrameIndex = index;
  }

  recordAction(frame: GameFrame, action: AgentAction, status: SubmitStatus): void {
    const replay = this.replay;
    if (!replay || replay.truncated || replay.gameId !== frame.gameId || action.pass) return;
    const directions = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    const direction = directions[action.direction];
    if (!direction || !Number.isSafeInteger(action.row) || !Number.isSafeInteger(action.col))
      return;
    const row = action.row + direction[0];
    const col = action.col + direction[1];
    if (
      action.row < 0 ||
      action.row >= replay.height ||
      action.col < 0 ||
      action.col >= replay.width ||
      row < 0 ||
      row >= replay.height ||
      col < 0 ||
      col >= replay.width
    )
      return;
    const index = frame.replayFrameIndex;
    if (
      index === undefined ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      replay.frames[index]?.turn !== frame.observation.turn ||
      frame.observation.player_id !== replay.perspective
    )
      return;
    const last = replay.actions.at(-1);
    if (last && last.turn >= frame.observation.turn) return;
    if (!this.reserve(0)) return;
    replay.actions.push({
      frame: index,
      turn: frame.observation.turn,
      player: frame.observation.player_id,
      from: action.row * replay.width + action.col,
      to: row * replay.width + col,
      split: action.split,
      status,
    });
  }

  getReplay(): Replay | null {
    return this.replay?.frames.length ? structuredClone(this.replay) : null;
  }
}

export function finishReplay(replay: Replay, match: MatchRecord): Replay {
  return {
    ...replay,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    outcome: match.outcome,
    winnerIndex: match.details?.winnerIndex ?? null,
  };
}

export class ReplayStore {
  constructor(private readonly dataDir: string) {}

  path(server: Replay['server'], gameId: string): string {
    replayAddressSchema.parse({ server, gameId });
    return join(resolve(this.dataDir), `server-${server}`, gameId, 'replay.json.gz');
  }

  async save(value: Replay): Promise<void> {
    const replay = parseReplay(value);
    const path = this.path(replay.server, replay.gameId);
    const directory = resolve(path, '..');
    const buffer = Buffer.from(JSON.stringify(replay));
    if (buffer.length > MAX_REPLAY_BYTES) throw new Error('Replay file is too large');
    const packed = await compress(buffer);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, packed, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async packed(server: Replay['server'], gameId: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(server, gameId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async load(server: Replay['server'], gameId: string): Promise<Replay | null> {
    const packed = await this.packed(server, gameId);
    if (!packed) return null;
    const json = await decompress(packed, { maxOutputLength: MAX_REPLAY_BYTES });
    const replay = parseReplay(JSON.parse(json.toString('utf8')));
    if (replay.server !== server || replay.gameId !== gameId)
      throw new Error('Replay identity mismatch');
    return replay;
  }
}
