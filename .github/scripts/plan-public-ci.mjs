/**
 * Choose how much of public CI a pull request needs. Every plan fails closed.
 *
 * - `full`    — the default for every runtime, contract, dependency, or unknown
 *               change, and when no comparison is requested (no base commit,
 *               as on a manual dispatch).
 * - `content` — only known prose and static image files changed. Broad unit
 *               tests are skipped; the managed artifact is still built so
 *               authored MDX is compiled and packaged.
 * - `record`  — the diff is *proven by content* to be a scaffold release-record
 *               promotion: the exact edit `promote-release.yml` generates and
 *               nothing else. Changed paths alone never select this mode,
 *               because a pull request that edits a package manifest could
 *               otherwise skip the tests. The proof rebuilds the expected
 *               bytes of every manifest, the lockfile, and both record files
 *               from the base commit and requires the candidate to equal
 *               them.
 *
 * What `record` skips, and why that is safe: a promotion changes no source
 * file, so most of the unit suite would re-test the tree its base already
 * passed. The tests that can observe a promotion are the ones belonging to
 * the workspaces whose manifests or bundled records change and to the
 * workspaces that depend on them. CI runs exactly those directories
 * (`RECORD_TEST_DIRECTORIES`) in `record` mode, so a record the suite would
 * reject cannot pass the required check. The whole suite still gates
 * publication: `publish-packages.yml` runs it on the merged record commit in
 * test shards that its attestation and publication jobs both need, so nothing
 * is attested or published unless every shard passed.
 *
 * Every plan reads both sides from git objects, never the working tree, so a
 * checkout that converts line endings (the Windows CI job) plans the same.
 *
 * Errors never choose a plan. Several CI jobs each compute this plan for the
 * same commits, and each skips work the others are trusted to do. A plan that
 * depended on whether a git command happened to succeed could therefore
 * differ between jobs: one job falling back to `full` would skip the
 * record-mode tests while the others planned `record` and skipped the full
 * suite, and every job would pass. So the planner separates two kinds of
 * failure:
 *
 * - Content the proof rejects (a file that is not valid JSON, a missing or
 *   non-regular file, any deviation) is a property of the commits. Every job
 *   reads the same bytes and reaches the same answer, so it plans `full`.
 * - A git command that fails for a requested comparison (unknown or missing
 *   objects, shallow history, an unreadable tree) is a property of one
 *   job's environment. The planner exits non-zero without writing outputs,
 *   so that job fails, the required gate fails, and a re-run recovers.
 *
 * As a result, every job that succeeds planned the same mode.
 */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { isMainModule } from "./main-module.mjs";

const LOCKFILE = "package-lock.json";
const STABLE_RECORD = "packages/create-thally-docs/src/stable-scaffold-release.json";
const PREVIOUS_RECORDS = "packages/create-thally-docs/src/previous-scaffold-releases.json";
const SCAFFOLD_MANIFEST = "packages/create-thally-docs/package.json";
const WORKSPACE_MANIFEST = /^packages\/[^/]+\/package\.json$/;

/**
 * The only workspaces a promotion may version: the package that bundles the
 * scaffold records and the publishable packages that depend on it. This is
 * the closure `bump-release-packages.mjs` computes; a structural test keeps
 * the two equal. A bump of any other workspace (for example
 * `@thallylabs/core`, which the root application and its managed Worker
 * bundle depend on) is not a promotion and plans `full`.
 */
export const RECORD_BUMP_WORKSPACES = Object.freeze([
  "packages/cli",
  "packages/create-thally-docs",
  "packages/mcp",
]);

/**
 * Vitest directories CI runs in `record` mode: every workspace above plus
 * every workspace that depends on one of them, publishable or not. Their
 * tests are the ones that read the record files, the bumped manifests, or
 * the packages built from them. A structural test fails when a test outside
 * these directories can reach the record files.
 */
export const RECORD_TEST_DIRECTORIES = Object.freeze([
  "packages/agent/",
  "packages/cli/",
  "packages/create-thally-docs/",
  "packages/mcp/",
]);

// The per-release fields of a scaffold record. Every other field must be
// carried over from the outgoing record unchanged.
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Every path a promotion writes is an ordinary non-executable file.
const REGULAR_FILE = "100644 blob";
// The fields `bump-release-packages.mjs` rewrites. A workspace pin anywhere
// else (for example devDependencies) is not part of a promotion.
const PIN_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
// Strict stable semver: no prerelease, build metadata, or leading zeros.
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// The lockfile is larger than Node's default 1 MiB child-process buffer.
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;

