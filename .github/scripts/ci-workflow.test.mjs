/**
 * Structural regression tests for the parallel public CI workflow, its
 * dependency install action, and the workflow that warms the dependency cache.
 *
 * They pin the policy the layout must keep: one required gate that fails on
 * any non-success, contract checks for every candidate, broad tests skipped
 * only by a positive cheaper plan, release-record consumer tests whenever the
 * broad tests do not run, a Worker build skipped only for a proven record, a
 * missing plan output that runs everything, and no restored build output.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

const read = (path) => readFileSync(path, "utf8");
const workflow = parse(read(".github/workflows/ci.yml"));
const warmWorkflow = parse(read(".github/workflows/warm-ci-dependency-cache.yml"));
const installAction = parse(read(".github/actions/install/action.yml"));

const { verify: gate, ...verifiedJobs } = workflow.jobs;
const stepsOf = (job) => workflow.jobs[job].steps;
const step = (job, name) => stepsOf(job).find((candidate) => candidate.name === name);
const allSteps = [
  ...Object.values(workflow.jobs).flatMap((job) => job.steps),
  ...Object.values(warmWorkflow.jobs).flatMap((job) => job.steps),
  ...installAction.runs.steps,
];
const PLANNED = "steps.plan.outputs.full != 'false'";
const RECORD_PLANNED = "steps.plan.outputs.full != 'true' && steps.plan.outputs.mode != 'content'";
const WORKER_PLANNED = "steps.plan.outputs.worker != 'false'";
const CACHE_SAVE = "${{ steps.plan.outputs.mode != 'record' && 'true' || 'false' }}";
const BASE_SHA = "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}";
const PLAN_RUN = 'node .github/scripts/plan-public-ci.mjs "$BASE_SHA"';

// The outputs the planner writes for each plan, and what GitHub sees when the
// planner wrote nothing: every output reads as the empty string.
const PLAN_OUTPUTS = {
  full: { full: "true", mode: "full", worker: "true" },
  content: { full: "false", mode: "content", worker: "true" },
  record: { full: "false", mode: "record", worker: "false" },
  missing: { full: "", mode: "", worker: "" },
};

/**
 * Evaluate the only expression shapes the plan-dependent conditions may use:
 * `steps.plan.outputs.<name> (==|!=) '<literal>'` joined by `&&`. Anything
 * else throws, so a new condition shape cannot slip past the matrix below.
 */
function evaluatePlanCondition(condition, outputs) {
  return condition.split(" && ").every((clause) => {
    const match = /^steps\.plan\.outputs\.(\w+) (==|!=) '([^']*)'$/.exec(clause.trim());
    assert.ok(match, `unsupported plan condition: ${condition}`);
    const [, name, operator, literal] = match;
    assert.ok(name in outputs, `unknown plan output: ${name}`);
    return operator === "==" ? outputs[name] === literal : outputs[name] !== literal;
  });
}

/** Evaluate `${{ <plan condition> && 'a' || 'b' }}` the way GitHub does for these operands. */
function evaluateSaveInput(expression, outputs) {
  const match = /^\$\{\{ (.+) && '([^']*)' \|\| '([^']*)' \}\}$/.exec(expression);
  assert.ok(match, `unsupported save expression: ${expression}`);
  return evaluatePlanCondition(match[1], outputs) ? match[2] : match[3];
}

test("CI verifies candidates without repeating on protected-branch pushes", () => {
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  assert.equal(workflow.on.merge_group, null);
  assert.equal(workflow.on.workflow_dispatch, null);
  assert.equal(workflow.on.push, undefined);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.match(workflow.concurrency.group, /github\.event\.pull_request\.number \|\| github\.ref/);
});

