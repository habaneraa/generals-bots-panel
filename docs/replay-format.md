# 本地录像 v1

## 使用

- 控制台「录像」Tab，或者独立页面 `/replay`，不需要启动 agent。
- 历史列表的「录像」在新窗口打开站内独立播放器，无本地录像时显示「未录制」。详情中的「站内录像」打开同一播放器；外部服务器链接仅在详情中以「官网回放」提供。
- 输入服务器与游戏 ID，从本机录像库读取；也可导入 gzip 或 JSON 文件。导入只在浏览器内进行，不上传、不执行文件内代码。
- 0.25×–16× 变速、前后单步、首尾定位、拖动时间轴、输入回合跳转。实际记录可能跳回合，跳转取不小于目标回合的第一帧，超过范围则取边界。
- 手动导航暂停播放。点击棋盘后，Space 播放/暂停，←/→ 单步，Shift + ←/→ 跳 10 帧，Home/End 首尾定位。地图默认 1×、每格最多 32 CSS px；容器较窄时自动缩小，支持 0.5×–3× 手动缩放和恢复适应宽度。
- 「显示操作箭头」控制全部轨迹；「历史操作淡化」控制最近 12 帧轨迹，关闭后只显示当前帧操作。近期操作可点击定位，半兵标记 `½`。
- 黄色箭头为 `sent`，其他状态为白色虚线；半兵也是虚线。`sent` **只表示提交**，不表示服务器实际执行。回放不重新运行引擎，也不根据行动推测棋盘。

当前只支持本项目已接入的普通远程 1v1。录像是 **bot 实际观察到的单一视角**，不是服务器全知录像：不揭开迷雾、不反推敌方动作、不把最终记分板当作完整终局棋盘。记录从第一张有效棋盘开始；没有棋盘的瞬间结束对局不会生成空录像。旧历史没有逐帧数据，不能补录。

## 落盘与生命周期

```text
<data_dir>/players/<player-id>/
  server-generals/<game-id>/replay.json.gz
  server-bots/<game-id>/replay.json.gz
```

服务器名固定为 `generals` / `bots`，游戏 ID 限制为 1–128 位 ASCII 字母、数字、下划线、连字符，不允许路径分隔符或 `..`。文件内容包含服务器和游戏 ID，读取时再次核对。

SocketGame 在每次收到有效游戏更新后、通知等待方之前记录棋盘，因此 bot 推理慢或等待 attackIndex 确认时的中间帧仍被保留。只保存规范化棋盘、公开玩家信息、记分板和策略动作，不保存登录账号、握手包或任意原始 socket 载荷。Controller 在决策后记录动作提交状态。

正常结束和有棋盘的主动停止/错误中断都会保存录像；中断结果为 `interrupted`。压缩和写盘在对局结束后执行，不在出招路径中进行文件 IO；先写同目录唯一临时文件，再原子替换正式文件。目录 0700、文件 0600。保存失败记入 `warn` 日志，不把正常胜负改成运行失败；只有成功保存后才标记历史中的 `localReplay`。清理临时文件只忽略文件已不存在的情况，其他清理失败与原始保存异常一起保留，并在错误消息中提供两次失败的诊断，便于定位可能遗留的临时文件。

录像录制期间在内存中累积，并限制帧数、棋盘数值个数和保守 JSON 字节预算（逐数字按安全整数最大长度估计，不在更新路径序列化整局）。触顶后停止追加，保留有效前缀并标记 `truncated: true`；播放器会明确提示「录像不完整」，不会把前缀最后一帧当作终局。进程突然崩溃或被 SIGKILL 时，尚未保存的这局录像会丢失。当前没有录像清理机制。

## 编码

文件是 UTF-8 JSON 经 gzip 压缩。选用可检查、无额外解码依赖的版本化格式，而非逐帧全量 Observation（后者重复存储 owners/player_grid 和不变玩家信息）。

| 字段                         | 含义                                       |
| ---------------------------- | ------------------------------------------ |
| `format` / `version`         | 固定 `generals-replay` / `1`；未知版本拒绝 |
| `server`, `gameId`           | 库中的身份                                 |
| `startedAt`, `endedAt`       | ISO 时间，未知结束为 null                  |
| `outcome`, `winnerIndex`     | 胜负/中断与胜者；未知为 null               |
| `perspective`                | 录制视角的原始服务器玩家索引               |
| `width`, `height`            | 真实矩形尺寸                               |
| `tickMs`, `keyframeInterval` | 固定 500 ms、最多每 64 帧一张关键帧        |
| `players`                    | 固定玩家信息：`{index, username, team}`    |
| `frames`                     | 按记录顺序排列的棋盘与记分板               |
| `actions`                    | 按所属帧排序的已记录策略动作               |

