/**
 * Structural tests for the release workflow's ordering and privilege boundary.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("starts only from a reviewed stable-record merge or an operator recovery", () => {
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.push.paths, [
    "packages/create-thally-docs/src/stable-scaffold-release.json",
    "packages/core/package.json",
    "packages/migrate/package.json",
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
  assert.deepEqual(workflow.jobs.publish.needs, ["plan", "verify", "attest"]);
  assert.match(workflow.jobs.plan.steps[0].run, /refs\/heads\/main/);
  assert.match(
    workflow.jobs.plan.steps.find(
      (step) => step.name === "Classify immutable scaffold handoff",
    ).run,
    /stable-scaffold-release\.json/,
  );
});

test("tests and packs before the minimal OIDC publish job", () => {
  const verify = workflow.jobs.verify;
  const attest = workflow.jobs.attest;
  const publish = workflow.jobs.publish;
  assert.equal(verify.permissions, undefined);
  assert.deepEqual(attest.permissions, {
    attestations: "write",
    contents: "read",
    "id-token": "write",
  });
  assert.equal(workflow.jobs.publish.environment, "npm-production");
  assert.equal(workflow.jobs.publish.permissions["id-token"], "write");
  assert.deepEqual(
    verify.steps.map((step) => step.name).slice(-2),
    ["Pack immutable release artifacts", "Upload immutable release artifacts"],
  );
  const publishScript = publish.steps.map((step) => step.run ?? "").join("\n");
  assert.match(publishScript, /publish-release-artifacts\.mjs/);
  assert.doesNotMatch(publishScript, /npm ci|npm test|npm pack|--workspace/);
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
  assert.ok(handoffSteps.some((step) => step.name === "Checkout trusted handoff policy"));
  const prepare = handoffSteps.find(
    (step) => step.name === "Validate and prepare the immutable locator",
  );
  assert.equal(prepare.env.RELEASE_SOURCE_DIRECTORY, "release-source");
});

test("bumps all package manifests atomically before refreshing the lockfile", () => {
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
  const script = fullReleaseWorkflow.jobs.release.steps
    .map((step) => step.run ?? "")
    .join("\n");
  assert.match(script, /workflow run sync-runtime\.yml/);
  assert.match(script, /-f runtime_ref="\$RUNTIME_SHA"/);
  assert.match(script, /workflow run promote-release\.yml/);
  assert.match(script, /-f starter_sha="\$STARTER_SHA"/);
  assert.match(script, /-f release_base_sha="\$RUNTIME_SHA"/);
  assert.match(script, /workflow publish-packages\.yml/);
  assert.match(script, /actions\/workflows\/promote-scaffold-release\.yml\/runs/);
  assert.match(script, /gh run watch/);
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
  assert.match(mergeStep.run, /gh run watch "\$run_id" --exit-status/);
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

  const controllerScript = fullReleaseWorkflow.jobs.release.steps
    .map((step) => step.run ?? "")
    .join("\n");
  assert.match(controllerScript, /commits\?path=.*stable-scaffold-release\.json/);
  assert.match(controllerScript, /candidate_record/);
  assert.match(controllerScript, /-f release_commit_sha="\$RECORD_SHA"/);
  assert.match(controllerScript, /display_title == \$title/);
  assert.match(controllerScript, /actor\.login == \$actor/);
  assert.match(controllerScript, /scaffold-production · automated/);
  assert.match(controllerScript, /event=repository_dispatch/);
  assert.match(controllerScript, /created_at >= \$created/);
});
