import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runConfigSchema, type RunConfig } from '../../../../packages/contracts/src/index.js';
import { writeJsonAtomic } from './atomic-json.js';

// 使用原子替换，避免中断保存后丢失上一次仍可用的运行参数。
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
    writeJsonAtomic(this.path, config);
    this.config = structuredClone(config);
  }
}