test("the required check is a gate over every other job", () => {
  assert.equal(gate.name, "Test · Build");
  assert.equal(gate.if, "always()");
  assert.deepEqual([...gate.needs].sort(), Object.keys(verifiedJobs).sort());
  assert.deepEqual([...gate.needs].sort(), ["contracts", "record", "test", "windows-updates", "worker"]);
  // No other job may carry the required context or it could satisfy the rule.
  assert.ok(Object.values(verifiedJobs).every((job) => job.name !== gate.name));
  assert.equal(gate.steps.length, 1);
  for (const job of gate.needs) {
    assert.ok(Object.values(gate.steps[0].env).includes(`\${{ needs.${job}.result }}`), job);
  }
});

test("the gate fails on any failed, cancelled, skipped, or missing result", () => {
  const { run, env } = gate.steps[0];
  const names = Object.keys(env);
  assert.equal(names.length, gate.needs.length);
  const conclude = (results) => spawnSync("bash", ["-c", run], {
    env: { PATH: process.env.PATH, ...Object.fromEntries(names.map((name, position) => [name, results[position]])) },
    encoding: "utf8",
  });
  assert.equal(conclude(names.map(() => "success")).status, 0);
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    names.forEach((name, position) => {
      const outcome = conclude(names.map((_, other) => (other === position ? result : "success")));
      assert.equal(outcome.status, 1, `${name}=${result || "<missing>"}`);
      assert.match(outcome.stdout, /::error::/);
    });
  }
});

test("jobs start together and are bounded", () => {
  for (const [id, job] of Object.entries(verifiedJobs)) {
    assert.equal(job.needs, undefined, id);
    assert.equal(job.if, undefined, id);
  }
  for (const [id, job] of Object.entries({ ...workflow.jobs, ...warmWorkflow.jobs })) {
    assert.ok(Number.isInteger(job["timeout-minutes"]) && job["timeout-minutes"] <= 20, id);
  }
});

test("every job that reads the plan computes it the same way, before anything it gates", () => {
  for (const [id, job] of Object.entries(verifiedJobs)) {
    const steps = job.steps;
    const planAt = steps.findIndex((candidate) => candidate.id === "plan");
    assert.ok(planAt >= 0, id);
    const plan = steps[planAt];
    assert.equal(plan.name, "Plan validation from changed paths", id);
    assert.equal(plan.run, PLAN_RUN, id);
    assert.equal(plan.env.BASE_SHA, BASE_SHA, id);
    assert.equal(plan.if, undefined, id);
    assert.equal(plan["continue-on-error"], undefined, id);
    // The planner diffs against the base commit, so it needs history.
    assert.equal(steps.find((candidate) => /actions\/checkout@/.test(candidate.uses ?? "")).with["fetch-depth"], 0, id);
    for (const earlier of steps.slice(0, planAt)) assert.equal(earlier.if, undefined, `${id}: ${earlier.name}`);
  }
  // PowerShell would not expand "$BASE_SHA".
  assert.equal(stepsOf("windows-updates").find((candidate) => candidate.id === "plan").shell, "bash");
});

test("contract checks run for every candidate", () => {
  const contracts = stepsOf("contracts").map((candidate) => candidate.name);
  assert.deepEqual(contracts, ["Checkout", "Plan validation from changed paths", "Install dependencies",
    "Require a release disposition for changed packages", "Build workspace packages", "Check authored content",
    "Test release handoff boundary"]);
  for (const name of ["Install dependencies", "Build workspace packages", "Check authored content", "Test release handoff boundary"]) {
    assert.equal(step("contracts", name).if, undefined, name);
    assert.equal(step("contracts", name)["continue-on-error"], undefined, name);
  }
  assert.equal(step("contracts", "Require a release disposition for changed packages").if,
    "github.event_name != 'workflow_dispatch'");
  assert.equal(step("contracts", "Check authored content").run, "node packages/cli/dist/index.js check --ci .");
  assert.equal(step("contracts", "Test release handoff boundary").run, "node --test .github/scripts/*.test.mjs");
});

