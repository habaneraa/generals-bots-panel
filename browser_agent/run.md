# 启动示例

以下命令在仓库根目录运行；先执行 `uv sync`。完整说明见[根 README](../README.md)。

默认随机策略，公共服务器：

```bash
./run.sh --autopilot --user-id-file browser_agent/.user-id --game-server generals
```

Bot 服务器使用独立账号：

```bash
./run.sh --autopilot --user-id-file browser_agent/.bot-id --game-server bots
```

使用外部 AverageJoe 策略，`--agent` 必须最后：

```bash
./run.sh --autopilot --user-id-file browser_agent/.user-id --game-server generals \
  --agent bash /绝对路径/AverageJoe/run.sh
```

启动脚本不改变当前工作目录，相对账号、录制路径和 agent 参数仍相对于调用目录。
