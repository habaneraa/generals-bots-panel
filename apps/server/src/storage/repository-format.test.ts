import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../../packages/contracts/src/index.js';
import { Repository } from './repository.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'panel-current-format-'));
  directories.push(path);
  return path;
}

describe('current storage format only', () => {
  it('creates a new v2 database and reopens current JSON config without migration', () => {
    const path = directory();
    let repo = new Repository(path);
    const config = { ...defaultConfig, command: 'current-agent' };
    repo.saveConfig(config);
    repo.close();
    const db = new DatabaseSync(join(path, 'panel.sqlite'));
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'settings'").get(),
    ).toBeUndefined();
    db.close();
    repo = new Repository(path);
    expect(repo.getConfig()).toEqual(config);
    repo.close();
  });

  it.each([0, 1, 3])(
    'refuses an existing unsupported v%s database without migrating settings',
    (version) => {
      const path = directory();
      const db = new DatabaseSync(join(path, 'panel.sqlite'));
      db.exec(`CREATE TABLE settings (payload TEXT); PRAGMA user_version = ${version};`);
      db.prepare('INSERT INTO settings VALUES (?)').run('untouched-old-settings');
      db.close();
      expect(() => new Repository(path)).toThrow('不支持');
      expect(existsSync(join(path, 'config.json'))).toBe(false);
      const check = new DatabaseSync(join(path, 'panel.sqlite'));
      expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(version);
      expect(check.prepare('SELECT payload FROM settings').get()?.payload).toBe(
        'untouched-old-settings',
      );
      check.close();
    },
  );

  it('rejects stale identity config without stripping fields or overwriting it', () => {
    const path = directory();
    const repo = new Repository(path);
    repo.close();
    const value = JSON.stringify({ ...defaultConfig, userIdFile: '.account-file' });
    writeFileSync(join(path, 'config.json'), value);
    expect(() => new Repository(path)).toThrow('无法读取运行参数');
    expect(readFileSync(join(path, 'config.json'), 'utf8')).toBe(value);
  });
});
