const ALLOWED_LICENSES = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0",
  "GPL-3.0-only", "GPL-3.0-or-later", "AGPL-3.0-only", "CC-BY-4.0", "CC0-1.0",
]);
const EXECUTABLE_CATEGORIES = new Set(["skills", "mcps", "tool-adapters"]);

function externalSourceError(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return "external_source 必须是包含仓库地址和提交 SHA 的对象";
  }
  const { repo_url, repo_path, commit_sha } = source;
  // Match the raw URL so URL parser normalization cannot hide extra segments.
  const repo = typeof repo_url === "string" &&
    /^https:\/\/github\.com\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/([a-zA-Z0-9_.-]+)\/?$/.exec(repo_url);
  if (!repo || [".", "..", ".git"].includes(repo[1])) {
    return "external_source.repo_url 必须是 https://github.com/owner/repo 仓库地址";
  }
  if (repo_path !== undefined && repo_path !== "") {
    if (typeof repo_path !== "string" || /[\\%?#:\x00-\x1f\x7f]/.test(repo_path) ||
        repo_path.split("/").some(part => !part || part === "." || part === "..")) {
      return "external_source.repo_path 必须是仓库内的相对子目录";
    }
  }
  if (typeof commit_sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit_sha)) {
    return "external_source.commit_sha 必须是 40 或 64 位小写十六进制提交 SHA";
  }
  return null;
}

function checkPermissions(permissions, errors) {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    errors.push("permissions 必须是权限声明对象");
    return;
  }
  for (const name of ["shell", "network"]) {
    if (typeof permissions[name] !== "boolean") errors.push(`permissions.${name} 必须是布尔值`);
  }
  if (!["none", "workspace", "full"].includes(permissions.filesystem)) {
    errors.push("permissions.filesystem 必须是 none、workspace 或 full");
  }
  if (Object.hasOwn(permissions, "env") && (!Array.isArray(permissions.env) ||
      !permissions.env.every(name => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))) {
    errors.push("permissions.env 只允许填写环境变量名的数组，严禁填写变量值");
  }
  if (Object.hasOwn(permissions, "notes") && typeof permissions.notes !== "string") {
    errors.push("permissions.notes 必须是字符串");
  }
}

// hasFile checks the exact name against the source being reviewed (worktree or Git tree).
export function packageAdmissionErrors(id, manifest, hasFile) {
  const errors = [];
  if (!ALLOWED_LICENSES.has(manifest.license)) {
    errors.push("license 必须是市场白名单中的 SPDX 许可证标识");
  }
  if (EXECUTABLE_CATEGORIES.has(id.split("/")[0]) || Object.hasOwn(manifest, "permissions")) {
    checkPermissions(manifest.permissions, errors);
  }
  const readme = manifest.entrypoints?.readme;
  if (!["readme.md", "README.md"].includes(readme) || !hasFile(readme)) {
    errors.push("entrypoints.readme 必须与包内实际文件 readme.md 或 README.md 完全一致");
  }
  if (Object.hasOwn(manifest, "external_source")) {
    const error = externalSourceError(manifest.external_source);
    if (error) errors.push(error);
  }
  return errors;
}
