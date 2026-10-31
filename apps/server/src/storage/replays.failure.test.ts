import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import type * as FileSystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureObservation } from '../../../../test/fixtures/game.js';
import { ReplayRecorder } from '../game/recorder.js';
import { ReplayStore } from './replays.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>();
  return { ...actual, rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) };
});

const actualFs = await vi.importActual<typeof FileSystem>('node:fs/promises');
const directories: string[] = [];

beforeEach(() => {
  vi.mocked(rename).mockReset().mockImplementation(actualFs.rename);
  vi.mocked(unlink).mockReset().mockImplementation(actualFs.unlink);
});

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function recorded() {
  const recorder = new ReplayRecorder('bots');
  recorder.capture({
    gameId: 'failed-replacement',
    startedAt: '2026-10-25T00:00:00.000Z',
    attackIndex: 0,
    observation: fixtureObservation(),
  });
  return recorder.getReplay()!;
}

describe('录像原子保存失败', () => {
  it.each(['success', 'ENOENT', 'EACCES'] as const)(
    '替换失败且清理结果为 %s 时保留错误和旧录像',
    async (cleanup) => {
      const directory = mkdtempSync(join(tmpdir(), 'panel-replay-failure-'));
      directories.push(directory);
      const store = new ReplayStore(directory);
      const replay = recorded();
      await store.save(replay);
      const previous = await store.packed(replay.server, replay.gameId);
      const saveError = new Error('rename failed');
      const cleanupError = Object.assign(new Error('unlink failed'), { code: cleanup });
      vi.mocked(rename).mockRejectedValueOnce(saveError);
      if (cleanup === 'ENOENT') {
        vi.mocked(unlink).mockImplementationOnce(async (path) => {
          // 模拟清理时文件已被移除，目标录像仍不应变化。
          await actualFs.unlink(path);
          throw cleanupError;
        });
      } else if (cleanup === 'EACCES') {
        vi.mocked(unlink).mockRejectedValueOnce(cleanupError);
      }

      const saving = store.save({ ...replay, truncated: true });
      if (cleanup === 'EACCES') {
        const failure: unknown = await saving.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(AggregateError);
        const aggregate = failure as AggregateError;
        expect(aggregate.errors).toHaveLength(2);
        expect(aggregate.errors[0]).toBe(saveError);
        expect(aggregate.errors[1]).toBe(cleanupError);
        expect(aggregate.message).toContain(saveError.message);
        expect(aggregate.message).toContain(cleanupError.message);
      } else {
        await expect(saving).rejects.toBe(saveError);
      }

      expect(unlink).toHaveBeenCalledTimes(1);
      expect(await store.packed(replay.server, replay.gameId)).toEqual(previous);
      expect(await store.load(replay.server, replay.gameId)).toEqual(replay);
      const files = readdirSync(dirname(store.path(replay.server, replay.gameId)));
      expect(files.filter((name) => name.endsWith('.tmp'))).toHaveLength(
        cleanup === 'EACCES' ? 1 : 0,
      );
    },
  );
});
