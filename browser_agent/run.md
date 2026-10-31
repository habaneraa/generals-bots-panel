# 旧版 Python 启动示例（历史归档）

> **不要按本文启动当前项目。** 以下内容记录旧版行为，不是现行安装或运行说明。旧版 Python 启动器已删除，本文命令不适用于当前 Node.js 控制台。当前流程见[根 README](../README.md)，文档分类见[文档索引](../docs/README.md)。

以下为旧版说明，保留供查阅：当时在仓库根目录执行 `uv sync` 后运行下列命令。

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

旧版脚本当时不改变工作目录，相对路径基于调用目录；这只描述历史实现，当前控制台通过 npm 脚本启动，不支持这些 Python 参数。
