# AGENTS.md

开发约定：使用 conventional commits，前缀用英文，句子用中文。

项目结构

- 使用 Node.js 24+ 与 npm；前后端和共享代码位于同一 npm 项目
- `apps/server`：HTTP API、运行控制、游戏通信与存储
- `apps/web`：React 控制台；`packages/contracts`：前后端共享的 Zod schema 与 DTO
- `config`：无副作用的运行时默认值与校验；`test/fixtures`：测试专用夹具

验证

```bash
npm run check
npm run build
```

`check` 包含类型检查、ESLint、测试和格式检查；`build` 构建前后端，不应为验证而启动服务。针对单一改动时，可先运行相关测试，再执行完整检查。
