import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { validVersion, compareVersions } from "./catalog.mjs";

const buildScript = fileURLToPath(
  new URL("./build-manifest.mjs", import.meta.url),
);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "market-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, data) => {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
      full,
      typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
    );
  };
  function pkg(id, version, deps = [], overrides = {}) {
    write(id + "/manifest.json", {
      id,
      version,
      license: "MIT",
      permissions: { shell: false, network: false, filesystem: "none" },
      entrypoints: { readme: "readme.md" },
      compat: { desktop_min: "1.0.0" },
      dependencies: { skills: deps },
      ...overrides,
    });
    write(id + "/readme.md", id + "\n");
  }
  const read = () =>
    JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  function build(...args) {
    const res = spawnSync(
      process.execPath,
      [buildScript, "--repo", root, ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          MARKET_REPO: "example/market",
          MIRROR_BASE_URL: "",
        },
      },
    );
    if (res.status !== 0) throw Error(res.stderr || res.stdout);
    return res.stdout;
  }
  write("taxonomy.json", { version: "1.0" });
  return {
    root,
    write,
    pkg,
    read,
    git,
    commit,
    build,
    init() {
      git("init", "-qb", "main");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "Market test");
      git("config", "core.filemode", "true");
    },
  };
}

const taxonomyFile = new URL("../taxonomy.json", import.meta.url);
function admissionFixture(t) {
  const { root, write } = fixture(t);
  write("taxonomy.json", fs.readFileSync(taxonomyFile, "utf8"));
  const gearTypes = { skills: "skill", mcps: "mcp", "tool-adapters": "tool_adapter", "model-configs": "model_config" };
  function item(id, overrides = {}, readme = "readme.md") {
    write(id + "/manifest.json", {
      schema_version: "1.0", id, type: gearTypes[id.split("/")[0]], market_group: "gear",
      version: "1.0.0", name: "Test package", summary: "Market admission", owner_github: "test-author",
      license: "MIT", industries: ["software"], positions: [], tags: ["自由标签"],
      entrypoints: { readme: "readme.md" }, ...overrides,
    });
    if (readme) write(id + "/" + readme, "Test package");
  }
  function validate() {
    const script = fileURLToPath(new URL("./validate.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--all", "--root", root], { encoding: "utf8" });
    assert.ifError(result.error);
    return result;
  }
  return { item, validate };
}

test("taxonomy keeps established industries and maps core positions; a submission may use only industry and free tags", t => {
  const taxonomy = JSON.parse(fs.readFileSync(taxonomyFile));
  const industries = new Set(taxonomy.industries.map(entry => entry.code));
  const positions = new Map(taxonomy.positions.map(entry => [entry.code, entry.industry]));
  const expected = {
    software: ["developer", "product-manager", "qa-engineer", "ui-designer", "devops-engineer", "data-analyst"],
    "content-media": ["xhs-operator"],
    ecommerce: ["ecommerce-operator", "growth-marketer", "customer-service"],
    general: ["executive-secretary", "research-analyst", "general-assistant"],
  };
  for (const [industry, roles] of Object.entries(expected)) {
    assert.ok(industries.has(industry), industry);
    for (const role of roles) assert.equal(positions.get(role), industry, role);
  }
  const { item, validate } = admissionFixture(t);
  item("model-configs/free-tags", { industries: ["ecommerce"], positions: [], tags: ["独立站选品"] });
  const accepted = validate();
  assert.equal(accepted.status, 0, accepted.stderr);
  item("model-configs/unknown-role", { positions: ["new-specialty"] });
  const rejected = validate();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /unknown-role: positions/);
});