test("each plan runs exactly the intended work, and a missing plan output runs all of it", () => {
  // Jobs whose planned work runs, per plan. `contracts` has no plan-gated step.
  const expected = {
    full: ["contracts", "test", "worker", "windows-updates"],
    content: ["contracts", "worker"],
    record: ["contracts", "record"],
    missing: ["contracts", "test", "record", "worker", "windows-updates"],
  };
  for (const [plan, outputs] of Object.entries(PLAN_OUTPUTS)) {
    const running = Object.entries(verifiedJobs)
      .filter(([, job]) => job.steps.every((candidate) => !/steps\.plan\.outputs/.test(candidate.if ?? "")
        || evaluatePlanCondition(candidate.if, outputs)))
      .map(([id]) => id);
    assert.deepEqual(running.sort(), [...expected[plan]].sort(), plan);
  }

  // Within a job, every step after the plan carries the job's one condition,
  // so a plan either runs a job's work completely or stops after the plan.
  const conditions = { test: PLANNED, "windows-updates": PLANNED, record: RECORD_PLANNED, worker: WORKER_PLANNED };
  for (const [id, condition] of Object.entries(conditions)) {
    const steps = stepsOf(id);
    const later = steps.slice(steps.findIndex((candidate) => candidate.id === "plan") + 1);
    for (const candidate of later) {
      assert.equal(candidate.if, condition, `${id}: ${candidate.name}`);
      assert.equal(candidate["continue-on-error"], undefined, `${id}: ${candidate.name}`);
    }
  }
  assert.ok(stepsOf("contracts").every((candidate) => !/steps\.plan\.outputs/.test(candidate.if ?? "")));
});

// Exact ordered step names, so removing a step (for example the package build
// the suites depend on) cannot pass unnoticed.
test("each planned job keeps its exact steps in order", () => {
  const plan = ["Checkout", "Plan validation from changed paths"];
  assert.deepEqual(stepsOf("test").map((candidate) => candidate.name),
    [...plan, "Install dependencies", "Build workspace packages", "Run test shard"]);
  assert.deepEqual(stepsOf("record").map((candidate) => candidate.name),
    [...plan, "Install dependencies", "Build workspace packages", "Test release-record consumers"]);
  assert.deepEqual(stepsOf("worker").map((candidate) => candidate.name),
    [...plan, "Install dependencies", "Build and enforce managed Worker size"]);
  assert.deepEqual(stepsOf("windows-updates").map((candidate) => candidate.name),
    ["Use Windows line endings", "Checkout with Windows line endings", "Plan validation from changed paths",
      "Set up Node", "Install dependencies", "Verify safe starter updates"]);
  assert.equal(step("test", "Build workspace packages").run, "npm run packages:build");
});

test("nothing the gate trusts may continue on error", () => {
  // A job or step that continues on error reports success to the gate.
  const jobs = Object.entries(workflow.jobs);
  assert.deepEqual(jobs.map(([id]) => id).sort(), [...gate.needs, "verify"].sort());
  for (const [id, job] of jobs) {
    assert.equal(job["continue-on-error"], undefined, id);
    for (const candidate of job.steps) assert.equal(candidate["continue-on-error"], undefined, `${id}: ${candidate.name}`);
  }
  for (const candidate of installAction.runs.steps) {
    assert.equal(candidate["continue-on-error"], undefined, `install action: ${candidate.name}`);
  }
  assert.doesNotMatch(read(".github/workflows/ci.yml"), /continue-on-error/);
  assert.doesNotMatch(read(".github/actions/install/action.yml"), /continue-on-error/);
});

/**
 * Which of the three kinds of verification run when each job's plan step
 * independently produced `outcomes[job]` (an output set, or "failed").
 * Returns null when any job failed, because the gate is then red.
 */
function verificationRun(outcomes) {
  if (Object.values(outcomes).includes("failed")) return null;
  const runs = (id) => stepsOf(id).every((candidate) => !/steps\.plan\.outputs/.test(candidate.if ?? "")
    || evaluatePlanCondition(candidate.if, outcomes[id]));
  return { suite: runs("test"), subset: runs("record"), worker: runs("worker"), windows: runs("windows-updates") };
}

