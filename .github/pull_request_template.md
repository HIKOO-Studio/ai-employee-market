## 投稿自查

请勾选适用于本次 PR 的项目。

- [ ] 内容投稿与仓库规则维护已分开提 PR。
- [ ] 普通投稿只改动一个 `<category>/<slug>/` 资源目录，未手改根目录的 `manifest.json`、`owners.json` 或 `taxonomy.json`。
- [ ] 本次改动不含任何明文 API Key、Token 或私钥。
- [ ] 资源清单的 `license` 已填写市场白名单中的单一 SPDX 标识。
- [ ] 可执行装备（`skills`、`mcps`、`tool-adapters`）已填写 `permissions`，环境变量只列名称。
- [ ] 更新已有资源时，已按 SemVer 将版本号升至该资源历史最高版本以上，保留所有已发布版本。
- [ ] 已在本地运行 `node scripts/validate.mjs --all` 并通过校验。
