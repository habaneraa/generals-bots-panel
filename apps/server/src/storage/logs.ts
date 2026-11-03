import {
  appendFileSync,
  closeSync,
  createReadStream,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import type {
  LogEntry,
  LogLevel,
  LogPage,
  LogPageCursor,
} from '../../../../packages/contracts/src/index.js';

const TAIL_SIZE = 200;

function parseEntry(line: string): LogEntry | null {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

export class RunLog {
  private entries: LogEntry[] = [];
  private sequence = 0;
  // 崩溃残留的无换行尾部必须与下一条记录隔开，避免污染新 JSONL 行。
  private needsNewline = false;

  constructor(
    readonly runId: string,
    readonly path: string,
  ) {
    try {
      const fd = openSync(path, 'r');
      try {
        const size = fstatSync(fd).size;
        let chunkSize = Math.min(size, 512 * 1024);
        let contents = '';
        let start = 0;
        let entries: LogEntry[] = [];
        let complete = false;
        while (!complete) {
          start = Math.max(0, size - chunkSize);
          const buffer = Buffer.alloc(size - start);
          readSync(fd, buffer, 0, buffer.length, start);
          contents = buffer.toString('utf8');
          const lines = contents.split('\n');
          if (start > 0) lines.shift();
          entries = lines
            .filter(Boolean)
            .map(parseEntry)
            .filter((entry): entry is LogEntry => entry !== null);
          complete = start === 0 || entries.length >= TAIL_SIZE || chunkSize === size;
          if (!complete) chunkSize = Math.min(size, chunkSize * 2);
        }
        this.needsNewline = size > 0 && !contents.endsWith('\n');
        this.entries = entries.slice(-TAIL_SIZE);
        this.sequence = this.entries.at(-1)?.id ?? 0;
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  write(level: LogLevel, message: string): LogEntry {
    const entry: LogEntry = {
      id: ++this.sequence,
      time: new Date().toISOString(),
      runId: this.runId,
      level,
      message,
    };
    appendFileSync(this.path, `${this.needsNewline ? '\n' : ''}${JSON.stringify(entry)}\n`, {
      mode: 0o600,
    });
    this.needsNewline = false;
    this.entries.push(entry);
    if (this.entries.length > TAIL_SIZE) this.entries.shift();
    return entry;
  }

  tail(): LogEntry[] {
    return [...this.entries];
  }

  static async page(path: string, cursor: LogPageCursor, limit = TAIL_SIZE): Promise<LogPage> {
    const input = createReadStream(path, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const entries: LogEntry[] = [];
    let hasMore = false;
    try {
      for await (const line of lines) {
        const entry = parseEntry(line);
        if (!entry) continue;
        if (cursor.beforeId !== undefined) {
          if (entry.id >= cursor.beforeId) continue;
          entries.push(entry);
          if (entries.length > limit + 1) entries.shift();
        } else if (cursor.afterId !== undefined && entry.id > cursor.afterId) {
          entries.push(entry);
          if (entries.length > limit) {
            hasMore = true;
            break;
          }
        }
      }
    } finally {
      lines.close();
      input.destroy();
    }
    if (cursor.beforeId !== undefined) {
      hasMore = entries.length > limit;
      return { entries: entries.slice(-limit), hasMore };
    }
    return { entries: entries.slice(0, limit), hasMore };
  }
}
