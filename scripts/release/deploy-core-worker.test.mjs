import assert from "node:assert/strict";
import test from "node:test";

import { deployCoreWorker } from "./deploy-core-worker.mjs";
import { createWorkerDeploymentCapture } from "./worker-deployment-evidence.mjs";

const RELEASE_SHA = "a".repeat(40);
const SOURCE_MISMATCH_RE = /does not match checked-out HEAD/u;

test("deploys the exact admitted Core version without rebuilding it", async () => {
  const events = [];

  await deployCoreWorker({
    adapters: {
      readAvailabilityCatalog: async () => ({ schemaVersion: 1, entries: [] }),
      readCoreWranglerConfig: () => "{}",
      readHeadSha: () => RELEASE_SHA,
      runStartupAdmission: (input) => {
        events.push(`admit:${input.releaseSha}`);
        return { versionId: "fb18a6dd-5ee3-43fd-aa64-087346c6bfd3" };
      },
      runStep: (step) => {
        events.push(step.label);
      },
    },
    releaseSha: RELEASE_SHA,
  });

  assert.deepEqual(events, [
    "Build Core receiver dependencies",
    "Verify Core Worker bundle module graph",
    `admit:${RELEASE_SHA}`,
    "Deploy the startup-admitted Core version",
    "Synchronize Core triggers",
  ]);
});

test("forwards exact Core activation for staged and atomic deployment, never upload alone", async () => {
  for (const trafficPercent of [0, 100]) {
    const evidence = {
      releaseSha: RELEASE_SHA,
      workerName: "openmeld-core-prod",
      versionId: "fb18a6dd-5ee3-43fd-aa64-087346c6bfd3",
      trafficPercent,
    };
    const capture = createWorkerDeploymentCapture({
      sourceSha: RELEASE_SHA,
      operationKey: "f".repeat(64),
      target: {
        workerName: evidence.workerName,
        projectionTag: "exact-core-projection",
        outputEnvironment: "prod",
      },
      env: {},
    });
    const activated = [];
    try {
      capture.recordDeploymentBaseline({ status: 0, stdout: "[]" });
      await deployCoreWorker({
        releaseSha: RELEASE_SHA,
        tag: "exact-core-projection",
        env: capture.env,
        adapters: {
          readAvailabilityCatalog: async () => ({
            schemaVersion: 1,
            entries: [],
          }),
          readHeadSha: () => RELEASE_SHA,
          readCoreWranglerConfig: () => "{}",
          runStartupAdmission: () => evidence,
          runStep: (step) => {
            activated.push(step.label);
          },
        },
      });
      const captured = capture.read();
      assert.equal(captured.versionId, evidence.versionId);
      assert.equal(captured.proof, "command-output");
      assert.equal(
        activated.includes("Deploy the startup-admitted Core version"),
        trafficPercent === 0
      );
    } finally {
      capture.close();
    }
  }
});

test("refuses to admit a SHA other than the checked-out Core source", async () => {
  await assert.rejects(
    () =>
      deployCoreWorker({
        adapters: {
          readAvailabilityCatalog: async () => ({
            schemaVersion: 1,
            entries: [],
          }),
          readHeadSha: () => "b".repeat(40),
          runStartupAdmission: () => {
            throw new Error("must not upload");
          },
          runStep: () => {
            throw new Error("must not deploy");
          },
        },
        releaseSha: RELEASE_SHA,
      }),
    SOURCE_MISMATCH_RE
  );
});

test("checks published channel alignment before any recovery deployment", async () => {
  const steps = [];
  await assert.rejects(() =>
    deployCoreWorker({
      verifyLocalComponents: true,
      releaseSha: RELEASE_SHA,
      adapters: {
        readAvailabilityCatalog: async () => ({
          schemaVersion: 1,
          entries: [],
        }),
        readHeadSha: () => RELEASE_SHA,
        runStep(step) {
          steps.push(step);
          throw new Error("channel unavailable");
        },
        runStartupAdmission() {
          assert.fail("must not deploy before channel verification");
        },
      },
    })
  );
  assert.deepEqual(
    steps.map((step) => step.args),
    [["run", "deploy:release-ready"]]
  );
});
