import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { MAX_REPLAY_BYTES, type Replay } from '../../../../packages/contracts/src/replay';
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
    const file = { size: MAX_REPLAY_BYTES + 1 } as File;
    await expect(readReplayFile(file)).rejects.toThrow('64 MiB');
  });
  it('releases the reader when the input stream fails', async () => {
    const failure = new Error('input stream failed');
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.error(failure);
      },
    });
    const file = new File(['{}'], 'failed.json');
    vi.spyOn(file, 'stream').mockReturnValue(stream);
    await expect(readReplayFile(file)).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });
  it('cancels a pending read and releases the reader lock when aborted', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
      {
        start(controller) {
          controller.enqueue(new Uint8Array([0x7b]));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const file = new File(['{}'], 'pending.json');
    vi.spyOn(file, 'stream').mockReturnValue(stream);
    const abort = new AbortController();
    const pending = readReplayFile(file, abort.signal);

    await vi.waitFor(() => expect(stream.locked).toBe(true));
    abort.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('preserves the read error and releases the reader if cancellation also fails', async () => {
    const failure = new Error('input stream failed');
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.error(failure);
      },
    });
    const reader = stream.getReader();
    vi.spyOn(reader, 'cancel').mockRejectedValueOnce(new Error('cancellation failed'));
    vi.spyOn(stream, 'getReader').mockReturnValue(reader);
    const file = new File(['{}'], 'failed.json');
    vi.spyOn(file, 'stream').mockReturnValue(stream);
    await expect(readReplayFile(file)).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });
});
