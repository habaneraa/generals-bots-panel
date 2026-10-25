import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  defaultConfig,
  runConfigSchema,
  type MatchFilters,
  type MatchPage,
  type MatchRecord,
  type RunConfig,
  type RunRecord,
  type Stats,
} from '../../../../packages/contracts/src/index.js';

import { ConfigStore } from './config.js';

// One local writer. Domain records stay versioned by the database schema, not by UI state.
export class Repository {
  readonly dataDir: string;
  private readonly db: DatabaseSync;
  private readonly config: ConfigStore;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    mkdirSync(join(this.dataDir, 'logs'), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(this.dataDir, 'panel.sqlite'));
    try {
      // Hold exclusive ownership so another panel cannot recover this process's active runs.
      this.db.exec(
        'PRAGMA busy_timeout = 5000; PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL;',
      );
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2) {
        throw new Error(`不支持的数据库版本：${String(version)}`);
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS matches (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, mode TEXT NOT NULL,
          outcome TEXT, started_at TEXT NOT NULL, payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS matches_mode_time ON matches(mode, started_at DESC);
        CREATE INDEX IF NOT EXISTS matches_run ON matches(run_id);
      `);
      const legacy =
        version === 1
          ? this.db.prepare('SELECT payload FROM settings WHERE id = 1').get()
          : undefined;
      const initial = legacy
        ? runConfigSchema.parse(JSON.parse(String(legacy.payload)))
        : defaultConfig;
      this.config = new ConfigStore(this.dataDir, initial);
      // Only remove legacy settings once their JSON replacement has been safely written.
      this.db.exec('BEGIN; DROP TABLE IF EXISTS settings; PRAGMA user_version = 2; COMMIT;');
      this.recoverInterrupted();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  getConfig(): RunConfig {
    return this.config.get();
  }

  saveConfig(config: RunConfig): void {
    this.config.save(config);
  }

  putRun(run: RunRecord): void {
    if (run.config.mode !== 'live') throw new Error('仅支持真实运行记录');
    this.db
      .prepare('INSERT OR REPLACE INTO runs (id, started_at, payload) VALUES (?, ?, ?)')
      .run(run.id, run.startedAt, JSON.stringify(run));
  }

  latestRun(): RunRecord | null {
    const row = this.db
      .prepare(
        "SELECT payload FROM runs WHERE json_extract(payload, '$.config.mode') = 'live' ORDER BY started_at DESC, rowid DESC LIMIT 1",
      )
      .get();
    return row ? (JSON.parse(String(row.payload)) as RunRecord) : null;
  }

  getRun(id: string): RunRecord | null {
    const row = this.db
      .prepare(
        "SELECT payload FROM runs WHERE id = ? AND json_extract(payload, '$.config.mode') = 'live'",
      )
      .get(id);
    return row ? (JSON.parse(String(row.payload)) as RunRecord) : null;
  }

  putMatch(match: MatchRecord): void {
    if (match.mode !== 'live') throw new Error('仅支持真实对局记录');
    this.db
      .prepare(
        'INSERT OR REPLACE INTO matches (id, run_id, mode, outcome, started_at, payload) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        match.id,
        match.runId,
        match.mode,
        match.outcome,
        match.startedAt,
        JSON.stringify(match),
      );
  }

  matches(page = 1, pageSize = 20, filters: MatchFilters = {}): MatchPage {
    const conditions = ["mode = 'live'"];
    const params: (string | number)[] = [];
    if (filters.server !== undefined) {
      conditions.push("json_extract(payload, '$.server') = ?");
      params.push(filters.server);
    }
    if (filters.outcome === 'playing') {
      conditions.push('outcome IS NULL');
    } else if (filters.outcome !== undefined) {
      conditions.push('outcome = ?');
      params.push(filters.outcome);
    }
    for (const field of ['gameId', 'opponent'] as const) {
      if (filters[field] !== undefined) {
        conditions.push(`json_extract(payload, '$.${field}') LIKE ? ESCAPE '\\'`);
        params.push(`%${filters[field].replace(/[\\%_]/g, '\\$&')}%`);
      }
    }
    if (filters.startedAfter !== undefined) {
      conditions.push('started_at >= ?');
      params.push(new Date(filters.startedAfter).toISOString());
    }
    if (filters.startedBefore !== undefined) {
      conditions.push('started_at <= ?');
      params.push(new Date(filters.startedBefore).toISOString());
    }
    if (filters.minTurns !== undefined) {
      conditions.push("json_extract(payload, '$.turns') >= ?");
      params.push(filters.minTurns);
    }
    if (filters.maxTurns !== undefined) {
      conditions.push("json_extract(payload, '$.turns') <= ?");
      params.push(filters.maxTurns);
    }
    const where = ` WHERE ${conditions.join(' AND ')}`;
    const rows = this.db
      .prepare(
        `SELECT payload FROM matches${where} ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize);
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM matches${where}`).get(...params)?.n ?? 0,
    );
    return {
      items: rows.map((row) => JSON.parse(String(row.payload)) as MatchRecord),
      total,
      page,
      pageSize,
    };
  }

  stats(): Stats {
    const stats: Stats = { total: 0, won: 0, lost: 0, draw: 0, interrupted: 0, winRate: 0 };
    const rows = this.db
      .prepare(
        "SELECT outcome, COUNT(*) AS n FROM matches WHERE mode = 'live' AND outcome IS NOT NULL GROUP BY outcome",
      )
      .all();
    for (const row of rows) {
      const outcome = String(row.outcome);
      if (
        outcome === 'won' ||
        outcome === 'lost' ||
        outcome === 'draw' ||
        outcome === 'interrupted'
      ) {
        stats[outcome] = Number(row.n);
      }
    }
    stats.total = stats.won + stats.lost + stats.draw;
    stats.winRate = stats.total ? stats.won / stats.total : 0;
    return stats;
  }

  logPath(runId: string): string {
    // Only IDs already persisted by the controller can address a log file.
    if (!/^[\da-f-]{36}$/i.test(runId) || !this.getRun(runId)) {
      throw new Error('运行记录不存在');
    }
    return join(this.dataDir, 'logs', `${runId}.jsonl`);
  }

  private recoverInterrupted(): void {
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      for (const row of this.db
        .prepare("SELECT payload FROM runs WHERE json_extract(payload, '$.config.mode') = 'live'")
        .all()) {
        const run = JSON.parse(String(row.payload)) as RunRecord;
        if (!run.endedAt) {
          this.putRun({ ...run, endedAt: now, phase: 'failed', error: '服务重启，前次运行已中断' });
        }
      }
      for (const row of this.db
        .prepare("SELECT payload FROM matches WHERE mode = 'live' AND outcome IS NULL")
        .all()) {
        const match = JSON.parse(String(row.payload)) as MatchRecord;
        this.putMatch({ ...match, endedAt: now, outcome: 'interrupted' });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