test("a single allowlisted SPDX license identifier is mandatory", t => {
  const { item, validate } = admissionFixture(t);
  for (const license of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0",
    "GPL-3.0-only", "GPL-3.0-or-later", "AGPL-3.0-only", "CC-BY-4.0", "CC0-1.0"]) {
    item("model-configs/license-" + license.toLowerCase().replaceAll(".", "-"), { license });
  }
  const accepted = validate();
  assert.equal(accepted.status, 0, accepted.stderr);
  const cases = [undefined, "", "Proprietary", "mit", "MIT OR ISC", ["MIT"]];
  cases.forEach((license, i) => item("model-configs/unlicensed-" + i, { license }));
  const rejected = validate();
  assert.equal(rejected.status, 1);
  cases.forEach((_, i) => assert.ok(rejected.stderr.includes("unlicensed-" + i + ": license"), rejected.stderr));
});

test("executable categories require explicit shell, network and filesystem permissions; env contains names only", t => {
  const { item, validate } = admissionFixture(t);
  const minimal = { shell: false, network: false, filesystem: "none" };
  item("skills/no-access", { permissions: minimal });
  item("mcps/workspace-access", { permissions: {
    shell: false, network: true, filesystem: "workspace", env: ["API_TOKEN", "_region2"], notes: "项目服务认证",
  } });
  item("tool-adapters/full-access", { permissions: { shell: true, network: false, filesystem: "full", env: [] } });
  item("model-configs/no-declaration");
  const accepted = validate();
  assert.equal(accepted.status, 0, accepted.stderr);

  const categories = ["skills", "mcps", "tool-adapters"];
  categories.forEach(cat => item(cat + "/missing-permissions"));
  const cases = [
    [null, "permissions"], [[], "permissions"],
    [{ ...minimal, shell: undefined }, "permissions.shell"], [{ ...minimal, shell: 0 }, "permissions.shell"],
    [{ ...minimal, network: undefined }, "permissions.network"], [{ ...minimal, network: "false" }, "permissions.network"],
    [{ ...minimal, filesystem: undefined }, "permissions.filesystem"], [{ ...minimal, filesystem: "home" }, "permissions.filesystem"],
    [{ ...minimal, env: "TOKEN" }, "permissions.env"], [{ ...minimal, env: ["TOKEN=value"] }, "permissions.env"],
    [{ ...minimal, env: ["1BAD"] }, "permissions.env"], [{ ...minimal, env: [1] }, "permissions.env"],
    [{ ...minimal, notes: false }, "permissions.notes"],
  ];
  cases.forEach(([permissions], i) => item("skills/bad-permission-" + i, { permissions }));
  const rejected = validate();
  assert.equal(rejected.status, 1);
  categories.forEach(cat => assert.ok(rejected.stderr.includes(cat + "/missing-permissions: permissions"), rejected.stderr));
  cases.forEach(([, field], i) => assert.ok(rejected.stderr.includes("bad-permission-" + i + ": " + field), rejected.stderr));
});

test("README entrypoint must match one of the two supported filenames exactly", t => {
  const { item, validate } = admissionFixture(t);
  item("model-configs/lowercase");
  item("model-configs/uppercase", { entrypoints: { readme: "README.md" } }, "README.md");
  const accepted = validate();
  assert.equal(accepted.status, 0, accepted.stderr);
  const cases = [
    ["README.md", "readme.md"], ["readme.md", "README.md"], ["Readme.md", "Readme.md"],
    ["readme.md", null], ["guide.md", "guide.md"], [undefined, "README.md"],
  ];
  cases.forEach(([readme, actual], i) => item("model-configs/bad-readme-" + i, { entrypoints: { readme } }, actual));
  const rejected = validate();
  assert.equal(rejected.status, 1);
  cases.forEach((_, i) => assert.ok(rejected.stderr.includes("bad-readme-" + i + ": entrypoints.readme"), rejected.stderr));
});