### 棋盘帧

每帧包含 `turn`（零基 Observation 回合）、`at`（从对局开始经过的毫秒）、`scores: [{index, land, army}]`，及两种棋盘编码之一：

- `keyframe`：完整平铺数字数组，每格三项 `[type, player, army]`。
- `delta`：仅变化格子的四元组 `[cellIndex, type, player, army]`；`[]` 是棋盘未变但仍保留时间/分数的帧。

格子顺序为行优先，`cellIndex = row * width + col`；关键帧中该格起始位置为 `cellIndex * 3`。`player` 是原始服务器索引，不是 Observation 的相对 owners 编号。

| type | 含义                             | player              |
| ---- | -------------------------------- | ------------------- |
| 0    | 迷雾                             | -3                  |
| 1    | 平原                             | -1 中立 / 0..1 玩家 |
| 2    | 山                               | -2                  |
| 3    | 城市                             | -1 中立 / 0..1 玩家 |
| 4    | 将军                             | 0..1 玩家           |
| 5    | 迷雾内未知障碍（山或城不可区分） | -4                  |

迷雾中的兵力固定 0，但这个 0 表示未知，并非真实无兵。帧时间和回合不倒退，允许同一回合多次有效更新。终局只更新录像元信息，不编造新的棋盘帧。

首帧必为关键帧，此后至多 63 张差分帧；若差分数字个数不少于完整棋盘，则提前使用关键帧。设 N 为格子数、F 为帧数、C 为变化格子数：关键帧约 `3N` 个数，差分约 `4C` 个数，加上两人记分板；gzip 再压缩重复值。无需依赖 Python/JAX 版本或重放战斗优先级即可还原真实观察结果。

`ReplayTimeline` 只缓存一张棋盘及关键帧索引，不展开所有帧：顺序播放应用下一张差分；任意前后跳转通过二分定位关键帧，再至多应用 63 张差分。内存为差分记录本身 + O(N + K)，K 为实际关键帧数量（包含大面积变化时提前生成的关键帧）；不会把所有差分展开成 F 张完整地图。

### 动作

```ts
interface ReplayAction {
  frame: number; // frames 数组索引，引用产生此决策的观察帧
  turn: number;
  player: number;
  from: number; // row * width + col
  to: number;
  split: boolean;
  status: 'sent' | 'pass' | 'stale' | 'rejected' | 'dry-run';
}
```

当前普通 1v1 每回合最多记录一个己方决策，导入时拒绝同回合重复动作，并对绘制窗口限制数量。不记录 Pass 箭头。策略计算过慢得到的 `stale`、校验拒绝和 dry-run 决策保留原状态，不冒充执行动作。当前数据源只有己方决策，因此不会有真正的敌方箭头。动作始终附在决策使用的观察帧上，而不是附在下一帧或错误地移动到计算结束的回合。

## 接口、复用与限制

- `GET /api/replays/:server/:gameId?playerId=<player-id>`：读取所选 Player 目录的 gzip、校验格式与身份，返回 JSON；没有文件为 404，不回退到其他 Player 的录像库。
- `GET /api/replays/:server/:gameId/download?playerId=<player-id>`：下载该 Player 的原始 gzip。控制台生成的独立播放器链接也保留 Player ID，切换账号不会改变已打开录像的归属。
- 导入/读取都验证版本、数值范围、尺寸、帧顺序、关键帧间隔、差分索引和动作引用。浏览器导入限制压缩前后均不超过 64 MiB；共享解码器额外限制总棋盘数值，避免构造巨大棋盘。
- 独立 [ReplayPlayer](../apps/web/src/replay/ReplayPlayer.tsx) 只接收 `replay` 和可选 `active`，不依赖 API、控制台或运行中的游戏；新录像使用新的 React key 挂载。读取、导入和错误反馈在 [ReplayWorkspace](../apps/web/src/replay/ReplayWorkspace.tsx)。
- 共享结构、导入校验及随机访问解码在 [replay.ts](../packages/contracts/src/replay.ts)；录制和落盘在 [replays.ts](../apps/server/src/storage/replays.ts)。
- 皇冠、城市、山图、Quicksand 字体复用参考引擎；来源与许可见 [素材归属](../apps/web/src/replay/assets/ATTRIBUTION.md)。播放器底部提供 MIT/OFL 原文，随 Vite 构建一起发行。