/** Every assignment of one of `choices` to each job that reads the plan. */
function* assignments(choices) {
  const jobs = Object.keys(verifiedJobs);
  const total = choices.length ** jobs.length;
  for (let index = 0; index < total; index += 1) {
    let rest = index;
    const outcomes = {};
    for (const job of jobs) { outcomes[job] = choices[rest % choices.length]; rest = Math.floor(rest / choices.length); }
    yield outcomes;
  }
}

/** Whether a green gate still ran the verification the true plan requires. */
const covers = (truth, run) => ({
  full: run.suite && run.worker && run.windows,
  record: run.subset || run.suite,
  content: run.worker,
})[truth];

test("jobs that plan independently cannot pass the gate while skipping what the true plan needs", () => {
  // The planner either writes the true plan or fails its job (see
  // plan-public-ci.test.mjs). "missing" models a step that wrote no outputs
  // yet succeeded. Every combination across the five jobs is checked.
  for (const truth of ["full", "record", "content"]) {
    let green = 0;
    for (const outcomes of assignments([PLAN_OUTPUTS[truth], PLAN_OUTPUTS.missing, "failed"])) {
      const run = verificationRun(outcomes);
      if (!run) continue;
      green += 1;
      assert.ok(covers(truth, run), `${truth}: ${JSON.stringify(Object.fromEntries(Object.entries(outcomes)
        .map(([job, value]) => [job, value.mode ?? "missing"])))}`);
    }
    assert.equal(green, 2 ** Object.keys(verifiedJobs).length, truth);
  }

  // Why errors must not choose a plan: if a job could fall back to `full`
  // on a git error, a record diff could pass with no unit tests and no build.
  const unsafe = [...assignments([PLAN_OUTPUTS.record, PLAN_OUTPUTS.full])]
    .map(verificationRun)
    .filter((run) => !run.suite && !run.subset && !run.worker);
  assert.ok(unsafe.length > 0);
});

test("the release-record consumers run from built packages without npm test", () => {
  assert.equal(workflow.jobs.record.name, "Test release-record consumers");
  assert.deepEqual(stepsOf("record").map((candidate) => candidate.name), ["Checkout",
    "Plan validation from changed paths", "Install dependencies", "Build workspace packages",
    "Test release-record consumers"]);
  assert.equal(step("record", "Install dependencies").uses, "./.github/actions/install");
  assert.equal(step("record", "Build workspace packages").run, "npm run packages:build");
  // The exact directory list is pinned by record-ci-tests.test.mjs.
  assert.match(step("record", "Test release-record consumers").run, /^npx vitest run packages\//);
});

test("the managed Worker build skips only for a proven release record", () => {
  assert.deepEqual(stepsOf("worker").map((candidate) => candidate.name), ["Checkout",
    "Plan validation from changed paths", "Install dependencies", "Build and enforce managed Worker size"]);
  const build = step("worker", "Build and enforce managed Worker size");
  assert.equal(build.run, "npm run build:cloudflare");
  assert.equal(build.env.THALLY_SITE_URL, "https://example.com");
});

test("the planner emits every output the workflow conditions read", () => {
  const output = join(mkdtempSync(join(tmpdir(), "plan-public-ci-")), "output");
  writeFileSync(output, "");
  // No base commit is the manual-dispatch case and must plan everything.
  execFileSync(process.execPath, [".github/scripts/plan-public-ci.mjs", ""], {
    env: { ...process.env, GITHUB_OUTPUT: output },
    stdio: "ignore",
  });
  assert.equal(readFileSync(output, "utf8"), "full=true\nmode=full\nworker=true\n");
  // Every output a condition reads is one the planner writes.
  const consumed = new Set(read(".github/workflows/ci.yml").match(/steps\.plan\.outputs\.\w+/g)
    .map((reference) => reference.split(".").at(-1)));
  assert.deepEqual([...consumed].sort(), ["full", "mode", "worker"]);
});

test("test shards cover the suite through the timing-balanced runner", () => {
  const { strategy } = workflow.jobs.test;
  assert.equal(strategy["fail-fast"], false);
  assert.deepEqual(strategy.matrix.shard, strategy.matrix.shard.map((_, position) => position + 1));
  assert.equal(workflow.jobs.test.name, "Test (shard ${{ matrix.shard }})");
  // The total comes from the matrix, so adding a shard cannot orphan files.
  assert.equal(step("test", "Run test shard").run,
    "node .github/scripts/test-shards.mjs run ${{ matrix.shard }}/${{ strategy.job-total }}");
  // `npm test` would recompile the packages through `pretest`.
  assert.ok(Object.values(workflow.jobs).flatMap((job) => job.steps).every((candidate) => !/npm (?:run )?test\b/.test(candidate.run ?? "")));
});

test("the Windows job keeps its starter-update coverage and line endings", () => {
  const job = workflow.jobs["windows-updates"];
  assert.equal(job.name, "Windows · Starter updates");
  assert.equal(job["runs-on"], "windows-latest");
  assert.equal(job.steps[0].run, "git config --global core.autocrlf true");
  const verifyStep = step("windows-updates", "Verify safe starter updates");
  assert.match(verifyStep.run, /^npx vitest run /);
  for (const file of ["starter-file-comparison.test.ts", "starter-update.test.ts"]) assert.ok(verifyStep.run.includes(file), file);
  // Both suites import package source only, so the job compiles nothing.
  assert.ok(job.steps.every((candidate) => !/packages:build|\bnpm run build\b/.test(candidate.run ?? "")));
  assert.deepEqual(job.steps.slice(-3).map((candidate) => candidate.name),
    ["Set up Node", "Install dependencies", "Verify safe starter updates"]);
});

test("each job compiles the workspace packages at most once", () => {
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const compiles = job.steps.filter((candidate) => /packages:build|build:cloudflare|npm (?:run )?test\b/.test(candidate.run ?? ""));
    assert.ok(compiles.length <= 1, id);
  }
  // With no repeated compilation there is no in-job build receipt to opt into.
  assert.ok(!read(".github/workflows/ci.yml").includes("THALLY_CI_PACKAGE_BUILD_PROOF"));
});

