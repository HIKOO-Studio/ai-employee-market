#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeCatalog } from "./catalog.mjs";
import {
  categories,
  git,
  gitJson,
  readLocalIndex,
  readSnapshot,
} from "./catalog-source.mjs";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2);
function option(name) {
  const pos = args.indexOf(name);
  if (pos < 0) return null;
  if (!args[pos + 1] || args[pos + 1].startsWith("--"))
    throw Error(name + " 缺少值");
  return args[pos + 1];
}
const root = path.resolve(option("--repo") || defaultRoot);
const pretty = (data) => JSON.stringify(data, null, 2) + "\n";
const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const paths = [...categories, "taxonomy.json", "rollbacks.json"];
const revision = (ref) =>
  git(root, ["rev-parse", "--verify", ref + "^{commit}"]).trim();

function advance(ref, prior) {
  return makeCatalog(readSnapshot(root, ref, prior), prior);
}

function protectedBaseline(ref) {
  const checked = gitJson(root, ref, "manifest.json");
  let previous, anchor;
  if (checked?.catalog_revision && shaPattern.test(checked.head_sha)) {
    // Import only the protected branch's generated index, never the PR copy.
    anchor = revision(checked.head_sha);
    git(root, ["merge-base", "--is-ancestor", anchor, ref]);
    previous = checked;
  } else {
    // Migrate published (pre-ledger) manifests, including versions later removed.
    const commits = git(root, [
      "log",
      "--first-parent",
      "--reverse",
      "--format=%H",
      ref,
      "--",
      "manifest.json",
    ])
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const commit of commits) {
      const legacy = gitJson(root, commit, "manifest.json");
      if (!legacy) continue;
      anchor = shaPattern.test(legacy.head_sha)
        ? revision(legacy.head_sha)
        : commit;
      git(root, ["merge-base", "--is-ancestor", anchor, ref]);
      previous = advance(anchor, previous);
    }
    if (!anchor) {
      [anchor] = git(root, [
        "log",
        "--first-parent",
        "--reverse",
        "--format=%H",
        ref,
        "--",
        "taxonomy.json",
      ])
        .trim()
        .split(/\s+/);
      if (!anchor) return null;
      previous = advance(anchor, null);
    }
  }
  // Catch accepted changes even when two merges land before the publishing job.
  // A failed intermediate source commit was never released. A corrected tip can
  // publish, but a later commit cannot replace an earlier valid (id,version).
  const commits = git(root, [
    "rev-list",
    "--first-parent",
    "--reverse",
    anchor + ".." + ref,
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const commit of commits) {
    const changes = git(root, [
      "diff",
      "--name-only",
      commit + "^1",
      commit,
      "--",
      ...paths,
    ]);
    if (!changes) continue;
    try {
      previous = advance(commit, previous);
    } catch (error) {
      if (error.code || error.status !== undefined) throw error;
      console.warn(
        "已跳过未通过发布校验的历史提交 " +
          commit.slice(0, 12) +
          ": " +
          error.message,
      );
    }
  }
  return previous;
}

function build() {
  const base = option("--base-ref");
  let catalog;
  if (base || args.includes("--git") || fs.existsSync(path.join(root, ".git"))) {
    const head = revision(option("--source-ref") || "HEAD");
    const baseRef = revision(base || head);
    git(root, ["merge-base", "--is-ancestor", baseRef, head]);
    catalog = advance(head, protectedBaseline(baseRef));
    if (
      !shaPattern.test(catalog.head_sha) ||
      catalog.releases.some((r) => !shaPattern.test(r.commit_sha))
    ) {
      throw Error("正式发布必须由可解析的 Git 提交生成");
    }
  } else {
    if (process.env.GITHUB_ACTIONS === "true")
      throw Error("CI 必须传入 --git 或 --base-ref");
    const local = readLocalIndex(root);
    if (
      local?.releases?.some((r) => !r.commit_sha.startsWith("local-")) ||
      (local?.head_sha && shaPattern.test(local.head_sha))
    )
      throw Error("权威索引请用 --git 生成");
    catalog = makeCatalog(
      readSnapshot(root, null, local),
      local?.releases ? local : null,
    );
  }
  if (!args.includes("--check")) {
    const owners = Object.fromEntries(
      catalog.items.map((item) => [item.id, item.owner_github]),
    );
    fs.writeFileSync(path.join(root, "owners.json"), pretty(owners));
    fs.writeFileSync(path.join(root, "manifest.json"), pretty(catalog));
  }
  console.log(
    "市场目录 #" +
      catalog.catalog_revision +
      "，当前 " +
      catalog.item_count +
      " 项，历史 " +
      catalog.releases.length +
      " 版",
  );
}
try {
  build();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
