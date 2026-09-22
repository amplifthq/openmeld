import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

test("manual client artifact validation excludes the broad diagnostic jobs", () => {
  const workflow = parse(
    readFileSync(
      new URL("../../.github/workflows/deep-confidence.yml", import.meta.url),
      "utf8"
    )
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.scope.options, [
    "full",
    "release-artifacts",
  ]);
  for (const name of [
    "verify",
    "workers-integration",
    "cli-integration",
    "runtime",
  ]) {
    assert.equal(workflow.jobs[name].if, "inputs.scope != 'release-artifacts'");
  }
  const job = workflow.jobs["release-artifacts"];
  assert.equal(job.if, "inputs.scope == 'release-artifacts'");
  assert.equal(job.steps[0].with.ref, `${"$"}{{ github.sha }}`);
  assert.equal(job.steps[0].with["persist-credentials"], false);
  const check = job.steps.find((step) => step.run);
  const command = check.run;
  assert.ok(command.includes('--scope desktop --source-sha "$GITHUB_SHA"'));
  assert.ok(command.includes('--scope web --source-sha "$GITHUB_SHA"'));
  assert.ok(
    command.indexOf("--scope desktop") < command.indexOf("--scope web")
  );
  assert.equal(
    check.env.OPENMELD_HOME,
    `${"$"}{{ runner.temp }}/openmeld-artifact-check`
  );
  assert.equal(job.env.OPENMELD_HOME, undefined);
});
