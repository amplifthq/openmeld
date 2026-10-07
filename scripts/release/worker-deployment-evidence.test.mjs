import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cliProjectionResult,
  FIXTURE_DEPLOYMENT,
  FIXTURE_PROJECTION,
  FIXTURE_VERSION,
  fixtureWorkerTarget,
  workerDeploymentResponse,
  writeDeploymentOutput,
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
const CORRELATION_ERROR = /uniquely correlated/iu;

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
    executionAdapters: {
      runCommand: () => workerDeploymentResponse({ deployments: [] }),
    },
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

test("correlates exactly one new deployment and rejects old or concurrent same-version records", async () => {
  const operationTime = Date.now();
  const oldDeployment = {
    id: "00000000-0000-4000-8000-000000000100",
    created_on: "2026-09-18T11:00:00Z",
    versions: [{ version_id: FIXTURE_VERSION, percentage: 100 }],
  };
  const newDeployment = {
    id: FIXTURE_DEPLOYMENT,
    created_on: new Date(operationTime).toISOString(),
    versions: [{ version_id: FIXTURE_VERSION, percentage: 100 }],
  };
  const concurrentDeployment = {
    id: "00000000-0000-4000-8000-000000000200",
    created_on: new Date(operationTime + 1).toISOString(),
    versions: [{ version_id: FIXTURE_VERSION, percentage: 100 }],
  };
  const unseenStaleDeployment = {
    id: "00000000-0000-4000-8000-000000000300",
    created_on: "2026-09-18T12:00:00Z",
    versions: [{ version_id: FIXTURE_VERSION, percentage: 100 }],
  };

  for (const scenario of [
    {
      name: "old same-version deployment",
      after: [oldDeployment],
      succeeds: false,
    },
    {
      name: "concurrent same-version deployments",
      after: [concurrentDeployment, newDeployment, oldDeployment],
      succeeds: false,
    },
    {
      name: "unseen stale same-version deployment",
      after: [unseenStaleDeployment, oldDeployment],
      succeeds: false,
    },
    {
      name: "one correlated deployment",
      after: [newDeployment, oldDeployment],
      succeeds: true,
    },
  ]) {
    const receipts = [];
    const run = () =>
      executeRecordedProductionDeploySteps({
        sourceSha: SOURCE,
        steps: buildProductionDeployStepSpecs(["web"]),
        readEvidence: () => new Map(),
        resolveWorkerTarget: fixtureWorkerTarget,
        executeSteps: executeProductionDeploySteps,
        runCommand: () =>
          workerDeploymentResponse({ deployments: scenario.after }),
        executionAdapters: {
          runCommand: () =>
            workerDeploymentResponse({ deployments: [oldDeployment] }),
          runStep: (step) => writeDeploymentOutput(step, SOURCE),
        },
        publishEvidence: (event) => receipts.push(event.receipts.web),
        write: () => undefined,
      });
    if (scenario.succeeds) {
      await assert.doesNotReject(run, scenario.name);
    } else {
      await assert.rejects(run, CORRELATION_ERROR, scenario.name);
    }
    assert.equal(
      receipts.at(-1)?.status,
      scenario.succeeds ? "verified" : "failed"
    );
    if (scenario.succeeds) {
      assert.equal(receipts.at(-1).identity.deploymentId, FIXTURE_DEPLOYMENT);
    } else {
      assert.equal(receipts.at(-1).identity, undefined);
    }
  }
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

test("separate trusted control reads the approved source's installed Wrangler", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-worker-config-"));
  const control = path.join(root, "release-control");
  const source = path.join(root, "release-source");
  const entry = path.join(
    control,
    "scripts/release/worker-deployment-evidence.mjs"
  );
  try {
    mkdirSync(path.dirname(entry), { recursive: true });
    mkdirSync(path.join(control, "packages"));
    copyFileSync(
      new URL("./worker-deployment-evidence.mjs", import.meta.url),
      entry
    );
    // Control owns its schema parser, while only the approved source owns the
    // real pinned Wrangler dependency, matching the hosted checkout topology.
    symlinkSync(
      fileURLToPath(new URL("../../packages/schemas", import.meta.url)),
      path.join(control, "packages/schemas"),
      "junction"
    );
    mkdirSync(path.join(source, "node_modules"), { recursive: true });
    symlinkSync(
      realpathSync(new URL("../../node_modules/wrangler", import.meta.url)),
      path.join(source, "node_modules/wrangler"),
      "junction"
    );
    writeFileSync(path.join(source, "package.json"), '{"type":"module"}\n');
    copyFileSync(
      new URL("../../services/auth/wrangler.jsonc", import.meta.url),
      path.join(source, "wrangler.jsonc")
    );
    const args = ["--config", "wrangler.jsonc", "--env", "prod"];
    const input = {
      cwd: source,
      group: {
        scope: "auth",
        steps: [{ workerDeploymentArgs: args }],
        workerArguments: args,
      },
    };
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { resolveReceiptWorkerTarget } = await import(${JSON.stringify(pathToFileURL(entry).href)});
console.log(JSON.stringify(await resolveReceiptWorkerTarget(${JSON.stringify(input)})));`,
      ],
      { cwd: control, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const target = JSON.parse(output);
    assert.equal(target.workerName, "openmeld-auth-prod");
    assert.equal(target.environment, "prod");
    assert.deepEqual(target.args, args);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