test("external source requires an HTTPS GitHub repository, confined optional path and complete lowercase SHA", t => {
  const { item, validate } = admissionFixture(t);
  const source = { repo_url: "https://github.com/Example-Org/Tool_Kit.v2", commit_sha: "12ab".repeat(10) };
  item("model-configs/repo-root", { external_source: source });
  item("model-configs/explicit-root", { external_source: { ...source, repo_path: "" } });
  item("model-configs/subdirectory", { external_source: { ...source, repo_path: "packages/工具", commit_sha: "ab".repeat(32) } });
  const accepted = validate();
  assert.equal(accepted.status, 0, accepted.stderr);

  const cases = [[null, "external_source"], [[], "external_source"]];
  const badFields = {
    repo_url: [undefined, "http://github.com/org/repo", "https://other.test/org/repo",
      "https://github.com.other.test/org/repo", "https://github.com@other.test/org/repo",
      "https://person@github.com/org/repo", "https://github.com:444/org/repo", "https://github.com/org",
      "https://github.com/org/..", "https://github.com/a/../org/repo", "https://github.com/org/repo/tree/main",
      "https://github.com/org/repo?ref=main", "https://github.com/org/repo#main"],
    repo_path: [null, 2, "/outside", "../outside", "dir/../../outside", "C:/outside", "dir\\outside",
      "dir/%2e%2e/outside", "dir/%252e%252e", "a//b", "dir\u0000x"],
    commit_sha: [undefined, "main", "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65),
      "A".repeat(40), "g".repeat(64), "f".repeat(40) + "\n"],
  };
  for (const [field, values] of Object.entries(badFields)) {
    for (const value of values) cases.push([{ ...source, [field]: value }, "external_source." + field]);
  }
  cases.forEach(([external_source], i) => item("model-configs/bad-source-" + i, { external_source }));
  const rejected = validate();
  assert.equal(rejected.status, 1);
  cases.forEach(([, field], i) => assert.ok(rejected.stderr.includes("bad-source-" + i + ": " + field), rejected.stderr));
});

test("semver, numeric precedence and prerelease", () => {
  for (const v of [
    "1.0",
    "v1.0.0",
    "01.0.0",
    "1.0.0-01",
    "1.0.0+ci",
    "1.0.0-a..b",
    "1.0.0\n",
  ])
    assert.equal(validVersion(v), false, v);
  assert.equal(validVersion("1.0.0-beta.10"), true);
  assert.ok(compareVersions("1.10.0", "1.2.9") > 0);
  assert.ok(compareVersions("1.0.0-beta.10", "1.0.0-beta.2") > 0);
  assert.ok(
    compareVersions("900719925474099300.0.0", "900719925474099299.0.0") > 0,
  );
  assert.ok(compareVersions("1.0.0", "1.0.0-rc.1") > 0);
});

test("external listings preserve both the market record and its pinned upstream source", (t) => {
  const { root, pkg, build, read } = fixture(t);
  const id = "skills/external-tool";
  const repo = "https://github.com/example/upstream";
  const firstPin = "a".repeat(40), nextPin = "b".repeat(64);
  function list(version, source) {
    pkg(id, version, [], { external_source: source });
  }
  list("1.0.0", { repo_url: repo, repo_path: "tools/widget", commit_sha: firstPin });
  build();
  const initial = read();
  for (const row of [initial.items[0], initial.releases[0]]) {
    assert.equal(row.source, "external");
    assert.equal(row.repo_url, repo);
    assert.equal(row.repo_path, "tools/widget");
    assert.equal(row.external_commit_sha, firstPin);
    assert.equal(row.path, id);
    assert.match(row.commit_sha, /^local-/);
  }
  build();
  assert.deepEqual(read(), initial);
  list("1.0.0", { repo_url: repo, commit_sha: nextPin });
  assert.throws(() => build(), /不可覆盖/);
  list("1.0.1", { repo_url: repo, commit_sha: "main" });
  assert.throws(() => build(), /external_source/);
  list("1.0.1", { repo_url: repo, commit_sha: nextPin });
  build();
  const updated = read();
  assert.equal(updated.items[0].repo_path, "");
  assert.equal(updated.items[0].external_commit_sha, nextPin);
  assert.notEqual(updated.items[0].content_sha256, initial.items[0].content_sha256);
  assert.deepEqual(updated.releases[0], initial.releases[0]);
  fs.rmSync(path.join(root, id), { recursive: true });
  build();
  assert.deepEqual(read().items, []);
  assert.deepEqual(read().releases, updated.releases);
});

