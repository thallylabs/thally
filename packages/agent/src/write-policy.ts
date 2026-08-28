/**
 * Closed write authority for evidence-backed documentation-agent runs.
 *
 * The product-change context is untrusted and may try to broaden the model's
 * scope. A controller-supplied policy therefore names the exact repository
 * paths and change identifiers one run must cover. Tool calls are checked
 * before mutation and the final Git tree is checked again before any result
 * can leave the sandbox.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

import type { DocumentationDecision } from "./types.js";

import {
  MAX_AGENT_WRITE_POLICY_FILE_BYTES,
  parseAgentWritePolicy,
  type AgentWritePolicy,
} from "./write-policy-contract.js";

export {
  parseAgentWritePolicy,
  type AgentWritePolicy,
  type AgentWritePolicyV1,
  type AgentWritePolicyV2,
} from "./write-policy-contract.js";

const MAX_PATH_BYTES = 512;

function safeRepositoryPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES
  ) {
    return null;
  }
  const normalized = posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(normalized) ||
    normalized
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.toLowerCase() === ".git",
      )
  ) {
    return null;
  }
  return normalized;
}

/** Read one controller-created policy file without silently truncating it. */
export function readAgentWritePolicyFile(
  path: string,
): Readonly<AgentWritePolicy> {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    throw new Error("agent_write_policy_invalid");
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size === 0 ||
    metadata.size > MAX_AGENT_WRITE_POLICY_FILE_BYTES
  ) {
    throw new Error("agent_write_policy_invalid");
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength !== metadata.size) {
    throw new Error("agent_write_policy_invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("agent_write_policy_invalid");
  }
  const policy = parseAgentWritePolicy(decoded);
  if (!policy) throw new Error("agent_write_policy_invalid");
  return policy;
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    Boolean(fromRoot) &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function isSafeToolTarget(
  projectDir: string,
  path: string,
  allowMissingLeaf: boolean,
): boolean {
  const root = realpathSync(projectDir);
  const absolute = resolve(root, path);
  if (!isInside(root, absolute)) return false;
  if (existsSync(absolute)) {
    const metadata = lstatSync(absolute);
    return (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      isInside(root, realpathSync(absolute))
    );
  }
  if (!allowMissingLeaf) return false;
  let ancestor = dirname(absolute);
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor))
    ancestor = dirname(ancestor);
  if (!isInside(root, ancestor) && ancestor !== root) return false;
  const metadata = lstatSync(ancestor);
  return (
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    (ancestor === root || isInside(root, realpathSync(ancestor)))
  );
}

function pageTargets(
  projectDir: string,
  pageId: unknown,
  isCreate: boolean,
): Array<string> | null {
  if (typeof pageId !== "string" || !/^[a-zA-Z0-9\-/]+$/.test(pageId))
    return null;
  if (isCreate) {
    const targets = [`src/content/${pageId}.mdx`, "docs.json"];
    return isSafeToolTarget(projectDir, targets[0]!, true) &&
      isSafeToolTarget(projectDir, targets[1]!, false)
      ? targets
      : null;
  }
  const candidates = [
    `src/content/${pageId}.mdx`,
    `src/content/${pageId}/index.mdx`,
  ];
  const existing = candidates.filter((path) =>
    isSafeToolTarget(projectDir, path, false),
  );
  return existing.length === 1 ? existing : null;
}

function apiTarget(projectDir: string, source: unknown): Array<string> | null {
  if (typeof source !== "string") return null;
  const path = safeRepositoryPath(source.trim().replace(/^\/+/, ""));
  return path &&
    /\.(?:json|ya?ml)$/i.test(path) &&
    isSafeToolTarget(projectDir, path, false)
    ? [path]
    : null;
}

/** Resolve the deterministic repository paths one write tool can mutate. */
export function agentWriteToolTargets(
  projectDir: string,
  name: string,
  input: Record<string, unknown>,
): Array<string> | null {
  switch (name) {
    case "add_page":
      return pageTargets(projectDir, input.pageId, true);
    case "update_page":
    case "replace_page_text":
      return pageTargets(projectDir, input.pageId, false);
    case "update_api_spec":
      // Policy-bound runs require an explicit configured source. The generic
      // tool may infer a sole source, but inference is too ambiguous for an
      // immutable controller plan.
      return apiTarget(projectDir, input.source);
    case "add_tab":
      return isSafeToolTarget(projectDir, "docs.json", false)
        ? ["docs.json"]
        : null;
    case "list_pages":
    case "read_page":
    case "search_docs":
    case "get_context":
    case "read_api_spec":
      return [];
    default:
      // A newly exposed agent tool gets no write authority until this closed
      // projection explicitly classifies its side effects.
      return null;
  }
}

