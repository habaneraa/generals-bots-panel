import {
  closeSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index.js';
import { writeJsonAtomic } from './atomic-json.js';
import { ConfigStore } from './config.js';
import { writeRegistry } from './player-registry.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFs>();
  return {
    ...fs,
    openSync: vi.fn(fs.openSync),
    writeFileSync: vi.fn(fs.writeFileSync),
    fsyncSync: vi.fn(fs.fsyncSync),
    closeSync: vi.fn(fs.closeSync),
    renameSync: vi.fn(fs.renameSync),
    unlinkSync: vi.fn(fs.unlinkSync),
  };
});

let directory: string;
let path: string;
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'panel-atomic-json-'));
  path = join(directory, 'settings.json');
  writeFileSync(path, 'previous version');
});
afterEach(() => {
  vi.resetAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function expectPreviousVersion() {
  expect(readFileSync(path, 'utf8')).toBe('previous version');
  expect(readdirSync(directory)).toEqual(['settings.json']);
}

describe('原子 JSON 保存故障边界', () => {
  it.each(['write', 'sync', 'rename'] as const)('%s 失败时关闭文件并保留旧版本', (stage) => {
    const error = failure('EIO');
    const operation = { write: writeFileSync, sync: fsyncSync, rename: renameSync }[stage];
    vi.mocked(operation).mockImplementationOnce(() => {
      throw error;
    });

    expect(() => writeJsonAtomic(path, { next: true }, { sync: true })).toThrow(error);
    expect(closeSync).toHaveBeenCalledOnce();
    expectPreviousVersion();
  });

  it('临时文件已消失时不掩盖原始错误', () => {
    const error = failure('EIO');
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw error;
    });
    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      throw failure('ENOENT');
    });

    expect(() => writeJsonAtomic(path, {})).toThrow(error);
    expect(readFileSync(path, 'utf8')).toBe('previous version');
  });

  it('清理也失败时保留两个异常及目标路径', () => {
    const error = failure('EIO');
    const cleanupError = failure('EACCES');
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw error;
    });
    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      throw cleanupError;
    });

    let caught: unknown;
    try {
      writeJsonAtomic(path, {});
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([error, cleanupError]);
    expect((caught as Error).message).toContain(path);
    expect(readFileSync(path, 'utf8')).toBe('previous version');
  });

  it('独占创建失败时不删除其他写入者的临时文件', () => {
    const error = failure('EEXIST');
    vi.mocked(openSync).mockImplementationOnce((temporary) => {
      writeFileSync(temporary, 'another writer');
      throw error;
    });

    expect(() => writeJsonAtomic(path, {})).toThrow(error);
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(closeSync).not.toHaveBeenCalled();
    const temporary = readdirSync(directory).find((name) => name.endsWith('.tmp'))!;
    expect(readFileSync(join(directory, temporary), 'utf8')).toBe('another writer');
  });

  it('配置替换失败后不提交内存缓存，且后续保存仍可成功', () => {
    const store = new ConfigStore(directory, defaultConfig);
    const before = readFileSync(store.path, 'utf8');
    const next = { ...defaultConfig, maxGames: defaultConfig.maxGames + 1 };
    const error = failure('EIO');
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw error;
    });

    expect(() => store.save(next)).toThrow(error);
    expect(store.get()).toEqual(defaultConfig);
    expect(readFileSync(store.path, 'utf8')).toBe(before);
    expect(readdirSync(directory).sort()).toEqual(['config.json', 'settings.json']);
    store.save(next);
    expect(store.get()).toEqual(next);
  });

  it('真实目标目录冲突时清理临时文件而不覆盖目标', () => {
    const target = join(directory, 'target.json');
    mkdirSync(target);
    writeFileSync(join(target, 'keep'), 'original');
    expect(() => writeJsonAtomic(target, {})).toThrow();
    expect(readFileSync(join(target, 'keep'), 'utf8')).toBe('original');
    expect(readdirSync(directory).sort()).toEqual(['settings.json', 'target.json']);
  });

  it('保留注册表同步落盘和运行配置不同的写入策略', () => {
    new ConfigStore(directory, defaultConfig).save(defaultConfig);
    expect(fsyncSync).not.toHaveBeenCalled();

    writeRegistry(join(directory, 'players.json'), {
      version: 1,
      activePlayerId: null,
      players: [],
    });
    expect(fsyncSync).toHaveBeenCalledOnce();
    expect(fsyncSync).toHaveBeenCalledWith(vi.mocked(openSync).mock.results.at(-1)!.value);
    expect(vi.mocked(fsyncSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(renameSync).mock.invocationCallOrder.at(-1)!,
    );
  });
});
