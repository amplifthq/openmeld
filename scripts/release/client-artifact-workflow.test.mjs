import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { admissionReason, resourcePolicy } from "../dev/local-resources.mjs";
import { productionBuildEnvironment } from "./production-artifact-check.mjs";

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
  const check = job.steps.find((step) =>
    step.run?.includes("production-artifact-check.mjs")
  );
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

test("Production and Deep Confidence share an explicit heap within available runner capacity", () => {
  const diagnostic = parse(
    readFileSync(
      new URL("../../.github/workflows/deep-confidence.yml", import.meta.url),
      "utf8"
    )
  );
  const production = parse(
    readFileSync(
      new URL("../../.github/workflows/release-on-main.yml", import.meta.url),
      "utf8"
    )
  );
  const productionJob = production.jobs.validate_release_source;
  const diagnosticJob = diagnostic.jobs["release-artifacts"];
  assert.equal(diagnosticJob["runs-on"], productionJob["runs-on"]);
  // Ubuntu run 35742137329 measured 7,291,916,288 available bytes. Use the
  // private runner's 8 GiB capacity ceiling to conservatively budget headroom.
  const memoryBytes = 8 * 1024 ** 3;
  for (const [job, entrypoint] of [
    [productionJob, "production-train-artifact-admission.mjs"],
    [diagnosticJob, "production-artifact-check.mjs"],
  ]) {
    const step = job.steps.find((item) => item.run?.includes(entrypoint));
    const workflowEnv = { ...job.env, ...step.env };
    assert.equal(workflowEnv.NODE_OPTIONS, undefined);
    assert.equal(workflowEnv.OPENMELD_RENDERER_NODE_HEAP_MB, undefined);
    for (const scope of ["web", "desktop"]) {
      const env = productionBuildEnvironment(
        scope,
        workflowEnv,
        memoryBytes,
        "linux"
      );
      const policy = resourcePolicy(env, memoryBytes, "linux");
      assert.equal(env.NODE_OPTIONS, "--max-old-space-size=4096");
      assert.equal(env.OPENMELD_LOCAL_HEAVY_GIB, "5");
      const admission = {
        kind: "heavy",
        entries: [],
        rows: [],
        policy,
        pressure: "unknown",
      };
      assert.equal(
        admissionReason({ ...admission, availableBytes: 7_291_916_288 }),
        null
      );
      assert.ok(
        admissionReason({ ...admission, availableBytes: 6 * 1024 ** 3 })
      );
      assert.equal(
        env.OPENMELD_DESKTOP_TARGET,
        scope === "desktop" ? "production" : undefined
      );
    }
  }
  const env = productionBuildEnvironment("web", {}, memoryBytes, "linux");
  const heapLimit = Number(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { getHeapStatistics } from "node:v8"; console.log(getHeapStatistics().heap_size_limit);',
      ],
      { env: { ...process.env, ...env }, encoding: "utf8" }
    )
  );
  assert.ok(heapLimit >= 4096 * 1024 ** 2 && heapLimit < 5 * 1024 ** 3);
});
