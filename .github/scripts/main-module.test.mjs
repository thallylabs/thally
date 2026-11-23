/**
 * Regression tests for the entry-point check shared by the CI and release
 * scripts. A script started through a symlinked directory (macOS `/tmp` and
 * `/var` are both symlinks) must still run, rather than exit successfully
 * having done nothing.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isMainModule } from "./main-module.mjs";

const SCRIPTS = resolve(".github/scripts");

/** A fresh directory whose `scripts` entry is a symlink to .github/scripts. */
function linkedScripts() {
  const directory = mkdtempSync(join(tmpdir(), "main-module-"));
  symlinkSync(SCRIPTS, join(directory, "scripts"), "dir");
  return join(directory, "scripts");
}

test("a module is the entry point whether it was started by its real or a symlinked path", () => {
  const moduleUrl = pathToFileURL(join(SCRIPTS, "plan-public-ci.mjs")).href;
  const linked = linkedScripts();
  // The symlink must actually change the spelling, or this proves nothing.
  assert.notEqual(join(linked, "plan-public-ci.mjs"), realpathSync(join(linked, "plan-public-ci.mjs")));
  assert.equal(isMainModule(moduleUrl, join(SCRIPTS, "plan-public-ci.mjs")), true);
  assert.equal(isMainModule(moduleUrl, join(linked, "plan-public-ci.mjs")), true);
  assert.equal(isMainModule(moduleUrl, join(linked, "test-shards.mjs")), false);
  assert.equal(isMainModule(moduleUrl, join(linked, "does-not-exist.mjs")), false);
  assert.equal(isMainModule(moduleUrl, undefined), false);
});

test("the CI planner acts when started through a symlinked directory", () => {
  const output = join(mkdtempSync(join(tmpdir(), "main-module-output-")), "output");
  writeFileSync(output, "");
  const result = spawnSync(process.execPath, [join(linkedScripts(), "plan-public-ci.mjs"), ""], {
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), "full=true\nmode=full\nworker=true\n");
  assert.match(result.stdout, /"mode":"full"/);
});

test("the test shard runner acts when started through a symlinked directory", () => {
  // With no command it prints its usage and exits 2 without starting Vitest.
  const result = spawnSync(process.execPath, [join(linkedScripts(), "test-shards.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Usage: test-shards\.mjs/);
});

test("every script that checks for its own entry point uses the shared check", () => {
  const scripts = readdirSync(SCRIPTS).filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));
  const guarded = [];
  for (const name of scripts) {
    const source = readFileSync(join(SCRIPTS, name), "utf8");
    // A literal comparison between argv[1] and the module URL or path is the
    // pattern that misses symlinked invocations.
    assert.doesNotMatch(source, /import\.meta\.url\s*===|===\s*process\.argv\[1\]|fileURLToPath\(import\.meta\.url\)\s*===/, name);
    if (/isMainModule\(import\.meta\.url\)/.test(source)) guarded.push(name);
  }
  assert.deepEqual(guarded.sort(), ["bump-release-packages.mjs", "plan-public-ci.mjs", "prepare-release-handoff.mjs",
    "release-package-plan.mjs", "start-full-release.mjs", "starter-runtime-contract.mjs", "test-shards.mjs",
    "verify-release-install.mjs"]);
});