/** Check one model-requested write against the controller's exact path set. */
export function isAgentWriteToolAuthorized(input: {
  projectDir: string;
  name: string;
  toolInput: Record<string, unknown>;
  policy: Readonly<AgentWritePolicy>;
}): boolean {
  let targets: Array<string> | null;
  try {
    targets = agentWriteToolTargets(
      input.projectDir,
      input.name,
      input.toolInput,
    );
  } catch {
    return false;
  }
  if (targets === null) return false;
  const allowed = new Set(input.policy.requiredPaths);
  return targets.every((path) => allowed.has(path));
}

function git(cwd: string, args: Array<string>): Buffer {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("agent_write_policy_git_failed");
  }
}

function nulStrings(bytes: Buffer): Array<string> {
  return bytes.toString("utf8").split("\0").filter(Boolean);
}

function projectRelativeGitPaths(
  projectDir: string,
  paths: Array<string>,
): Array<string> {
  const rawPrefix = git(projectDir, ["rev-parse", "--show-prefix"])
    .toString("utf8")
    .replace(/\r?\n$/u, "");
  const prefix =
    rawPrefix === ""
      ? ""
      : rawPrefix.endsWith("/")
        ? rawPrefix
        : `${rawPrefix}/`;
  if (prefix && !safeRepositoryPath(prefix.slice(0, -1))) {
    throw new Error("agent_write_policy_git_failed");
  }
  return paths.map((repositoryPath) => {
    const projectPath =
      prefix === ""
        ? repositoryPath
        : repositoryPath.startsWith(prefix)
          ? repositoryPath.slice(prefix.length)
          : "";
    const safePath = safeRepositoryPath(projectPath);
    if (!safePath) throw new Error("agent_write_policy_git_failed");
    return safePath;
  });
}

function changedRepositoryPaths(projectDir: string): Array<string> {
  // Disable rename detection so a move is always represented by both its
  // deletion and addition. A policy that authorizes only the new path cannot
  // thereby hide removal of an unplanned source file.
  const tracked = nulStrings(
    git(projectDir, [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      "HEAD",
      "--",
    ]),
  );
  const untracked = nulStrings(
    git(projectDir, ["ls-files", "--others", "--exclude-standard", "-z", "--"]),
  );
  // Git always reports repository-root paths, even when the pathspec is scoped
  // from a nested project. Write tools and their immutable policy deliberately
  // use project-relative paths, so remove the verified Git prefix exactly once.
  return [
    ...new Set(projectRelativeGitPaths(projectDir, [...tracked, ...untracked])),
  ].sort();
}

/**
 * Assert the final branch is the exact bounded patch authorized by the plan.
 * This second gate protects against future tool side effects that are broader
 * than their current deterministic target projection.
 */
export function assertAgentWritePolicySatisfied(
  projectDir: string,
  policy: Readonly<AgentWritePolicy>,
  decision: DocumentationDecision,
): void {
  const changeIds = [...decision.changeIds].sort();
  const hasValidChangeIds =
    policy.version === 1
      ? changeIds.length === policy.requiredChangeIds.length &&
        changeIds.every((id, index) => id === policy.requiredChangeIds[index])
      : changeIds.length > 0 &&
        new Set(changeIds).size === changeIds.length &&
        changeIds.every((id) => policy.requiredChangeIds.includes(id));
  if (!hasValidChangeIds) {
    throw new Error("agent_write_policy_change_ids_mismatch");
  }
  const changedPaths = changedRepositoryPaths(projectDir);
  if (decision.outcome === "abstained") {
    if (changedPaths.length !== 0)
      throw new Error("agent_write_policy_abstention_dirty");
    // A revision action exists only to advance the current PR with a concrete
    // reviewer-requested edit. Treat a clean abstention as a failed no-op so a
    // controller cannot mistake it for an applied revision.
    if (policy.version === 2)
      throw new Error("agent_write_policy_revision_noop");
    return;
  }
  const hasValidPaths =
    policy.version === 1
      ? changedPaths.length === policy.requiredPaths.length &&
        changedPaths.every(
          (path, index) => path === policy.requiredPaths[index],
        )
      : changedPaths.length > 0 &&
        changedPaths.length <= policy.maximumFiles &&
        changedPaths.every((path) => policy.requiredPaths.includes(path));
  if (!hasValidPaths || changedPaths.length > policy.maximumFiles) {
    throw new Error("agent_write_policy_paths_mismatch");
  }
  let totalBytes = 0;
  const root = realpathSync(projectDir);
  for (const path of changedPaths) {
    const absolute = resolve(root, path);
    let resolved: string;
    try {
      resolved = realpathSync(absolute);
    } catch {
      throw new Error("agent_write_policy_file_invalid");
    }
    const fromRoot = relative(root, absolute);
    if (
      !fromRoot ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      !existsSync(absolute) ||
      !lstatSync(absolute).isFile() ||
      lstatSync(absolute).isSymbolicLink() ||
      !isInside(root, resolved)
    ) {
      throw new Error("agent_write_policy_file_invalid");
    }
    totalBytes += lstatSync(absolute).size;
    if (totalBytes > policy.maximumBytes)
      throw new Error("agent_write_policy_bytes_exceeded");
  }
}
