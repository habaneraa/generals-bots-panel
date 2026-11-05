# 架构

> 状态：当前实现。文档分类与历史记录见[文档索引](README.md)。

## 目录与依赖方向

```text
apps/
  server/src/
    main.ts             # 进程入口、回环监听、信号退出
    app.ts              # HTTP/SSE，参数和请求来源校验
    player-manager.ts   # Player 注册、选择及独立控制器管理
    controller.ts       # 单 Player 运行会话、autopilot、资源生命周期
    agent/              # shell:false 子进程、协议编解码
    game/
      types.ts          # 领域观察、动作、连接接口与帧身份规则
      socket.ts         # 原生 WebSocket 上的 Engine.IO / Socket.IO
      state.ts          # 增量地图、普通双人观察
      live.ts           # 真实连接、队列和动作提交
      recorder.ts       # 纯内存录像采集与预算，不访问磁盘
      ratings.ts        # 独立连接池中的可选公开评分采样
    storage/            # JSON 配置、SQLite 历史、JSONL 日志与 gzip 录像文件
  web/                  # React 控制台与 Vite 配置
packages/contracts/     # Zod 配置校验、前后端共享 DTO，不依赖 Node
config/runtime.ts       # 无副作用的本机默认值与端口校验
test/fixtures/          # 仅单元测试使用的观察和子进程夹具
docs/
```

当前使用单个 npm 项目，避免引入包发布和多重构建链。共享契约不依赖服务端，前端不会导入进程、文件系统或数据库模块。服务端通过 esbuild 打包，第三方依赖保持外置；前端通过 Vite 构建。Node 内置 SQLite，无原生 npm 扩展或额外数据库服务。

录像录制由游戏层的 `ReplayRecorder` 在内存中完成，文件校验、gzip 和原子保存由存储层的 `ReplayStore` 完成；控制器在局末协调两者。游戏层不导入存储层，这条边界由 ESLint 约束。控制器与游戏连接复用帧身份规则，回合或兵力推进不改变对局身份。开发与生产的本机默认值集中在[运行配置](../config/runtime.ts)，环境变量只在进程入口读取，详见[配置与验证](configuration.md)。

## 两个通信边界

```text
React ── HTTP + SSE ── Node Controller ── stdin/stdout ── 外部 agent
                           │                            （例如 AverageJoe）
                      GameConnection
                           │
                 Engine.IO 4 / Socket.IO
                    原生 WebSocket
                           │
                    generals.io 服务器
```

“只保留 ws”指游戏通道，不改变策略子进程协议。没有浏览器自动化、CDP 或 Python bridge。Node 不导入策略模块，也不探测模型仓库结构；启动命令、参数、cwd 是唯一模型集成点。

## 前端布局

桌面端使用左侧固定导航，移动端折叠为顶部横向 Tab；五个页面为「启动 / 统计 / 对局记录 / 录像 / 日志」，默认启动页。统一浅色主题，主色为 `#008080`，控件使用 2–4px 小圆角。样式由 Tailwind CSS v4 与 [应用样式](../apps/web/src/styles/app.css) 中的设计令牌生成。日志页同样使用浅色面板，不混用深色区块。同一 Player 内的面板常驻挂载，使用 `hidden` 控制显示，Tab 切换不丢未保存的表单草稿，也不影响 SSE 或运行任务。左下角 Player 按钮打开相邻浮窗，列出服务器昵称缓存、服务器及默认隐藏的 User ID，也可仅用 server/userId 新增账号或打开删除详情确认。删除弹窗使用原生 `<dialog>`，展示本地数据量与仅移除列表、保留磁盘文件的说明，并禁止删除运行中的账号。切换 Player 会按 ID 重新挂载整组面板，清理草稿、历史分页与筛选、详情及录像等旧状态，并关闭旧事件流、取消旧查询；不停止后台运行。对局详情使用原生 `<dialog>` modal，支持 Esc、遮罩点击关闭和焦点恢复。Tab 支持方向键、Home / End 与标准 ARIA 语义；日志页重新显示时按用户的自动跟随设置滚动。录像还可通过 `/replay` 独立打开，链接携带 Player ID，只加载该 Player 的录像接口或本地文件，不依赖控制台 SSE。

