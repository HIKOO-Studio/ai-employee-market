#!/usr/bin/env node
/**
 * 零依赖市场仓库校验器：
 *   node scripts/validate.mjs --all
 *   node scripts/validate.mjs --pr-files changed.txt --pr-author alice --approvers bob,admin1 --admins admin1,admin2
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validVersion, scenarioCoreChecks } from "./catalog.mjs";

const opts = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(opts.root || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

export const CATEGORY_MAP = {
  identities: { type: "identity", group: "people" },
  secretaries: { type: "secretary", group: "people" },
  teams: { type: "team", group: "people" },
  skills: { type: "skill", group: "gear" },
  mcps: { type: "mcp", group: "gear" },
  "model-configs": { type: "model_config", group: "gear" },
  "tool-adapters": { type: "tool_adapter", group: "gear" },
  scenarios: { type: "scenario", group: "scenario" },
  judges: { type: "judge", group: "system" },
};

const GENERATED_ROOT_FILES = new Set(["manifest.json", "owners.json"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const TEXT_EXTS = new Set([".json", ".md", ".txt", ".yml", ".yaml", ".toml", ".js", ".mjs", ".ts", ".py", ".sh", ".env"]);

const SECRET_PATTERNS = [
  { name: "OpenAI / generic sk- key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private key header", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  {
    name: "Hardcoded credential assignment",
    re: /"(?:api_key|apiKey|access_token|secret_key|proxy_password|password)"\s*:\s*"(?!\s*$|your[_-]|YOUR[_-]|\$\{|<)[^"]{8,}"/i,
  },
];

const errors = [];
function fail(msg) {
  errors.push(msg);
}

function readJson(filePath, label) {
  try {
    if (!fs.lstatSync(filePath).isFile()) throw new Error("JSON 必须是普通文件");
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    fail(`${label}: JSON 解析失败 (${err.message})`);
    return null;
  }
}

function inside(dir, full) {
  const relative = path.relative(dir, full);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

// Inspect links as data without opening their targets. Package validation never
// needs to read a link target; reject absolute/escaping references at intake.
function checkLinks(dir, boundary = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkLinks(full, boundary);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      const lexical = path.resolve(dir,target);
      if (path.isAbsolute(target) || !inside(boundary, lexical)) {
        fail(`符号链接必须位于资源包内: ${path.relative(ROOT, full)}`);
        continue;
      }
      // Resolve one component at a time, rejecting escapes before further reads.
      let next = path.relative(boundary, lexical).split(path.sep);
      let resolved = boundary, hops = 0;
      while (next.length) {
        const component = next.shift();
        if (!component) continue;
        resolved = path.join(resolved, component);
        const stat = fs.lstatSync(resolved, {throwIfNoEntry:false});
        if (!stat) { fail(`失效的符号链接: ${path.relative(ROOT,full)}`); break; }
        if (stat.isSymbolicLink()) {
          const text = fs.readlinkSync(resolved);
          const dest = path.resolve(path.dirname(resolved),text);
          if (++hops > 40 || path.isAbsolute(text) || !inside(boundary,dest)) {
            fail(`符号链接目标越界或循环: ${path.relative(ROOT,full)}`);
            break;
          }
          next = [...path.relative(boundary,dest).split(path.sep),...next];
          resolved = boundary;
        }
      }
    }
  }
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function parseArgs(argv) {
  const opts = { all: false, prFiles: null, prAuthor: "", approvers: [], admins: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") opts.all = true;
    else if (a === "--root") opts.root = argv[++i];
    else if (a === "--owners-file") opts.ownersFile = argv[++i];
    else if (a === "--pr-files") opts.prFiles = argv[++i];
    else if (a === "--pr-author") opts.prAuthor = (argv[++i] || "").trim().toLowerCase();
    else if (a === "--approvers") opts.approvers = (argv[++i] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === "--admins") opts.admins = (argv[++i] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return opts;
}

function loadTaxonomy() {
  const taxPath = path.join(ROOT, "taxonomy.json");
  if (!fs.existsSync(taxPath)) {
    fail("缺少根目录 taxonomy.json");
    return { industries: new Set(), positions: new Set() };
  }
  const tax = readJson(taxPath, "taxonomy.json");
  if (!tax) return { industries: new Set(), positions: new Set() };
  const industries = new Set((tax.industries || []).map((x) => x.code));
  const positions = new Set((tax.positions || []).map((x) => x.code));
  if (industries.size === 0) fail("taxonomy.json 至少需要定义 1 个行业");
  if (positions.size === 0) fail("taxonomy.json 至少需要定义 1 个岗位");
  return { industries, positions };
}

function discoverItems() {
  const items = new Map();
  for (const [catDir, expected] of Object.entries(CATEGORY_MAP)) {
    const absCat = path.join(ROOT, catDir);
    if (!fs.existsSync(absCat)) continue;
    if (!fs.lstatSync(absCat).isDirectory()) { fail(`${catDir} 必须是普通目录`); continue; }
    for (const entry of fs.readdirSync(absCat, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const slug = entry.name;
      const id = `${catDir}/${slug}`;
      const absDir = path.join(absCat, slug);
      items.set(id, { id, catDir, slug, absDir, expected });
    }
  }
  return items;
}

function validateSkillStandard(id, absDir) {
  const skillPath = path.join(absDir, "SKILL.md");
  if (!fs.existsSync(skillPath) || !fs.lstatSync(skillPath).isFile()) {
    fail(`${id}: skill 类型必须遵守 Agent Skills 行业规范，在目录根部提供普通文件 SKILL.md`);
    return;
  }
  const raw = fs.readFileSync(skillPath, "utf8");
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!fmMatch) {
    fail(`${id}/SKILL.md: 缺少标准 YAML Frontmatter（需以 --- 包裹并包含 name、description）`);
    return;
  }
  const [, frontmatter, body] = fmMatch;
  const hasName = /^\s*name\s*:\s*\S+/m.test(frontmatter);
  const hasDesc = /^\s*description\s*:\s*\S+/m.test(frontmatter);
  if (!hasName) fail(`${id}/SKILL.md: YAML Frontmatter 缺少必填字段 name`);
  if (!hasDesc) fail(`${id}/SKILL.md: YAML Frontmatter 缺少必填字段 description`);
  if (!body.trim()) fail(`${id}/SKILL.md: Frontmatter 之后缺少 Skill 指令正文`);
}

function validateMcpStandard(id, absDir) {
  const mcpPath = path.join(absDir, "mcp.json");
  if (!fs.existsSync(mcpPath) || !fs.lstatSync(mcpPath).isFile()) {
    fail(`${id}: mcp 类型必须遵守标准声明规范，在目录根部提供普通文件 mcp.json`);
    return;
  }
  const cfg = readJson(mcpPath, `${id}/mcp.json`);
  if (!cfg) return;
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object" || Array.isArray(cfg.mcpServers)) {
    fail(`${id}/mcp.json: 必须包含标准 mcpServers 对象`);
    return;
  }
  const entries = Object.entries(cfg.mcpServers);
  if (entries.length === 0) {
    fail(`${id}/mcp.json: mcpServers 至少需要声明 1 个服务`);
    return;
  }
  for (const [serverName, def] of entries) {
    if (!def || typeof def !== "object" || Array.isArray(def)) {
      fail(`${id}/mcp.json: mcpServers.${serverName} 必须为对象`);
      continue;
    }
    const hasCommand = typeof def.command === "string" && def.command.trim().length > 0;
    const hasUrl = typeof def.url === "string" && /^https?:\/\//i.test(def.url.trim());
    if (!hasCommand && !hasUrl) {
      fail(`${id}/mcp.json: mcpServers.${serverName} 必须声明 command（stdio）或合法的 http(s) url（远程）`);
    }
    if (def.args !== undefined) {
      if (!Array.isArray(def.args) || def.args.some((a) => typeof a !== "string")) {
        fail(`${id}/mcp.json: mcpServers.${serverName}.args 必须为字符串数组`);
      } else if (def.args.some((a) => /@latest(?=$|[/?#])/i.test(a))) {
        fail(`${id}/mcp.json: mcpServers.${serverName}.args 禁止使用 @latest，请锁定精确版本号以保证评测可复现`);
      }
    }
  }
}

function validateItem(item, taxonomy, allIds, released) {
  const { id, slug, absDir, expected } = item;
  if (!SLUG_RE.test(slug)) {
    fail(`${id}: 目录名不合法，仅允许小写字母/数字/短横线且长度 3–64`);
  }

  const manifestPath = path.join(absDir, "manifest.json");
  const readmePath = path.join(absDir, "readme.md");
  if (!fs.existsSync(manifestPath)) fail(`${id}: 缺少必填文件 manifest.json`);
  if (!fs.existsSync(readmePath)) fail(`${id}: 缺少必填文件 readme.md`);

  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath, `${id}/manifest.json`) : null;
  if (manifest) {
    if (manifest.schema_version !== "1.0") fail(`${id}: schema_version 必须为 "1.0"`);
    if (manifest.id !== id) fail(`${id}: manifest.id (${manifest.id}) 必须与目录路径 "${id}" 一致`);
    if (manifest.type !== expected.type) fail(`${id}: type 必须为 "${expected.type}"`);
    if (manifest.market_group !== expected.group) fail(`${id}: market_group 必须为 "${expected.group}"`);
    if (!manifest.name || typeof manifest.name !== "string") fail(`${id}: 缺少有效 name`);
    if (!manifest.summary || typeof manifest.summary !== "string") fail(`${id}: 缺少有效 summary`);
    if (!manifest.owner_github || typeof manifest.owner_github !== "string") fail(`${id}: 缺少有效 owner_github`);
    if (!validVersion(manifest.version)) fail(`${id}: version (${manifest.version}) 必须符合 SemVer，市场版本不含构建元数据`);

    if (expected.type === "identity") {
      if (!["ai_managed", "user_custom", "both"].includes(manifest.identity_mode)) {
        fail(`${id}: identity 必须声明合法 identity_mode (ai_managed|user_custom|both)`);
      }
    }

    for (const ind of manifest.industries || []) {
      if (!taxonomy.industries.has(ind)) fail(`${id}: industries 包含未在 taxonomy.json 登记的值 "${ind}"`);
    }
    for (const pos of manifest.positions || []) {
      if (!taxonomy.positions.has(pos)) fail(`${id}: positions 包含未在 taxonomy.json 登记的值 "${pos}"`);
    }

    if (Object.hasOwn(manifest, "core_checks")) fail(`${id}: core_checks 由题包生成`);
    if (expected.type === "scenario") {
      const definitionFiles = walkFiles(absDir);
      const entry = manifest.entrypoints?.scenario ?? "scenario.json";
      if (!definitionFiles.includes(path.join(absDir, "scenario.json"))) {
        fail(`${id}: scenario 类型必须包含普通文件 scenario.json`);
      }
      const entryPath = typeof entry === "string" ? path.resolve(absDir, entry) : "";
      if (!definitionFiles.includes(entryPath)) {
        fail(`${id}: 情景入口必须是资源包内的普通文件`);
      } else {
        const definition = readJson(entryPath, `${id}/${entry}`);
        try {
          scenarioCoreChecks(definition);
        } catch (error) {
          fail(`${id}/${entry}: ${error.message}`);
        }
      }
    }

    if (expected.type === "skill") {
      validateSkillStandard(id, absDir);
    }

    if (expected.type === "mcp") {
      validateMcpStandard(id, absDir);
    }

    // 校验 entrypoints 文件存在性
    for (const [k, rel] of Object.entries(manifest.entrypoints || {})) {
      if (typeof rel !== "string" || path.isAbsolute(rel) || !inside(absDir, path.resolve(absDir,rel)) || !fs.existsSync(path.join(absDir, rel))) {
        fail(`${id}: entrypoints.${k} 指向的文件不存在 (${rel})`);
      }
    }

    // 校验内部依赖存在性
    const deps = [];
    for (const list of Object.values(manifest.dependencies || {})) {
      if (!Array.isArray(list)) continue;
      for (const depId of list) {
        deps.push(depId);
        const locked = released.get(id + "@" + manifest.version)?.dependency_lock;
        if (!allIds.has(depId) && !locked?.some(pin => pin.id === depId)) {
          fail(`${id}: 依赖的内部资源 "${depId}" 不存在于仓库中`);
        }
      }
    }
    item.deps = deps;
    item.manifest = manifest;
  }

  // 扫描图片体积与敏感密钥
  for (const file of walkFiles(absDir)) {
    const rel = path.relative(absDir, file).replaceAll("\\", "/");
    const ext = path.extname(file).toLowerCase();
    if (rel.startsWith("photo/")) {
      const st = fs.statSync(file);
      if (st.size > MAX_IMAGE_BYTES) {
        fail(`${id}/${rel}: 图片体积 ${(st.size / 1024 / 1024).toFixed(2)}MB 超出 2MB 限制`);
      }
    }
    if (TEXT_EXTS.has(ext)) {
      const content = fs.readFileSync(file, "utf8");
      for (const rule of SECRET_PATTERNS) {
        if (rule.re.test(content)) {
          fail(`${id}/${rel}: 疑似包含敏感密钥或明文凭据 (${rule.name})，已拦截`);
        }
      }
    }
  }
}

function checkCycles(items) {
  const visiting = new Set();
  const visited = new Set();
  function dfs(id, trail) {
    if (visiting.has(id)) {
      fail(`检测到循环依赖: ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = items.get(id);
    for (const dep of node?.deps || []) {
      if (items.has(dep)) dfs(dep, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of items.keys()) dfs(id, []);
}

function checkPrGovernance(opts, items) {
  if (!opts.prFiles) return;
  const fileList = fs.readFileSync(opts.prFiles, "utf8");
  const changed = fileList.split(fileList.includes("\0") ? "\0" : /\r?\n/).filter(Boolean);

  for (const f of changed) {
    if (GENERATED_ROOT_FILES.has(f)) {
      fail(`禁止在 PR 中手工修改自动生成文件: ${f}`);
    }
  }

  if (!opts.admins.length) {
    fail("MARKET_ADMINS 尚未配置：投稿审批不能完成");
    return;
  }
  const protectedChange = f => f.startsWith(".github/") || f.startsWith("scripts/");
  const isSubmission = f => Object.hasOwn(CATEGORY_MAP, f.split("/")[0]) || f === "rollbacks.json";
  if (changed.some(protectedChange) && changed.some(isSubmission)) {
    fail("投稿内容和市场校验/发布规则应分别提交 PR");
  }
  const ownersPath = opts.ownersFile || path.join(ROOT, "owners.json");
  const owners = fs.existsSync(ownersPath) ? readJson(ownersPath, "owners.json") || {} : {};
  const adminSet = new Set(opts.admins);
  const approverSet = new Set(opts.approvers);
  const reviewAdmins = [...approverSet].filter(a => a !== opts.prAuthor && adminSet.has(a));
  if (!reviewAdmins.length) fail("需平台管理员审阅并批准当前 PR 提交");

  const touchedItemIds = new Set();
  for (const f of changed) {
    const parts = f.split("/");
    if (parts.length >= 2 && CATEGORY_MAP[parts[0]]) {
      touchedItemIds.add(`${parts[0]}/${parts[1]}`);
    }
  }

  for (const itemId of touchedItemIds) {
    const existingOwner = (owners[itemId] || "").toLowerCase();
    const item = items.get(itemId);
    if (existingOwner) {
      // 修改或删除已有资源：必须 Owner（作者本人提交或已 Approve）+ Admin 双审
      const platformOwned = existingOwner === "official";
      const ownerApproved = platformOwned ? reviewAdmins.length > 0 : opts.prAuthor === existingOwner || approverSet.has(existingOwner);
      if (!ownerApproved) {
        fail(`${itemId}: 修改已有资源必须获得原创建者 @${existingOwner} 的 Approve`);
      }
      if (!reviewAdmins.some(a => a !== existingOwner)) {
        fail(`${itemId}: 修改已有资源必须获得平台 Admin 的 Approve（Owner + Admin 双审）`);
      }
      if (item?.manifest && item.manifest.owner_github.toLowerCase() !== existingOwner && !adminSet.has(opts.prAuthor)) {
        fail(`${itemId}: 禁止擅自变更 owner_github（原 owner 为 @${existingOwner}）`);
      }
    } else if (item?.manifest) {
      // 新增资源：非管理员提交时 owner_github 必须与 PR 作者一致
      if (opts.prAuthor && !adminSet.has(opts.prAuthor) && item.manifest.owner_github.toLowerCase() !== opts.prAuthor) {
        fail(`${itemId}: 新增资源的 manifest.owner_github (${item.manifest.owner_github}) 必须与 PR 提交者 @${opts.prAuthor} 一致`);
      }
    }
  }
}

if (opts.prFiles) {
  for (const cat of Object.keys(CATEGORY_MAP)) {
    const base=path.join(ROOT,cat);
    const stat=fs.lstatSync(base,{throwIfNoEntry:false});
    if (!stat) continue;
    if (!stat.isDirectory()) { fail(`${cat} 必须是普通目录`); continue; }
    for (const item of fs.readdirSync(base,{withFileTypes:true})) {
      if (item.isDirectory()) checkLinks(path.join(base,item.name));
      if (item.isSymbolicLink()) fail(`${cat}/${item.name} 必须是普通资源目录`);
    }
  }
  for (const name of ["taxonomy.json","manifest.json","owners.json","rollbacks.json"]) {
    if (fs.lstatSync(path.join(ROOT,name),{throwIfNoEntry:false})?.isSymbolicLink()) fail(`${name} 必须是普通文件`);
  }
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
}
const taxonomy = loadTaxonomy();
const items = discoverItems();
const allIds = new Set(items.keys());
const previousIndex = fs.existsSync(path.join(ROOT, "manifest.json"))
  ? readJson(path.join(ROOT, "manifest.json"), "manifest.json") : {};
const released = new Map((previousIndex?.releases || []).map(r => [r.id + "@" + r.version, r]));

for (const item of items.values()) {
  validateItem(item, taxonomy, allIds, released);
}
checkCycles(items);
checkPrGovernance(opts, items);

if (errors.length > 0) {
  console.error(`❌ 校验失败（共 ${errors.length} 项错误）：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`✅ 校验通过：共检查 ${items.size} 个资源包，无 Schema/依赖/密钥/权限违规。`);
