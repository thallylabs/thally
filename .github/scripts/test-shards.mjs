/**
 * Split the Vitest suite across parallel CI jobs by recorded test time.
 *
 * Role: pull-request CI and the package release workflow run
 * `run <index>/<total>` once per matrix job, from the checkout under test. Every
 * job derives the same assignment from the same two inputs, so no coordinator
 * job sits on the critical path.
 *
 * Invariants:
 * - Vitest itself lists the candidate files (`vitest list`), so the include
 *   globs in `vitest.config.ts` stay the only definition of "a test file".
 * - Every discovered file lands in exactly one shard for any shard total. A
 *   file missing from the recorded timings still runs; timings only steer
 *   balance and never decide whether a test executes.
 * - The assignment is a pure function of the sorted file list and the
 *   committed timings, so concurrent jobs cannot disagree about ownership.
 * - A shard with no files exits successfully without starting Vitest, because
 *   Vitest given no file arguments runs the whole suite.
 *
 * The module imports nothing from node_modules; only `run` and `print` need an
 * installed Vitest.
 *
 * Refreshing the timings (optional; stale timings cost balance, not coverage):
 *   node .github/scripts/test-shards.mjs run 1/1 -- --reporter=default \
 *     --reporter=json --outputFile=/tmp/vitest.json
 *   node .github/scripts/test-shards.mjs record /tmp/vitest.json
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./main-module.mjs";

/**
 * Committed map of repo-relative test path to recorded seconds. It is resolved
 * beside this script rather than from the working directory, because the
 * release workflow runs this trusted copy against a separate source checkout
 * that may predate the timings file.
 */
export const TIMINGS_PATH = fileURLToPath(new URL("../ci/test-timings.json", import.meta.url));

/**
 * Seconds charged to every file on top of its recorded time. Vitest's per-file
 * duration excludes module transform and import, and most files record under
 * 50 ms; without a fixed share those files would all pile into one shard.
 */
export const FILE_OVERHEAD_SECONDS = 0.5;

const VITEST_ENTRY = "node_modules/vitest/vitest.mjs";

/** Parse `<index>/<total>` with a 1-based index, rejecting anything else. */
export function parseShardSpec(spec) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(spec ?? "");
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || index > total) {
    throw new Error(`Expected a shard as <index>/<total> with 1 <= index <= total, received "${spec ?? ""}".`);
  }
  return { index, total };
}

const isRecording = (value) => Number.isFinite(value) && value >= 0;