## 运行状态与并发

```text
idle/stopped/failed → starting → queueing → playing → cooldown → queueing
                                     └────────────→ stopped
任意活动状态 → stopping → stopped
任意异常状态 → failed
failed（autoRestart 开启且停留 ≥60s）→ starting（沿用上次配置）
```

- 每个 Player 由独立 Controller 管理一个运行任务，可跨 HTTP 请求持续存在。同一 Player 重复启动或运行时修改参数返回 409；切换 Player 不停止其他 Controller。
- 自动重启是启动配置的一部分（`autoRestart`）。运行失败进入 `failed` 后，仅当开关开启且在该状态停留满 60 秒，Controller 才用同一份配置整轮重启（新建运行记录、从 `starting` 开始）；手动停止、重新启动或在 `failed` 期间保存参数都会取消已排定的重启，`failed` 之外的状态永不触发。重启无次数上限或退避，配置损坏时会持续按 60 秒重试。
- 只有一个待处理 agent observation；stdout 无请求 ID，超时后流不能安全复用，必须停止。
- WebSocket 消息与推理异步推进。推理完成后检查当前游戏与回合；过期动作不发送。
- 待执行攻击通过服务器 `attackIndex` 确认；未确认时不继续堆积动作。
- 一局结束持久化结果，发送 agent `end`，冷却后发送新局 `start`，复用进程。
- 停止通过 AbortSignal 取消排队、下一帧等待、推理或冷却，再关闭游戏连接和子进程。
- POSIX 使用独立进程组清理启动脚本及其子进程；Windows 的基础 child.kill 不保证回收任意脚本后代。首版以 Linux / WSL 为推荐环境。
- 服务端 SIGINT / SIGTERM 退出会停止运行并关闭 SSE；前端刷新、断线不会停止后台任务。

## 持久化与事件

同一个数据目录只允许一个服务实例，SQLite 连接持有独占锁，避免重复启动将另一实例的活动运行误判为中断。需要检查原始数据库时请先停止服务。

运行与对局记录通过仓储访问 SQLite，PlayerManager 另持有根目录的 SQLite 单实例锁。`PRAGMA user_version` 标识当前历史数据库 schema（v2）；只接受当前格式或初始化空库，不兼容和自动升级旧版本。变更格式时应离线处理数据，不在业务模块保留旧格式适配。启动时将未完成运行标为失败、未完成对局标为中断，不自动启动 agent。

Player 以 `<server, userId>` 唯一标识，注册表保存 User ID 字符串、服务器昵称缓存、内部 ID 和上次选择。新增只接收 server/userId，通过独立 GameSocket 连接查询 `get_username` 后关闭，不加入游戏；昵称查询成功才持久化新 Player。已有缓存启动后后台刷新，游戏连接成功时同步更新；失败保留有效缓存。异步查询结束后再次检查身份唯一性，关闭时取消未完成查询，防止延迟响应写入已删除账号或已关闭的数据目录。

PlayerManager 为每个账号建立独立 Repository/Controller；配置、SQLite、日志和录像保存在各自的 Player 数据子目录，所有 API 查询、SSE 与下载均支持显式 `playerId`。无效 ID 不回退到其他账号。删除前通过详情接口读取固定 Player 的身份、路径、运行状态和数据量；运行中返回 409。确认后仅移除该 Player 的注册信息，配置、历史、日志和录像保留在原数据目录，不移动或删除文件，不影响游戏服务器账号；重启不会自动将保留目录加入列表。被删除 Player 的事件流收到 `player-deleted` 后结束，其他事件流仍固定在自己的 Player。

运行参数由独立 `ConfigStore` 保存：可读的缩进 JSON、Zod 校验、临时文件写入后原子替换、默认 0600 权限。启动时读取，界面保存后同步更新缓存；手工编辑应在停止服务后进行，重启生效。仅支持当前格式，不探测和迁移旧单玩家目录、账号文件或 SQLite settings；损坏配置或缺失 Player 数据会明确报错，不用默认值静默替换。