test("only installed dependencies are cached, never build output", () => {
  const cacheSteps = allSteps.filter((candidate) => /actions\/cache/.test(candidate.uses ?? ""));
  assert.deepEqual(cacheSteps.map((candidate) => candidate.uses.split("@")[0]).sort(), ["actions/cache/restore", "actions/cache/save"]);
  for (const candidate of cacheSteps) {
    assert.deepEqual(candidate.with.path.trim().split("\n"), ["node_modules", "packages/*/node_modules"]);
    assert.equal(candidate.with["restore-keys"], undefined);
  }
  assert.ok(allSteps.every((candidate) => !/download-artifact|upload-artifact/.test(candidate.uses ?? "")));
  assert.ok(!/\bdist\b|\.next|\.open-next/.test(JSON.stringify(allSteps.map((candidate) => candidate.with ?? {}))));
});

test("the dependency cache is addressed by platform, Node major, and the exact lockfile", () => {
  const steps = installAction.runs.steps;
  const byName = (name) => steps.find((candidate) => candidate.name === name);
  const restore = byName("Restore installed dependencies");
  assert.equal(restore.with.key, "node-modules-${{ runner.os }}-${{ runner.arch }}-node22-${{ hashFiles('package-lock.json') }}");
  assert.equal(String(byName("Set up Node").with["node-version"]), restore.with.key.match(/node(\d+)/)[1]);

  const miss = "steps.dependencies.outputs.cache-hit != 'true'";
  assert.equal(byName("Install dependencies").if, miss);
  assert.equal(byName("Install dependencies").run, "npm ci --no-audit --no-fund");
  assert.equal(byName("Save installed dependencies").if, `${miss} && inputs.save == 'true'`);
  assert.equal(byName("Save installed dependencies").with.key, "${{ steps.dependencies.outputs.cache-primary-key }}");
  assert.equal(installAction.inputs.save.default, "false");
  // The save must precede anything that could add files to the saved paths.
  assert.deepEqual(steps.map((candidate) => candidate.name), ["Set up Node", "Restore installed dependencies",
    "Install dependencies", "Save installed dependencies", "Generate runtime sources"]);

  // Generated sources come from the candidate's tracked files, not the cache:
  // a hit must run exactly what the root postinstall runs after `npm ci`.
  const generate = byName("Generate runtime sources");
  assert.equal(generate.if, "steps.dependencies.outputs.cache-hit == 'true'");
  assert.equal(generate.run, JSON.parse(read("package.json")).scripts.postinstall);
});