test("top-level source fields cannot override the reviewed package origin", (t) => {
  const { pkg, build, read } = fixture(t);
  const id = "skills/local-tool";
  pkg(id, "1.0.0", [], {
    source: "external",
    repo_url: "https://github.com/example/elsewhere",
    repo_path: "overridden",
    external_commit_sha: "a".repeat(40),
  });
  build();
  const catalog = read();
  assert.equal(catalog.items[0].source, "official");
  for (const row of [catalog.items[0], catalog.releases[0]]) {
    for (const field of ["repo_url", "repo_path", "external_commit_sha"])
      assert.equal(Object.hasOwn(row, field), false);
  }
});

test("Git builds and replay enforce admission at the candidate commit before sealing a version", t => {
  const { init, pkg, build, read, commit } = fixture(t);
  init();
  const id = "skills/tool";
  pkg(id, "1.0.0");
  commit("valid package");
  build("--git");
  const base = commit("published catalog");

  pkg(id, "2.0.0", [], { license: undefined, permissions: undefined, entrypoints: { readme: "README.md" } });
  const rejected = commit("incomplete release");
  pkg(id, "2.0.0"); // The corrected worktree must not influence a Git build.
  assert.throws(() => build("--check", "--git", "--base-ref", base), error =>
    ["license", "permissions", "entrypoints.readme"].every(field => error.message.includes(field)));

  const accepted = commit("complete the same unpublished version");
  build("--git", "--base-ref", rejected);
  assert.deepEqual(read().releases.map(r => r.version), ["1.0.0", "2.0.0"]);
  assert.equal(read().releases[1].commit_sha, accepted);
});

test("protected pre-ledger releases migrate without applying new admission rules retroactively", t => {
  const { init, pkg, write, build, read, commit } = fixture(t);
  init();
  const id = "skills/tool";
  pkg(id, "1.0.0", [], { permissions: undefined });
  const original = commit("legacy package");
  write("manifest.json", { schema_version: "1.0", head_sha: original, items: [{ id, version: "1.0.0" }] });
  commit("protected pre-ledger publication");
  build("--git");
  const migrated = read();
  assert.equal(migrated.releases[0].commit_sha, original);
  commit("publish migrated ledger");
  build("--git");
  assert.deepEqual(read(), migrated);
  pkg(id, "1.0.1", [], { permissions: undefined });
  commit("new invalid package version");
  assert.throws(() => build("--git"), /permissions/);
});

test("content, rename, executable bit and untracked local edits", (t) => {
  const { root, pkg, build, read, write } = fixture(t);
  const id = "skills/tool";
  pkg(id, "1.0.0");
  write(id + "/run", "echo hello\n");
  build();
  const first = read();
  build();
  assert.deepEqual(read(), first);
  fs.chmodSync(path.join(root, id, "run"), 0o755);
  assert.throws(() => build(), /不可覆盖/);
  fs.chmodSync(path.join(root, id, "run"), 0o644);
  fs.renameSync(path.join(root, id, "run"), path.join(root, id, "runner"));
  assert.throws(() => build(), /不可覆盖/);
  fs.renameSync(path.join(root, id, "runner"), path.join(root, id, "run"));
  write(id + "/run", "echo goodbye\n");
  assert.throws(() => build(), /不可覆盖/);
  assert.deepEqual(read(), first);
});

