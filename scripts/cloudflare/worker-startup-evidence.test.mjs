import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerStartupEvidence } from "./worker-startup-evidence.mjs";

const INCOMPLETE_PROFILE_RE =
  /samples and timeDeltas must have the same non-zero length/u;
const INCONSISTENT_TIMING_RE = /inconsistent startup timing/u;

test("summarizes sampled, active, idle, and garbage-collection startup time", () => {
  const evidence = createWorkerStartupEvidence({
    profile: {
      endTime: 160_000,
      nodes: [
        { callFrame: { functionName: "(root)" }, id: 1 },
        { callFrame: { functionName: "(garbage collector)" }, id: 2 },
        { callFrame: { functionName: "(idle)" }, id: 3 },
        { callFrame: { functionName: "initializeSchemas" }, id: 4 },
      ],
      samples: [4, 2, 3],
      startTime: 0,
      timeDeltas: [100_000, 30_000, 20_000],
    },
    worker: "core",
  });

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.worker, "core");
  assert.deepEqual(evidence.profile, {
    activeMs: 130,
    applicationMs: 100,
    garbageCollectionMs: 30,
    idleMs: 20,
    profileWindowMs: 160,
    sampleCount: 3,
    sampledMs: 150,
  });
});

test("fails closed when the CPU profile is incomplete", () => {
  assert.throws(
    () =>
      createWorkerStartupEvidence({
        profile: { nodes: [], samples: [1], timeDeltas: [] },
        worker: "core",
      }),
    INCOMPLETE_PROFILE_RE
  );
  assert.throws(
    () =>
      createWorkerStartupEvidence({
        profile: {
          endTime: 10,
          nodes: [
            { callFrame: { functionName: "(garbage collector)" }, id: 1 },
            { callFrame: { functionName: "(idle)" }, id: 2 },
          ],
          samples: [1, 2],
          startTime: 0,
          timeDeltas: [10, 20],
        },
        worker: "core",
      }),
    INCONSISTENT_TIMING_RE
  );
});
