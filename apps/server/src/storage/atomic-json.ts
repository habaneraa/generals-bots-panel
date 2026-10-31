import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function writeJsonAtomic(
  path: string,
  value: unknown,
  { sync = false }: { sync?: boolean } = {},
): void {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  // 与目标放在同一目录，确保 rename 不跨文件系统且读者只能看到完整版本。
  const temporary = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  // 创建失败时不清理：该路径可能属于其他写入者，不能删除非本次创建的文件。
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, content);
      if (sync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new AggregateError([error, cleanupError], `保存 JSON 及清理临时文件失败：${path}`);
      }
    }
    throw error;
  }
}
