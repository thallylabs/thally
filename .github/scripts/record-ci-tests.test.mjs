/**
 * Keeps the `record` CI plan honest about which unit tests it may skip.
 *
 * A release-record promotion skips most of the unit suite, so the tests that
 * can observe one must still run. CI runs the vitest directories listed in
 * `RECORD_TEST_DIRECTORIES`. These tests fail when that list stops being
 * complete: when a workspace starts depending on a promoted package, when the
 * promotion tooling starts versioning another workspace, or when any test
 * outside those directories can reach the scaffold record files or the
 * lockfile through its imports.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

import { parse } from "yaml";

import { RECORD_BUMP_WORKSPACES, RECORD_TEST_DIRECTORIES } from "./plan-public-ci.mjs";

const ROOT = process.cwd();
const RECORD_WORKSPACE = "packages/create-thally-docs";
// The fields `bump-release-packages.mjs` follows to find publishable dependents.
const RELEASE_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const ALL_DEPENDENCY_FIELDS = [...RELEASE_DEPENDENCY_FIELDS, "devDependencies"];
// Files a promotion rewrites that code can read by name from anywhere.
const PROMOTED_FILE = /stable-scaffold-release\.json|previous-scaffold-releases\.json|package-lock\.json/;
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".next", ".git"]);

const workspaces = readdirSync("packages", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join("packages", entry.name, "package.json")))
  .map((entry) => ({
    directory: `packages/${entry.name}`,
    manifest: JSON.parse(readFileSync(join("packages", entry.name, "package.json"), "utf8")),
  }));

/** Workspaces that reach `seeds` through the given manifest fields. */
function dependentClosure(seeds, fields, include = () => true) {
  const selected = new Set(seeds);
  for (let changed = true; changed;) {
    changed = false;
    for (const { directory, manifest } of workspaces) {
      if (selected.has(directory) || !include(manifest)) continue;
      const names = fields.flatMap((field) => Object.keys(manifest[field] ?? {}));
      const reaches = workspaces.some((candidate) =>
        selected.has(candidate.directory) && names.includes(candidate.manifest.name));
      if (reaches) {
        selected.add(directory);
        changed = true;
      }
    }
  }
  return [...selected].sort();
}

/** Every source file under a directory, relative to the repository root. */
function sourceFiles(directory, found = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (SOURCE_FILE.test(entry.name)) found.push(path);
  }
  return found;
}

const IMPORT_SPECIFIER = new RegExp([
  String.raw`(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]`,
  String.raw`import\s*\(\s*['"]([^'"]+)['"]\s*\)`,
  String.raw`import\s*['"]([^'"]+)['"]`,
  String.raw`require\(\s*['"]([^'"]+)['"]\s*\)`,
  String.raw`vi\.(?:mock|doMock|importActual|importMock)\(\s*['"]([^'"]+)['"]`,
].join("|"), "g");

/** Resolve one import specifier to a repository file or a workspace. */
function resolveSpecifier(importer, specifier) {
  if (specifier.startsWith("@/")) return resolveSpecifier("src/index.ts", `./${specifier.slice(2)}`);
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(importer), specifier);
    const candidates = [
      target,
      target.replace(/\.js$/, ".ts"),
      target.replace(/\.js$/, ".tsx"),
      target.replace(/\.mjs$/, ".mts"),
      `${target}.ts`,
      `${target}.tsx`,
      `${target}.mts`,
      `${target}.mjs`,
      join(target, "index.ts"),
      join(target, "index.tsx"),
    ];
    const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    return file ? relative(ROOT, file) : null;
  }
  const workspace = workspaces.find(({ manifest }) =>
    specifier === manifest.name || specifier.startsWith(`${manifest.name}/`));
  return workspace ? `workspace:${workspace.directory}` : null;
}

const files = ["src", "scripts", "packages"].flatMap((directory) => sourceFiles(directory));
const graph = new Map(files.map((file) => {
  const text = readFileSync(file, "utf8");
  const targets = new Set();
  for (const match of text.matchAll(IMPORT_SPECIFIER)) {
    const target = resolveSpecifier(file, match.slice(1).find(Boolean));
    if (target) targets.add(target);
  }
  return [file, { targets, readsPromotedFile: PROMOTED_FILE.test(text) }];
}));

const isTestFile = (file) => /\.test\.(?:ts|tsx)$/.test(file);
const workspaceReach = new Map();

/**
 * Whether a file can observe a promoted file through its imports. Importing a
 * workspace by package name is treated as importing all of its sources, since
 * that resolves to a bundle built from them.
 */
