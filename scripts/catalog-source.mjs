import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { sha256, packageFilesHash } from "./catalog.mjs";

export const categories = [
  "identities",
  "secretaries",
  "teams",
  "skills",
  "mcps",
  "model-configs",
  "tool-adapters",
  "scenarios",
  "judges",
];

export function git(root, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: root,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}
export function gitJson(root, ref, file) {
  if (!git(root, ["ls-tree", ref, "--", file]).trim()) return null;
  return JSON.parse(git(root, ["show", ref + ":" + file]));
}

function listGitPackages(root, ref) {
  const groups = new Map();
  const records = git(root, [
    "ls-tree",
    "-r",
    "-z",
    ref,
    "--",
    ...categories,
  ]).split("\0");
  for (const line of records) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const [mode, type, object] = line.slice(0, tab).split(" ");
    const [cat, slug, ...rel] = line.slice(tab + 1).split("/");
    if (!slug || slug.startsWith(".") || !rel.length) continue;
    if (type !== "blob")
      throw Error("资源包不支持 Git 子模块: " + cat + "/" + slug);
    const id = cat + "/" + slug;
    if (!groups.has(id)) groups.set(id, []);
    groups
      .get(id)
      .push({
        path: rel.join("/"),
        mode,
        bytes: git(root, ["cat-file", "blob", object], null),
      });
  }
  return groups;
}

function listLocalPackages(root) {
  const groups = new Map();
  for (const cat of categories) {
    const base = path.join(root, cat);
    if (!fs.existsSync(base)) continue;
    for (const dir of fs.readdirSync(base, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
      const id = cat + "/" + dir.name,
        files = [];
      function walk(prefix) {
        for (const entry of fs.readdirSync(path.join(root, id, prefix), {
          withFileTypes: true,
        })) {
          if (entry.name === ".DS_Store") continue;
          const name = path.posix.join(prefix, entry.name),
            full = path.join(root, id, name);
          if (entry.isDirectory()) {
            walk(name);
            continue;
          }
          const stat = fs.lstatSync(full);
          if (!stat.isSymbolicLink() && !stat.isFile())
            throw Error("不支持的文件类型 " + full);
          const mode = stat.isSymbolicLink()
            ? "120000"
            : stat.mode & 0o100
              ? "100755"
              : "100644";
          const bytes = stat.isSymbolicLink()
            ? fs.readlinkSync(full, { encoding: "buffer" })
            : fs.readFileSync(full);
          files.push({ path: name, mode, bytes });
        }
      }
      walk("");
      groups.set(id, files);
    }
  }
  return groups;
}

// Version 1.0 local snapshots used this path+bytes hash. Reuse their source IDs
// only after matching their current files, then seal them with the stronger hash.
function oldLocalSha(files) {
  const sum = createHash("sha256");
  for (const f of [...files].sort((a, b) => {
    const aa = a.path.split("/"),
      bb = b.path.split("/");
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      const c = aa[i].localeCompare(bb[i]);
      if (c) return c;
    }
    return aa.length - bb.length;
  }))
    sum.update(f.path).update(f.bytes);
  return "local-" + sum.digest("hex").slice(0, 12);
}

function localJSON(root, file) {
  const full = path.join(root, file);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
}

export function readSnapshot(root, ref, prior) {
  const groups = ref ? listGitPackages(root, ref) : listLocalPackages(root);
  const packages = new Map();
  const legacy = new Map((prior?.items || []).map((i) => [i.id, i]));
  const now = new Date().toISOString();
  for (const [id, files] of groups) {
    const manifestFile = files.find((f) => f.path === "manifest.json");
    if (!manifestFile || manifestFile.mode === "120000")
      throw Error(id + " 缺少普通文件 manifest.json");
    const manifest = JSON.parse(manifestFile.bytes);
    const filesHash = packageFilesHash(files);
    const prev = legacy.get(id);
    packages.set(id, {
      manifest,
      filesHash,
      hasSkill: files.some((f) => f.path.startsWith("skill/")),
      commit() {
        if (ref)
          return git(root, ["log", "-1", "--format=%H", ref, "--", id]).trim();
        if (prev && !prior.releases && prev.version === manifest.version) {
          if (prev.commit_sha !== oldLocalSha(files))
            throw Error(id + " 本地旧基线内容已更改，请先还原原始文件完成迁移");
          return prev.commit_sha;
        }
        return "local-" + filesHash;
      },
      updatedAt(commit) {
        if (ref)
          return git(root, ["show", "-s", "--format=%cI", commit]).trim();
        return prev?.commit_sha === commit
          ? prev.updated_at
          : prior?.releases?.some((r) => r.commit_sha === commit)
            ? prior.generated_at
            : now;
      },
    });
  }
  const tax = ref
    ? git(root, ["show", ref + ":taxonomy.json"], null)
    : fs.readFileSync(path.join(root, "taxonomy.json"));
  const intents =
    (ref
      ? gitJson(root, ref, "rollbacks.json")
      : localJSON(root, "rollbacks.json")) || {};
  for (const [id, intent] of Object.entries(intents)) {
    if (!intent || typeof intent.reason !== "string" || !intent.reason.trim())
      throw Error(id + " 缺少回退原因");
  }
  return {
    packages,
    rollbackIntents: intents,
    taxonomySha: sha256(tax).slice(0, 16),
    head: ref || "local-uncommitted",
    time: ref ? git(root, ["show", "-s", "--format=%cI", ref]).trim() : now,
    repo: process.env.MARKET_REPO || prior?.repo || "org/ai-employee-market",
    mirror: process.env.MIRROR_BASE_URL ?? prior?.mirror_base_url ?? "",
  };
}

export function readLocalIndex(root) {
  return localJSON(root, "manifest.json");
}
