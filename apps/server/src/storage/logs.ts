import { appendFileSync, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { LogEntry, LogLevel } from '../../../../packages/contracts/src/index.js';

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
        const start = Math.max(0, size - 512 * 1024);
        const buffer = Buffer.alloc(size - start);
        readSync(fd, buffer, 0, buffer.length, start);
        const contents = buffer.toString('utf8');
        this.needsNewline = size > 0 && !contents.endsWith('\n');
        const lines = contents.split('\n');
        if (start > 0) lines.shift();
        this.entries = lines
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as LogEntry];
            } catch {
              return []; // 崩溃可能留下不完整的尾行，后续续写会另起一行。
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
    appendFileSync(this.path, `${this.needsNewline ? '\n' : ''}${JSON.stringify(entry)}\n`, {
      mode: 0o600,
    });
    this.needsNewline = false;
    this.entries.push(entry);
    if (this.entries.length > 200) this.entries.shift();
    return entry;
  }

  tail(): LogEntry[] {
    return [...this.entries];
  }
}