const isContentPath = (path) =>
  /^src\/content\/.+\.mdx?$/.test(path) ||
  /^public\/.+\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/.test(path) ||
  /^(?:README|CHANGELOG)\.md$/.test(path);

const isRecordPath = (path) =>
  path === LOCKFILE || path === STABLE_RECORD || path === PREVIOUS_RECORDS ||
  WORKSPACE_MANIFEST.test(path);

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The exact bytes the promotion tooling writes for a JSON value. The bump
 * script, the record script, and npm all serialise with two-space indentation
 * and a trailing newline. Comparing candidate bytes with this pins key order
 * and rejects duplicate keys, comments, or any other text a parser would
 * silently discard.
 */
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Promotions only ever add one to the patch number of a stable version. */
function isPatchBump(baseVersion, headVersion) {
  const base = STABLE_VERSION.exec(baseVersion ?? "");
  const head = STABLE_VERSION.exec(headVersion ?? "");
  return Boolean(base && head) && base[1] === head[1] && base[2] === head[2] &&
    BigInt(head[3]) === BigInt(base[3]) + 1n;
}

/**
 * Rebuild the record a promotion would write from the outgoing record and
 * the candidate's per-release identifiers. Returns `null` unless those
 * identifiers are well formed and mutually consistent. Because everything
 * else comes from the outgoing record, a candidate with a different shape,
 * an extra or missing key, a changed `starterVersion`, repository, or
 * contract version cannot equal the result.
 */
function promoteRecord(baseStable, headStable) {
  if (!isPlainObject(headStable) || !isPlainObject(headStable.source) || !isPlainObject(headStable.runtime)) return null;
  if (!isPlainObject(baseStable.source) || !isPlainObject(baseStable.runtime)) return null;
  const { id, source, runtime } = headStable;
  if (typeof id !== "string") return null;
  for (const sha of [source.commitSha, source.treeSha, runtime.commitSha, runtime.treeSha]) {
    if (typeof sha !== "string" || !COMMIT_SHA.test(sha)) return null;
  }
  if (typeof source.manifestSha256 !== "string" || !SHA256.test(source.manifestSha256)) return null;
  const [date, starterPrefix, runtimePrefix, ...rest] = id.split(".");
  if (rest.length > 0 || !RELEASE_DATE.test(date ?? "")) return null;
  if (starterPrefix !== source.commitSha.slice(0, 8) || runtimePrefix !== runtime.commitSha.slice(0, 8)) return null;
  const next = structuredClone(baseStable);
  next.id = id;
  next.source.commitSha = source.commitSha;
  next.source.treeSha = source.treeSha;
  next.source.archiveUrl = `https://codeload.github.com/${baseStable.source.repository}/tar.gz/${source.commitSha}`;
  next.source.manifestSha256 = source.manifestSha256;
  next.runtime.commitSha = runtime.commitSha;
  next.runtime.treeSha = runtime.treeSha;
  return next;
}

/**
 * Apply a promotion to one base manifest or lockfile workspace entry: set its
 * new version and repin the bumped workspace packages it depends on to their
 * exact new versions. Everything else is carried over untouched, so any other
 * difference in the candidate (a script, a new dependency, an external
 * version, a range instead of an exact pin) fails the comparison.
 */
function promoteEntry(baseEntry, version, bumped) {
  const next = structuredClone(baseEntry);
  next.version = version;
  for (const field of PIN_FIELDS) {
    if (!isPlainObject(next[field])) continue;
    for (const name of Object.keys(next[field])) {
      if (bumped.has(name)) next[field][name] = bumped.get(name);
    }
  }
  return next;
}

/**
 * Prove that a diff is exactly one scaffold release-record promotion.
 *
 * `readers` supplies, for the comparison base and for the candidate:
 * `readBase`/`readHead` (the text of a repository path) and
 * `modeBase`/`modeHead` (its git tree entry as `"<mode> <type>"`, or `null`
 * when the path has no entry on that side). The mode check runs first and
 * covers every path the proof reads, so the content readers are only asked
 * for files that exist.
 *
 * A missing file, malformed JSON, or deviation of any kind returns `false`:
 * these are deterministic properties of the two commits. A git failure
 * (see `isGitFailure`) is rethrown, because it says nothing about the
 * commits and must not select a plan.
 */
