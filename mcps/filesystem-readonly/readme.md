# 工作区文件访问 MCP（`filesystem-readonly`）

本配置遵循行业通用的标准 **`mcpServers` (`mcp.json`)** 声明规范：
- **本体来源**：直接引用公共 npm 源上的官方 `@modelcontextprotocol/server-filesystem` 并锁定精确版本号，本仓库不托管第三方源码；
- **环境变量占位**：安装时将 `${WORKSPACE_DIR}` 替换为目标工作区绝对路径；
- **跨工具兼容**：除在本平台桌面端一键安装外，也可直接将 `mcp.json` 中的 `mcpServers` 片段粘贴到 Claude Desktop、Cursor、OpenCode 等任意支持 MCP 的客户端中使用。

固定版本的服务提供读、写、编辑和移动文件操作。包 ID 保留旧标识 `filesystem-readonly`。需要只读访问时，请把工作区以只读卷挂载给服务进程，并将配置中的占位符替换为挂载路径。[上游版本的文件操作与只读挂载说明](https://github.com/modelcontextprotocol/servers/blob/0155af3069fb6d593165037a28703cb3a595cf67/src/filesystem/README.md)
