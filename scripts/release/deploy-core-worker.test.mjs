import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoreWorkerDeployStepSpec,
  deployCoreWorker,
} from "./deploy-core-worker.mjs";

const RELEASE_SHA = "a".repeat(40);
const SOURCE_MISMATCH_RE = /does not match checked-out HEAD/u;

test("builds the ordinary Core deploy without changing its production configuration path", () => {
  assert.deepEqual(buildCoreWorkerDeployStepSpec({}), {
    args: ["--filter", "@openmeld/core", "run", "deploy"],
    command: "pnpm",
    label: "Deploy the startup-admitted Core Worker",
  });
  assert.deepEqual(
    buildCoreWorkerDeployStepSpec({ tag: "openmeld-release-target" }).args,
    [
      "--filter",
      "@openmeld/core",
      "run",
      "deploy",
      "--tag",
      "openmeld-release-target",
    ]
  );
});

test("admits the exact checked-out Core source before deploying it", () => {
  const events = [];

  deployCoreWorker({
    adapters: {
      readHeadSha: () => RELEASE_SHA,
      runStartupAdmission: (input) => {
        events.push(`admit:${input.releaseSha}`);
      },
      runStep: (step) => {
        events.push(step.label);
      },
    },
    releaseSha: RELEASE_SHA,
  });

  assert.deepEqual(events, [
    "Build Core receiver dependencies",
    `admit:${RELEASE_SHA}`,
    "Deploy the startup-admitted Core Worker",
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