运行日志同步追加 JSONL，每个 Controller 的内存只保存最后 200 条。重启时忽略崩溃遗留的残缺尾行，续写前先隔开该行，避免污染后续记录。日志文件地址由该 Player 持久化的运行 UUID 决定，不接受任意下载路径。账号原文只用于本机 Player 管理与服务器连接，不进入运行参数、模型观察或日志；前端默认隐藏 User ID 不是加密。

HTTP mutation 返回最新快照；SSE 发送 `event: dashboard` 的完整快照并以约 100 ms 合并更新，重连时重新发送当前快照。前端通过 SSE 世代计数防止较慢的启动、停止或保存响应覆盖期间已收到的实时状态。慢消费者不累积无界历史事件。历史使用独立分页 API；统计只由真实持久化结果计算，中断单独计数。所有记录限定在所属 Player 的数据库内；字段筛选全部参数化，文本按字面量子串，时间统一为 UTC ISO，列表与 count 复用同一筛选条件。

Star 图使用独立的 `GET /api/matches/star-history`，与分页列表复用同一套筛选校验和 SQL 条件，但不分页，按开始时间升序返回轻量评分记录，不加载完整详情。前端通过独立的 [Star 历史 hook](../apps/web/src/hooks/useStarHistory.ts)读取与重试；翻页不改变图表数据，筛选变化取消旧请求，评分相关刷新在请求进行中时合并。图表按服务器与账号分组、以赛后时间（未知时使用开始时间）绘制；同来源缺失区间用虚线提示，来源变化断开，不补造缺失值。缩放与平移只改变图表视区，不修改列表筛选。

## 对局详情与数据可信度

GameState 从已有服务器事件生成独立 MatchSnapshot，不改变发给 agent 的 Observation。Controller 保存首个和最后快照，并累计推理、提交与时间指标；停止和失败时也读取最后可用快照，首个可行动帧之前已结束的对局仍保存结果。详情与历史同属 JSON payload，不引入单独的数据库或重复事实来源。前端通过 modal 展示最后记录的快照：开局固定的首帧资源数值不再重复展示，玩家区只保留昵称、星级与末次领地/兵力/城市/存活数据，展示层不修改持久化的原始快照。

已确认的终局结果独立保留；即使 agent 推理随后超时或被停止，仍保存真实胜负，运行本身的错误单独记录。后续同局终局事件可补全评分、回合和快照，不重写首次胜负或终局时间。每局 rating 的赛前值、赛后值、来源和采集时间独立持久化；缺失值不推算，终局事件的评分优先于可能延迟的公开资料采样。详情弹窗使用当前页同 ID 的最新记录，刷新内容不重开弹窗或重置焦点。ECharts 引擎按可见性延迟加载，卸载时取消后续初始化并释放实例。

资源数量优先来自 scoreboard；城市由已知城市位置和可见归属统计。只有能确认视野完整时才保存精确城市数，否则为 null，visibleCities 只作已见下限。没有完整最终更新时不得将末帧称为完整终局。public rating 查询使用独立的 Undici 连接池，每地址连接尝试限时 2 秒、单次请求限时 30 秒，支持取消且最多重试四次（共 5 次请求，退避间隔为 250 / 500 / 1000 / 2000 毫秒）；不修改全局网络参数，游戏操作仍只经过原生 WebSocket。公开玩家 ID 不从登录凭据推断。

## 扩展原则

不引入插件总线、依赖注入容器或通用任务框架。新增功能时遵守现有边界：

1. agent 格式变化放在 `agent/`，不要在 React 中解释 stdout。
2. 服务器事件变化放在 `game/`，不要在控制器里手工拼 WebSocket 帧。
3. 前后端数据变化先更新 `packages/contracts/` 与校验，再更新使用端。
4. 存储格式变更应验证当前格式与重启行为，不保留旧格式兼容分支；不要用浏览器 localStorage 替代历史来源。
5. 固定输入只放测试目录并使用临时存储；产品只连接真实对局，不生成结果数据。

自动化验证不连接真实游戏服务器、不自动开始联网对局；游戏事件使用内存替身。验证入口与环境隔离见[配置与验证](configuration.md)，尚未覆盖的传输层等风险见[技术债](technical-debt.md)。
