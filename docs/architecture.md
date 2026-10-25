# 架构

## 目录与依赖方向

```text
apps/
  server/src/
    main.ts             # 进程入口、回环监听、信号退出
    app.ts              # HTTP/SSE，参数和请求来源校验
    controller.ts       # 单运行会话、autopilot、资源生命周期
    agent/              # shell:false 子进程、协议编解码
    game/
      types.ts          # 领域观察、动作、连接接口
      socket.ts         # 原生 WebSocket 上的 Engine.IO / Socket.IO
      state.ts          # 增量地图、普通双人观察
      live.ts           # 真实连接、队列和动作提交
    storage/            # JSON 配置、SQLite 历史、JSONL 日志
  web/                  # React 控制台与 Vite 配置
packages/contracts/     # Zod 配置校验、前后端共享 DTO，不依赖 Node
test/fixtures/          # 仅单元测试使用的观察和子进程夹具
docs/
browser_agent/          # 原始参考，不被新代码导入
```

单个 npm 项目避免首版引入包发布和多重构建链。共享契约不依赖服务端，前端不会导入进程、文件系统或数据库模块。服务端通过 esbuild 打包，第三方依赖保持外置；前端通过 Vite 构建。Node 内置 SQLite，无原生 npm 扩展或额外数据库服务。

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

桌面端使用左侧固定导航，移动端折叠为顶部横向 Tab；四个页面为「启动 / 统计 / 对局记录 / 日志」，默认启动页。统一浅色主题，主色为 `#008080`，控件使用 2–4px 小圆角。样式由 Tailwind CSS v4 与 `apps/web/src/styles/app.css` 中的设计令牌生成。日志页同样使用浅色面板，不混用深色区块。面板常驻挂载，使用 `hidden` 控制显示，切换不丢未保存的表单草稿，也不影响 SSE 或运行任务。对局详情使用原生 `<dialog>` modal，支持 Esc、遮罩点击关闭和焦点恢复。Tab 支持方向键、Home / End 与标准 ARIA 语义；日志页重新显示时按用户的自动跟随设置滚动。

## 运行状态与并发

```text
idle/stopped/failed → starting → queueing → playing → cooldown → queueing
                                     └────────────→ stopped
任意活动状态 → stopping → stopped
任意异常状态 → failed
```

- 只有一个运行任务，可跨 HTTP 请求持续存在。重复启动或运行时修改参数返回 409。
- 只有一个待处理 agent observation；stdout 无请求 ID，超时后流不能安全复用，必须停止。
- WebSocket 消息与推理异步推进。推理完成后检查当前游戏与回合；过期动作不发送。
- 待执行攻击通过服务器 `attackIndex` 确认；未确认时不继续堆积动作。
- 一局结束持久化结果，发送 agent `end`，冷却后发送新局 `start`，复用进程。
- 停止通过 AbortSignal 取消排队、下一帧等待、推理或冷却，再关闭游戏连接和子进程。
- POSIX 使用独立进程组清理启动脚本及其子进程；Windows 的基础 child.kill 不保证回收任意脚本后代。首版以 Linux / WSL 为推荐环境。
- 服务端 SIGINT / SIGTERM 退出会停止运行并关闭 SSE；前端刷新、断线不会停止后台任务。

## 持久化与事件

同一个数据目录只允许一个服务实例，SQLite 连接持有独占锁，避免重复启动将另一实例的活动运行误判为中断。需要检查原始数据库时请先停止服务。

仓储是 SQLite 的唯一访问点。`PRAGMA user_version` 管理初始 schema；将来改结构应增加明确迁移，不在各业务模块创建表。启动时将未完成运行标为失败、未完成对局标为中断，不自动启动 agent。

运行参数由独立 `ConfigStore` 保存到 `data/config.json`：可读的缩进 JSON、Zod 校验、临时文件写入后原子替换、默认 0600 权限。启动时读取，界面保存后同步更新缓存；手工编辑应在停止服务后进行，重启生效。数据库 v1 的 settings 首次启动迁移到 JSON，成功后升级 v2 并移除旧 settings 表；已有 JSON 优先，损坏文件不会被默认配置覆盖。运行历史中的配置仍是当时参数的快照。

运行日志同步追加 JSONL，内存只保存最后 200 条；这种实现适合本地单会话的小吞吐场景。日志文件地址由持久化运行 UUID 决定，不接受任意下载路径。无账号原文进入 DTO 或日志；参数中只保存账号文件路径。

HTTP mutation 返回最新快照；SSE 发送 `event: dashboard` 的完整快照并以约 100 ms 合并更新，重连时重新发送当前快照。前端通过 SSE 世代计数防止较慢的启动、停止或保存响应覆盖期间已收到的实时状态。慢消费者不累积无界历史事件。历史使用独立分页 API；统计只由真实持久化结果计算，中断单独计数。服务端始终限制真实记录；字段筛选全部参数化，文本按字面量子串，时间统一为 UTC ISO，列表与 count 复用同一筛选条件。非真实旧记录不进入历史、统计、最近运行或下载入口。

## 对局详情与数据可信度

GameState 从已有服务器事件生成独立 MatchSnapshot，不改变发给 agent 的 Observation。Controller 保存首个和最后快照，并累计推理、提交与时间指标；停止和失败时也读取最后可用快照，首个可行动帧之前已结束的对局仍保存结果。详情与历史同属 JSON payload，不引入单独的数据库或重复事实来源。前端通过 modal 展示最后记录的快照：开局固定的首帧资源数值不再重复展示，玩家区只保留昵称、星级与末次领地/兵力/城市/存活数据，展示层不修改持久化的原始快照。

已确认的终局结果独立保留；即使 agent 推理随后超时或被停止，仍保存真实胜负，运行本身的错误单独记录。后续同局终局事件可补全评分、回合和快照，不重写首次胜负或终局时间。每局 rating 的赛前值、赛后值、来源和采集时间独立持久化；缺失值不推算，终局事件的评分优先于可能延迟的公开资料采样。详情弹窗使用当前页同 ID 的最新记录，刷新内容不重开弹窗或重置焦点。ECharts 引擎按可见性延迟加载，卸载时取消后续初始化并释放实例。

资源数量优先来自 scoreboard；城市由已知城市位置和可见归属统计。只有能确认视野完整时才保存精确城市数，否则为 null，visibleCities 只作已见下限。没有完整最终更新时不得将末帧称为完整终局。public rating 查询是可取消、2 秒限时的辅助元数据请求，游戏操作仍只经过原生 WebSocket。公开玩家 ID 不从登录凭据推断。

## 扩展原则

首版不引入插件总线、依赖注入容器或通用任务框架。新增功能时遵守现有边界：

1. agent 格式变化放在 `agent/`，不要在 React 中解释 stdout。
2. 服务器事件变化放在 `game/`，不要在控制器里手工拼 WebSocket 帧。
3. 前后端数据变化先更新 `packages/contracts/` 与校验，再更新使用端。
4. 新的存储结构应增加迁移和重启测试；不要用浏览器 localStorage 替代历史来源。
5. 固定输入只放测试目录并使用临时存储；产品只连接真实对局，不生成结果数据。

不新增 WebSocket 测试是本次明确范围；新控制端的其他边界仍应保持自动化验证。
