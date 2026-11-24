/**
 * Structural tests for the release workflow's ordering and privilege boundary.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(".github/workflows/publish-packages.yml", "utf8"),
);
const promotionWorkflow = parse(
  readFileSync(".github/workflows/promote-release.yml", "utf8"),
);
const fullReleaseWorkflow = parse(
  readFileSync(".github/workflows/full-release.yml", "utf8"),
);
const ciWorkflow = parse(
  readFileSync(".github/workflows/ci.yml", "utf8"),
);

/** Every shell script of one job, joined in step order. */
const jobScript = (job) => job.steps.map((step) => step.run ?? "").join("\n");
/** Find a step by name and fail with that name when it is missing. */
function namedStep(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing step: ${name}`);
  return step;
}
/** Offset of a required fragment in a script; fails when it is absent. */
function offsetOf(script, pattern) {
  const match = pattern.exec(script);
  assert.ok(match, `script is missing ${pattern}`);
  return match.index;
}

test("rejects missing package bumps in pull-request CI before a main merge", () => {
  // The disposition lives in the always-run contracts job, and the required
  // gate cannot pass unless that job succeeded.
  const contracts = ciWorkflow.jobs.contracts;
  const checkout = contracts.steps.find((step) => step.name === "Checkout");
  const disposition = contracts.steps.find(
    (step) => step.name === "Require a release disposition for changed packages",
  );
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.match(disposition.run, /release-package-plan\.mjs/);
  assert.match(disposition.env.BASE_SHA, /pull_request\.base\.sha/);
  assert.equal(disposition.if, "github.event_name != 'workflow_dispatch'");
  assert.equal(contracts.if, undefined);
  assert.equal(ciWorkflow.jobs.verify.name, "Test · Build");
  assert.ok(ciWorkflow.jobs.verify.needs.includes("contracts"));
});

test("starts only from a reviewed stable-record merge or an operator recovery", () => {
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.push.paths, [
    "packages/**",
  ]);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.request_id.required,
    false,
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.release_commit_sha.required,
    true,
  );
  assert.equal(workflow.jobs.plan.outputs.release_sha, "${{ steps.source.outputs.sha }}");
  assert.equal(workflow.jobs.plan.outputs.has_packages, "${{ steps.package-plan.outputs.has_packages }}");
  assert.equal(workflow.jobs.plan.outputs.plan_sha256, "${{ steps.package-plan.outputs.plan_sha256 }}");
  assert.deepEqual(workflow.jobs.publish.needs, ["plan", "verify", "test", "attest"]);
  assert.match(workflow.jobs.plan.steps[0].run, /refs\/heads\/main/);
  assert.match(
    workflow.jobs.plan.steps.find(
      (step) => step.name === "Classify immutable scaffold handoff",
    ).run,
    /stable-scaffold-release\.json/,
  );
  const sourceStep = workflow.jobs.plan.steps.find(
    (step) => step.name === "Resolve immutable release source",
  );
  assert.match(sourceStep.run, /authoritative_sha/);
  assert.match(sourceStep.run, /log -1 --format=%H origin\/main/);
  assert.match(sourceStep.run, /selected_sha.*authoritative_sha/);
  const packagePlan = workflow.jobs.plan.steps.find(
    (step) => step.name === "Derive dependency-aware package plan",
  );
  assert.match(packagePlan.run, /release-package-plan\.mjs/);
  assert.match(packagePlan.run, /sha256sum/);
});

test("packs once, without privilege, before the minimal OIDC publish job", () => {
  const verify = workflow.jobs.verify;
  const attest = workflow.jobs.attest;
  const publish = workflow.jobs.publish;
  assert.equal(verify.name, "Pack once");
  assert.equal(verify.needs, "plan");
  assert.equal(verify.permissions, undefined);
  assert.equal(verify.environment, undefined);
  assert.deepEqual(attest.permissions, {
    attestations: "write",
    contents: "read",
    "id-token": "write",
  });
  assert.equal(workflow.jobs.publish.environment, "npm-production");
  assert.equal(workflow.jobs.publish.permissions["id-token"], "write");
  assert.equal(verify.if, "needs.plan.outputs.has_packages == 'true'");
  assert.equal(publish.if, "needs.plan.outputs.has_packages == 'true'");
  assert.deepEqual(
    verify.steps.map((step) => step.name).slice(-3),
    ["Pack immutable release artifacts", "Clean-install the selected tarballs", "Upload immutable release artifacts"],
  );
  // The suite moved to the parallel `test` job, taking the `pretest` build
  // with it. The packed `dist` output must still be compiled here, from the
  // release source, after a clean install and before packing.
  const names = verify.steps.map((step) => step.name);
  const build = verify.steps.find((step) => step.name === "Build workspace packages");
  assert.equal(build.run, "npm run packages:build");
  assert.equal(build["working-directory"], "release-source");
  assert.equal(build.if, undefined);
  assert.ok(names.indexOf("Install dependencies") < names.indexOf("Build workspace packages"));
  assert.ok(names.indexOf("Build workspace packages") < names.indexOf("Pack immutable release artifacts"));
  assert.doesNotMatch(verify.steps.map((step) => step.run ?? "").join("\n"), /npm (?:run )?test\b|vitest|test-shards/);
  const uploadStep = verify.steps.find(
    (step) => step.name === "Upload immutable release artifacts",
  );
  assert.equal(uploadStep.with["include-hidden-files"], true);
  const publishScript = publish.steps.map((step) => step.run ?? "").join("\n");
  assert.match(publishScript, /publish-release-artifacts\.mjs/);
  assert.doesNotMatch(publishScript, /npm ci|npm test|npm pack|--workspace/);
  assert.match(publishScript, /EXPECTED_PLAN_SHA256/);
});

test("runs the release suite beside packing, on the same source and toolchain", () => {
  const job = workflow.jobs.test;
  const pack = workflow.jobs.verify;
  const named = (candidate, name) => candidate.steps.find((step) => step.name === name);

  // It starts with the pack job rather than ahead of it.
  assert.equal(job.needs, pack.needs);
  assert.equal(job.if, pack.if);
  assert.equal(job["runs-on"], pack["runs-on"]);
  assert.ok(Number.isInteger(job["timeout-minutes"]));

  // Same checkouts, selected commit, Node version, and clean install as the
  // job whose bytes are published.
  const shared = ["Checkout trusted release policy", "Checkout immutable release source",
    "Select the authorized immutable release source", "Set up Node", "Install dependencies"];
  for (const name of shared) assert.deepEqual(named(job, name), named(pack, name), name);
  assert.deepEqual(job.steps.map((step) => step.name), [...shared, "Build workspace packages", "Run test shard"]);
  assert.equal(named(job, "Select the authorized immutable release source").env.RELEASE_SHA,
    "${{ needs.plan.outputs.release_sha }}");
  assert.equal(named(job, "Install dependencies").run, "npm ci");
  assert.equal(named(job, "Install dependencies")["working-directory"], "release-source");
  assert.deepEqual(named(job, "Build workspace packages"), named(pack, "Build workspace packages"));

  // Every shard of one matrix runs, so together they cover the whole suite.
  // The trusted runner executes inside the release source it tests.
  assert.equal(job.strategy["fail-fast"], false);
  assert.deepEqual(job.strategy.matrix, { shard: [1, 2, 3, 4] });
  assert.equal(named(job, "Run test shard").run.trim(), [
    "cd release-source",
    "node ../.github/scripts/test-shards.mjs run ${{ matrix.shard }}/${{ strategy.job-total }}",
  ].join("\n"));
  for (const step of job.steps) {
    assert.equal(step.if, undefined, step.name);
    assert.equal(step["continue-on-error"], undefined, step.name);
  }
  assert.equal(job["continue-on-error"], undefined);
});

test("the release suite holds no privilege and contributes no release bytes", () => {
  const job = workflow.jobs.test;
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(job.permissions, undefined);
  assert.equal(job.environment, undefined);
  assert.equal(job.outputs, undefined);
  assert.doesNotMatch(JSON.stringify(job), /secrets\.|vars\.|id-token|GH_TOKEN|NODE_AUTH_TOKEN/);
  assert.deepEqual(
    job.steps.filter((step) => step.uses).map((step) => step.uses.split("@")[0]),
    ["actions/checkout", "actions/checkout", "actions/setup-node"],
  );
  for (const step of job.steps.filter((candidate) => /actions\/checkout@/.test(candidate.uses))) {
    assert.equal(step.with["persist-credentials"], false);
  }
});

test("no release job restores a dependency or build cache", () => {
  for (const [id, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps) {
      assert.doesNotMatch(step.uses ?? "", /actions\/cache|\.github\/actions\/install/, `${id}: ${step.name}`);
      if (/actions\/setup-node@/.test(step.uses ?? "")) {
        assert.equal(step.with["package-manager-cache"], false, `${id}: ${step.name}`);
        assert.equal(step.with.cache, undefined, `${id}: ${step.name}`);
        assert.equal(step.with["node-version"], 24, `${id}: ${step.name}`);
      }
    }
  }
});

test("attestation and publication both require the pack job and every test shard", () => {
  const { attest, publish } = workflow.jobs;
  assert.deepEqual(attest.needs, ["plan", "verify", "test"]);
  assert.deepEqual(publish.needs, ["plan", "verify", "test", "attest"]);
  // A status function such as always() would let a job run past a failed or
  // skipped dependency; the plain condition keeps the implicit success().
  for (const job of [attest, publish]) {
    assert.equal(job.if, "needs.plan.outputs.has_packages == 'true'");
  }
  assert.doesNotMatch(workflow.jobs.handoff.if, /always\(\)|failure\(\)|cancelled\(\)/);
  assert.ok(workflow.jobs.handoff.needs.includes("publish"));
});

test("no job after packing can act unless every test shard passed", () => {
  // Before the suite moved beside packing, everything downstream of `verify`
  // inherited its test gate. Now each job that attests, publishes, hands off,
  // or consumes the packed artifact must reach `test` through its own needs,
  // and none may use a status function that runs past a failed dependency.
  const needsOf = (id) => [workflow.jobs[id].needs ?? []].flat();
  const ancestors = (id, seen = new Set()) => {
    for (const parent of needsOf(id)) if (!seen.has(parent)) { seen.add(parent); ancestors(parent, seen); }
    return seen;
  };
  const gated = Object.keys(workflow.jobs).filter((id) => !["plan", "test", "verify"].includes(id));
  assert.deepEqual(gated.sort(), ["attest", "handoff", "publish"]);
  for (const id of gated) {
    assert.ok(ancestors(id).has("test"), id);
    assert.doesNotMatch(workflow.jobs[id].if ?? "", /always\(\)|failure\(\)|cancelled\(\)|success\(\)/, id);
  }
  // The test job itself must cover the suite: every shard of one matrix.
  assert.equal(workflow.jobs.test.strategy["fail-fast"], false);
});

test("the shard runner reads its timings from beside the trusted script", async () => {
  // The release job runs the policy checkout's runner with the release source
  // as the working directory, so a path relative to that directory would read
  // (or miss) the source's copy instead.
  const { TIMINGS_PATH } = await import("./test-shards.mjs");
  assert.equal(TIMINGS_PATH, fileURLToPath(new URL("../ci/test-timings.json", import.meta.url)));
});

test("mints a narrowed Cloud workflow token only after publish succeeds", () => {
  const handoff = workflow.jobs.handoff;
  assert.deepEqual(handoff.needs, ["plan", "publish"]);
  assert.equal(handoff.if, "needs.plan.outputs.should_handoff == 'true'");
  assert.equal(handoff.environment, "release-control");
  assert.deepEqual(handoff.permissions, { contents: "read" });

  const tokenStep = handoff.steps.find(
    (step) => step.name === "Mint the Cloud workflow token",
  );
  assert.equal(tokenStep.with.repositories, "thally-cloud");
  assert.equal(tokenStep.with["permission-actions"], "write");
  assert.equal(tokenStep.with["permission-contents"], "read");
  const dispatchStep = handoff.steps.find(
    (step) => step.name === "Dispatch the cloud release tail",
  );
  assert.match(dispatchStep.run, /workflow run promote-scaffold-release\.yml/);
  assert.match(dispatchStep.run, /-f automated=true/);
  assert.match(dispatchStep.run, /request_id="handoff-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
});

test("recovers immutable sources with the current trusted release policy", () => {
  const planSteps = workflow.jobs.plan.steps;
  const verifySteps = workflow.jobs.verify.steps;
  const handoffSteps = workflow.jobs.handoff.steps;
  assert.ok(planSteps.some((step) => step.name === "Checkout trusted release policy"));
  assert.ok(planSteps.some((step) => step.name === "Checkout immutable release source"));
  assert.ok(verifySteps.some((step) => step.name === "Checkout trusted release policy"));
  assert.ok(verifySteps.some((step) => step.name === "Checkout immutable release source"));
  assert.ok(
    verifySteps.some(
      (step) => step.name === "Select the authorized immutable release source",
    ),
  );
  const testSteps = workflow.jobs.test.steps;
  for (const name of ["Checkout trusted release policy", "Checkout immutable release source",
    "Select the authorized immutable release source"]) {
    assert.ok(testSteps.some((step) => step.name === name), name);
  }
  assert.ok(handoffSteps.some((step) => step.name === "Checkout trusted handoff policy"));
  const prepare = handoffSteps.find(
    (step) => step.name === "Validate and prepare the immutable locator",
  );
  assert.equal(prepare.env.RELEASE_SOURCE_DIRECTORY, "release-source");
});

test("bumps the scaffold package graph before refreshing the lockfile", () => {
  const bumpStep = promotionWorkflow.jobs.promote.steps.find(
    (step) => step.name === "Bump package patch versions",
  );

  assert.match(bumpStep.run, /bump-release-packages\.mjs/);
  assert.match(
    bumpStep.run,
    /npm install --package-lock-only --ignore-scripts/,
  );
  assert.doesNotMatch(bumpStep.run, /npm version/);
});

test("keeps the one-click coordinator on main with a short-lived App token", () => {
  const releaseJob = fullReleaseWorkflow.jobs.release;
  assert.equal(releaseJob.environment, "release-control");
  assert.deepEqual(fullReleaseWorkflow.permissions, { contents: "read" });
  assert.match(
    releaseJob.steps.find((step) => step.name === "Reject non-main dispatches")
      .run,
    /refs\/heads\/main/,
  );

  const tokenStep = releaseJob.steps.find(
    (step) => step.name === "Mint the release coordinator token",
  );
  assert.match(tokenStep.uses, /actions\/create-github-app-token@[0-9a-f]{40}/);
  assert.match(tokenStep.with.repositories, /thally\nstarter\nthally-cloud/);
  assert.equal(
    tokenStep.with["private-key"],
    "${{ secrets.RELEASE_COORDINATOR_PRIVATE_KEY }}",
  );
  assert.equal(
    tokenStep.with["client-id"],
    "${{ vars.RELEASE_COORDINATOR_CLIENT_ID }}",
  );
  assert.equal(tokenStep.with["permission-actions"], "write");
  assert.equal(tokenStep.with["permission-contents"], "read");
});

test("coordinates the exact starter, package, and Cloud release workflows", () => {
  const script = [
    jobScript(fullReleaseWorkflow.jobs.release),
    jobScript(fullReleaseWorkflow.jobs.publication),
  ].join("\n");
  assert.match(script, /workflow run sync-runtime\.yml/);
  assert.match(script, /-f runtime_ref="\$RUNTIME_SHA"/);
  assert.match(script, /workflow run promote-release\.yml/);
  assert.match(script, /-f starter_sha="\$STARTER_SHA"/);
  assert.match(script, /-f release_base_sha="\$RUNTIME_SHA"/);
  assert.match(script, /workflow publish-packages\.yml/);
  assert.match(script, /actions\/workflows\/promote-scaffold-release\.yml\/runs/);
  assert.match(script, /gh run watch/);
});

test("recovers the current stable record before selecting another runtime", () => {
  const steps = fullReleaseWorkflow.jobs.release.steps;
  const detectIndex = steps.findIndex(
    (step) => step.name === "Detect an already-stable release before selecting new work",
  );
  const syncIndex = steps.findIndex(
    (step) => step.name === "Start the standalone starter synchronization",
  );
  const detect = steps[detectIndex];
  const sync = steps[syncIndex];
  assert.ok(detectIndex >= 0 && detectIndex < syncIndex);
  assert.match(detect.run, /runtime_head.*record_sha/);
  assert.match(detect.run, /starter_head.*source\.commitSha/);
  assert.match(detect.run, /current_stable=true/);
  assert.equal(sync.if, "steps.release.outputs.current_stable != 'true'");
});

test("auto-merges release records only after the exact PR CI run succeeds", () => {
  assert.equal(promotionWorkflow.jobs.promote.environment, "release-control");
  const mergeStep = promotionWorkflow.jobs.promote.steps.find(
    (step) => step.name === "Merge after CI succeeds",
  );
  assert.equal(
    mergeStep.if,
    "inputs.auto_merge && github.actor == vars.RELEASE_COORDINATOR_ACTOR",
  );
  assert.match(mergeStep.run, /--workflow ci\.yml/);
  assert.match(mergeStep.run, /ci_conclusion="\$\(run_conclusion "\$GITHUB_REPOSITORY" "\$run_id"\)"/);
  assert.match(mergeStep.run, /if \[\[ "\$ci_conclusion" != "success" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
  assert.match(mergeStep.run, /base_sha.*EXPECTED_BASE_SHA/);
  assert.match(mergeStep.run, /current_base.*commits\/main/);
  assert.match(mergeStep.run, /current_base.*EXPECTED_BASE_SHA/);
  assert.match(mergeStep.run, /final_base.*EXPECTED_BASE_SHA/);
  assert.match(mergeStep.run, /--match-head-commit "\$head_sha"/);
});

test("computes and correlates releases from frozen source commits", () => {
  const sourceStep = promotionWorkflow.jobs.promote.steps.find(
    (step) => step.name === "Prove the selected sources are on main",
  );
  const computeStep = promotionWorkflow.jobs.promote.steps.find(
    (step) => step.name === "Compute the new scaffold release record",
  );
  assert.match(sourceStep.run, /starter_sha=\$selected_sha/);
  assert.match(sourceStep.run, /runtime_sha=\$selected_runtime_sha/);
  assert.match(sourceStep.run, /RELEASE_BASE_SHA.*selected_release_base/);
  assert.match(sourceStep.run, /release_base_sha=\$selected_release_base/);
  assert.equal(
    computeStep.env.STARTER_SHA_INPUT,
    "${{ steps.sources.outputs.starter_sha }}",
  );
  assert.equal(
    computeStep.env.RUNTIME_SHA_INPUT,
    "${{ steps.sources.outputs.runtime_sha }}",
  );

  const controllerScript = [
    jobScript(fullReleaseWorkflow.jobs.release),
    jobScript(fullReleaseWorkflow.jobs.publication),
  ].join("\n");
  assert.match(controllerScript, /commits\?path=.*stable-scaffold-release\.json/);
  assert.match(controllerScript, /candidate_record/);
  assert.match(controllerScript, /-f release_commit_sha="\$RECORD_SHA"/);
  assert.match(controllerScript, /display_title == \$title/);
  assert.match(controllerScript, /actor\.login == \$actor/);
  assert.match(controllerScript, /scaffold-production · automated/);
  assert.match(controllerScript, /event=repository_dispatch/);
  assert.match(controllerScript, /LEGACY_RELEASE_ACTOR/);
  assert.match(controllerScript, /legacy_log/);
  // An expired legacy run log must not abort the resume check.
  assert.match(controllerScript, /if ! legacy_log="\$\(/);
  assert.match(controllerScript, /--log 2>\/dev\/null\s*\)"; then\s+echo "::notice::[^\n]*\n\s+continue/);
});

test("overlaps the starter synchronization with the release-record promotion", () => {
  const job = fullReleaseWorkflow.jobs.release;
  const order = [
    "Detect an already-stable release before selecting new work",
    "Start the standalone starter synchronization",
    "Freeze and verify the starter selection",
    "Check whether this pair is already stable",
    "Start the immutable release-record promotion",
    "Require the starter synchronization to succeed",
    "Wait for the merged release record",
    "Resolve the published release record",
  ].map((name) => {
    namedStep(job, name);
    return job.steps.findIndex((step) => step.name === name);
  });
  assert.deepEqual(order, [...order].sort((left, right) => left - right));

  // The first wait ends when the starter pull request exists, not when the
  // starter run does; the whole run is watched only after promotion started.
  const sync = namedStep(job, "Start the standalone starter synchronization");
  assert.doesNotMatch(sync.run, /gh run watch/);
  assert.match(sync.run, /select\(\.name == "Open synchronization pull request" and \.status == "completed"\)/);
  assert.match(sync.run, /"\$pr_step" != "success"/);
  assert.match(sync.run, /ended .* before opening its pull request/);
  assert.match(sync.run, /run_id=\$run_id/);

  const promotion = namedStep(job, "Start the immutable release-record promotion");
  assert.equal(promotion.if, "steps.stable.outputs.needed == 'true'");
  assert.doesNotMatch(promotion.run, /gh run watch/);
  assert.match(promotion.run, /run_id=\$run_id/);

  const wait = namedStep(job, "Wait for the merged release record");
  assert.equal(wait.if, "steps.stable.outputs.needed == 'true'");
  assert.match(wait.run, /conclusion="\$\(run_conclusion thallylabs\/thally "\$PROMOTION_RUN_ID"\)"/);
  assert.match(wait.run, /if \[\[ "\$conclusion" != "success" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
  assert.equal(wait.env.PROMOTION_RUN_ID, "${{ steps.promotion.outputs.run_id }}");
});

test("selects the starter commit its own synchronization run produced", () => {
  const job = fullReleaseWorkflow.jobs.release;
  const selection = namedStep(job, "Freeze and verify the starter selection");
  assert.equal(selection.if, "steps.release.outputs.current_stable != 'true'");
  assert.equal(selection.env.SYNC_RUN_ID, "${{ steps.sync.outputs.run_id }}");
  // The run's merge step decides between starter main and the pull request,
  // so a pull request left open by an earlier attempt is never selected when
  // this run changed nothing.
  assert.match(selection.run, /select\(\.name == "Merge after CI succeeds"\)/);
  const unchanged = offsetOf(selection.run, /\n\s+skipped\)\n\s+starter_sha="\$\(gh api repos\/thallylabs\/starter\/commits\/main --jq \.sha\)"/);
  const changed = offsetOf(selection.run, /\n\s+in_progress\|success\)/);
  const unknown = offsetOf(selection.run, /\n\s+\*\)\n\s+echo "::error::[^\n]*\n\s+exit 1/);
  assert.ok(unchanged < changed && changed < unknown);
  assert.match(selection.run, /sync_branch="automation\/runtime-\$\{RUNTIME_SHA:0:12\}"/);
  assert.match(selection.run, /git\/ref\/heads\/\$sync_branch/);
  assert.match(selection.run, /pulls\?state=open&base=main&head=thallylabs:\$sync_branch/);
  assert.match(selection.run, /"\$branch_sha" == "\$pr_head_sha"/);
  // Whichever commit is selected must pin the runtime being released.
  const pin = offsetOf(selection.run, /contents\/starter-release\.json\?ref=\$starter_sha/);
  const mismatch = offsetOf(selection.run, /"\$pinned_runtime" != "\$RUNTIME_SHA"/);
  const output = offsetOf(selection.run, /starter_sha=\$starter_sha" >> "\$GITHUB_OUTPUT"/);
  assert.ok(unknown < pin && pin < mismatch && mismatch < output);
});

test("the blocking stage fails unless the starter synchronization succeeds", () => {
  const job = fullReleaseWorkflow.jobs.release;
  const required = namedStep(job, "Require the starter synchronization to succeed");
  // Not conditional on a promotion: an already-recorded pair still requires it.
  assert.equal(required.if, "steps.release.outputs.current_stable != 'true'");
  assert.equal(required["continue-on-error"], undefined);
  assert.equal(required.env.SYNC_RUN_ID, "${{ steps.sync.outputs.run_id }}");
  assert.equal(required.env.STARTER_SHA, "${{ steps.starter.outputs.starter_sha }}");

  // The run's result is read from its recorded conclusion, with retries; a
  // failing `gh run watch` alone (for example a network error) decides nothing.
  assert.match(required.run, /gh run watch "\$SYNC_RUN_ID" --repo thallylabs\/starter >&2 \|\| true/);
  assert.doesNotMatch(required.run, /--exit-status/);
  assert.match(required.run, /--json status,conclusion \\\n\s+--jq 'select\(\.status == "completed"\) \| \.conclusion'/);
  // The selected commit itself, not just some synchronization, reached main,
  // and "not on main" needs two agreeing reads.
  assert.match(required.run, /compare\/\$\{STARTER_SHA\}\.\.\.main" --jq \.status/);
  assert.match(required.run, /ahead\|identical\)\n\s+echo landed/);
  assert.match(required.run, /behind\|diverged\)\n\s+missing=\$\(\(missing \+ 1\)\)\n\s+if \[\[ "\$missing" -ge 2 \]\]; then\n\s+echo missing/);
  assert.equal(required.run.match(/delay=\$\(\(delay \* 2\)\)/g).length, 2);

  // Success is exactly: the run succeeded and the commit landed. Everything
  // else exits non-zero.
  const success = offsetOf(required.run, /if \[\[ "\$conclusion" == "success" && "\$state" == "landed" \]\]; then\n\s+exit 0\nfi/);
  assert.ok(success < offsetOf(required.run, /case "\$\{conclusion:-unobserved\}\/\$state" in/));
  assert.match(required.run, /esac\nexit 1\n?$/);
  assert.equal(required.run.match(/exit 0/g).length, 1);

  // The promotion is cancelled only when the commit will definitely not
  // land, or the run failed and the commit is not known to have landed.
  const branches = Object.fromEntries(
    [...required.run.matchAll(/\n {2}(\S+)\)\n([\s\S]*?)\n {4};;/g)].map((match) => [match[1], match[2]]),
  );
  assert.deepEqual(Object.keys(branches), [
    "success/missing", "success/unknown", "unobserved/landed", "unobserved/*", "*/landed", "*/missing", "*",
  ]);
  const cancels = Object.entries(branches)
    .filter(([, body]) => /\bstop_promotion\b/.test(body))
    .map(([pattern]) => pattern);
  assert.deepEqual(cancels, ["success/missing", "*/missing", "*"]);
  // Only the case that really is a non-fast-forward merge says so.
  const blamesSquash = Object.entries(branches)
    .filter(([, body]) => /squash/.test(body))
    .map(([pattern]) => pattern);
  assert.deepEqual(blamesSquash, ["success/missing"]);
  assert.ok(Object.values(branches).every((body) => /::error::/.test(body)));
  assert.match(required.run, /gh run cancel "\$PROMOTION_RUN_ID" --repo thallylabs\/thally/);
});

test("splits the controller into a blocking stage and a publication tail", () => {
  assert.deepEqual(Object.keys(fullReleaseWorkflow.jobs), ["release", "publication"]);
  const blocking = fullReleaseWorkflow.jobs.release;
  const tail = fullReleaseWorkflow.jobs.publication;
  const tailCondition =
    "needs.release.outputs.needed == 'true' || needs.release.outputs.cloud_complete != 'true'";

  // The blocking stage ends at the merged record and never waits on the tail.
  assert.deepEqual(blocking.steps.map((step) => step.name).slice(-4), [
    "Resolve the published release record",
    "Re-drive an interrupted stable release",
    "Resolve the active release",
    "Write blocking-stage summary",
  ]);
  assert.doesNotMatch(jobScript(blocking), /--workflow publish-packages\.yml|display_title == \$title/);
  assert.match(namedStep(blocking, "Write blocking-stage summary").run, /continuing in the \*\*Publish · Promote to Cloud\*\* job/);
  assert.equal(tail.name, "Publish · Promote to Cloud");

  // A tail failure fails the run: it depends only on the blocking stage, is
  // never skipped or tolerated, and no step ignores an error except the two
  // warning-only steps that start the hosted toolchain sync early.
  assert.equal(tail.needs, "release");
  assert.equal(tail.if, undefined);
  for (const job of [blocking, tail]) {
    assert.equal(job["continue-on-error"], undefined);
    assert.equal(job.environment, "release-control");
    assert.match(namedStep(job, "Reject non-main dispatches").run, /refs\/heads\/main/);
  }
  assert.ok(blocking.steps.every((step) => step["continue-on-error"] === undefined));
  assert.deepEqual(
    tail.steps.filter((step) => step["continue-on-error"] !== undefined).map((step) => step.id),
    ["early-toolchain-token", "early-toolchain"],
  );
  assert.deepEqual(tail.steps.map((step) => [step.name, step.if]), [
    ["Reject non-main dispatches", undefined],
    ["Mint the publication observer token", tailCondition],
    ["Mint the early toolchain sync token", tailCondition],
    ["Start the Cloud toolchain sync early", tailCondition],
    ["Wait for npm publication", tailCondition],
    ["Mint the Cloud observer token", tailCondition],
    ["Wait for exact Cloud production handoff", tailCondition],
    ["Mint the Cloud observer token (wait 2)", "steps.cloud-wait-1.outputs.concluded == 'false'"],
    ["Keep waiting for the Cloud production handoff (wait 2)", "steps.cloud-wait-1.outputs.concluded == 'false'"],
    ["Mint the Cloud observer token (wait 3)", "steps.cloud-wait-2.outputs.concluded == 'false'"],
    ["Keep waiting for the Cloud production handoff (wait 3)", "steps.cloud-wait-2.outputs.concluded == 'false'"],
    ["Write release summary", undefined],
  ]);

  // Only identifiers cross the job boundary. The tail mints its own tokens
  // and cannot see a step output of the blocking stage. Its observers are
  // read-only; the early toolchain token is pinned by its own test.
  assert.deepEqual(blocking.outputs, {
    needed: "${{ steps.stable.outputs.needed }}",
    cloud_complete: "${{ steps.stable.outputs.cloud_complete }}",
    record_sha: "${{ steps.active-release.outputs.record_sha }}",
    release_id: "${{ steps.active-release.outputs.release_id }}",
    new_release_id: "${{ steps.published.outputs.release_id }}",
    existing_release_id: "${{ steps.stable.outputs.release_id }}",
    request_id: "${{ steps.release.outputs.request_id }}",
    runtime_sha: "${{ steps.release.outputs.runtime_sha }}",
    starter_sha: "${{ steps.release.outputs.stable_starter_sha || steps.starter.outputs.starter_sha }}",
  });
  assert.doesNotMatch(JSON.stringify(blocking.outputs), /token/i);
  const tailText = JSON.stringify(tail);
  assert.doesNotMatch(tailText, /steps\.(?:coordinator|release|stable|starter|published|active-release|sync|promotion)\./);
  for (const [name, repository] of [
    ["Mint the publication observer token", "thally"],
    ["Mint the Cloud observer token", "thally-cloud"],
    ["Mint the Cloud observer token (wait 2)", "thally-cloud"],
    ["Mint the Cloud observer token (wait 3)", "thally-cloud"],
  ]) {
    const token = namedStep(tail, name);
    assert.match(token.uses, /actions\/create-github-app-token@[0-9a-f]{40}/);
    assert.equal(token.with.repositories, repository);
    assert.equal(token.with["permission-actions"], "read");
    assert.equal(token.with["permission-contents"], "read");
    assert.equal(token.with["private-key"], "${{ secrets.RELEASE_COORDINATOR_PRIVATE_KEY }}");
  }
  const publication = namedStep(tail, "Wait for npm publication");
  assert.deepEqual(publication.env, {
    GH_TOKEN: "${{ steps.publication-observer.outputs.token }}",
    IS_NEW_RELEASE: "${{ needs.release.outputs.needed }}",
    RECORD_SHA: "${{ needs.release.outputs.record_sha }}",
    RELEASE_ID: "${{ needs.release.outputs.release_id }}",
    REQUEST_ID: "${{ needs.release.outputs.request_id }}",
  });
  assert.match(publication.run, /conclusion="\$\(run_conclusion thallylabs\/thally "\$publish_run"\)"/);
  assert.match(publication.run, /if \[\[ "\$conclusion" != "success" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
  assert.match(publication.run, /if \[\[ -z "\$publish_attempt" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
  const cloud = namedStep(tail, "Wait for exact Cloud production handoff");
  assert.equal(cloud.env.GH_TOKEN, "${{ steps.cloud-observer.outputs.token }}");
  assert.equal(cloud.env.EXPECTED_TITLE, "${{ steps.publication.outputs.expected_cloud_title }}");
  // The staged Cloud wait has its own tests below; a concluded failure
  // still fails the step.
  assert.match(cloud.run, /if \[\[ "\$conclusion" != "success" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
});

test("starts the hosted toolchain sync early without gating publication", () => {
  const tail = fullReleaseWorkflow.jobs.publication;
  const names = tail.steps.map((step) => step.name);
  const token = namedStep(tail, "Mint the early toolchain sync token");
  const start = namedStep(tail, "Start the Cloud toolchain sync early");

  // Started before the npm wait, so it overlaps publication instead of
  // following it, and only after the main-only guard.
  assert.ok(names.indexOf("Reject non-main dispatches") < names.indexOf(token.name));
  assert.equal(names.indexOf(start.name), names.indexOf(token.name) + 1);
  assert.equal(names.indexOf("Wait for npm publication"), names.indexOf(start.name) + 1);

  // Warning-only: neither step can fail the job, and nothing later reads
  // either one, so they gate nothing.
  assert.equal(token["continue-on-error"], true);
  assert.equal(start["continue-on-error"], true);
  for (const later of tail.steps.slice(names.indexOf(start.name) + 1)) {
    assert.doesNotMatch(JSON.stringify(later), /early-toolchain/, later.name);
  }

  // The narrowest token that can dispatch one Cloud workflow.
  assert.equal(token.id, "early-toolchain-token");
  assert.equal(token.uses, "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1");
  assert.deepEqual(token.with, {
    "client-id": "${{ vars.RELEASE_COORDINATOR_CLIENT_ID }}",
    "private-key": "${{ secrets.RELEASE_COORDINATOR_PRIVATE_KEY }}",
    owner: "${{ github.repository_owner }}",
    repositories: "thally-cloud",
    "permission-actions": "write",
  });

  // The source is the runtime commit the release record pins, the commit
  // the Cloud promotion verifies. Values arrive only through env.
  assert.deepEqual(start.env, {
    GH_TOKEN: "${{ steps.early-toolchain-token.outputs.token }}",
    RUNTIME_SHA: "${{ needs.release.outputs.runtime_sha }}",
  });
  assert.doesNotMatch(start.run, /\$\{\{/);
  assert.match(start.run, /\[\[ ! "\$RUNTIME_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(start.run, /early_request="early-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
  assert.match(start.run, /repos\/thallylabs\/thally-cloud\/actions\/workflows\/sync-public-toolchain\.yml\/dispatches/);

  // Dispatch only: no waiting, polling, or failing exit.
  assert.doesNotMatch(start.run, /gh run (?:watch|view|list)|\bsleep\b|exit 1|set -e/);
  assert.match(start.run, /exit 0\n?$/);
});

test("the early toolchain sync start warns instead of failing", () => {
  const { run } = namedStep(fullReleaseWorkflow.jobs.publication, "Start the Cloud toolchain sync early");
  const directory = mkdtempSync(join(tmpdir(), "early-toolchain-"));
  const calls = join(directory, "calls");
  // A stand-in `gh` that records its arguments and request body, then
  // succeeds or fails as the case requires.
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${calls}"\ncat >> "${calls}"\nexit "\${FAKE_GH_STATUS:-0}"\n`,
    { mode: 0o755 },
  );
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const execute = (env) => {
    rmSync(calls, { force: true });
    const result = spawnSync("bash", ["-c", run], {
      encoding: "utf8",
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "2",
        GH_TOKEN: "token",
        RUNTIME_SHA: sha,
        ...env,
      },
    });
    const recorded = existsSync(calls) ? readFileSync(calls, "utf8") : "";
    return { ...result, recorded };
  };

  try {
    const started = execute({});
    assert.equal(started.status, 0);
    assert.doesNotMatch(started.stdout, /::warning::/);
    const newline = started.recorded.indexOf("\n");
    const args = started.recorded.slice(0, newline);
    const body = started.recorded.slice(newline + 1);
    assert.equal(args, "api --method POST repos/thallylabs/thally-cloud/actions/workflows/sync-public-toolchain.yml/dispatches --input -");
    assert.deepEqual(JSON.parse(body), {
      ref: "main",
      inputs: { source_sha: sha, request_id: "early-123-2" },
    });

    const rejected = execute({ FAKE_GH_STATUS: "1" });
    assert.equal(rejected.status, 0);
    assert.match(rejected.stdout, /::warning::Could not start the Cloud toolchain sync early/);

    for (const runtime of ["", "main", sha.slice(0, 12), `${sha}\nx`]) {
      const invalid = execute({ RUNTIME_SHA: runtime });
      assert.equal(invalid.status, 0, runtime);
      assert.match(invalid.stdout, /::warning::Did not start the Cloud toolchain sync early/, runtime);
      assert.equal(invalid.recorded, "", runtime);
    }

    const untokened = execute({ GH_TOKEN: "" });
    assert.equal(untokened.status, 0);
    assert.match(untokened.stdout, /::warning::Could not mint a token/);
    assert.equal(untokened.recorded, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** The Cloud wait stages of the publication tail, in step order. */
const cloudWaitStages = () =>
  fullReleaseWorkflow.jobs.publication.steps.filter((step) => /^cloud-wait-\d+$/.test(step.id ?? ""));
/** The part of a stage script shared by every stage. */
const sharedWait = (run) => run.slice(offsetOf(run, /^# Bounded wait:/m));

test("splits the Cloud wait into bounded stages, each with a fresh read-only token", () => {
  const tail = fullReleaseWorkflow.jobs.publication;
  const names = tail.steps.map((step) => step.name);
  const stages = cloudWaitStages();
  const count = Number(stages[0].env.WAIT_STAGES);
  assert.ok(count >= 2);
  assert.equal(stages.length, count);
  const firstMint = namedStep(tail, "Mint the Cloud observer token");
  assert.deepEqual(firstMint.with, {
    "client-id": "${{ vars.RELEASE_COORDINATOR_CLIENT_ID }}",
    "private-key": "${{ secrets.RELEASE_COORDINATOR_PRIVATE_KEY }}",
    owner: "${{ github.repository_owner }}",
    repositories: "thally-cloud",
    "permission-actions": "read",
    "permission-contents": "read",
  });
  // The first stage starts only after npm completes, as before.
  assert.ok(names.indexOf("Wait for npm publication") < names.indexOf(firstMint.name));

  stages.forEach((stage, index) => {
    const number = index + 1;
    assert.equal(stage.id, `cloud-wait-${number}`);
    assert.equal(Number(stage.env.WAIT_STAGE), number);
    assert.equal(Number(stage.env.WAIT_STAGES), count);
    assert.doesNotMatch(stage.run, /\$\{\{/);

    // Every stage is preceded by its own mint, with exactly the first
    // observer's read-only scope from the same pinned action.
    const mint = tail.steps[tail.steps.indexOf(stage) - 1];
    assert.equal(mint.uses, firstMint.uses);
    assert.match(mint.uses, /^actions\/create-github-app-token@[0-9a-f]{40}$/);
    assert.deepEqual(mint.with, firstMint.with);
    assert.equal(mint.if, stage.if);
    assert.equal(stage.env.GH_TOKEN, `\${{ steps.${mint.id}.outputs.token }}`);

    // A later stage runs only when the previous one handed off a run still
    // in progress, reuses the first stage's run id, and never looks it up.
    if (number === 1) {
      assert.equal(stage.name, "Wait for exact Cloud production handoff");
      assert.equal(mint.id, "cloud-observer");
      assert.equal(stage.env.EXPECTED_TITLE, "${{ steps.publication.outputs.expected_cloud_title }}");
      assert.match(stage.run, /promote-scaffold-release\.yml\/runs/);
      assert.ok(
        offsetOf(stage.run, /echo "run_id=\$cloud_run" >> "\$GITHUB_OUTPUT"/) < offsetOf(stage.run, /^# Bounded wait:/m),
      );
    } else {
      assert.equal(stage.if, `steps.cloud-wait-${number - 1}.outputs.concluded == 'false'`);
      assert.equal(stage.env.CLOUD_RUN, "${{ steps.cloud-wait-1.outputs.run_id }}");
      assert.equal(stage.env.EXPECTED_TITLE, undefined);
      assert.doesNotMatch(stage.run, /gh api|display_title|\/runs\?/);
      assert.match(stage.run, /cloud_run="\$CLOUD_RUN"\nif \[\[ ! "\$cloud_run" =~ \^\[0-9\]\+\$ \]\]; then/);
    }
    // Each stage runs the same bounded wait.
    assert.equal(sharedWait(stage.run), sharedWait(stages[0].run));
  });

  // Each stage's reads fit inside one token's hour: the budget, and the
  // step's own backstop above it, are both below sixty minutes.
  const budget = Number(stages[0].env.STAGE_BUDGET_MINUTES);
  for (const stage of stages) {
    assert.equal(Number(stage.env.STAGE_BUDGET_MINUTES), budget);
    assert.ok(budget < stage["timeout-minutes"], stage.name);
    assert.ok(stage["timeout-minutes"] < 60, stage.name);
  }

  // The #379 pattern, bounded by the budget: the watch only waits and its
  // status is ignored, the conclusion is read separately, a good read resets
  // the failure count, and only ten failed reads in a row give up.
  const wait = sharedWait(stages[0].run);
  assert.match(wait, /deadline=\$\(\(started \+ STAGE_BUDGET_MINUTES \* 60\)\)/);
  assert.match(wait, /timeout "\$remaining" gh run watch "\$cloud_run" --repo thallylabs\/thally-cloud >&2 \|\| true/);
  assert.match(wait, /if state="\$\(\n\s+gh run view "\$cloud_run" --repo thallylabs\/thally-cloud --json status,conclusion/);
  assert.match(wait, /\)"; then\n\s+failures=0\n/);
  assert.match(wait, /if \[\[ "\$failures" -ge 10 \]\]; then\n\s+result="unreadable"/);
  assert.doesNotMatch(wait, /--exit-status/);
  // Only the stages read their results; the mints read them only to share
  // their stage's condition (checked above).
  for (const step of tail.steps.filter((candidate) => !stages.includes(candidate))) {
    assert.doesNotMatch(JSON.stringify({ ...step, if: undefined }), /cloud-wait-/, step.name);
  }
});

test("the publication job outlasts every step's bound, counting each Cloud stage at its budget", () => {
  const tail = fullReleaseWorkflow.jobs.publication;
  const stages = cloudWaitStages();
  const bounded = [
    "Mint the early toolchain sync token",
    "Start the Cloud toolchain sync early",
    "Wait for npm publication",
    ...tail.steps.filter((step) => /^cloud-observer/.test(step.id ?? "")).map((step) => step.name),
    ...stages.map((step) => step.name),
  ];
  for (const name of bounded) {
    assert.ok(Number.isInteger(namedStep(tail, name)["timeout-minutes"]), name);
  }
  // A slow but healthy release ends with the final stage's clear error,
  // not with the job being cancelled.
  const total = tail.steps.reduce(
    (sum, step) => sum + (stages.includes(step) ? Number(step.env.STAGE_BUDGET_MINUTES) : step["timeout-minutes"] ?? 0),
    0,
  );
  assert.ok(tail["timeout-minutes"] >= total, `${tail["timeout-minutes"]} < ${total}`);
  // The npm observer is minted at the start of the job; everything that uses
  // it finishes inside its hour.
  const steps = tail.steps.map((step) => step.name);
  const npmToken = tail.steps
    .slice(steps.indexOf("Mint the publication observer token") + 1, steps.indexOf("Wait for npm publication") + 1)
    .reduce((sum, step) => sum + step["timeout-minutes"], 0);
  assert.ok(npmToken < 60, `${npmToken}`);
});

test("each Cloud wait stage concludes, hands off, or fails with what it knows", () => {
  const stages = cloudWaitStages();
  const budgetSeconds = Number(stages[0].env.STAGE_BUDGET_MINUTES) * 60;
  const directory = mkdtempSync(join(tmpdir(), "cloud-wait-"));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const file = (name) => join(directory, name);
  const script = (name, body) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  // A fake clock: `date` reads it, `sleep` advances it, and `timeout`
  // advances it as if the watch it bounds ran for WATCH_SECONDS (at most
  // the limit it was given).
  script("date", `cat "${file("clock")}"`);
  script("sleep", `echo $(( $(cat "${file("clock")}") + \${1%s} )) > "${file("clock")}"`);
  script(
    "timeout",
    `printf 'timeout %s\\n' "$1" >> "${file("calls")}"
limit="$1"; shift
ran="\${WATCH_SECONDS:-$limit}"; [[ "$ran" -gt "$limit" ]] && ran="$limit"
echo $(( $(cat "${file("clock")}") + ran )) > "${file("clock")}"
"$@"`,
  );
  // `gh` answers run views from a queue whose last answer repeats.
  script(
    "gh",
    `printf '%s\\n' "$*" >> "${file("calls")}"
case "$1 $2" in
  "run watch") exit "\${WATCH_STATUS:-0}" ;;
  "run view")
    line="$(head -n 1 "${file("views")}")"
    if [[ "$(wc -l < "${file("views")}")" -gt 1 ]]; then
      tail -n +2 "${file("views")}" > "${file("views")}.next"
      mv "${file("views")}.next" "${file("views")}"
    fi
    [[ "$line" == fail ]] && exit 1
    printf '%s\\n' "$line" ;;
  "api repos/thallylabs/thally-cloud/actions/workflows/promote-scaffold-release.yml/runs?event=workflow_dispatch&per_page=100")
    printf '%s' "$RUNS_JSON" ;;
  *) exit 2 ;;
esac`,
  );
  const title = "scaffold-production · automated · handoff-1-1 · 2026-11-24.a · abc";
  const runs = JSON.stringify({
    workflow_runs: [
      { id: 111, display_title: "another release", actor: { login: "coordinator" } },
      { id: 555, display_title: title, actor: { login: "someone-else" } },
      { id: 987, display_title: title, actor: { login: "coordinator" } },
    ],
  });
  const start = 1_000_000;
  const execute = (stage, views, env = {}) => {
    writeFileSync(file("clock"), `${start}\n`);
    writeFileSync(file("views"), `${views.join("\n")}\n`);
    writeFileSync(file("output"), "");
    rmSync(file("calls"), { force: true });
    const result = spawnSync("bash", ["-c", stages[stage - 1].run], {
      encoding: "utf8",
      // A stage that never ends fails here instead of hanging the suite.
      timeout: 20_000,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_OUTPUT: file("output"),
        GH_TOKEN: "token",
        STAGE_BUDGET_MINUTES: stages[stage - 1].env.STAGE_BUDGET_MINUTES,
        WAIT_STAGE: String(stage),
        WAIT_STAGES: String(stages.length),
        ...(stage === 1
          ? { COORDINATOR_ACTOR: "coordinator", EXPECTED_TITLE: title, RELEASE_ID: "2026-11-24.a", RUNS_JSON: runs }
          : { CLOUD_RUN: "987" }),
        ...env,
      },
    });
    const calls = existsSync(file("calls")) ? readFileSync(file("calls"), "utf8").trim().split("\n") : [];
    return {
      ...result,
      calls,
      views: calls.filter((call) => call.startsWith("run view")).length,
      elapsed: Number(readFileSync(file("clock"), "utf8")) - start,
      outputs: Object.fromEntries(
        readFileSync(file("output"), "utf8").trim().split("\n").filter(Boolean).map((line) => line.split("=")),
      ),
    };
  };

  try {
    // Stage 1 finds the run and sees it conclude, even when the watch and
    // one read fail.
    const concluded = execute(1, ["fail", "completed/success"], { WATCH_STATUS: "1" });
    assert.equal(concluded.status, 0, concluded.stdout);
    assert.deepEqual(concluded.outputs, { run_id: "987", concluded: "true" });
    assert.equal(concluded.views, 2);
    assert.equal(concluded.calls.filter((call) => call.startsWith("api ")).length, 1);
    assert.doesNotMatch(concluded.stdout, /::error::/);

    // Its budget runs out while the run is still going: it hands off with the
    // run id, having never waited past the budget by more than one poll.
    const handedOff = execute(1, ["in_progress/"], { WATCH_SECONDS: "600" });
    assert.equal(handedOff.status, 0, handedOff.stdout);
    assert.deepEqual(handedOff.outputs, { run_id: "987", concluded: "false" });
    assert.match(handedOff.stdout, /::notice::.*actions\/runs\/987 is still running after wait 1 of 3/);
    assert.ok(handedOff.views > 1);
    assert.ok(handedOff.elapsed >= budgetSeconds && handedOff.elapsed <= budgetSeconds + 30, `${handedOff.elapsed}`);
    for (const call of handedOff.calls.filter((line) => line.startsWith("timeout "))) {
      assert.ok(Number(call.split(" ")[1]) <= budgetSeconds, call);
    }

    // The next stage reuses that run id without a lookup and sees it conclude.
    const resumed = execute(2, ["in_progress/", "completed/success"], {
      CLOUD_RUN: handedOff.outputs.run_id,
      WATCH_SECONDS: "60",
    });
    assert.equal(resumed.status, 0, resumed.stdout);
    assert.deepEqual(resumed.outputs, { concluded: "true" });
    assert.ok(resumed.calls.every((call) => !call.startsWith("api ")));
    assert.ok(resumed.calls.some((call) => call.startsWith("run watch 987 ")));

    // A concluded failure still fails, as before.
    const failed = execute(2, ["completed/failure"]);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /::error::Cloud scaffold promotion run 987 ended with "failure"/);
    assert.deepEqual(failed.outputs, {});

    // Reads that keep failing are not a timeout: ten in a row give up with
    // the existing error, even before the budget is spent.
    const unreadable = execute(2, ["fail"], { WATCH_SECONDS: "1" });
    assert.equal(unreadable.status, 1);
    assert.match(unreadable.stdout, /::error::Cloud scaffold promotion run 987 ended with "a result GitHub did not return"/);
    assert.equal(unreadable.views, 10);
    assert.ok(unreadable.elapsed < budgetSeconds);
    assert.deepEqual(unreadable.outputs, {});

    // The final stage running out says where the promotion is still running.
    const exhausted = execute(stages.length, ["in_progress/"]);
    assert.equal(exhausted.status, 1);
    assert.match(
      exhausted.stdout,
      new RegExp(`::error::Cloud scaffold promotion run https://github\\.com/thallylabs/thally-cloud/actions/runs/987 is still running after ${stages.length * budgetSeconds / 60} minutes\\. Let it finish, then run Full release again`),
    );
    assert.deepEqual(exhausted.outputs, {});

    // A later stage without a run id fails before calling GitHub.
    const missing = execute(2, ["completed/success"], { CLOUD_RUN: "" });
    assert.equal(missing.status, 1);
    assert.deepEqual(missing.calls, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts a pending starter commit only for the controller's merging dispatch", () => {
  const sources = namedStep(promotionWorkflow.jobs.promote, "Prove the selected sources are on main");
  assert.equal(
    sources.env.ALLOW_PENDING_STARTER,
    "${{ inputs.auto_merge && github.actor == vars.RELEASE_COORDINATOR_ACTOR }}",
  );
  // The runtime must always be on main; only the starter rule is relaxed.
  assert.match(sources.run, /git -C runtime-source merge-base --is-ancestor "\$selected_runtime_sha" origin\/main\n/);
  const offMain = offsetOf(sources.run, /if ! git -C starter-source merge-base --is-ancestor "\$selected_sha" origin\/main; then/);
  const strict = offsetOf(
    sources.run,
    /if \[\[ "\$ALLOW_PENDING_STARTER" != "true" \|\| -z "\$STARTER_SHA_INPUT" \]\]; then\n[^\n]*is not on starter main[^\n]*\n\s+exit 1/,
  );
  const pullRequest = offsetOf(sources.run, /pulls\?state=open&base=main&head=thallylabs:\$\{sync_branch\}/);
  const missing = offsetOf(sources.run, /if \[\[ -z "\$starter_pending_pr" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
  const parent = offsetOf(
    sources.run,
    /"\$pending_parents" != "\$\(git -C starter-source rev-parse origin\/main\)" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/,
  );
  assert.ok(offMain < strict && strict < pullRequest && pullRequest < missing && missing < parent);
  assert.match(sources.run, /sync_branch="automation\/runtime-\$\{selected_runtime_sha:0:12\}"/);
  assert.match(
    sources.run,
    /select\(\.head\.repo\.full_name == "thallylabs\/starter" and \.head\.ref == \$branch and \.head\.sha == \$sha\)/,
  );
  assert.match(sources.run, /starter_pending_pr=\$starter_pending_pr" >> "\$GITHUB_OUTPUT"/);
});

test("never merges a release record before its starter commit is on starter main", () => {
  const steps = promotionWorkflow.jobs.promote.steps;
  const merge = namedStep(promotionWorkflow.jobs.promote, "Merge after CI succeeds");
  assert.equal(merge.env.STARTER_SHA, "${{ steps.sources.outputs.starter_sha }}");
  assert.match(
    merge.run,
    /starter_is_on_main\(\) \{\n\s+git -C starter-source fetch --no-tags --quiet origin main &&\n\s+git -C starter-source merge-base --is-ancestor "\$STARTER_SHA" FETCH_HEAD\n\}/,
  );
  const ci = offsetOf(merge.run, /if \[\[ "\$ci_conclusion" != "success" \]\]; then/);
  const wait = offsetOf(merge.run, /for attempt in \{1\.\.120\}; do\n\s+if starter_is_on_main; then/);
  const timeout = offsetOf(merge.run, /if \[\[ "\$starter_landed" != "true" \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
  const base = offsetOf(merge.run, /"\$current_base" != "\$EXPECTED_BASE_SHA" \|\| "\$final_base" != "\$EXPECTED_BASE_SHA"/);
  const gate = offsetOf(merge.run, /if ! starter_is_on_main; then\n[^\n]*::error::[^\n]*\n\s+exit 1\nfi\ngh pr merge "\$PR_NUMBER"/);
  assert.ok(ci < wait && wait < timeout && timeout < base && base < gate);
  assert.equal(merge.run.match(/gh pr merge/g).length, 1);

  // A starter merged by squash, or a superseded pull request, stops the
  // promotion with an actionable error instead of waiting for the timeout.
  assert.match(merge.run, /"\$starter_pr_head" != "\$STARTER_SHA" \]\]; then\n[^\n]*superseded[^\n]*\n\s+exit 1/);
  assert.match(merge.run, /"\$starter_pr_state" == "closed"[\s\S]*?fast-forward[^\n]*squash[^\n]*\n\s+exit 1/);

});

test("a failed controller promotion closes its record so a re-dispatch starts fresh", () => {
  const promote = promotionWorkflow.jobs.promote;
  const steps = promote.steps;
  const merge = namedStep(promote, "Merge after CI succeeds");
  const cleanup = namedStep(promote, "Close an unmerged release record after a failed promotion");
  assert.equal(steps.indexOf(cleanup), steps.indexOf(merge) + 1);
  assert.equal(steps.indexOf(cleanup), steps.length - 1);
  // Keyed on the computed release, not the pull request number, so it also
  // runs when the failure came before that number was recorded.
  assert.equal(
    cleanup.if,
    "(failure() || cancelled()) && inputs.auto_merge && github.actor == vars.RELEASE_COORDINATOR_ACTOR && steps.record.outputs.release_id != ''",
  );
  assert.equal(cleanup.env.RELEASE_ID, "${{ steps.record.outputs.release_id }}");
  assert.match(cleanup.run, /branch="release\/promote-\$\{RELEASE_ID\}"/);
  assert.match(cleanup.run, /"\$branch" =~ \^release\/promote-\[0-9\]\{4\}/);
  // Fail closed: nothing about the starter has to be proven before closing.
  assert.doesNotMatch(cleanup.run, /starter-source|merge-base|git fetch|exit 0/);
  assert.match(cleanup.run, /--state open \\\n\s+--json number,isCrossRepository/);
  assert.match(cleanup.run, /gh pr close "\$number"/);
  assert.match(cleanup.run, /\[\[ "\$failed" == "false" \]\]\n?$/);
  assert.doesNotMatch(cleanup.run, /gh pr merge/);
  // A merged record's branch is never deleted by cleanup.
  assert.ok(
    offsetOf(cleanup.run, /"\$merged_count" == "0" \|\| "\$merged_count" == "unknown" \]\] &&/) <
      offsetOf(cleanup.run, /--method DELETE "repos\/\$GITHUB_REPOSITORY\/git\/refs\/heads\/\$branch"/),
  );
  // A failed listing or close still removes the branch, which closes the
  // pull request on GitHub, and still fails the step.
  assert.match(cleanup.run, /if ! open_numbers="\$\(/);
  assert.match(cleanup.run, /\)" \|\| merged_count="unknown"/);

  // The next dispatch must not adopt the pull request this step closed.
  const open = namedStep(promote, "Open the release-record PR");
  assert.doesNotMatch(open.run, /gh pr view/);
  assert.match(open.run, /--state open \\\n\s+--json number,url,isCrossRepository/);
  assert.match(open.run, /map\(select\(\.isCrossRepository == false\)\) \| \.\[0\] \/\/ empty/);
  const lookup = offsetOf(open.run, /pr_json="\$\(open_pull_request\)"\nif \[\[ -z "\$pr_json" \]\]; then\n\s+gh pr create/);
  const guard = offsetOf(open.run, /if \[\[ ! "\$pr_number" =~ \^\[0-9\]\+\$ \]\]; then\n[^\n]*::error::[^\n]*\n\s+exit 1/);
  const output = offsetOf(open.run, /number=\$pr_number" >> "\$GITHUB_OUTPUT"/);
  assert.ok(lookup < guard && guard < output);
});

test("does not bump runtime packages after the starter source is frozen", () => {
  const openPullRequest = promotionWorkflow.jobs.promote.steps.find(
    (step) => step.name === "Open the release-record PR",
  );
  assert.doesNotMatch(openPullRequest.run, /packages\/core\/package\.json/);
  assert.doesNotMatch(openPullRequest.run, /packages\/migrate\/package\.json/);
});


test("proves historical upgrades before opening any immutable release record PR", () => {
  const steps = promotionWorkflow.jobs.promote.steps;
  const freeze = steps.findIndex(step => step.name === "Freeze outgoing stable upgrade baseline");
  const compute = steps.findIndex(step => step.name === "Compute the new scaffold release record");
  const gate = steps.findIndex(step => step.name === "Verify complete historical scaffold upgrades");
  const open = steps.findIndex(step => step.name === "Open the release-record PR");
  assert.ok(freeze >= 0 && freeze < compute && compute < gate && gate < open);
  assert.equal(steps[gate].if, undefined);
  assert.match(steps[gate].run, /verify-scaffold-upgrades\.mts/);
  assert.match(steps[gate].run, /starter-source/);
  assert.match(steps[gate].run, /outgoing-scaffold-release\.json/);
});

test("rechecks complete historical upgrades before artifact attestation and npm authority", () => {
  const steps = workflow.jobs.verify.steps;
  const gate = steps.findIndex(step => step.name === "Verify complete historical scaffold upgrades before packing");
  const pack = steps.findIndex(step => step.name === "Pack immutable release artifacts");
  assert.ok(gate >= 0 && gate < pack);
  assert.equal(steps[gate].if, undefined);
  assert.equal(steps[gate]["working-directory"], "release-source");
  assert.match(steps[gate].run, /BASE_SHA/);
  assert.match(steps[gate].run, /download/);
  assert.deepEqual(workflow.jobs.attest.needs, ["plan", "verify", "test"]);
  assert.deepEqual(workflow.jobs.publish.needs, ["plan", "verify", "test", "attest"]);
});

test("waits on other workflow runs without failing on a transient GitHub error", () => {
  // `gh run watch --exit-status` also exits non-zero when one API read fails,
  // which once failed a release whose publication went on to succeed. Every
  // wait reads the run's conclusion separately, and every lookup treats a
  // failed read as "not found yet".
  const helper = /run_conclusion\(\) \{\n\s+local repo="\$1" run="\$2" failures=0 state\n\s+while \[\[ "\$failures" -lt 10 \]\]; do\n\s+gh run watch "\$run" --repo "\$repo" >&2 \|\| true\n/;
  const waits = [
    [fullReleaseWorkflow.jobs.release, "Wait for the merged release record"],
    [fullReleaseWorkflow.jobs.publication, "Wait for npm publication"],
    [promotionWorkflow.jobs.promote, "Merge after CI succeeds"],
  ];
  for (const [job, name] of waits) {
    const { run } = namedStep(job, name);
    assert.match(run, helper, name);
    // The helper never fails the step itself; an empty answer is handled
    // by the caller's explicit success check.
    assert.match(run, /sleep 30\n\s+done\n\s+return 0\n\s*\}/, name);
  }
  for (const workflow of [fullReleaseWorkflow, promotionWorkflow]) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (typeof step.run !== "string") continue;
        assert.doesNotMatch(step.run, /gh run watch[^\n]*--exit-status/, step.name);
        // Each polling lookup assigned inside a retry loop survives a failed read.
        for (const variable of ["run_id", "publish_run", "cloud_run", "publish_attempt"]) {
          const assignments = step.run.match(new RegExp(`\\b${variable}="\\$\\(\\n[\\s\\S]*?\\n\\s*\\)"[^\\n]*`, "g")) ?? [];
          for (const assignment of assignments) {
            assert.match(assignment, new RegExp(`\\)" \\|\\| ${variable}=""$`), `${step.name}: ${variable}`);
          }
        }
      }
    }
  }
});
