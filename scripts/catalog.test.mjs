import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { validVersion, compareVersions, scenarioCoreChecks } from "./catalog.mjs";

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
  function pkg(id, version, deps = []) {
    write(id + "/manifest.json", {
      id,
      version,
      compat: { desktop_min: "1.0.0" },
      dependencies: { skills: deps },
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

test("pinned scenario releases derive core checks from their own scenario file", (t) => {
  const { root, init, pkg, build, read, write, commit } = fixture(t);
  init();
  const id = "scenarios/delivery";
  const file = id + "/scenario.json";
  const scenario = (checks) => ({ payload: { acceptance: { auto_checks: checks } } });
  pkg(id, "1.0.0");
  write(file, scenario([{ id: "deliver" }]));
  commit("unmarked legacy scenario");
  build("--git");
  const oldRelease = read().releases[0];
  assert.equal(Object.hasOwn(oldRelease, "core_checks"), false);
  commit("legacy catalog");

  pkg(id, "1.1.0");
  write(file, scenario([{ id: "deliver", core_for: ["team", "identity"] }, { id: "layout" }]));
  const source = commit("mark delivery as core");
  build("--git");
  const releases = read().releases;
  assert.deepEqual(releases[0], oldRelease);
  assert.deepEqual(releases[1].core_checks, {deliver: ["identity", "team"]});
  assert.equal(releases[1].commit_sha, source);
  commit("catalog with scoped checks");

  write(file, scenario([{ id: "deliver", core_for: ["identity"] }]));
  commit("attempt to change published grading");
  assert.throws(() => build("--git"), /不可覆盖/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, id, "manifest.json")));
  write(id + "/manifest.json", { ...manifest, version: "1.2.0", core_checks: { layout: ["team"] } });
  commit("attempt to inject generated metadata");
  assert.throws(() => build("--git"), /core_checks 由题包生成/);
});

test("a core check has an unambiguous ID and a nonempty set of formal subject types", () => {
  const parse = auto_checks => scenarioCoreChecks({ payload: { acceptance: { auto_checks } } });
  for (const core_for of [null, [], "team", ["member"], ["team", "team"]]) {
    assert.throws(() => parse([{id: "delivery", core_for}]), /core_for/);
  }
  assert.throws(() => parse([{id: "x"}, {id: "x", core_for: ["team"]}]), /唯一/);
  assert.equal(parse([{id: "legacy"}]), undefined);
});
