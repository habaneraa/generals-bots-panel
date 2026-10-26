import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

describe('模块依赖边界', () => {
  it.each([
    ['apps/web/src/boundary.ts', '../../../server/src/controller'],
    ['apps/web/src/boundary.ts', 'node:fs'],
    ['apps/web/src/boundary.ts', 'fs/promises'],
    ['packages/contracts/src/boundary.ts', '../../../apps/web/src/api/client'],
    ['packages/contracts/src/boundary.ts', '../../../apps/server/src/game/types'],
    ['packages/contracts/src/boundary.ts', '../../../config/runtime'],
    ['packages/contracts/src/boundary.ts', 'node:sqlite'],
    ['packages/contracts/src/boundary.ts', 'fs'],
    ['apps/server/src/game/boundary.ts', '../storage/repository'],
  ])('拒绝 %s 反向导入 %s', async (filePath, source) => {
    const [result] = await eslint.lintText(`export { value } from '${source}';`, { filePath });
    expect(result?.messages.map(({ ruleId }) => ruleId)).toEqual(['no-restricted-imports']);
  });

  it.each([
    ['apps/web/src/boundary.ts', '../../../../packages/contracts/src/index'],
    ['packages/contracts/src/boundary.ts', 'zod'],
    ['apps/server/src/game/boundary.ts', './types'],
    ['apps/server/src/storage/boundary.ts', '../game/types'],
    ['apps/web/src/boundary.test.ts', 'node:zlib'],
    ['packages/contracts/src/boundary.test.ts', 'node:fs'],
    ['apps/web/vite.config.ts', 'node:url'],
  ])('保留 %s 对 %s 的合法依赖', async (filePath, source) => {
    const [result] = await eslint.lintText(`export { value } from '${source}';`, { filePath });
    expect(result?.messages).toEqual([]);
  });
});
