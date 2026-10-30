# 配置与验证

> 状态：当前实现。分类见[文档索引](README.md)。

## 进程配置

默认值和端口校验集中在[运行配置模块](../config/runtime.ts)。该模块不读取环境、不访问磁盘；只有[服务入口](../apps/server/src/main.ts)和[Vite 入口](../apps/web/vite.config.ts)读取环境变量，导入配置不会启动服务。

| 配置         | 默认值      | 生效范围与来源                                                                  |
| ------------ | ----------- | ------------------------------------------------------------------------------- |
| `PORT`       | `3000`      | API 监听端口；开发代理也读取同一值。必须为 1–65535 的整数，非法值在启动阶段报错 |
| `DATA_DIR`   | `data`      | 服务端 JSON 配置、数据库、日志和录像目录；相对路径基于进程工作目录              |
| 监听地址     | `127.0.0.1` | 开发与生产均为回环地址，不提供公网监听配置                                      |
| 开发页面端口 | `5173`      | 固定端口，冲突时直接失败；服务端只额外允许该开发来源                            |

`PORT` 和 `DATA_DIR` 从进程环境读取，不由配置模块加载 `.env`。生产静态构建不会读取或校验 `PORT`；监听端口只在 API 或开发代理启动时校验。生产页面来自仓库根目录下的构建产物，启动时应使用仓库根目录。[根启动脚本](../run.sh)会先切换到该目录，只识别 `--dev`。

开发代理与 API 复用 `PORT`，不再要求手工修改代理配置：

```bash
PORT=3100 npm run dev
# 页面仍为 http://127.0.0.1:5173，API 与代理目标为 3100
```

生产环境示例：

```bash
npm ci
npm run build
PORT=3100 DATA_DIR=/绝对路径/panel-data npm start
```

同一数据目录只允许一个服务实例。不要为了验证使用已有真实数据目录，也不要把账号原文或密钥放入环境示例、启动参数或日志。

## Player 与 agent 运行参数

Player 的服务器与 User ID 字符串独立于运行配置，`<server, userId>` 唯一标识账号。通过左下角浮窗新增、切换或删除 Player；新增只提交服务器和 User ID，昵称必须由服务器 `get_username` 返回并持久缓存，不接受手工昵称。查询昵称不会加入对局，失败不创建账号；已有缓存会在启动时后台刷新及游戏连接成功时更新，查询失败不清空有效缓存。User ID 默认隐藏，但不是加密存储。Player 注册信息与上次选择保存在数据目录的注册表中，每个 Player 有独立的运行参数、历史、日志和录像库。删除前会弹出包含身份、运行状态和数据量的警告确认；运行中不可删除，确认只删除本地 Player 及其全部数据，不影响远端游戏账号。

表单和历史快照使用[共享运行参数 schema](../packages/contracts/src/index.ts)，由[配置存储](../apps/server/src/storage/config.ts)校验并原子写入。运行参数不含 `server`、`userId` 或 `userIdFile`；环境变量仅配置面板进程，不覆盖 agent 的运行参数。

每个 Player 加载自己的 JSON 配置，新账号使用 schema 默认值。只支持当前 Player 注册表与数据库格式：不读取旧单玩家根配置或账号文件，不迁移旧 SQLite settings，不自动兼容旧版本。无效 JSON、缺失 Player 数据或不支持的数据库版本明确报错，不静默回退或将历史归给其他账号。运行时修改参数需要先停止该 Player 的 agent；历史中的配置保持为当次运行快照。

## 测试隔离与验证入口

- [Vitest 配置](../vitest.config.ts)统一测试发现、超时与 mock 恢复。测试覆盖应用、共享契约和纯运行配置，不加载真实游戏入口。
- [ESLint 规则](../eslint.config.js)保护静态依赖方向：浏览器产品源码不能导入服务端或 Node 内置模块，共享契约不能导入应用、本机配置或 Node 内置模块，游戏层不能导入存储层。[边界回归测试](../config/import-boundaries.test.ts)同时验证禁止和允许的导入；前端和契约测试仍可使用 Node 夹具，Vite 构建配置也可使用 Node API。
- 存储与 HTTP 测试显式创建临时目录及临时数据库；配置测试直接传入字符串，不依赖开发者本机 `PORT` 或 `DATA_DIR`。
- 游戏事件使用内存替身，外部 agent 使用[测试夹具](../test/fixtures/pass-agent.mjs)及 Node 子进程；不会读取真实账号或自动发起联网对局。
- 前端交互测试按需使用 Happy DOM，不增加另一套生产配置。
- [CI](../.github/workflows/ci.yml)使用 Node.js 24、`npm ci`、完整检查和生产构建；[锁文件](../package-lock.json)固定实际安装版本与完整性。仅使用已安装依赖通过检查，不等同于验证干净安装或所有镜像的可用性。
- [旧 Python 目录](../browser_agent/README.md)不属于当前测试入口；不要把其 `unittest discover` 当作本项目验证命令。旧入口测试仍调用现已改为面板启动器的根脚本，可能误启动服务或访问默认数据目录。

```bash
npm run check
npm run build
```

`npm run check` 依次运行 `typecheck`、`lint`、`test`、`format:check`，任一步失败便停止；这些脚本也可独立执行。`npm run build` 先做类型检查，再构建前后端，不启动服务。仅核对 Star 历史回归时可运行：

```bash
npm test -- apps/server/src/storage/star-history.test.ts apps/web/src/hooks/useStarHistory.test.ts apps/web/src/components/StarHistoryChart apps/web/src/components/MatchHistory.interaction.test.ts
```

测试只验证已声明的边界，不代表真实游戏服务器兼容性或跨平台进程清理已经完成实机验证；尚未覆盖的风险见[技术债](technical-debt.md)。