function reachesPromotedFile(file, seen = new Set()) {
  if (file.startsWith("workspace:")) {
    const directory = file.slice("workspace:".length);
    if (!workspaceReach.has(directory)) {
      workspaceReach.set(directory, false);
      workspaceReach.set(directory, files
        .filter((candidate) => candidate.startsWith(`${directory}/src/`) && !isTestFile(candidate))
        .some((candidate) => reachesPromotedFile(candidate)));
    }
    return workspaceReach.get(directory);
  }
  if (seen.has(file)) return false;
  seen.add(file);
  const node = graph.get(file);
  if (!node) return false;
  return node.readsPromotedFile || [...node.targets].some((target) => reachesPromotedFile(target, seen));
}

const ciWorkflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const vitestConfig = readFileSync("vitest.config.ts", "utf8");
const inRecordDirectories = (file) =>
  RECORD_TEST_DIRECTORIES.some((directory) => file.startsWith(directory));

test("record promotions version exactly the workspaces the bump tooling selects", () => {
  // bump-release-packages.mjs: the record workspace plus its publishable
  // dependents through the published dependency fields.
  assert.deepEqual(
    [...RECORD_BUMP_WORKSPACES].sort(),
    dependentClosure([RECORD_WORKSPACE], RELEASE_DEPENDENCY_FIELDS, (manifest) => manifest.private !== true),
  );
  // The root application, and so the skipped Worker build, depends on none of them.
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  const rootDependencies = ALL_DEPENDENCY_FIELDS.flatMap((field) => Object.keys(root[field] ?? {}));
  for (const { directory, manifest } of workspaces) {
    if (RECORD_BUMP_WORKSPACES.includes(directory)) {
      assert.ok(!rootDependencies.includes(manifest.name), `the root application depends on ${manifest.name}`);
    }
  }
});

test("record CI tests every workspace that depends on a promoted package", () => {
  assert.deepEqual(
    RECORD_TEST_DIRECTORIES.map((directory) => directory.replace(/\/$/, "")).sort(),
    dependentClosure(RECORD_BUMP_WORKSPACES, ALL_DEPENDENCY_FIELDS),
  );
  // A trailing slash keeps `packages/agent/` from also matching a sibling
  // such as `packages/agent-scan`, and vitest must collect those directories.
  assert.ok(RECORD_TEST_DIRECTORIES.every((directory) => /^packages\/[^/]+\/$/.test(directory)));
  assert.match(vitestConfig, /'packages\/\*\/src\/\*\*\/\*\.test\.ts'/);
});

test("the record CI job runs exactly the record test directories under the required gate", () => {
  const job = ciWorkflow.jobs.record;
  const step = job.steps.find((candidate) => candidate.name === "Test release-record consumers");
  assert.equal(step.run, `npx vitest run ${RECORD_TEST_DIRECTORIES.join(" ")}`);
  assert.equal(step.if, "steps.plan.outputs.full != 'true' && steps.plan.outputs.mode != 'content'");
  // It is the only CI step that runs these tests without the shards, so its
  // result must reach the one required check.
  assert.ok(ciWorkflow.jobs.verify.needs.includes("record"));
  assert.equal(job.needs, undefined);
  assert.equal(job.if, undefined);
});

test("no test outside the record test directories can reach a promoted file", () => {
  const tests = files.filter(isTestFile);
  const reaching = tests.filter((file) => reachesPromotedFile(file));
  // Guard the scan itself: it must see the tests known to assert on the record.
  assert.ok(tests.length > 100, "the test scan found too few files");
  for (const known of [
    "packages/create-thally-docs/src/__tests__/scaffold-hygiene.test.ts",
    "packages/mcp/src/__tests__/scaffold-template.test.ts",
    "packages/cli/src/__tests__/starter.test.ts",
  ]) {
    assert.ok(reaching.includes(known), `the scan no longer reaches the record from ${known}`);
  }
  assert.deepEqual(
    reaching.filter((file) => !inRecordDirectories(file)),
    [],
    "these tests can observe a release-record promotion but do not run in record CI; " +
      "add their workspace to RECORD_TEST_DIRECTORIES and the CI step",
  );
  // Every test file of a record directory is one vitest collects.
  for (const file of tests.filter(inRecordDirectories)) {
    assert.match(file, /^packages\/[^/]+\/src\/.+\.test\.ts$/, file);
  }
});

test("no source outside the record test directories names a promoted file", () => {
  // Reading a promoted file by path, rather than by import, is invisible to
  // the import scan above, so no code outside the tested workspaces may do it.
  const offenders = files.filter((file) =>
    !inRecordDirectories(file) && graph.get(file).readsPromotedFile);
  assert.deepEqual(offenders, []);
});
