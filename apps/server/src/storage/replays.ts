import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { z } from 'zod';
import type { MatchRecord } from '../../../../packages/contracts/src/index.js';
import {
  MAX_REPLAY_BYTES,
  parseReplay,
  type Replay,
} from '../../../../packages/contracts/src/replay.js';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const replayAddressSchema = z
  .object({
    server: z.enum(['generals', 'bots']),
    gameId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();

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
