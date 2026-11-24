# 时间与时区换算

从 IANA 时区名称查询当地时间，或为跨地区会议换算时间。可调用 `get_current_time`、`convert_time` 和 `get_time_ago`。例如用 `convert_time` 把上海 09:00 换算为 UTC。

配置要求 Claude Code 能从 PATH 找到 `uvx`，且 uv 可使用 Python 3.10 或更新版本。将 `mcp.json` 中的 `timezone-clock` 条目合并到项目根目录 `.mcp.json` 的 `mcpServers` 中，在 Claude Code 中确认启用，然后运行 `claude mcp get timezone-clock` 检查连接。[Claude Code 的项目级 MCP 配置](https://code.claude.com/docs/en/mcp)

首次运行由 uv 安装固定版本 `mcp-server-time==2026.11.18` 和所需依赖。uv 会访问配置的包索引并写入本机缓存。查询时使用本机时钟与时区数据，无需提供凭据。上游时间服务以 MIT 许可发布，本市场包提供项目内的启动配置。[上游发布记录](https://pypi.org/project/mcp-server-time/2026.11.18/)
