import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig, type RunRecord } from '../../../../packages/contracts/src/index.js';
import { Repository } from './repository.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function legacyFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'panel-migration-'));
  directories.push(directory);
  const db = new DatabaseSync(join(directory, 'panel.sqlite'));
  const config = { ...defaultConfig, autopilot: true, args: ['external agent path'] };
  const run: RunRecord = {
    id: 'legacy-run',
    startedAt: '2026-10-25T00:00:00.000Z',
    endedAt: null,
    phase: 'playing',
    config,
    error: null,
  };
  db.exec(
    'CREATE TABLE settings (id INTEGER PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, payload TEXT NOT NULL); PRAGMA user_version = 1;',
  );
  db.prepare('INSERT INTO settings VALUES (1, ?)').run(JSON.stringify(config));
  db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(run.id, run.startedAt, JSON.stringify(run));
  db.close();
  return { directory, config };
}

describe('configuration storage migration', () => {
  it('migrates SQLite settings to JSON without losing history', () => {
    const { directory, config } = legacyFixture();
    const repo = new Repository(directory);
    expect(repo.getConfig()).toEqual(config);
    expect(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))).toEqual(config);
    expect(repo.getRun('legacy-run')?.phase).toBe('failed');
    repo.close();
    const db = new DatabaseSync(join(directory, 'panel.sqlite'));
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'settings'").get(),
    ).toBeUndefined();
    db.close();
    const restarted = new Repository(directory);
    expect(restarted.getConfig()).toEqual(config);
    expect(restarted.getRun('legacy-run')).not.toBeNull();
    restarted.close();
  });

  it('prefers an existing JSON file to legacy database settings', () => {
    const { directory } = legacyFixture();
    const config = { ...defaultConfig, cooldownMs: 7000 };
    writeFileSync(join(directory, 'config.json'), JSON.stringify(config));
    const repo = new Repository(directory);
    expect(repo.getConfig()).toEqual(config);
    repo.close();
  });

  it('keeps legacy settings and active history untouched if JSON is invalid', () => {
    const { directory } = legacyFixture();
    writeFileSync(join(directory, 'config.json'), '{invalid');
    expect(() => new Repository(directory)).toThrow('无法读取运行参数');
    const db = new DatabaseSync(join(directory, 'panel.sqlite'));
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    expect(db.prepare('SELECT payload FROM settings').get()).toBeDefined();
    const row = db.prepare('SELECT payload FROM runs').get();
    expect(JSON.parse(String(row?.payload)).endedAt).toBeNull();
    db.close();
    expect(readFileSync(join(directory, 'config.json'), 'utf8')).toBe('{invalid');
  });
});
