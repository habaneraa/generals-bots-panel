# 外部 agent 协议

控制端通过 `child_process.spawn(command, args, { shell: false })` 启动外部程序，stdin 写观察，stdout 按行读动作，stderr 记诊断。没有 HTTP 模型接口、ready 握手或仓库内模型依赖。首次 observation 的超时包含模型加载时间，默认 60 秒，可在参数中调整。

## JSONL v2（默认）

每局先发送一行：

```json
{
  "event": "start",
  "version": 2,
  "player_id": 0,
  "height": 2,
  "width": 2,
  "mode": "1v1",
  "teams": [0, 1],
  "players": [],
  "rules": { "game_type": "1v1", "modifiers": [], "torus": false }
}
```

每回合发送一行（示意，players 在真实观察中包含当前双方统计）：

```json
{
  "event": "observation",
  "player_id": 0,
  "turn": 0,
  "my_land": 1,
  "my_army": 5,
  "opp_land": 1,
  "opp_army": 5,
  "allied_land": 0,
  "allied_army": 0,
  "mode": "1v1",
  "teams": [0, 1],
  "players": [],
  "types": [
    [4, 1],
    [1, 4]
  ],
  "owners": [
    [1, 0],
    [0, 2]
  ],
  "armies": [
    [5, 0],
    [0, 5]
  ],
  "player_grid": [
    [0, -1],
    [-1, 1]
  ],
  "rules": { "game_type": "1v1", "modifiers": [], "torus": false },
  "features": { "deserts": [], "swamps": [], "tunnels": [] }
}
```

- `player_id` 为服务器 playerIndex；`owners` 始终 0 中立/未知、1 自己、2 敌人，与 playerIndex 无关。
- `types`：0 迷雾、1 平地、2 山、3 城市、4 将军、5 迷雾结构。标准双人入口拒绝特殊地形、队伍与 modifiers。
- `armies` 迷雾兵力强制为 0；`player_grid` 保留服务器真实玩家编号与负地形值。
- `turn = server.turn - 1`，一回合最多推理一次，允许跳过推理期间已推进的回合，不补发过期动作。
- `players` 带 `i, username, team, relation, tiles, total`，`relation` 为 `self` 或 `enemy`。
- 控制端内部 gameId、连接元数据不混入 observation。

每局结束发送 `{"event":"end"}` 加换行；没有动作回复。下一局重新发 start。整个运行结束关闭 stdin；agent 应在 EOF 时正常退出。

## 整数 stdio（兼容外部既有策略）

首行：

```text
player_id height width
```

每帧：

```text
turn my_land my_army opp_land opp_army
<types 的 height 行，每行 width 个整数>
<owners 的 height 行>
<armies 的 height 行>
```

空行结束本局；下一行可为新局握手。只支持标准双人。

## stdout 动作（两种输入共用）

每个 observation 必须且只能回复一行：

```text
pass row col direction split [value]
```

- 前五项均为整数；`pass=1` 跳过，`pass=0` 移动。
- `row/col` 为从 0 开始的源坐标；方向 `0 上 / 1 下 / 2 左 / 3 右`。
- `split=1` 半兵，`0` 全兵。
- 可选 `value` 是有限浮点数，仅用于日志，不影响提交。
- 不接受 stdout 中的日志、空行、JSON 动作、READY 或多行响应。所有诊断请写 stderr。

控制端还会检查动作是否过期、坐标、源所有权与兵力、目标地形。写入 WebSocket 的 `sent` 不代表动作已被执行；后续服务器状态才是事实来源。

启动失败、stdout EOF、非法响应或超时会停止整个运行，关闭连接并标记未结束对局为中断；不会继续读取可能已错位的旧响应。
