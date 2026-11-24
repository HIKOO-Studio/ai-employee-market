import { createHash } from "node:crypto";

const numeric = /^(0|[1-9][0-9]*)$/;
export function validVersion(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.exec(
      value,
    );
  return (
    !!match &&
    (!match[4] ||
      match[4].split(".").every((p) => !/^[0-9]+$/.test(p) || numeric.test(p)))
  );
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function cmpNumeric(a, b) {
  return cmp(a.length, b.length) || cmp(a, b);
}

export function compareVersions(a, b) {
  if (!validVersion(a) || !validVersion(b))
    throw Error("无效的市场版本 " + a + " / " + b);
  const parts = (v) => /^([^-]+)(?:-(.+))?$/.exec(v).slice(1);
  const [coreA, preA] = parts(a),
    [coreB, preB] = parts(b);
  const an = coreA.split("."),
    bn = coreB.split(".");
  for (let i = 0; i < 3; i++) {
    const diff = cmpNumeric(an[i], bn[i]);
    if (diff) return diff;
  }
  if (!preA || !preB) return cmp(!preA, !preB);
  const ap = preA.split("."),
    bp = preB.split(".");
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    const x = ap[i],
      y = bp[i];
    if (x === y) continue;
    if (numeric.test(x) && numeric.test(y)) return cmpNumeric(x, y);
    if (numeric.test(x) !== numeric.test(y)) return numeric.test(x) ? -1 : 1;
    return cmp(x, y);
  }
  return cmp(ap.length, bp.length);
}

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const orderId = (a, b) => cmp(a.id, b.id);
const identity = (row) => row.id + "@" + row.version;
const contentHash = (filesHash, lock) =>
  sha256(JSON.stringify(["market-package-v1", filesHash, lock]));
// Only the versioned scenario may set grading policy for a formal subject.
export function scenarioCoreChecks(scenario) {
  const checks = scenario?.payload?.acceptance?.auto_checks;
  if (checks === undefined) return undefined;
  if (!Array.isArray(checks)) throw Error("auto_checks 必须为数组");
  const ids = new Set();
  const core = new Map();
  for (const check of checks) {
    if (typeof check?.id !== "string" || !check.id.trim() || check.id !== check.id.trim() || ids.has(check.id)) {
      throw Error("auto_checks 的 id 必须非空、无首尾空格且唯一");
    }
    ids.add(check.id);
    if (!Object.hasOwn(check, "core_for")) continue;
    const subjects = check.core_for;
    if (!Array.isArray(subjects) || !subjects.length ||
        subjects.some(value => value !== "identity" && value !== "team") ||
        new Set(subjects).size !== subjects.length) {
      throw Error(check.id + ".core_for 须为 identity、team 组成的非空、无重复数组");
    }
    core.set(check.id, [...subjects].sort());
  }
  return core.size ? Object.fromEntries(core) : undefined;
}

export function packageFilesHash(files) {
  const entries = [...files].sort((a, b) => cmp(a.path, b.path));
  return sha256(
    JSON.stringify(entries.map((f) => [f.path, f.mode, sha256(f.bytes)])),
  );
}

function dependencyLock(item, resolve) {
  const resolved = new Map();
  function add(pin) {
    const existing = resolved.get(pin.id);
    if (existing && identity(existing) !== identity(pin)) {
      throw Error(
        item.id +
          " 的传递依赖同时要求 " +
          identity(existing) +
          " 和 " +
          identity(pin),
      );
    }
    resolved.set(pin.id, pin);
  }
  for (const id of new Set(Object.values(item.dependencies || {}).flat())) {
    const dep = resolve(id);
    add({
      id,
      version: dep.version,
      commit_sha: dep.commit_sha,
      content_sha256: dep.content_sha256,
    });
    for (const pin of dep.dependency_lock) add(pin);
  }
  return [...resolved.values()].sort(orderId);
}

