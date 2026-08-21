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

test("starts only from a reviewed stable-record merge or an operator recovery", () => {
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.push.paths, [
    "packages/create-thally-docs/src/stable-scaffold-release.json",
    "packages/core/package.json",
    "packages/migrate/package.json",
  ]);
  assert.deepEqual(workflow.on.workflow_dispatch, null);
  assert.equal(workflow.jobs.publish.needs, "plan");
  assert.match(workflow.jobs.plan.steps[0].run, /refs\/heads\/main/);
  assert.match(
    workflow.jobs.plan.steps.find(
      (step) => step.name === "Classify immutable scaffold handoff",
    ).run,
    /stable-scaffold-release\.json/,
  );
});

test("publishes the dependency chain before verifying every registry artifact", () => {
  const stepNames = workflow.jobs.publish.steps.map((step) => step.name);
  const expectedOrder = [
    "Publish core",
    "Publish migrate",
    "Publish create-thally-docs",
    "Publish MCP",
    "Publish CLI",
    "Verify prerequisite registry releases",
    "Verify scaffold registry releases",
  ];

  assert.deepEqual(
    stepNames.filter((name) => expectedOrder.includes(name)),
    expectedOrder,
  );
  assert.equal(workflow.jobs.publish.environment, "npm-production");
  assert.equal(workflow.jobs.publish.permissions["id-token"], "write");
  for (const stepName of [
    "Publish create-thally-docs",
    "Publish MCP",
    "Publish CLI",
  ]) {
    assert.equal(
      workflow.jobs.publish.steps.find((step) => step.name === stepName).if,
      "needs.plan.outputs.should_handoff == 'true'",
    );
  }
  assert.equal(
    workflow.jobs.publish.steps.find(
      (step) => step.name === "Verify scaffold registry releases",
    ).if,
    "needs.plan.outputs.should_handoff == 'true'",
  );
});

test("withholds the cross-repository token until the publish job succeeds", () => {
  const handoff = workflow.jobs.handoff;
  assert.deepEqual(handoff.needs, ["plan", "publish"]);
  assert.equal(handoff.if, "needs.plan.outputs.should_handoff == 'true'");
  assert.deepEqual(handoff.permissions, { contents: "read" });

  const stepsUsingCloudToken = handoff.steps.filter((step) =>
    JSON.stringify(step).includes("secrets.THALLY_CLOUD_RELEASE_TOKEN"),
  );
  assert.equal(stepsUsingCloudToken.length, 1);
  assert.equal(stepsUsingCloudToken[0].name, "Dispatch the cloud release tail");
  assert.match(stepsUsingCloudToken[0].run, /scaffold-release-published/);
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
