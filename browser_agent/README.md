# browser_agent Python 包（历史参考）

> 状态：历史归档，不是当前应用入口。当前 Node.js 控制台不导入或运行此目录的 Python 代码，也不将其测试纳入现行验证。

本目录仅保留旧版 Python 控制端、游戏传输、随机 agent、测试和已有账号文件。保留这些内容是为了查阅旧协议与复用本机账号路径，不表示维护两套实现。

当前安装、启动、账号配置和外部 agent 协议以[仓库根 README](../README.md)及[现行文档索引](../docs/README.md)为准；[旧启动示例](run.md)仅用于历史查阅。模型入口与权重属于外部策略仓库，不在控制端内置。

不要将本目录的 `unittest discover` 用作当前项目验证：其中测试面向历史 Python 控制端，不属于现行验证入口。旧入口测试曾将 Python 参数传给[根启动脚本](../run.sh)，而该脚本默认会执行 `npm start`；该测试已删除，避免误启动当前服务。现行验证使用仓库根目录的 `npm run check` 与 `npm run build`，隔离边界见[配置与验证](../docs/configuration.md)。
