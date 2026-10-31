import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { builtinModules } from 'node:module';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'data/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  {
    files: ['apps/server/src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/storage/**'], message: '游戏层只负责连接与内存状态，不依赖磁盘存储。' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', ...builtinModules],
              message: '浏览器源码与共享契约不能依赖 Node 内置模块。',
            },
            { group: ['**/server/**'], message: '前端与共享契约不能反向依赖服务端。' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/contracts/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', ...builtinModules],
              message: '共享契约必须可在浏览器使用，不能依赖 Node 内置模块。',
            },
            {
              group: ['**/apps/**', '**/config/**'],
              message: '共享契约不依赖应用实现或本机运行配置。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
