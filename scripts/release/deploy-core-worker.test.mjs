import assert from "node:assert/strict";
import test from "node:test";

import { deployCoreWorker } from "./deploy-core-worker.mjs";

const RELEASE_SHA = "a".repeat(40);
const SOURCE_MISMATCH_RE = /does not match checked-out HEAD/u;

test("deploys the exact admitted Core version without rebuilding it", () => {
  const events = [];

  deployCoreWorker({
    adapters: {
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

test("refuses to admit a SHA other than the checked-out Core source", () => {
  assert.throws(
    () =>
      deployCoreWorker({
        adapters: {
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

test("checks published channel alignment before any recovery deployment", () => {
  const steps = [];
  assert.throws(() =>
    deployCoreWorker({
      verifyLocalComponents: true,
      releaseSha: RELEASE_SHA,
      adapters: {
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
