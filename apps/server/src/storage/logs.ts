import { appendFileSync, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { LogEntry, LogLevel } from '../../../../packages/contracts/src/index.js';

export class RunLog {
  private entries: LogEntry[] = [];
  private sequence = 0;

  constructor(
    readonly runId: string,
    readonly path: string,
  ) {
    try {
      const fd = openSync(path, 'r');
      try {
        const size = fstatSync(fd).size;
        const start = Math.max(0, size - 512 * 1024);
        const buffer = Buffer.alloc(size - start);
        readSync(fd, buffer, 0, buffer.length, start);
        const lines = buffer.toString('utf8').split('\n');
        if (start > 0) lines.shift();
        this.entries = lines
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as LogEntry];
            } catch {
              return []; // A crash can leave one incomplete trailing line.
            }
          })
          .slice(-200);
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
      message: message.slice(0, 16000),
    };
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    this.entries.push(entry);
    if (this.entries.length > 200) this.entries.shift();
    return entry;
  }

  tail(): LogEntry[] {
    return [...this.entries];
  }
}
