import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultConfig,
  runConfigSchema,
  type MatchRecord,
} from '../../../../packages/contracts/src/index.js';
import { Repository } from './repository.js';
import { RunLog } from './logs.js';

const dirs: string[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'panel-storage-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function match(id: string, outcome: MatchRecord['outcome']): MatchRecord {
  return {
    id,
    runId: 'run',
    mode: 'live',
    server: 'bots',
    gameId: id,
    opponent: 'fixture',
    startedAt: '2026-10-25T00:00:00.000Z',
    endedAt: outcome ? '2026-10-25T00:01:00.000Z' : null,
    outcome,
    turns: 10,
    replayUrl: null,
  };
}

describe('local persistence', () => {
  it('holds the database exclusively while the panel is running', () => {
    const dir = temp();
    const repo = new Repository(dir);
    const competing = new DatabaseSync(join(dir, 'panel.sqlite'));
    try {
      competing.exec('PRAGMA busy_timeout = 1');
      expect(() => competing.prepare('SELECT * FROM runs').all()).toThrow('locked');
    } finally {
      competing.close();
      repo.close();
    }
  });

  it('persists configuration and excludes interruptions and ongoing games from win rate', () => {
    const dir = temp();
    let repo = new Repository(dir);
    repo.saveConfig({ ...defaultConfig, autopilot: true });
    repo.putMatch(match('won', 'won'));
    repo.putMatch(match('lost', 'lost'));
    repo.putMatch(match('draw', 'draw'));
    repo.putMatch(match('interrupted', 'interrupted'));
    repo.putMatch(match('playing', null));
    expect(repo.stats()).toEqual({
      total: 3,
      won: 1,
      lost: 1,
      draw: 1,
      interrupted: 1,
      winRate: 1 / 3,
    });
    expect(repo.matches(1, 1, { server: 'bots' })).toMatchObject({ total: 5, pageSize: 1 });
    repo.close();
    repo = new Repository(dir);
    expect(repo.getConfig().autopilot).toBe(true);
    repo.close();
  });

  it('preserves rating payloads across restart without inventing values for old records', () => {
    const dir = temp();
    let repo = new Repository(dir);
    const record = {
      ...match('rated', 'won'),
      rating: {
        username: 'self',
        before: 0,
        after: 0.5,
        delta: 0.5,
        source: 'public-profile' as const,
        capturedAt: '2026-10-25T00:01:00.000Z',
      },
    };
    repo.putMatch(match('legacy', 'lost'));
    repo.putMatch(record);
    repo.close();
    repo = new Repository(dir);
    expect(repo.matches().items.find((entry) => entry.id === 'rated')).toEqual(record);
    expect(repo.matches().items.find((entry) => entry.id === 'legacy')).not.toHaveProperty(
      'rating',
    );
    repo.close();
  });

  it('hides legacy demo records without modifying or deleting their physical data', () => {
    const dir = temp();
    let repo = new Repository(dir);
    const liveRun = {
      id: 'live-run',
      startedAt: '2026-10-25T00:00:00.000Z',
      endedAt: '2026-10-25T00:01:00.000Z',
      phase: 'stopped' as const,
      config: defaultConfig,
      error: null,
    };
    repo.putRun(liveRun);
    repo.putMatch(match('live-win', 'won'));
    repo.close();

    const demoRun = {
      ...liveRun,
      id: '00000000-0000-4000-8000-000000000000',
      startedAt: '2026-10-26T00:00:00.000Z',
      endedAt: null,
      phase: 'playing',
      config: { ...defaultConfig, mode: 'demo' },
    };
    const demoMatch = { ...match('legacy-demo', 'won'), mode: 'demo', runId: demoRun.id };
    const activeDemo = { ...demoMatch, id: 'legacy-active-demo', outcome: null, endedAt: null };
    const raw = new DatabaseSync(join(dir, 'panel.sqlite'));
    raw
      .prepare('INSERT INTO runs (id, started_at, payload) VALUES (?, ?, ?)')
      .run(demoRun.id, demoRun.startedAt, JSON.stringify(demoRun));
    for (const record of [demoMatch, activeDemo]) {
      raw
        .prepare(
          'INSERT INTO matches (id, run_id, mode, outcome, started_at, payload) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          record.id,
          record.runId,
          record.mode,
          record.outcome,
          record.startedAt,
          JSON.stringify(record),
        );
    }
    raw.close();

    repo = new Repository(dir);
    expect(repo.latestRun()).toEqual(liveRun);
    expect(repo.getRun(liveRun.id)).toEqual(liveRun);
    expect(repo.getRun(demoRun.id)).toBeNull();
    expect(() => repo.logPath(demoRun.id)).toThrow('运行记录不存在');
    expect(repo.matches().items.map((record) => record.id)).toEqual(['live-win']);
    expect(repo.matches(1, 20, { gameId: 'legacy' })).toMatchObject({ items: [], total: 0 });
    expect(repo.stats()).toMatchObject({ total: 1, won: 1, interrupted: 0 });
    repo.close();

    const check = new DatabaseSync(join(dir, 'panel.sqlite'));
    expect(check.prepare('SELECT payload FROM runs WHERE id = ?').get(demoRun.id)?.payload).toBe(
      JSON.stringify(demoRun),
    );
    for (const record of [demoMatch, activeDemo]) {
      expect(
        check.prepare('SELECT payload FROM matches WHERE id = ?').get(record.id)?.payload,
      ).toBe(JSON.stringify(record));
    }
    check.prepare('DELETE FROM runs WHERE id = ?').run(liveRun.id);
    check.close();
    repo = new Repository(dir);
    expect(repo.latestRun()).toBeNull();
    repo.close();
  });

  it('recovers unfinished runs and matches after a restart', () => {
    const dir = temp();
    let repo = new Repository(dir);
    repo.putRun({
      id: 'fixture',
      startedAt: new Date().toISOString(),
      endedAt: null,
      phase: 'playing',
      config: defaultConfig,
      error: null,
    });
    repo.putMatch(match('unfinished', null));
    repo.close();
    repo = new Repository(dir);
    expect(repo.latestRun()).toMatchObject({ phase: 'failed', error: '服务重启，前次运行已中断' });
    expect(repo.matches().items[0]?.outcome).toBe('interrupted');
    expect(repo.stats().total).toBe(0);
    repo.close();
  });

  it('writes JSONL and limits only the in-memory tail', () => {
    const path = join(temp(), 'fixture.jsonl');
    const logger = new RunLog('fixture', path);
    for (let i = 0; i < 205; i++) logger.write('debug', `turn ${i}`);
    expect(logger.tail()).toHaveLength(200);
    const reopened = new RunLog('fixture', path);
    expect(reopened.tail().at(-1)?.id).toBe(205);
    expect(reopened.write('info', 'restart').id).toBe(206);
  });

  it('accepts only live configuration and validates its required fields', () => {
    expect(runConfigSchema.safeParse({ mode: 'live' }).success).toBe(true);
    expect(runConfigSchema.safeParse({ mode: 'demo' }).success).toBe(false);
    expect(runConfigSchema.safeParse({ ...defaultConfig, command: '' }).success).toBe(false);
    expect(runConfigSchema.safeParse({ ...defaultConfig, userIdFile: '' }).success).toBe(false);
    expect(runConfigSchema.safeParse({ ...defaultConfig, maxGames: 0 }).success).toBe(false);
  });
});
