import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { productionBuildEnvironment } from "./production-artifact-check.mjs";

const expression = (value) => `${"$"}{{ ${value} }}`;
const workflow = (name) =>
  parse(
    readFileSync(new URL(`../../.github/${name}`, import.meta.url), "utf8")
  );
const toolchain = (job) =>
  job.steps.find((step) => step.uses?.endsWith("/setup-node-pnpm"));

test("coordinated release hands trusted parent outputs to every child and retains standalone admission", () => {
  const parent = workflow("workflows/release-on-main.yml");
  const validation = parent.jobs.validate_release_source;
  const issue = validation.steps.filter((step) =>
    step.run?.includes("--issue-parent-evidence")
  );
  assert.equal(issue.length, 1);
  assert.equal(issue[0].id, "train_admission");
  assert.equal(issue[0].if, undefined);
  assert.equal(
    validation.outputs.parent_admission_evidence,
    expression("steps.train_admission.outputs.parent_admission_evidence")
  );
  for (const [name, file] of [
    ["core", "core-worker"],
    ["web", "web"],
    ["website", "website"],
    ["auth", "auth-worker"],
    ["gateway", "gateway-worker"],
    ["remote_agent", "remote-agent-worker"],
  ]) {
    const job = parent.jobs[name];
    assert.ok(job.needs.includes("validate_release_source"));
    assert.ok(
      job.if.includes("needs.validate_release_source.result == 'success'")
    );
    assert.equal(
      job.with.parent_admission_evidence,
      expression(
        "needs.validate_release_source.outputs.parent_admission_evidence"
      )
    );
    const child = workflow(`workflows/deploy-${file}.yml`);
    assert.equal(
      toolchain(child.jobs.deploy).with.node_version,
      expression(
        "inputs.parent_admission_evidence && fromJSON(inputs.parent_admission_evidence).buildInputs.node || '24'"
      )
    );
    assert.equal(
      child.on.workflow_call.inputs.parent_admission_evidence.required,
      false
    );
    assert.equal(
      child.on.workflow_call.inputs.parent_admission_evidence.default,
      ""
    );
    // Job-level propagation also covers the nested hosted preflight admission.
    assert.equal(
      child.jobs.deploy.env.OPENMELD_PARENT_TRAIN_ADMISSION,
      expression("inputs.parent_admission_evidence")
    );
    const admission = child.jobs.deploy.steps.find(
      (step) => step.name === "Admit declared production train artifacts"
    );
    assert.equal(admission.if, undefined);
    assert.ok(
      admission.run.includes(
        "node ../release-control/scripts/release/production-train-artifact-admission.mjs"
      )
    );
  }
  assert.equal(parent.jobs.database.needs, "validate_release_source");
  assert.equal(
    toolchain(parent.jobs.database).with.node_version,
    expression(
      "fromJSON(needs.validate_release_source.outputs.parent_admission_evidence).buildInputs.node"
    )
  );
  // Standalone jobs retain the existing major version; coordinated consumers
  // use the producer's exact runtime instead of independently resolving it.
  const setup = workflow("actions/setup-node-pnpm/action.yml");
  assert.equal(setup.inputs.node_version.default, "24");
  assert.equal(
    setup.runs.steps.find((step) => step.uses === "actions/setup-node@v5").with[
      "node-version"
    ],
    expression("inputs.node_version")
  );
  const dbCall = parent.jobs.database.steps.find((step) =>
    step.uses?.endsWith("/shared-db-gate")
  );
  assert.equal(
    dbCall.with.parent_admission_evidence,
    expression(
      "needs.validate_release_source.outputs.parent_admission_evidence"
    )
  );
  const db = workflow("actions/shared-db-gate/action.yml");
  for (const step of db.runs.steps) {
    assert.equal(
      step.env.OPENMELD_PARENT_TRAIN_ADMISSION,
      expression("inputs.parent_admission_evidence")
    );
  }
  assert.ok(
    db.runs.steps[1].run.includes(
      'node "$GITHUB_ACTION_PATH/../../../scripts/release/production-db.mjs"'
    )
  );
});

