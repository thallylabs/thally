/** Structural regression tests for the single-pass public CI workflow. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parse } from "yaml";

const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));

test("CI verifies candidates without repeating on protected-branch pushes", () => {
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  assert.equal(workflow.on.merge_group, null);
  assert.equal(workflow.on.workflow_dispatch, null);
  assert.equal(workflow.on.push, undefined);
});

test("content validation shares the existing checkout and installation", () => {
  const steps = workflow.jobs.verify.steps;
  assert.equal(
    steps.filter((step) => step.name === "Install dependencies").length,
    1,
  );
  assert.ok(steps.some((step) => step.name === "Check authored content"));
});