export function isReleaseRecordPromotion(paths, readers) {
  try {
    const { readBase, readHead, modeBase, modeHead } = readers;
    if (paths.length === 0 || !paths.every(isRecordPath)) return false;
    if (!paths.includes(STABLE_RECORD) || !paths.includes(SCAFFOLD_MANIFEST)) return false;
    // Every file a promotion writes or this proof reads is a regular,
    // non-executable file on both sides: never a symlink, submodule, or a
    // manifest that gained an executable bit.
    for (const path of new Set([...paths, LOCKFILE, STABLE_RECORD, PREVIOUS_RECORDS])) {
      if (modeBase(path) !== REGULAR_FILE || modeHead(path) !== REGULAR_FILE) return false;
    }
    const base = (path) => JSON.parse(readBase(path));

    // 1. Every changed manifest is a patch bump of the same package, and
    //    only the workspaces a promotion versions are bumped.
    const manifests = paths.filter((path) => WORKSPACE_MANIFEST.test(path)).map((path) => ({
      path,
      workspace: path.slice(0, -"/package.json".length),
      base: base(path),
      head: JSON.parse(readHead(path)),
    }));
    const bumped = new Map();
    for (const manifest of manifests) {
      if (!RECORD_BUMP_WORKSPACES.includes(manifest.workspace)) return false;
      if (!isPlainObject(manifest.base) || !isPlainObject(manifest.head)) return false;
      if (typeof manifest.base.name !== "string" || manifest.base.name !== manifest.head.name) return false;
      if (!isPatchBump(manifest.base.version, manifest.head.version)) return false;
      if (bumped.has(manifest.head.name)) return false;
      bumped.set(manifest.head.name, manifest.head.version);
    }

    // 2. Each manifest is byte-for-byte its base with only the version and
    //    the exact pins on other bumped workspace packages replaced.
    for (const manifest of manifests) {
      const expected = promoteEntry(manifest.base, manifest.head.version, bumped);
      if (serialize(expected) !== readHead(manifest.path)) return false;
    }

    // 3. The lockfile is byte-for-byte its base with the same replacement
    //    applied to the bumped workspace entries only. Third-party entries,
    //    including every `resolved` URL and `integrity` hash, must be
    //    identical. This runs even when the lockfile is not in the diff, so
    //    manifests cannot be bumped without it.
    const expectedLock = base(LOCKFILE);
    for (const manifest of manifests) {
      const entry = expectedLock.packages?.[manifest.workspace];
      if (!isPlainObject(entry) || entry.version !== manifest.base.version) return false;
      expectedLock.packages[manifest.workspace] =
        promoteEntry(entry, manifest.head.version, bumped);
    }
    if (serialize(expectedLock) !== readHead(LOCKFILE)) return false;

    // 4. The records move exactly as `compute-scaffold-release.mjs` writes
    //    them: the outgoing stable record is prepended to the retained list
    //    (there is no retention cap), and the new record is the outgoing one
    //    with only its per-release identifiers replaced and an unused id.
    const baseStable = base(STABLE_RECORD);
    const basePrevious = base(PREVIOUS_RECORDS);
    if (!isPlainObject(baseStable) || !Array.isArray(basePrevious)) return false;
    const headStableText = readHead(STABLE_RECORD);
    const expectedStable = promoteRecord(baseStable, JSON.parse(headStableText));
    if (!expectedStable || serialize(expectedStable) !== headStableText) return false;
    if ([baseStable, ...basePrevious].some((record) => record?.id === expectedStable.id)) return false;
    return serialize([baseStable, ...basePrevious]) === readHead(PREVIOUS_RECORDS);
  } catch (error) {
    if (isGitFailure(error)) throw error;
    // Anything else (JSON syntax, an unexpected shape) is computed purely from
    // the commits' bytes, so every job reaches the same rejection.
    return false;
  }
}

/**
 * Return a fail-closed plan from the complete changed-path set.
 *
 * `readers` supplies the content and tree-entry readers the release-record
 * proof needs (see `isReleaseRecordPromotion`); without them a plan can only
 * be `content` or `full`. `worker` is `false` only for a proven record
 * promotion. The root application depends on `@thallylabs/core` alone, and a
 * promotion cannot bump it, so its managed Worker bundle would be
 * byte-for-byte the one the base commit already built.
 */
export function createPublicCiPlan(paths, readers) {
  const changedCount = paths.length;
  if (paths.length > 0 && paths.every(isContentPath)) {
    return { full: false, mode: "content", worker: true, changedCount };
  }
  if (readers && isReleaseRecordPromotion(paths, readers)) {
    return { full: false, mode: "record", worker: false, changedCount };
  }
  return { full: true, mode: "full", worker: true, changedCount };
}

