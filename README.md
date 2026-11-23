# AI 员工开源市场仓库（`ai-employee-market`）

本仓库是公开市场的事实源。每项资源在独立目录内提交配置或外部源码坐标，经 PR 审核后，由 CI 生成版本索引。任何人都可以 Fork、镜像或用 Git 和 Node.js 在本地校验、构建和读取市场。服务端代码在平台自己的仓库维护，私钥只保存在部署环境中。

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

1. Fork 仓库，选一个未占用的 `<category>/<slug>/`。普通投稿每个 PR 只改一个资源目录。目录内至少提供 `manifest.json` 和 `readme.md` 或 `README.md`，并将实际文件名原样写入 `entrypoints.readme`。
2. 从词典选择合适的 `industries`。岗位有匹配时填入标准 `positions` 代码，暂时没有时可填 `"positions": []`，用自由 `tags` 描述具体工作。例如电商退货专员可用 `"industries": ["ecommerce"], "positions": [], "tags": ["售后", "退货处理"]`，按行业和标签就能检索。新增通用岗位请单开词典维护 PR。[行业与岗位词典](taxonomy.json)
3. 在本地运行 `node scripts/validate.mjs --all` 后提交 PR。首次投稿将自己的 GitHub 登录名填入 `owner_github`，由独立 Admin 审批。更新、删除他人的资源须获原 Owner 确认和另一名 Admin 批准。Owner 本人提交即为本人确认，Admin 不能自审。上游仓库收录和更新也走同一流程。
4. 合入 `main` 后，CI 汇总各目录并生成根 `manifest.json` 和 `owners.json`。所有投稿人都禁止手改这两个文件。`taxonomy.json`、根 `README.md`、`.github/`、`scripts/` 等共享文件的改动单独走维护 PR。这样两个不同 slug 的作者可以并行投稿，无需协调中心文件的编辑顺序。

管理员名单配置在仓库变量 `MARKET_ADMINS`，填写以逗号分隔的 GitHub 登录名。名单缺失时检查失败。种子资源的 `owner_github: official` 代表维护团队。普通作者修改这种资源时，需要两名不同的管理员批准，一人代表团队 Owner，另一人独立审核。管理员本人提交时已代表团队确认，另需一名管理员批准。审批仅对当前 PR 的 HEAD 生效。

默认分支上的工作流用基线校验器读取候选合并的文件数据，从受保护基线确认资源 Owner，覆盖已合入但尚未刷新 `owners.json` 的投稿。它只向该 PR 的精确提交写入 `market/pr-validate` 状态。审批事件会重新计算该状态，也可在 PR 评论 `/market-recheck` 请求重查。管理员可将该状态设为合并必需并要求分支保持最新。若私有仓库套餐无法强制该规则，由受信维护者核对该提交的绿色状态和实际审批后合并。

### 协议、权限和外部来源

