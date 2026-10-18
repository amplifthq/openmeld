import assert from "node:assert/strict";
import test from "node:test";

import { deployCoreWorker } from "./deploy-core-worker.mjs";

const RELEASE_SHA = "a".repeat(40);
const SOURCE_MISMATCH_RE = /does not match checked-out HEAD/u;
const SEED_FIRST_RE = /Seed it first/u;
const VERSION_ID = "fb18a6dd-5ee3-43fd-aa64-087346c6bfd3";

function adapters(overrides = {}) {
  const events = [];
  return {
    events,
    adapters: {
      readCoreWranglerConfig: () => "{}",
      readHeadSha: () => RELEASE_SHA,
      readPublishedCliRelease: () => ({ schemaVersion: 1 }),
      runStartupAdmission: (input) => {
        events.push(`admit:${input.releaseSha}`);
        return { versionId: VERSION_ID, trafficPercent: 0 };
      },
      runStep: (step) => {
        events.push(step.label);
      },
      ...overrides,
    },
  };
}

test("uploads, admits, and activates the exact Core version", async () => {
  const { events, adapters: input } = adapters();
  await deployCoreWorker({ adapters: input, releaseSha: RELEASE_SHA });
  assert.deepEqual(events, [
    "Build Core dependencies",
    "Verify Core Worker bundle module graph",
    `admit:${RELEASE_SHA}`,
    "Deploy the startup-admitted Core version",
    "Synchronize Core triggers",
  ]);
});

test("does not repeat activation after an atomic Durable Object migration", async () => {
  const { events, adapters: input } = adapters({
    runStartupAdmission: () => ({ versionId: VERSION_ID, trafficPercent: 100 }),
  });
  await deployCoreWorker({ adapters: input, releaseSha: RELEASE_SHA });
  assert.equal(
    events.includes("Deploy the startup-admitted Core version"),
    false
  );
});

test("refuses another source or a CLI release bucket that was never seeded", async () => {
  const failFast = {
    runStartupAdmission: () => {
      throw new Error("must not upload");
    },
    runStep: () => {
      throw new Error("must not build");
    },
  };
  await assert.rejects(
    deployCoreWorker({
      adapters: adapters({ ...failFast, readHeadSha: () => "b".repeat(40) })
        .adapters,
      releaseSha: RELEASE_SHA,
    }),
    SOURCE_MISMATCH_RE
  );
  await assert.rejects(
    deployCoreWorker({
      adapters: adapters({ ...failFast, readPublishedCliRelease: () => null })
        .adapters,
      releaseSha: RELEASE_SHA,
    }),
    SEED_FIRST_RE
  );
});