// A well-formed commit id; the all-zero id is git's "no commit" placeholder.
const COMMIT_ID = /^[a-f0-9]{40}$/i;
const NO_COMMIT = /^0{40}$/;

/**
 * Wrap a failed git invocation. The proof rethrows these instead of treating
 * them as a rejected diff, and the command line exits non-zero on them.
 */
function gitFailure(arguments_, cause) {
  return Object.assign(
    new Error(`git ${arguments_[0]} failed, so the CI plan cannot be computed: ${cause?.message ?? cause}`, { cause }),
    { gitFailure: true },
  );
}

/** Whether `error` came from a git command rather than from the commits' content. */
export function isGitFailure(error) {
  return error?.gitFailure === true;
}

/** Whether `baseSha` requests a comparison at all. */
const requestsComparison = (baseSha) => COMMIT_ID.test(baseSha ?? "") && !NO_COMMIT.test(baseSha);

/**
 * List the paths that differ between the merge base of `baseSha` and the
 * candidate.
 *
 * No comparison is requested when `baseSha` is empty (a manual dispatch), not
 * a full commit id, or the all-zero placeholder; that returns no paths, which
 * plans `full`. These inputs come from the event, so every job sees the same
 * one. When a comparison is requested and git fails, this throws a git
 * failure: an unavailable comparison must never select a plan.
 */
export function changedPaths(baseSha, run = execFileSync, headRef = "HEAD") {
  if (!requestsComparison(baseSha)) return [];
  const arguments_ = ["diff", "--name-only", "--no-renames", "-z", `${baseSha}...${headRef}`];
  let output;
  try {
    output = run("git", arguments_,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: GIT_OUTPUT_LIMIT });
  } catch (error) {
    throw gitFailure(arguments_, error);
  }
  return output.split("\0").filter(Boolean);
}

/**
 * Readers for file content and tree entries on both sides of the same
 * comparison `changedPaths` lists: the merge base of `baseSha` and the
 * candidate, and the candidate commit itself (never the working tree, which
 * later CI steps modify).
 *
 * A path with no entry on one side is content: its mode reads as `null`.
 * Every git command that fails, and a merge base that is not a commit id,
 * throws a git failure.
 */
export function gitReaders(baseSha, run = execFileSync, headRef = "HEAD") {
  const git = (...arguments_) => {
    try {
      return run("git", arguments_,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: GIT_OUTPUT_LIMIT });
    } catch (error) {
      throw gitFailure(arguments_, error);
    }
  };
  let mergeBase;
  const comparisonBase = () => {
    if (!requestsComparison(baseSha)) throw new Error("No comparison was requested.");
    mergeBase ??= git("merge-base", baseSha, headRef).trim();
    if (!COMMIT_ID.test(mergeBase)) throw gitFailure(["merge-base"], new Error("no merge base"));
    return mergeBase;
  };
  // `git ls-tree` prints "<mode> <type> <object>\t<path>" for an exact path,
  // and nothing when the path does not exist in that commit.
  const treeEntry = (ref, path) => {
    const lines = git("ls-tree", ref, "--", path).split("\n").filter(Boolean);
    if (lines.length !== 1 || !lines[0].endsWith(`\t${path}`)) return null;
    return lines[0].split("\t")[0].split(" ").slice(0, 2).join(" ");
  };
  return {
    readBase: (path) => git("show", `${comparisonBase()}:${path}`),
    readHead: (path) => git("show", `${headRef}:${path}`),
    modeBase: (path) => treeEntry(comparisonBase(), path),
    modeHead: (path) => treeEntry(headRef, path),
  };
}

// Outputs are written only after the whole plan is known, so a failing run
// leaves none behind for a later step to misread.
if (isMainModule(import.meta.url)) {
  const baseSha = process.argv[2] ?? "";
  let plan;
  try {
    plan = createPublicCiPlan(changedPaths(baseSha), gitReaders(baseSha));
  } catch (error) {
    // exitCode rather than exit(), so the message is flushed on every platform.
    console.error(`::error::${error.message} Re-run the job; no plan was chosen.`);
    process.exitCode = 1;
  }
  if (plan) {
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT,
        `full=${plan.full}\nmode=${plan.mode}\nworker=${plan.worker}\n`);
    }
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  }
}