test("transitive locks stay pinned across dependency updates and resolve on a new package version", (t) => {
  const { pkg, build, read } = fixture(t);
  const a = "skills/alpha",
    b = "skills/bravo",
    c = "teams/charlie";
  pkg(a, "1.0.0");
  pkg(b, "1.0.0", [a]);
  pkg(c, "1.0.0", [b]);
  build();
  const first = read();
  const oldC = first.items.find((i) => i.id === c);
  assert.deepEqual(
    oldC.dependency_lock.map((p) => p.id),
    [a, b],
  );
  pkg(a, "1.1.0");
  build();
  assert.deepEqual(
    read().items.find((i) => i.id === c),
    oldC,
  );
  pkg(b, "1.1.0", [a]);
  pkg(c, "2.0.0", [b]);
  build();
  assert.deepEqual(
    read()
      .items.find((i) => i.id === c)
      .dependency_lock.map((p) => p.version),
    ["1.1.0", "1.1.0"],
  );
  assert.deepEqual(
    first.releases.find((r) => r.id === c),
    read().releases.find((r) => r.id === c && r.version === "1.0.0"),
  );
});

test("deleted versions cannot be reused; rollback is explicit, persistent, and restores the original commit", (t) => {
  const { root, pkg, build, read, write, git, init, commit } = fixture(t);
  init();
  const id = "skills/tool";
  pkg(id, "1.0.0");
  const original = commit("initial");
  build("--git");
  commit("catalog");
  const first = read();
  assert.equal(first.releases[0].commit_sha, original);
  pkg(id, "1.1.0");
  commit("release 1.1");
  build("--git");
  commit("catalog 1.1");
  fs.rmSync(path.join(root, id), { recursive: true });
  commit("delist");
  build("--git");
  commit("catalog delisted");
  assert.equal(read().items.length, 0);
  assert.equal(read().releases.length, 2);
  pkg(id, "1.0.0");
  write(id + "/readme.md", "different");
  commit("conflicting resurrection");
  assert.throws(() => build("--git"), /不可覆盖/);
  write(id + "/readme.md", id + "\n");
  commit("original files");
  assert.throws(() => build("--git"), /降版/);
  write("rollbacks.json", {
    [id]: { from_version: "1.1.0", to_version: "1.0.0", reason: "恢复兼容性" },
  });
  commit("reviewed rollback");
  build("--git");
  const rolled = read();
  assert.equal(rolled.items[0].commit_sha, original);
  assert.equal(rolled.rollbacks.length, 1);
  commit("catalog rollback");
  build("--git");
  assert.deepEqual(read(), rolled);
  pkg(id, "1.2.0");
  write("rollbacks.json", {});
  commit("new fixed version");
  build("--git");
  commit("catalog 1.2");
  assert.deepEqual(read().rollbacks, rolled.rollbacks);
  pkg(id, "1.1.0");
  commit("attempt resurrection");
  assert.throws(() => build("--git"), /已被回退撤回/);
});

test("PR and publisher compare against protected history despite competing merges and edited generated files", (t) => {
  const { root, init, pkg, build, read, write, git, commit } = fixture(t);
  init();
  const id = "skills/tool";
  pkg(id, "1.0.0");
  commit("initial");
  build("--git");
  commit("catalog");
  pkg(id, "2.0.0");
  write(id + "/readme.md", "first bytes");
  const protectedHead = commit("first merge not indexed yet");
  write(id + "/readme.md", "different same version");
  const collision = commit("second merge");
  assert.throws(
    () => build("--base-ref", protectedHead, "--check"),
    /不可覆盖/,
  );
  assert.throws(() => build("--git"), /不可覆盖/);
  pkg(id, "2.0.1");
  commit("fix version");
  build("--base-ref", collision);
  assert.ok(
    read().releases.some(
      (r) => r.version === "2.0.0" && r.commit_sha === protectedHead,
    ),
  );
  const generated = commit("catalog 2.0.1");
  const tampered = read();
  tampered.releases = [];
  write("manifest.json", tampered);
  write(id + "/readme.md", "still different");
  commit("PR with fabricated history");
  assert.throws(() => build("--base-ref", generated, "--check"), /不可覆盖/);
});
