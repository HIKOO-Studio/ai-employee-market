# AI 员工开源市场仓库（`ai-employee-market`）

本仓库托管所有公开开源配置资源，与服务端职责严格分离：
- **本仓库负责**：配置本体、版本历史、PR 规范与防密钥校验、Owner + Admin 双重审批、自动生成根目录索引 `manifest.json`。
- **服务端负责**：同步本仓库索引并提供多维筛选、账号体系、级联反查与评测运行数据回显。

## 目录结构

```text
.
├── taxonomy.json           # 行业与岗位标准词典
├── manifest.json           # 【自动生成，禁止手改】全量索引
├── owners.json             # 【自动生成，禁止手改】资源创建者 Owner 映射
├── judges/                 # 官方内置裁判身份
├── identities/             # 【找人】身份
├── secretaries/            # 【找人】秘书
├── teams/                  # 【找人】项目组
├── skills/                 # 【找装备】Skill
├── mcps/                   # 【找装备】MCP
├── model-configs/          # 【找装备】模型档位模板（严禁包含 API Key）
├── tool-adapters/          # 【找装备】AI 工具适配器
└── scenarios/              # 【评测场景】情景题包
```

## 提交流程（PR 规则）

1. Fork 本仓库，在对应分类目录下新建 `<slug>/`，至少包含 `manifest.json` 与 `readme.md`；
   - Skill 资源的根目录提供普通文件 `SKILL.md`，用 YAML frontmatter 声明 `name`、`description`，随后写技能指令。
   - MCP 资源的根目录提供普通文件 `mcp.json`，在 `mcpServers` 中声明本地命令或远程 URL。引用 npm、PyPI 包时应固定版本，校验会拒绝 `@latest`。第三方服务源码和凭据由上游维护。
2. 严禁修改根目录 `manifest.json` 和 `owners.json`，严禁包含任何 API Key / Token / 私钥；
3. 提交 PR 后将自动运行 `pr-validate` 校验：
   - **新增资源**：校验通过 + 平台 Admin 审批合入，合入后你的 GitHub 账号自动登记为唯一 `owner`；
   - **修改已有资源**：校验通过 + **原创建者（Owner）与平台 Admin 双方共同 Approve** 才可合入；
4. 合入 `main` 后，流水线生成版本索引，并按部署配置通知服务端刷新市场。

管理员在仓库变量 `MARKET_ADMINS` 中维护 GitHub 登录名，用逗号分隔。审批名单缺失时检查失败。平台种子配置的 `owner_github: official` 由一名提交人以外的实际管理员批准；其他已有配置需要原 Owner 和一名独立管理员确认，Owner 自己提交即视为本人确认。审批仅对当前 PR 的 HEAD 生效。

内容投稿和仓库规则维护分开提 PR。默认分支上的工作流用基线校验器读取候选合并的文件数据，只向该 PR 的精确提交写入 `market/pr-validate` 状态。审批事件会重新计算该状态，也可在 PR 评论 `/market-recheck` 请求重查。管理员可将 `market/pr-validate` 设为合并必需状态并要求分支保持最新。若私有仓库套餐无法强制该规则，由受信维护者核对该提交的绿色状态和实际审批后合并。

## 资源版本和依赖

每个资源独立发布，发行键是本仓库中的 item ID 与 SemVer 版本号。版本示例有 1.2.0、1.3.0-beta.1。版本号使用三个不含前导零的数字段，可带预发布标识，市场版本省略 v 前缀和 +build 元数据。升级时新版本需高于该资源已发布的最高版本。用户主动选用测试版本时才推荐预发布版。[SemVer 2.0](https://semver.org/lang/zh-CN/)

发布会封存资源目录中的文件路径、内容与 Git 模式，包括权限位变化和符号链接的目标文本。改动交付文件时升级该资源的版本。相同版本再次发布会复用原始提交、摘要和依赖锁。资源下架后，索引继续保留旧版，历史报告仍可指向原始提交。Git 提交标识用于取回源文件，content_sha256 用于绑定这份文件和当次解析的全部依赖。

例如秘书 1.0.0 引用身份 1.0.0，而身份引用工具 1.0.0。工具发布 1.1.0 后，秘书和身份的旧版继续使用工具 1.0.0。身份新版本可采用新工具；秘书要采纳这个新组合时也发布新版本。跨路径依赖要求同一资源的两个不同版本时，发布校验会提示作者统一依赖。桌面端对已创建项目的快照更新仍由用户决定。

## 回退已发布配置

在同一个 PR 中把该资源全部文件恢复到旧版原样，并在仓库根目录的 rollbacks.json 记录本次回退，注明当前版本、目标版本和实际原因。首次使用时创建此文件，例如：

~~~json
{
  "identities/opencode-plus-base": {
    "from_version": "1.2.0",
    "to_version": "1.1.0",
    "reason": "1.2.0 与已支持的桌面版本不兼容"
  }
}
~~~

恢复的是封存的原始 Git 提交和依赖锁。版本从 1.2.0 退到 1.1.0 时，区间 (1.1.0, 1.2.0] 内的旧版从常规升级建议中撤回，原报告仍可核对。修正后发布比历史最高版本更高的新版本，同时清除此资源的回退声明。已经执行的回退事件独立保存在生成索引的历史里。下架后重新启用历史低版本，同样需明确回退；已撤回的版本继续保留供追溯。

## 生成索引契约

| 字段 | 内容 |
|---|---|
| catalog_revision | 正整数。索引变化时递增，重放同一份数据保留序号和生成时间。 |
| items | 当前上架的资源，含 version、commit_sha、content_sha256 和 dependency_lock。 |
| releases | 所有已发布版本，包含已下架资源。每条保存 id、version、path、commit_sha、content_sha256、compat、dependency_lock。 |
| dependency_lock | 直接和传递依赖均按 ID 排序，每条包含 id、version、commit_sha、content_sha256。无依赖时为空数组。 |
| rollbacks | 按 revision 和 id 排序的完整回退记录。每条包含 id、from_version、to_version、reason、revision。 |

正式索引从 Git 中的文件生成。每个新版本保存资源路径的原始提交；已发行版本始终复用首发提交。无 Git 元数据的本地示例保留 local-* 标识，适合联调；从正式仓库首次生成的索引采用真实 Git 提交。历史依赖与资源始终可按同一仓库、路径和原始提交复核。

## 校验和发布

无 Git 的本地样例可直接执行以下命令。第一次生成会为旧格式本地索引补充发行历史，随后重复执行的索引保持一致。

~~~bash
node scripts/validate.mjs --all
node scripts/build-manifest.mjs
node --test scripts/*.test.mjs
~~~

在独立市场 Git 仓库里，构建默认读取已提交的 Git 对象。对候选合并提交执行以下只读校验。工作树改动应先提交到候选分支。PR 配置要求候选提交包含最新受保护 main 基线，避免两个作者同时声明同一版本。

~~~bash
git fetch origin main
node scripts/build-manifest.mjs --check --base-ref refs/remotes/origin/main
~~~

合并后的 Actions 串行生成索引，按 main 的第一父提交历史检查尚未来得及生成索引的合并，在写回前复核所有版本。普通快进推送会在 main 已前移时失败；最新流水线或重新运行发布任务会读取最新保护基线再生成。分支保护须将 PR 校验配置为合并必需并要求分支保持最新，索引发布身份须具有回写生成文件的权限。

如已配置市场同步 Webhook，发布完成后会通知后端读取新目录。部署启用自建镜像前，先由镜像发布流程上传并核验对应的不可变快照；配置流水线的 MIRROR_BASE_URL 后，索引才会提供镜像地址。
