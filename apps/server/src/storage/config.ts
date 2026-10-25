import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runConfigSchema, type RunConfig } from '../../../../packages/contracts/src/index.js';

/** Human-readable settings; replace atomically so an interrupted save cannot truncate them. */
export class ConfigStore {
  readonly path: string;
  private config: RunConfig;

  constructor(dataDir: string, initial: RunConfig) {
    this.path = join(dataDir, 'config.json');
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      this.config = runConfigSchema.parse(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`无法读取运行参数 ${this.path}；请检查 JSON 内容和参数格式`, {
          cause: error,
        });
      }
      this.config = initial;
      this.save(initial);
    }
  }

  get(): RunConfig {
    return structuredClone(this.config);
  }

  save(value: RunConfig): void {
    const config = runConfigSchema.parse(value);
    const temporary = join(dirname(this.path), `.config-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new AggregateError([error, cleanupError], '保存参数及清理临时文件失败');
        }
      }
      throw error;
    }
    this.config = structuredClone(config);
  }
}