每个资源的 `license` 必填，使用以下单一 SPDX 标识，大小写须匹配。代码常用 `MIT`、`Apache-2.0`、`BSD-2-Clause`、`BSD-3-Clause`、`ISC`、`MPL-2.0`、`GPL-3.0-only`、`GPL-3.0-or-later` 或 `AGPL-3.0-only`，内容可用 `CC-BY-4.0` 或 `CC0-1.0`。作者需确认外部源码和随包分发的内容符合所声明的协议。[SPDX 标识列表](https://spdx.org/licenses/)

`skills`、`mcps`、`tool-adapters` 的清单必须逐项声明运行权限。下面是一个会联网、只访问当前工作区的装备示例。

```json
{
  "permissions": {
    "shell": false,
    "network": true,
    "filesystem": "workspace",
    "env": ["SERVICE_TOKEN"],
    "notes": "读取工作区的配置，并向服务查询任务状态。"
  }
}
```

`shell` 与 `network` 分别表示是否执行本机命令、是否发起网络请求，均须填写 JSON 布尔值。`filesystem` 须选 `none`（无需文件系统）、`workspace`（限工作区）或 `full`（需要工作区外访问）。`env` 和 `notes` 可省略。环境变量只列名称，严禁填写值、Token 或私钥。CI 校验声明格式，审核者对照具体代码核实用途，运行环境负责实际授权。

若源码托管在另一个 GitHub 仓库，在本市场的资源清单中加入以下字段。本地 README 说明用途、权限和获取方式，审核者按固定提交检查上游代码及许可证。示例中的哈希需换成实际提交。

```json
{
  "external_source": {
    "repo_url": "https://github.com/example/employee-tools",
    "repo_path": "packages/support",
    "commit_sha": "0123456789abcdef0123456789abcdef01234567"
  }
}
```

`repo_url` 使用 HTTPS GitHub 仓库地址。`repo_path` 相对于仓库根目录，省略表示整仓。`commit_sha` 须为 40 或 64 位小写十六进制完整提交哈希。更换上游提交、子目录或仓库均需提升市场资源版本并重新提 PR。CI 可离线核对清单格式，审核者还需确认指定提交和子目录可供第三方访问。

目录和审核方式借鉴了 WinGet 的单包投稿，外部来源建模参考 Claude 插件市场的 Git 仓库、子目录和提交定位。这里由 CI 合成中心索引，作者始终在包目录中声明来源。[WinGet 投稿规则](https://learn.microsoft.com/en-us/windows/package-manager/package/repository) · [Claude 插件市场](https://code.claude.com/docs/en/plugin-marketplaces)

## 资源版本和依赖

每个资源独立发布，发行键是本仓库中的 item ID 与 SemVer 版本号。版本示例有 1.2.0、1.3.0-beta.1。版本号使用三个不含前导零的数字段，可带预发布标识，市场版本省略 v 前缀和 +build 元数据。升级时新版本需高于该资源已发布的最高版本。用户主动选用测试版本时才推荐预发布版。[SemVer 2.0](https://semver.org/lang/zh-CN/)

发布会封存资源目录中的文件路径、内容与 Git 模式，包括权限位变化和符号链接的目标文本。改动交付文件时须提升版本，重复构建同一版本会复用原始提交、摘要和依赖锁。资源下架后也保留旧版，历史报告可继续指向原始提交。这沿用了 npm 对已发布包名与版本组合的约束。[npm 发布规则](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

例如秘书 1.0.0 引用身份 1.0.0，而身份引用工具 1.0.0。工具发布 1.1.0 后，秘书和身份的旧版继续使用工具 1.0.0。身份新版本可采用新工具；秘书要采纳这个新组合时也发布新版本。跨路径依赖要求同一资源的两个不同版本时，发布校验会提示作者统一依赖。桌面端对已创建项目的快照更新仍由用户决定。

## 回退已发布配置

回退需要同时变更共享的 `rollbacks.json`。由管理员发起专门的 PR，恢复该资源的全部旧版文件，并记录当前版本、目标版本和实际原因。已有资源仍需通过其 Owner 和独立 Admin 的审核。首次使用时创建此文件。

~~~json
{
  "identities/opencode-plus-base": {
    "from_version": "1.2.0",
    "to_version": "1.1.0",
    "reason": "1.2.0 与已支持的桌面版本不兼容"
  }
}
~~~

恢复的是封存的原始 Git 提交和依赖锁，重新上架的资源仍须符合当前准入规则。旧版缺少当前必填声明时，可在修复版本中恢复其功能并补充声明。版本从 1.2.0 退到 1.1.0 时，区间 (1.1.0, 1.2.0] 内的旧版从常规升级建议中撤回，原报告仍可核对。修正后由管理员随包发布比历史最高版本更高的新版本，同时清除此资源的回退声明。已经执行的回退事件独立保存在生成索引的历史里。下架后重新启用历史低版本，同样需明确回退。已撤回的版本继续保留供追溯。

## 生成索引契约

| 字段 | 内容 |
|---|---|
| catalog_revision | 正整数。索引变化时递增，重放同一份数据保留序号和生成时间。 |
| items | 当前上架的资源，含 version、commit_sha、content_sha256 和 dependency_lock。source 为 official（本仓库托管）或 external（外部仓库托管），两类均经本市场审核。 |
| releases | 所有已发布版本，包含已下架资源。每条保存 id、version、path、commit_sha、content_sha256、compat、dependency_lock。外部版本还保留当时的 source 和上游坐标。 |
| dependency_lock | 直接和传递依赖均按 ID 排序，每条包含 id、version、commit_sha、content_sha256。无依赖时为空数组。 |
| rollbacks | 按 revision 和 id 排序的完整回退记录。每条包含 id、from_version、to_version、reason、revision。 |

正式索引从 Git 对象生成。对所有条目，`path` 和 `commit_sha` 定位本市场内受审的资源目录，`content_sha256` 绑定该目录和依赖锁。对外部条目，`repo_url`、`repo_path`（空串表示根目录）和 `external_commit_sha` 共同定位实际交付源码。校验外部源码时应按上游 Git 提交取回，市场摘要计算的对象是本地收录包。无 Git 元数据的本地样例使用 `local-*` 标识。

## 服务端与镜像如何消费

公开条目的唯一发布入口是本仓库的审核 PR。平台以只读方式消费索引，可以在自己的数据库中建立筛选、依赖反查、账号和评测视图。任何服务端都须从已审核索引导入公开条目，包括外部来源。已有“登记外部仓库”界面可引导作者提交 PR，须停用绕过审核、直接写入公开市场的发布 API。

- **定时拉取**可先将受信仓库的 `main` 解析为一个 Git 提交，再从该提交读取根 `manifest.json`，按索引的 `head_sha` 取 `taxonomy.json` 并核对 `taxonomy_sha`。主分支会前移，记录实际读取的提交即可重放同一份索引。索引的 `head_sha` 标记构建输入，CI 写回生成文件发生在其后的提交。
- **Webhook** 仅用于提示有新版。可在 Actions Secrets 配置 `BACKEND_SYNC_WEBHOOK_URL` 和 `BACKEND_SYNC_WEBHOOK_SECRET`。接收方按原始请求体核验 `X-Market-Signature`（HMAC-SHA256），再从预先配置的受信仓库读取索引。按 `catalog_revision` 幂等导入，避免重复或迟到的通知覆盖新版。
- **Fork 或镜像**可以直接提供固定 Git 提交中的目录和清单，无需平台账号、数据库或 Webhook 密钥。分发外部条目时一并保留市场提交与上游提交两个坐标。部署自建归档镜像时先上传并验证相应不可变快照，再设置 `MIRROR_BASE_URL`。

## 校验和发布

在仓库根目录执行以下命令，可校验工作树并运行回归测试，无需平台服务或密钥。

~~~bash
node scripts/validate.mjs --all
node --test scripts/*.test.mjs
~~~

索引构建默认读取已提交的 Git 对象。以下命令对候选合并提交执行只读发行校验。PR 配置要求候选提交包含最新的受保护 `main` 基线，避免两个作者同时声明同一版本。

~~~bash
git fetch origin main
node scripts/build-manifest.mjs --check --base-ref refs/remotes/origin/main
~~~

无 Git 元数据的独立样例可以运行 `node scripts/build-manifest.mjs` 生成本地索引。首次构建会为旧格式的本地索引补充发行历史，再次构建相同内容会复用原索引。

合并后的 Actions 串行生成索引，按 main 的第一父提交历史检查尚未来得及生成索引的合并，在写回前复核所有版本。普通快进推送会在 main 已前移时失败；最新流水线或重新运行发布任务会读取最新保护基线再生成。分支保护须将 PR 校验配置为合并必需并要求分支保持最新，索引发布身份须具有回写生成文件的权限。