test("Linux jobs install through the shared action after checkout; only contracts saves, never for a record", () => {
  const savers = [];
  for (const [id, job] of Object.entries(verifiedJobs)) {
    const install = job.steps.findIndex((candidate) => candidate.uses === "./.github/actions/install");
    if (job["runs-on"] !== "ubuntu-latest") {
      assert.equal(install, -1, id);
      continue;
    }
    const checkout = job.steps.findIndex((candidate) => /actions\/checkout@/.test(candidate.uses ?? ""));
    assert.ok(checkout >= 0 && install > checkout, id);
    if (job.steps[install].with?.save !== undefined) savers.push(id);
  }
  assert.deepEqual(savers, ["contracts"]);

  // The input is a string the action compares with 'true'. A release-record
  // pull request always misses and would upload a cache nothing reads; every
  // other plan, including a missing one, saves as before.
  const save = step("contracts", "Install dependencies").with.save;
  assert.equal(save, CACHE_SAVE);
  const planAt = stepsOf("contracts").findIndex((candidate) => candidate.id === "plan");
  assert.ok(planAt < stepsOf("contracts").findIndex((candidate) => candidate.name === "Install dependencies"));
  assert.deepEqual(Object.fromEntries(Object.entries(PLAN_OUTPUTS)
    .map(([plan, outputs]) => [plan, evaluateSaveInput(save, outputs)])),
  { full: "true", content: "true", record: "false", missing: "true" });
});

test("every action is pinned to a commit and checkouts drop credentials", () => {
  for (const candidate of allSteps.filter((entry) => entry.uses)) {
    assert.match(candidate.uses, /^(?:\.\/\.github\/actions\/install|[\w./-]+@[a-f0-9]{40})$/, candidate.uses);
    if (/actions\/checkout@/.test(candidate.uses)) assert.equal(candidate.with["persist-credentials"], false);
  }
});

test("the dependency cache is warmed only from trusted main", () => {
  assert.deepEqual(warmWorkflow.on.push.branches, ["main"]);
  assert.deepEqual(warmWorkflow.on.push.paths, ["package-lock.json", ".github/actions/install/**",
    ".github/workflows/warm-ci-dependency-cache.yml"]);
  assert.equal(warmWorkflow.on.workflow_dispatch, null);
  assert.equal(warmWorkflow.on.pull_request, undefined);
  assert.deepEqual(warmWorkflow.permissions, { contents: "read" });
  for (const [id, job] of Object.entries(warmWorkflow.jobs)) {
    assert.equal(job.if, "github.ref == 'refs/heads/main'", id);
    assert.ok(job.steps.every((candidate) => !/\b(?:build|test|deploy|publish)\b/.test(candidate.run ?? "")), id);
  }
  const linux = warmWorkflow.jobs.linux.steps.find((candidate) => candidate.uses === "./.github/actions/install");
  assert.equal(linux.with.save, "true");

  // setup-node keys the npm cache on the checked-out lockfile bytes, so the
  // warming job must mirror the CI job's runner, line endings, and Node setup.
  const ciWindows = workflow.jobs["windows-updates"];
  const warmWindows = warmWorkflow.jobs.windows;
  assert.equal(warmWindows["runs-on"], ciWindows["runs-on"]);
  assert.equal(warmWindows.steps[0].run, ciWindows.steps[0].run);
  const setup = (job) => job.steps.find((candidate) => /actions\/setup-node@/.test(candidate.uses ?? ""));
  assert.equal(setup(warmWindows).uses, setup(ciWindows).uses);
  assert.deepEqual(setup(warmWindows).with, setup(ciWindows).with);
});
