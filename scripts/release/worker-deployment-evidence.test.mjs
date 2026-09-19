import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import test from "node:test";
import {
  cliProjectionResult,
  FIXTURE_DEPLOYMENT,
  FIXTURE_PROJECTION,
  FIXTURE_VERSION,
  fixtureWorkerTarget,
  workerDeploymentResponse,
} from "./fixtures/worker-deployment-output.mjs";
import {
  buildProductionDeployStepSpecs,
  executeProductionDeploySteps,
} from "./production-release.mjs";
import { executeRecordedProductionDeploySteps } from "./production-release-receipts.mjs";
import {
  createWorkerDeploymentCapture,
  resolveReceiptWorkerTarget,
} from "./worker-deployment-evidence.mjs";

const SOURCE = "a".repeat(40);
const OPERATION = "f".repeat(64);
const OUTPUT_ERROR = /output|projection|source|Worker/iu;

test("actual guarded subprocess inherits its unique output path and reports exact activation", async () => {
  const receipts = [];
  const steps = buildProductionDeployStepSpecs(["web"]);
  steps[0] = {
    ...steps[0],
    command: process.execPath,
    args: [
      "--input-type=module",
      "-e",
      `
    import { appendFileSync } from 'node:fs';
    if (!process.env.OPENMELD_RELEASE_RECEIPT_CONTEXT) throw new Error('missing guarded context');
    appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({
      type:'deploy', version:1, worker_name:'openmeld-web-prod', wrangler_environment:'prod',
      version_id:'${FIXTURE_VERSION}', timestamp:new Date().toISOString()
    })+'\\n');
  `,
    ],
  };
  steps[1] = {
    ...steps[1],
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
  };
  await executeRecordedProductionDeploySteps({
    sourceSha: SOURCE,
    steps,
    env: {},
    readEvidence: () => new Map(),
    resolveWorkerTarget: fixtureWorkerTarget,
    executeSteps: executeProductionDeploySteps,
    runCommand: () => workerDeploymentResponse(),
    executionAdapters: { runCommand: () => workerDeploymentResponse() },
    publishEvidence: (event) => {
      receipts.push(event.receipts.web);
    },
    write: () => undefined,
  });
  assert.equal(receipts.at(-1).status, "verified");
  assert.deepEqual(receipts.at(-1).identity, {
    kind: "worker-deployment",
    workerName: "openmeld-web-prod",
    environment: "prod",
    deploymentId: FIXTURE_DEPLOYMENT,
    versionId: FIXTURE_VERSION,
    sourceSha: SOURCE,
    proof: "command-output",
  });
});

test("production Worker names use Wrangler's actual config resolution", async () => {
  for (const scope of ["web", "auth", "gateway", "remote-agent"]) {
    const steps = buildProductionDeployStepSpecs([scope]);
    const target = await resolveReceiptWorkerTarget({
      group: {
        scope,
        steps,
        workerArguments:
          steps.at(-1).receiptWorkerDeploymentArgs ??
          steps[0].workerDeploymentArgs,
      },
    });
    assert.equal(target.workerName, `openmeld-${scope}-prod`);
    assert.equal(
      target.outputEnvironment,
      scope === "remote-agent" ? null : "prod"
    );
  }
});

test("CLI no-op publication must prove source and exact projection, not merely current traffic", () => {
  const input = {
    sourceSha: SOURCE,
    operationKey: OPERATION,
    env: {},
    target: {
      workerName: "openmeld-core-prod",
      projectionTag: FIXTURE_PROJECTION,
      outputEnvironment: "prod",
    },
  };
  const capture = createWorkerDeploymentCapture(input);
  try {
    const result = cliProjectionResult(SOURCE);
    assert.deepEqual(capture.read(result), {
      versionId: FIXTURE_VERSION,
      deploymentId: FIXTURE_DEPLOYMENT,
      proof: "cli-projection",
    });
    for (const changed of [
      { ...result, sourceSha: "b".repeat(40) },
      { ...result, core: { ...result.core, targetTag: "other-projection" } },
      { ...result, core: { ...result.core, deploymentId: undefined } },
    ]) {
      assert.throws(() => capture.read(changed), OUTPUT_ERROR);
    }
  } finally {
    capture.close();
  }
});

test("stale ambient output and duplicate events cannot replace current command output", () => {
  const capture = createWorkerDeploymentCapture({
    sourceSha: SOURCE,
    operationKey: OPERATION,
    target: { workerName: "openmeld-web-prod", outputEnvironment: "prod" },
    env: { WRANGLER_OUTPUT_FILE_PATH: "/not-used/old-output.jsonl" },
  });
  try {
    assert.notEqual(
      capture.env.WRANGLER_OUTPUT_FILE_PATH,
      "/not-used/old-output.jsonl"
    );
    assert.throws(() => capture.read(), OUTPUT_ERROR);
    const event = {
      type: "deploy",
      version: 1,
      worker_name: "openmeld-web-prod",
      wrangler_environment: "prod",
      version_id: FIXTURE_VERSION,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(
      capture.env.WRANGLER_OUTPUT_FILE_PATH,
      `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`
    );
    assert.throws(() => capture.read(), OUTPUT_ERROR);
  } finally {
    capture.close();
  }
});