for (const [scope, title] of [
  ["web", "Web"],
  ["website", "Website"],
]) {
  test(`${title} handoff downloads only the immutable same-run snapshot and verifies it before preflight or deployment`, () => {
    const parent = workflow("workflows/release-on-main.yml");
    const validation = parent.jobs.validate_release_source;
    const upload = validation.steps.find(
      (step) => step.id === `${scope}_artifact`
    );
    assert.equal(upload.uses, "actions/upload-artifact@v4");
    assert.equal(
      upload.if,
      `steps.train_admission.outputs.has_${scope}_artifact == 'true'`
    );
    assert.equal(upload.with["if-no-files-found"], "error");
    assert.equal(upload.with["include-hidden-files"], true);
    assert.equal(upload.with.overwrite, undefined);
    assert.deepEqual(upload.with.path.trim().split("\n"), [
      `release-source/dev-tmp/release-artifact-check/${scope}.json`,
      `release-source/dev-tmp/release-artifact-check/artifacts/${scope}/`,
    ]);
    assert.equal(
      validation.outputs[`parent_${scope}_artifact_id`],
      expression(`steps.${scope}_artifact.outputs.artifact-id`)
    );
    assert.equal(
      parent.jobs[scope].with[`parent_${scope}_artifact_id`],
      expression(
        `needs.validate_release_source.outputs.parent_${scope}_artifact_id`
      )
    );
    const web = workflow(`workflows/deploy-${scope}.yml`).jobs.deploy;
    const parentHeap = validation.steps.find((step) =>
      step.run?.includes("--issue-parent-evidence")
    ).env.OPENMELD_RENDERER_NODE_HEAP_MB;
    assert.equal(
      web.env.OPENMELD_RENDERER_NODE_HEAP_MB,
      expression(
        `inputs.parent_admission_evidence != '' && '${parentHeap}' || ''`
      )
    );
    assert.equal(
      web.env[`OPENMELD_PARENT_${scope.toUpperCase()}_ARTIFACT_ID`],
      expression(`inputs.parent_${scope}_artifact_id`)
    );
    const downloadIndex = web.steps.findIndex(
      (step) => step.uses === "actions/download-artifact@v4"
    );
    const download = web.steps[downloadIndex];
    assert.equal(download.if, "inputs.parent_admission_evidence != ''");
    assert.deepEqual(download.with, {
      "artifact-ids": expression(`inputs.parent_${scope}_artifact_id`),
      "merge-multiple": true,
      path: "release-source/dev-tmp/release-artifact-check",
    });
    assert.equal(
      web.steps[downloadIndex - 1].name,
      "Admit declared production train artifacts"
    );
    assert.ok(
      web.steps[downloadIndex + 1].run.includes("--restore-renderer-artifact")
    );
    assert.equal(web.steps[downloadIndex + 1].if, download.if);
    assert.ok(
      downloadIndex + 1 <
        web.steps.findIndex(
          (step) => step.name === `Run ${title} deployment preflight`
        )
    );
    const health = web.steps.find(
      (step) => step.name === `Verify ${title} health`
    );
    assert.ok(health.run.includes("scripts/release/production-web-health.mjs"));
    assert.ok(health.run.includes(`--scope ${scope}`));
  });
}

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
    "artifact-handoff",
  ]);
  for (const name of [
    "verify",
    "workers-integration",
    "cli-integration",
    "runtime",
  ]) {
    assert.equal(workflow.jobs[name].if, "inputs.scope == 'full'");
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
  const memoryBytes = 8 * 1024 ** 3;
  for (const [job, entrypoint] of [
    [productionJob, "production-train-artifact-admission.mjs"],
    [diagnosticJob, "production-artifact-check.mjs"],
    [
      diagnostic.jobs.validate_release_source,
      "production-train-admission-handoff.mjs",
    ],
  ]) {
    const step = job.steps.find((item) => item.run?.includes(entrypoint));
    const workflowEnv = { ...job.env, ...step.env };
    const trainAdmission = job === productionJob;
    assert.equal(workflowEnv.NODE_OPTIONS, undefined);
    assert.equal(
      workflowEnv.OPENMELD_RENDERER_NODE_HEAP_MB,
      trainAdmission ? "5120" : undefined
    );
    for (const scope of ["web", "desktop"]) {
      const env = productionBuildEnvironment(
        scope,
        workflowEnv,
        memoryBytes,
        "linux"
      );
      assert.equal(env.NODE_OPTIONS, "--max-old-space-size=5120");
      assert.equal(env.OPENMELD_LOCAL_HEAVY_GIB, "6");
      assert.equal(
        env.OPENMELD_DESKTOP_TARGET,
        scope === "desktop" ? "production" : undefined
      );
    }
  }
  const desktopMac = productionBuildEnvironment(
    "desktop",
    {},
    48 * 1024 ** 3,
    "darwin"
  );
  assert.equal(desktopMac.NODE_OPTIONS, "--max-old-space-size=5120");
  assert.equal(desktopMac.OPENMELD_LOCAL_HEAVY_GIB, "6");
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
  assert.ok(heapLimit >= 5120 * 1024 ** 2 && heapLimit < 6 * 1024 ** 3);
  const website = productionBuildEnvironment(
    "website",
    {},
    memoryBytes,
    "linux"
  );
  assert.equal(website.NODE_OPTIONS, "--max-old-space-size=2048");
  assert.equal(website.OPENMELD_LOCAL_HEAVY_GIB, "3");
  for (const [scope, standaloneHeap] of [
    ["web", 5120],
    ["website", 2048],
  ]) {
    const child = workflow(`workflows/deploy-${scope}.yml`).jobs.deploy;
    for (const hasParent of [false, true]) {
      const expectedHeap = hasParent ? 5120 : standaloneHeap;
      // GitHub evaluates the optional-parent expression to an empty string
      // for standalone calls, not an absent environment variable.
      const actual = productionBuildEnvironment(
        scope,
        {
          ...child.env,
          OPENMELD_RENDERER_NODE_HEAP_MB: hasParent
            ? productionJob.steps.find((step) =>
                step.run?.includes("production-train-artifact-admission.mjs")
              ).env.OPENMELD_RENDERER_NODE_HEAP_MB
            : "",
        },
        memoryBytes,
        "linux"
      );
      assert.equal(actual.NODE_OPTIONS, `--max-old-space-size=${expectedHeap}`);
      assert.equal(
        actual.OPENMELD_LOCAL_HEAVY_GIB,
        String((expectedHeap + 1024) / 1024)
      );
    }
  }
});

