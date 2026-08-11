import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAcceptedLeases,
  applyIntervalJitterMs,
  MAX_HEARTBEAT_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  pruneStaleLeases,
  resolveAdaptiveHeartbeatIntervalMs,
  resolveCatalogSyncIntervalMs,
} from "../dist/index.js";

test("heartbeat policy applies accepted leases and prunes stale leases", () => {
  const leasesByProfileId = new Map([
    ["old-agent", 1],
    ["agent-a", 1],
  ]);

  applyAcceptedLeases({
    acceptedLeases: [
      { leaseEpoch: 2, profileId: "agent-a" },
      { leaseEpoch: 1, profileId: "agent-b" },
    ],
    leasesByProfileId,
  });

  assert.deepEqual(
    [...leasesByProfileId.entries()],
    [
      ["agent-a", 2],
      ["agent-b", 1],
    ]
  );

  pruneStaleLeases({
    leasesByProfileId,
    staleLeases: [
      { leaseEpoch: 1, profileId: "agent-a" },
      { leaseEpoch: 1, profileId: "agent-b" },
    ],
  });

  assert.deepEqual([...leasesByProfileId.entries()], [["agent-a", 2]]);
});

test("heartbeat policy clamps adaptive intervals and jitter", () => {
  assert.equal(
    resolveAdaptiveHeartbeatIntervalMs({
      currentIntervalMs: 30_000,
      hasDispatchActivity: true,
    }),
    MIN_HEARTBEAT_INTERVAL_MS
  );
  assert.equal(
    resolveAdaptiveHeartbeatIntervalMs({
      currentIntervalMs: MAX_HEARTBEAT_INTERVAL_MS,
      hasDispatchActivity: false,
    }),
    MAX_HEARTBEAT_INTERVAL_MS
  );
  assert.equal(
    applyIntervalJitterMs({
      baseIntervalMs: 10_000,
      jitterRatio: 0.1,
      maxIntervalMs: 20_000,
      minIntervalMs: 5000,
      randomValue: 1,
    }),
    11_000
  );
  assert.equal(
    resolveCatalogSyncIntervalMs({ heartbeatIntervalMs: 5000 }),
    15_000
  );
});