export function makeCatalog(snapshot, previous) {
  const history = new Map(
    (previous?.releases || []).map((r) => [identity(r), r]),
  );
  const current = new Map((previous?.items || []).map((i) => [i.id, i]));
  const maxVersion = new Map();
  for (const r of history.values()) {
    if (
      !maxVersion.has(r.id) ||
      compareVersions(r.version, maxVersion.get(r.id)) > 0
    )
      maxVersion.set(r.id, r.version);
  }
  const revision = (previous?.catalog_revision || 0) + 1;
  const rollbacks = [...(previous?.rollbacks || [])];
  const resolved = new Map(),
    resolving = new Set();
  function resolve(id) {
    if (resolved.has(id)) return resolved.get(id);
    if (resolving.has(id)) throw Error("循环依赖 " + id);
    const pkg = snapshot.packages.get(id);
    if (!pkg) throw Error("找不到依赖 " + id);
    const m = pkg.manifest,
      v = m.version;
    if (m.id !== id || !validVersion(v))
      throw Error(id + " 的 id / SemVer 不合法: " + v);
    const intent = snapshot.rollbackIntents[id];
    if (intent && intent.to_version !== v)
      throw Error(id + " 回退声明与当前版本不一致，请清除过期声明");
    resolving.add(id);
    const key = identity(m),
      sealed = history.get(key);
    const lock = sealed?.dependency_lock || dependencyLock(m, resolve);
    const digest = contentHash(pkg.filesHash, lock);
    if (sealed && sealed.content_sha256 !== digest) {
      throw Error(
        key + " 已发布，其文件内容、路径、模式和依赖锁不可覆盖；请提升资源版本",
      );
    }
    const highest = maxVersion.get(id);
    const from = current.get(id)?.version || highest;
    if (
      rollbacks.some(
        (r) =>
          r.id === id &&
          compareVersions(v, r.to_version) > 0 &&
          compareVersions(v, r.from_version) <= 0,
      )
    ) {
      throw Error(key + " 已被回退撤回，恢复推荐须发布新版本");
    }
    if (!sealed && highest && compareVersions(v, highest) <= 0) {
      throw Error(key + " 为新发行版，版本需高于已发布的 " + highest);
    }
    if (from && compareVersions(v, from) < 0) {
      if (
        !sealed ||
        intent?.from_version !== from ||
        intent?.to_version !== v ||
        !intent?.reason?.trim()
      ) {
        throw Error(
          key +
            " 降版须在 rollbacks.json 声明来源版本、目标版本和原因，且恢复原始发行内容",
        );
      }
      rollbacks.push({
        id,
        from_version: from,
        to_version: v,
        reason: intent.reason.trim(),
        revision,
      });
    }
    const row = sealed || {
      id,
      version: v,
      path: id,
      commit_sha: pkg.commit(),
      content_sha256: digest,
      dependency_lock: lock,
      ...(pkg.coreChecks && { core_checks: pkg.coreChecks }),
      compat: m.compat || {},
    };
    resolved.set(id, row);
    resolving.delete(id);
    history.set(key, row);
    return row;
  }

  const items = [];
  for (const id of [...snapshot.packages.keys()].sort()) {
    const pkg = snapshot.packages.get(id);
    const m = pkg.manifest,
      r = resolve(id);
    const { schema_version, ...meta } = m;
    items.push({
      ...meta,
      id,
      path: id,
      commit_sha: r.commit_sha,
      updated_at: pkg.updatedAt(r.commit_sha),
      identity_mode: m.identity_mode || null,
      industries: m.industries || [],
      positions: m.positions || [],
      tags: m.tags || [],
      compat: r.compat,
      model_tier_binding: m.model_tier_binding || null,
      dependencies: m.dependencies || {},
      entrypoints: m.entrypoints || {},
      has_skill: !!m.dependencies?.skills?.length || pkg.hasSkill,
      source: "official",
      content_sha256: r.content_sha256,
      dependency_lock: r.dependency_lock,
    });
  }
  const next = {
    schema_version: "1.1",
    repo: snapshot.repo,
    mirror_base_url: snapshot.mirror,
    taxonomy_sha: snapshot.taxonomySha,
    item_count: items.length,
    items,
    releases: [...history.values()].sort(
      (a, b) => orderId(a, b) || compareVersions(a.version, b.version),
    ),
    rollbacks: rollbacks.sort(
      (a, b) => a.revision - b.revision || orderId(a, b),
    ),
  };
  if (previous) {
    const { catalog_revision, generated_at, head_sha, ...old } = previous;
    if (JSON.stringify(old) === JSON.stringify(next)) return previous;
  }
  return {
    ...next,
    catalog_revision: revision,
    head_sha: snapshot.head,
    generated_at: snapshot.time,
  };
}