test("handoff acceptance uses separate clean jobs and the production artifact transport with no mutation credentials", () => {
  const diagnostic = workflow("workflows/deep-confidence.yml");
  const production = workflow("workflows/release-on-main.yml");
  const parent = diagnostic.jobs.validate_release_source;
  const child = diagnostic.jobs.verify_web_admission;
  assert.equal(
    toolchain(child).with.node_version,
    toolchain(production.jobs.database).with.node_version
  );
  assert.deepEqual(diagnostic.permissions, { contents: "read" });
  assert.equal(child.needs, "validate_release_source");
  for (const job of [parent, child]) {
    assert.equal(job.if, "inputs.scope == 'artifact-handoff'");
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.equal(job.environment, undefined);
    assert.equal(job.permissions, undefined);
    assert.equal(JSON.stringify(job).includes("secrets."), false);
    const checkouts = job.steps.filter(
      (step) => step.uses === "actions/checkout@v5"
    );
    assert.deepEqual(
      checkouts.map((step) => step.with.path),
      ["release-control", "release-source"]
    );
    for (const step of checkouts) {
      assert.equal(step.with.ref, expression("github.sha"));
      assert.equal(step.with["persist-credentials"], false);
    }
  }
  const upload = parent.steps.find((step) => step.id === "snapshot");
  const productionUpload = production.jobs.validate_release_source.steps.find(
    (step) => step.id === "web_artifact"
  );
  assert.equal(upload.uses, productionUpload.uses);
  assert.equal(upload.with.path, productionUpload.with.path);
  assert.equal(upload.with["include-hidden-files"], true);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(
    parent.outputs.parent_admission_evidence,
    expression("steps.admission.outputs.parent_admission_evidence")
  );
  assert.equal(
    parent.outputs.parent_web_artifact_id,
    expression("steps.snapshot.outputs.artifact-id")
  );
  const download = child.steps.find(
    (step) => step.uses === "actions/download-artifact@v4"
  );
  assert.deepEqual(download.with, {
    "artifact-ids": expression(
      "needs.validate_release_source.outputs.parent_web_artifact_id"
    ),
    "merge-multiple": true,
    path: "release-source/dev-tmp/release-artifact-check",
  });
  const issue = parent.steps.find((step) => step.id === "admission");
  const verify = child.steps.find((step) =>
    step.run?.endsWith("production-train-admission-handoff.mjs verify")
  );
  assert.equal(
    issue.run,
    "node ../release-control/scripts/release/production-train-admission-handoff.mjs issue"
  );
  assert.equal(
    verify.env.OPENMELD_PARENT_TRAIN_ADMISSION,
    expression(
      "needs.validate_release_source.outputs.parent_admission_evidence"
    )
  );
  assert.equal(
    verify.env.OPENMELD_PARENT_WEB_ARTIFACT_ID,
    download.with["artifact-ids"]
  );
});
