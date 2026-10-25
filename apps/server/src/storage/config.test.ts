import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index.js';
import { ConfigStore } from './config.js';

const directories: string[] = [];
function temp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'panel-config-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('JSON runtime configuration', () => {
  it('creates readable defaults, saves atomically and reloads after restart', () => {
    const directory = temp();
    const store = new ConfigStore(directory, defaultConfig);
    const config = { ...defaultConfig, autopilot: true, args: ['path with spaces', '--flag'] };
    store.save(config);
    const content = readFileSync(store.path, 'utf8');
    expect(content).toContain('\n  "mode": "live"');
    expect(JSON.parse(content)).toEqual(config);
    expect(new ConfigStore(directory, defaultConfig).get()).toEqual(config);
    expect(readdirSync(directory)).toEqual(['config.json']);
    if (process.platform !== 'win32') expect(statSync(store.path).mode & 0o777).toBe(0o600);
  });

  it('isolates returned objects and preserves the saved file after validation failure', () => {
    const store = new ConfigStore(temp(), defaultConfig);
    store.get().args.push('not persisted');
    expect(store.get().args).toEqual(defaultConfig.args);
    const before = readFileSync(store.path, 'utf8');
    expect(() => store.save({ ...defaultConfig, maxGames: 0 })).toThrow();
    expect(readFileSync(store.path, 'utf8')).toBe(before);
  });

  it.each(['{broken', '{"mode":"demo"}'])(
    'does not overwrite invalid JSON configuration: %s',
    (content) => {
      const directory = temp();
      const path = join(directory, 'config.json');
      writeFileSync(path, content);
      expect(() => new ConfigStore(directory, defaultConfig)).toThrow('无法读取运行参数');
      expect(readFileSync(path, 'utf8')).toBe(content);
    },
  );

  it('uses manual file edits on the next service start', () => {
    const directory = temp();
    const store = new ConfigStore(directory, defaultConfig);
    writeFileSync(store.path, JSON.stringify({ ...defaultConfig, cooldownMs: 5000 }));
    expect(store.get().cooldownMs).toBe(defaultConfig.cooldownMs);
    expect(new ConfigStore(directory, defaultConfig).get().cooldownMs).toBe(5000);
  });
});
