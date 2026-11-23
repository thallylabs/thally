/**
 * Invariants for timing-balanced test shards: complete and exclusive
 * coverage, a deterministic assignment, and no accidental whole-suite run.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parse } from "yaml";

import {
  FILE_OVERHEAD_SECONDS,
  TIMINGS_PATH,
  assignShards,
  discoverTestFiles,
  filterOverlap,
  medianSeconds,
  parseShardSpec,
  runShard,
  timingsFromReports,
  vitestOptions,
} from "./test-shards.mjs";

const files = Array.from({ length: 57 }, (_, position) => `src/lib/__tests__/case-${String(position).padStart(2, "0")}.test.ts`);
const timings = Object.fromEntries(files.map((file, position) => [file, (position * 7) % 23]));

test("every file lands in exactly one shard for any shard total", () => {
  for (const total of [1, 2, 3, 4, 6, 57, 80]) {
    const shards = assignShards(files, timings, total);
    assert.equal(shards.length, total);
    assert.deepEqual(shards.flatMap((shard) => shard.files).sort(), files, `total ${total}`);
  }
});

test("the assignment does not depend on discovery order", () => {
  const expected = assignShards(files, timings, 4);
  assert.deepEqual(assignShards([...files].reverse(), timings, 4), expected);
  assert.deepEqual(assignShards([...files, ...files], timings, 4), expected);
});

test("recorded time, not file count, balances the shards", () => {
  const heavy = { "a.test.ts": 30, "b.test.ts": 10, "c.test.ts": 10, "d.test.ts": 10 };
  const shards = assignShards(Object.keys(heavy), heavy, 2);
  assert.deepEqual(shards.map((shard) => shard.files), [["a.test.ts"], ["b.test.ts", "c.test.ts", "d.test.ts"]]);
  assert.deepEqual(shards.map((shard) => shard.seconds), [30, 30]);
});

test("files with equal weight are placed by path", () => {
  const equal = { "z.test.ts": 1, "a.test.ts": 1, "m.test.ts": 1 };
  assert.deepEqual(assignShards(["z.test.ts", "m.test.ts", "a.test.ts"], equal, 3).map((shard) => shard.files),
    [["a.test.ts"], ["m.test.ts"], ["z.test.ts"]]);
});

test("unrecorded files still run and weigh the median; deleted recordings are ignored", () => {
  const recorded = { "old-deleted.test.ts": 500, "a.test.ts": 4, "b.test.ts": 4, "c.test.ts": 2 };
  const shards = assignShards(["a.test.ts", "b.test.ts", "c.test.ts", "new.test.ts"], recorded, 2);
  assert.deepEqual(shards.flatMap((shard) => shard.files).sort(), ["a.test.ts", "b.test.ts", "c.test.ts", "new.test.ts"]);
  // Median of 500, 4, 4, 2 is 4, so the new file weighs the same as a and b.
  assert.equal(shards.reduce((sum, shard) => sum + shard.seconds, 0), 14);
  assert.equal(medianSeconds([]), 0);
  // With no usable recordings the split falls back to an even file count.
  assert.deepEqual(assignShards(files, { [files[0]]: "slow", [files[1]]: -3 }, 3).map((shard) => shard.files.length), [19, 19, 19]);
  assert.ok(FILE_OVERHEAD_SECONDS > 0);
});

test("shard specifications are validated before anything runs", () => {
  assert.deepEqual(parseShardSpec("2/4"), { index: 2, total: 4 });
  for (const spec of [undefined, "", "0/4", "5/4", "1/0", "1", "a/b", "1/4/2", "-1/4", "1.5/4"]) {
    assert.throws(() => parseShardSpec(spec), /<index>\/<total>/, String(spec));
  }
  assert.throws(() => assignShards(files, timings, 0), /positive integer/);
});

test("a shard runs only its own files and propagates the exit code", () => {
  const ran = [];
  const code = runShard({ index: 2, total: 4 }, files, timings, (selected) => { ran.push(selected); return 3; }, () => {});
  assert.equal(code, 3);
  assert.deepEqual(ran, [assignShards(files, timings, 4)[1].files]);
});

test("an empty shard succeeds without starting the whole suite", () => {
  const messages = [];
  const code = runShard({ index: 4, total: 4 }, files.slice(0, 2), timings,
    () => assert.fail("Vitest with no file arguments would run every test"), (message) => messages.push(message));
  assert.equal(code, 0);
  assert.match(messages.join("\n"), /nothing to run/);
});

test("extra arguments cannot widen a shard with a file filter", () => {
  assert.deepEqual(vitestOptions(["--", "--reporter=json", "--outputFile=report.json"]), ["--reporter=json", "--outputFile=report.json"]);
  assert.deepEqual(vitestOptions([]), []);
  assert.throws(() => vitestOptions(["--", "src"]), /Only Vitest options/);
  assert.throws(() => vitestOptions(["--", "--outputFile", "report.json"]), /Only Vitest options/);
  assert.throws(() => vitestOptions(["--", "--outputFile"]), /Only Vitest options/);
});

test("substring filter overlap is reported rather than hidden", () => {
  const all = ["src/a.test.ts", "src/a.test.tsx", "packages/core/src/a.test.ts", "src/b.test.ts"];
  assert.deepEqual(filterOverlap(["src/a.test.ts"], all), ["src/a.test.tsx", "packages/core/src/a.test.ts"]);
  assert.deepEqual(filterOverlap(["src/b.test.ts"], all), []);
});

test("recorded timings are repo-relative, sorted, and rounded to a tenth", () => {
  const root = "/work/repo";
  const report = { testResults: [
    { name: "/work/repo/src/z.test.ts", startTime: 1000, endTime: 3260 },
    { name: "/work/repo/packages/core/src/a.test.ts", startTime: 0, endTime: 49 },
  ] };
  const recorded = timingsFromReports([report, { testResults: [{ name: "/work/repo/src/z.test.ts", startTime: 0, endTime: 1040 }] }], root);
  assert.deepEqual(Object.entries(recorded), [["packages/core/src/a.test.ts", 0], ["src/z.test.ts", 1]]);
  assert.throws(() => timingsFromReports([{ testResults: [{ name: "/elsewhere/a.test.ts", startTime: 0, endTime: 1 }] }], root), /under the repository/);
  assert.throws(() => timingsFromReports([{ testResults: [{ name: "/work/repo/a.test.ts" }] }], root), /timed file/);
  assert.throws(() => timingsFromReports([{ testResults: [] }], root), /no test files/);
  assert.throws(() => timingsFromReports([{}], root), /testResults/);
});

test("a failed or empty Vitest listing is an error, never an empty suite", () => {
  const listing = (stdout, status = 0) => () => ({ status, stdout });
  assert.deepEqual(discoverTestFiles("/work/repo", listing(JSON.stringify([{ file: "/work/repo/src/b.test.ts" }, { file: "/work/repo/src/a.test.ts" }]))),
    ["src/a.test.ts", "src/b.test.ts"]);
  assert.throws(() => discoverTestFiles("/work/repo", listing("[]")), /no usable test files/);
  assert.throws(() => discoverTestFiles("/work/repo", listing("[]", 1)), /vitest list failed/);
  assert.throws(() => discoverTestFiles("/work/repo", listing(JSON.stringify([{ file: "/elsewhere/a.test.ts" }]))), /no usable test files/);
});

test("committed timings are canonical and only name tracked test files", () => {
  const source = readFileSync(TIMINGS_PATH, "utf8");
  const committed = JSON.parse(source);
  const paths = Object.keys(committed);
  assert.ok(paths.length > 0);
  assert.deepEqual(paths, [...paths].sort());
  assert.equal(source, `${JSON.stringify(committed, null, 2)}\n`);
  for (const [path, seconds] of Object.entries(committed)) {
    assert.match(path, /\.test\.tsx?$/, path);
    assert.ok(Number.isFinite(seconds) && seconds >= 0 && Math.round(seconds * 10) / 10 === seconds, path);
  }
});

test("the real suite is covered exactly once by the CI shard matrix", () => {
  const total = parse(readFileSync(".github/workflows/ci.yml", "utf8")).jobs.test.strategy.matrix.shard.length;
  const discovered = discoverTestFiles();
  // Independent restatement of the include globs in vitest.config.ts. If the
  // two drift, either Vitest stopped collecting a test file or this list did.
  const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter((path) => /^(?:src\/.+\.test\.tsx?|packages\/[^/]+\/src\/.+\.test\.ts|scripts\/.+\.test\.ts)$/.test(path) && existsSync(path))
    .sort();
  assert.deepEqual(discovered, tracked);
  const shards = assignShards(discovered, JSON.parse(readFileSync(TIMINGS_PATH, "utf8")), total);
  assert.deepEqual(shards.flatMap((shard) => shard.files).sort(), discovered);
  assert.ok(shards.every((shard) => shard.files.length > 0));
});
