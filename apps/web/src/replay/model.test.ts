import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Replay } from '../../../../packages/contracts/src/replay';
import { readReplayFile } from './model';

function sample(): Replay {
  return {
    format: 'generals-replay',
    version: 1,
    server: 'bots',
    gameId: 'file-import',
    startedAt: '2026-10-25T00:00:00Z',
    endedAt: null,
    outcome: null,
    winnerIndex: null,
    perspective: 0,
    width: 2,
    height: 1,
    tickMs: 500,
    keyframeInterval: 64,
    players: [
      { index: 0, username: 'self', team: 0 },
      { index: 1, username: 'enemy', team: 1 },
    ],
    frames: [
      {
        turn: 0,
        at: 0,
        keyframe: [4, 0, 1, 0, -3, 0],
        scores: [
          { index: 0, army: 1, land: 1 },
          { index: 1, army: 1, land: 1 },
        ],
      },
    ],
    actions: [],
  };
}

describe('browser-local replay file import', () => {
  it('reads JSON and gzip by content rather than trusting the filename or MIME type', async () => {
    const replay = sample();
    const json = JSON.stringify(replay);
    expect(await readReplayFile(new File([json], 'renamed.gz'))).toEqual(replay);
    expect(
      await readReplayFile(new File([new Uint8Array(gzipSync(json))], 'renamed.json')),
    ).toEqual(replay);
  });
  it('rejects invalid JSON, unsupported versions and corrupt gzip', async () => {
    await expect(readReplayFile(new File(['invalid'], 'test.json'))).rejects.toThrow();
    await expect(
      readReplayFile(new File([JSON.stringify({ ...sample(), version: 2 })], 'test.json')),
    ).rejects.toThrow();
    await expect(
      readReplayFile(new File([new Uint8Array([0x1f, 0x8b, 0, 0])], 'test.gz')),
    ).rejects.toThrow();
  });
  it('checks compressed input size before reading or allocating it', async () => {
    const file = { size: 64 * 1024 * 1024 + 1 } as File;
    await expect(readReplayFile(file)).rejects.toThrow('64 MiB');
  });
});