/** Median of the usable recorded values; zero when there are none. */
export function medianSeconds(values) {
  const sorted = values.filter(isRecording).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Locale-independent ordering keeps the assignment identical on every runner.
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Assign files to `total` shards, longest first, each to the least-loaded
 * shard. Unrecorded files weigh the median; recordings for files that no
 * longer exist are ignored. Ties resolve by path, then by lowest shard index.
 *
 * @param {string[]} files Repo-relative test paths.
 * @param {Record<string, number>} timings Recorded seconds by path.
 * @param {number} total Number of shards.
 * @returns {{ files: string[], seconds: number, weight: number }[]} One entry
 *   per shard: its files, their summed recorded seconds, and the balanced
 *   weight (recorded seconds plus the per-file overhead).
 */
export function assignShards(files, timings, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Shard total must be a positive integer, received ${total}.`);
  const unique = [...new Set(files)];
  const fallback = medianSeconds(Object.values(timings));
  const weighted = unique
    .map((file) => {
      const recorded = Object.hasOwn(timings, file) ? timings[file] : undefined;
      const seconds = isRecording(recorded) ? recorded : fallback;
      return { file, seconds, weight: seconds + FILE_OVERHEAD_SECONDS };
    })
    .sort((a, b) => b.weight - a.weight || byPath(a.file, b.file));
  const shards = Array.from({ length: total }, () => ({ files: [], seconds: 0, weight: 0 }));
  for (const { file, seconds, weight } of weighted) {
    const target = shards.reduce((least, shard) => (shard.weight < least.weight ? shard : least));
    target.files.push(file);
    target.seconds += seconds;
    target.weight += weight;
  }
  const tenths = (value) => Math.round(value * 10) / 10;
  return shards.map((shard) => ({ files: shard.files.sort(byPath), seconds: tenths(shard.seconds), weight: tenths(shard.weight) }));
}

/**
 * Files that Vitest would also select for a shard beyond the assigned ones.
 * Vitest treats file arguments as case-insensitive substring filters, so
 * `a.test.ts` also selects `a.test.tsx`. A duplicate run is harmless, but it
 * is reported so an unexpectedly slow shard can be explained.
 */
export function filterOverlap(assigned, allFiles) {
  const owned = new Set(assigned);
  const filters = assigned.map((file) => file.toLowerCase());
  return allFiles.filter((file) => !owned.has(file) && filters.some((filter) => file.toLowerCase().includes(filter)));
}

function toRepoPath(root, file) {
  const path = relative(root, resolve(root, file));
  if (path === "" || path.startsWith("..") || isAbsolute(path)) return null;
  return path.split(sep).join("/");
}

/**
 * Convert Vitest JSON reporter output into the committed timings map: sorted
 * keys, seconds rounded to 0.1. Later reports win so shard reports can be
 * merged. Files outside `root` or without usable timestamps are rejected
 * rather than silently dropped, since a partial map hides a broken report.
 */
export function timingsFromReports(reports, root) {
  const seconds = new Map();
  for (const report of reports) {
    if (!Array.isArray(report?.testResults)) throw new Error("Vitest report has no testResults array.");
    for (const result of report.testResults) {
      const path = toRepoPath(root, String(result.name ?? ""));
      const duration = (result.endTime - result.startTime) / 1000;
      if (!path || !Number.isFinite(duration) || duration < 0) {
        throw new Error(`Vitest report entry is not a timed file under the repository: ${result.name}`);
      }
      seconds.set(path, Math.round(duration * 10) / 10);
    }
  }
  if (seconds.size === 0) throw new Error("Vitest report contains no test files.");
  return Object.fromEntries([...seconds].sort(([a], [b]) => byPath(a, b)));
}

/** Read the committed timings; a missing or malformed file must fail loudly. */
export function readTimings(path = TIMINGS_PATH) {
  const timings = JSON.parse(readFileSync(path, "utf8"));
  if (timings === null || typeof timings !== "object" || Array.isArray(timings)) {
    throw new Error(`${path} must be a JSON object of path to seconds.`);
  }
  return timings;
}

/**
 * Ask Vitest for the files its own configuration includes. An empty or failed
 * listing is an error: treating it as "nothing to run" would pass every shard.
 */
export function discoverTestFiles(root = process.cwd(), run = spawnSync) {
  const listed = run(process.execPath, [VITEST_ENTRY, "list", "--filesOnly", "--json"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
  if (listed.error || listed.status !== 0) {
    throw new Error(`vitest list failed (${listed.error?.message ?? `exit ${listed.status}`}).`);
  }
  const entries = JSON.parse(listed.stdout);
  const files = Array.isArray(entries) ? entries.map((entry) => toRepoPath(root, String(entry?.file ?? ""))) : [];
  if (files.length === 0 || files.includes(null)) throw new Error("vitest list returned no usable test files.");
  return [...new Set(files)].sort(byPath);
}

/**
 * Run one shard and return its exit code. `runVitest` is injectable so the
 * empty-shard guard can be proven without starting a test process.
 */
export function runShard({ index, total }, files, timings, runVitest = spawnVitest, log = console.log) {
  const shard = assignShards(files, timings, total)[index - 1];
  if (shard.files.length === 0) {
    log(`Shard ${index}/${total} has no test files; nothing to run.`);
    return 0;
  }
  const overlap = filterOverlap(shard.files, files);
  log(`Shard ${index}/${total}: ${shard.files.length} of ${files.length} files, about ${shard.seconds}s of recorded test time.`);
  if (overlap.length > 0) log(`Vitest's substring filters also select: ${overlap.join(", ")}`);
  return runVitest(shard.files);
}

/**
 * Accept only `-`-prefixed Vitest options after `--`. A bare word would be a
 * file filter and could pull files from other shards into this one.
 */
export function vitestOptions(args) {
  const options = args[0] === "--" ? args.slice(1) : args;
  // A value-taking option written without "=" would make Vitest consume the
  // first test file as its value (and, for --outputFile, overwrite it).
  const bare = options.find((option) => !option.startsWith("-") || !option.includes("="));
  if (bare !== undefined) throw new Error(`Only Vitest options written as --name=value may follow the shard, received "${bare}".`);
  return options;
}

function spawnVitest(files, options = []) {
  const result = spawnSync(process.execPath, [VITEST_ENTRY, "run", ...options, ...files], { stdio: "inherit" });
  if (result.error) throw result.error;
  // A signal leaves status null; that is a failed shard, never a pass.
  return result.status ?? 1;
}

function printAssignment(total, files, timings, log = console.log) {
  const shards = assignShards(files, timings, total);
  const unrecorded = files.filter((file) => !Object.hasOwn(timings, file));
  shards.forEach((shard, position) => {
    log(`shard ${position + 1}/${total}: ${shard.files.length} files, ${shard.seconds}s recorded, ${shard.weight}s weighted`);
    for (const file of shard.files) log(`  ${file}`);
  });
  log(`total: ${files.length} files in ${total} shard(s); ${unrecorded.length} without a recording`);
}

function main([command, ...rest]) {
  if (command === "run") {
    const shard = parseShardSpec(rest[0]);
    const options = vitestOptions(rest.slice(1));
    return runShard(shard, discoverTestFiles(), readTimings(), (files) => spawnVitest(files, options));
  }
  if (command === "print" || command === "--print") {
    const total = parseShardSpec(`1/${rest[0] ?? "4"}`).total;
    printAssignment(total, discoverTestFiles(), readTimings());
    return 0;
  }
  if (command === "record" && rest.length > 0) {
    const timings = timingsFromReports(rest.map((path) => JSON.parse(readFileSync(path, "utf8"))), process.cwd());
    writeFileSync(TIMINGS_PATH, `${JSON.stringify(timings, null, 2)}\n`);
    console.log(`Recorded ${Object.keys(timings).length} files in ${TIMINGS_PATH}.`);
    return 0;
  }
  console.error("Usage: test-shards.mjs run <index>/<total> [-- --vitest-option=value...] | print [total] | record <vitest-json>...");
  return 2;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
