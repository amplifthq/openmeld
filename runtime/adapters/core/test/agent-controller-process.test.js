import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentControllerProcessDiscoveryDiagnosticAggregator,
  createAgentControllerProcessTableSnapshotReader,
} from "../dist/agent-controller-process.js";
import {
  resolveAgentControllerDescendantProcessIds,
  resolveAgentControllerSupervisedProcessIds,
  signalAgentControllerProcessTree,
  terminateRemainingAgentControllerProcesses,
} from "../dist/index.js";

test("shares one async process-table snapshot across a simultaneous controller stop phase", async () => {
  let nowMs = 0;
  let readCount = 0;
  const readProcessTable = createAgentControllerProcessTableSnapshotReader({
    maxAgeMs: 75,
    now: () => nowMs,
    readProcessTable: () => {
      readCount += 1;
      return Promise.resolve(`snapshot-${String(readCount)}`);
    },
  });

  assert.equal(await readProcessTable(), "snapshot-1");
  nowMs = 74;
  assert.equal(await readProcessTable(), "snapshot-1");
  assert.equal(readCount, 1);

  nowMs = 75;
  assert.equal(await readProcessTable(), "snapshot-2");
  assert.equal(readCount, 2);
  assert.equal(await readProcessTable({ fresh: true }), "snapshot-3");
  assert.equal(readCount, 3);
});

test("shares a slow in-flight process scan after its snapshot age expires", async () => {
  let nowMs = 0;
  let readCount = 0;
  let release;
  const read = createAgentControllerProcessTableSnapshotReader({
    maxAgeMs: 75,
    now: () => nowMs,
    readProcessTable: () => {
      readCount += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const first = read();
  nowMs = 1000;
  const follower = read();
  assert.equal(readCount, 1);
  release("old snapshot");
  assert.deepEqual(await Promise.all([first, follower]), [
    "old snapshot",
    "old snapshot",
  ]);
  const fresh = read();
  assert.equal(readCount, 2);
  release("fresh snapshot");
  assert.equal(await fresh, "fresh snapshot");
});

test("shares one async process-table timeout without suppressing the bounded retry", async () => {
  const timeoutError = Object.assign(new Error("spawnSync ps ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
  let nowMs = 0;
  let readCount = 0;
  const readProcessTable = createAgentControllerProcessTableSnapshotReader({
    maxAgeMs: 75,
    now: () => nowMs,
    readProcessTable: () => {
      readCount += 1;
      if (readCount === 1) {
        return Promise.reject(timeoutError);
      }
      return Promise.resolve("retry-snapshot");
    },
  });

  await assert.rejects(readProcessTable(), timeoutError);
  nowMs = 74;
  await assert.rejects(readProcessTable(), timeoutError);
  assert.equal(readCount, 1);

  nowMs = 100;
  assert.equal(await readProcessTable(), "retry-snapshot");
  assert.equal(readCount, 2);
});

test("keeps the event loop responsive while process discovery is pending", async () => {
  let releaseProcessTable;
  const readProcessTable = createAgentControllerProcessTableSnapshotReader({
    maxAgeMs: 75,
    readProcessTable: () =>
      new Promise((resolve) => {
        releaseProcessTable = resolve;
      }),
  });

  let settled = false;
  const processTable = readProcessTable().then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  releaseProcessTable("4242 1 4242");
  assert.equal(await processTable, "4242 1 4242");
});

test("aggregates repeated discovery timeouts and records recovery", () => {
  let nowMs = 1000;
  const writes = [];
  const diagnostics = createAgentControllerProcessDiscoveryDiagnosticAggregator(
    {
      now: () => nowMs,
      windowMs: 60_000,
      write: (level, event, payload) => writes.push({ event, level, payload }),
    }
  );
  const timeoutError = Object.assign(new Error("Command failed: ps"), {
    code: null,
    killed: true,
    signal: "SIGTERM",
  });

  diagnostics.failure({
    error: timeoutError,
    processId: 4242,
    signal: "SIGKILL",
    source: "supervision_marker",
  });
  nowMs += 1000;
  diagnostics.failure({
    error: timeoutError,
    processId: 4343,
    signal: "SIGKILL",
    source: "supervision_marker",
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.reasonCode, "process_discovery_timeout");
  assert.equal(writes[0].payload.occurrenceCount, 1);

  nowMs += 60_000;
  diagnostics.failure({
    error: timeoutError,
    processId: 4444,
    signal: "SIGKILL",
    source: "supervision_marker",
  });
  assert.equal(writes.length, 2);
  assert.equal(writes[1].payload.occurrenceCount, 3);
  assert.deepEqual(writes[1].payload.affectedProcessIds, [4242, 4343, 4444]);

  diagnostics.recovered("supervision_marker");
  assert.equal(writes.length, 3);
  assert.equal(writes[2].level, "info");
  assert.equal(writes[2].payload.reasonCode, "process_discovery_recovered");
  assert.equal(writes[2].payload.occurrenceCount, 3);
});

test("distinguishes descendants from reparented supervised processes", () => {
  const processTable = [
    "4200 1 4200",
    "4201 4200 4200",
    "4300 4201 4300",
    "4301 4300 4301",
    "4400 1 4400 OPENMELD_PROCESS_SUPERVISION_ID=supervision-4200",
    "4500 1 4500 OPENMELD_PROCESS_SUPERVISION_ID=another-task",
  ].join("\n");

  assert.deepEqual(
    resolveAgentControllerDescendantProcessIds({
      processId: 4200,
      processTable,
    }),
    [4300, 4301]
  );
  assert.deepEqual(
    resolveAgentControllerSupervisedProcessIds({
      processId: 4200,
      processTable,
      supervisionId: "supervision-4200",
    }),
    [4300, 4301, 4400]
  );
});

test("keeps reparented supervised processes after the leader exits", () => {
  const processIds = resolveAgentControllerSupervisedProcessIds({
    markedProcessIds: [4300, 4400],
    processId: 4200,
    processTable: [
      "4200 1 4200",
      "4201 1 4200",
      "4300 1 4300",
      "4400 4300 4400",
    ].join("\n"),
    supervisionId: "supervision-4200",
  });

  assert.deepEqual(processIds, [4300, 4400]);
  assert.deepEqual(
    resolveAgentControllerSupervisedProcessIds({
      markedProcessIds: [4200, 4201, 4300],
      processId: null,
      processTable: [
        "1 0 1",
        "4200 1 4200",
        "4201 4200 4200",
        "4300 1 4300",
        "5000 1 5000",
      ].join("\n"),
      supervisionId: "supervision-4200",
    }),
    [4200, 4201, 4300]
  );
});

test("signals the process group without waiting for process discovery", () => {
  const killCalls = [];
  const trackedDescendantProcessIds = new Set([4343]);

  const sent = signalAgentControllerProcessTree({
    killProcess: (processId, signal) => {
      killCalls.push({ processId, signal });
      return true;
    },
    processId: 4242,
    signal: "SIGTERM",
    signalTarget: "process_group",
    trackedDescendantProcessIds,
  });

  assert.equal(sent, true);
  assert.deepEqual(killCalls, [
    { processId: -4242, signal: "SIGTERM" },
    { processId: 4343, signal: "SIGTERM" },
  ]);
});

test("preserves signaling failures for task control callers", () => {
  const signalError = Object.assign(new Error("kill EINVAL"), {
    code: "EINVAL",
  });

  assert.throws(
    () =>
      signalAgentControllerProcessTree({
        killProcess: () => {
          throw signalError;
        },
        processId: 4242,
        signal: "SIGKILL",
        signalTarget: "process_group",
      }),
    signalError
  );
});

test("reports post-exit cleanup failures as an incomplete cleanup", async () => {
  const cleanupError = Object.assign(new Error("kill EINVAL"), {
    code: "EINVAL",
  });
  const cleanupFailures = [];

  const result = await terminateRemainingAgentControllerProcesses({
    killProcess: () => {
      throw cleanupError;
    },
    listSupervisedProcessIds: async () => [],
    processId: 4242,
    reportCleanupFailure: (failure) => {
      cleanupFailures.push(failure);
    },
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
  });

  assert.deepEqual(result, {
    error: cleanupError,
    ok: false,
    signalSent: false,
  });
  assert.deepEqual(cleanupFailures, [
    {
      error: cleanupError,
      processId: 4242,
      signal: "SIGKILL",
    },
  ]);
});

test("retries discovery when inspection and leader cleanup fail together", async () => {
  const discoveryError = Object.assign(new Error("spawnSync ps ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
  const cleanupError = Object.assign(new Error("kill EINVAL"), {
    code: "EINVAL",
  });
  const killCalls = [];
  let discoveryAttempts = 0;

  const result = await terminateRemainingAgentControllerProcesses({
    killProcess: (processId, signal) => {
      killCalls.push({ processId, signal });
      if (processId === -4242) {
        throw cleanupError;
      }
      return true;
    },
    listSupervisedProcessIds: () => {
      discoveryAttempts += 1;
      if (discoveryAttempts === 1) {
        return Promise.reject(discoveryError);
      }
      return Promise.resolve([4343]);
    },
    processId: 4242,
    waitForDiscoveryRetry: async () => undefined,
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
  });

  assert.equal(discoveryAttempts, 2);
  assert.deepEqual(result, {
    error: cleanupError,
    ok: false,
    signalSent: false,
  });
  assert.deepEqual(killCalls, [
    { processId: -4242, signal: "SIGKILL" },
    { processId: -4242, signal: "SIGKILL" },
    { processId: 4343, signal: "SIGKILL" },
  ]);
});

test("retries supervised discovery when the leader exits during an inspection failure", async () => {
  const timeoutError = Object.assign(new Error("spawnSync ps ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
  const killCalls = [];
  const discoveryFailures = [];
  let discoveryAttempts = 0;

  const result = await terminateRemainingAgentControllerProcesses({
    killProcess: (processId, signal) => {
      killCalls.push({ processId, signal });
      if (processId === -4242) {
        const error = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
        throw error;
      }
      return true;
    },
    listSupervisedProcessIds: () => {
      discoveryAttempts += 1;
      if (discoveryAttempts === 1) {
        return Promise.reject(timeoutError);
      }
      return Promise.resolve([4343]);
    },
    processId: 4242,
    reportDiscoveryFailure: (failure) => {
      discoveryFailures.push(failure);
    },
    waitForDiscoveryRetry: async () => undefined,
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
  });

  assert.equal(discoveryAttempts, 2);
  assert.deepEqual(result, { ok: true, signalSent: true });
  assert.deepEqual(killCalls, [
    { processId: -4242, signal: "SIGKILL" },
    { processId: -4242, signal: "SIGKILL" },
    { processId: 4343, signal: "SIGKILL" },
  ]);
  assert.deepEqual(discoveryFailures, [
    {
      error: timeoutError,
      processId: 4242,
      signal: "SIGKILL",
      source: "supervision_marker",
    },
  ]);
});

test("retries with a fresh scan when the exited leader had no visible descendants", async () => {
  const killCalls = [];
  let discoveryAttempts = 0;

  const result = await terminateRemainingAgentControllerProcesses({
    killProcess: (processId, signal) => {
      killCalls.push({ processId, signal });
      if (processId === -4242) {
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      }
      return true;
    },
    listSupervisedProcessIds: () => {
      discoveryAttempts += 1;
      return Promise.resolve(discoveryAttempts === 1 ? [] : [4343]);
    },
    processId: 4242,
    waitForDiscoveryRetry: async () => undefined,
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
  });

  assert.equal(discoveryAttempts, 2);
  assert.deepEqual(result, { ok: true, signalSent: true });
  assert.deepEqual(killCalls, [
    { processId: -4242, signal: "SIGKILL" },
    { processId: -4242, signal: "SIGKILL" },
    { processId: 4343, signal: "SIGKILL" },
  ]);
});

test("waits for the supervised discovery retry before completing cleanup", async () => {
  let releaseRetry;
  let discoveryAttempts = 0;
  let settled = false;
  const cleanup = terminateRemainingAgentControllerProcesses({
    killProcess: () => false,
    listSupervisedProcessIds: () => {
      discoveryAttempts += 1;
      if (discoveryAttempts === 1) {
        return Promise.reject(
          new Error("process table temporarily unavailable")
        );
      }
      return Promise.resolve([]);
    },
    processId: 4242,
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
    waitForDiscoveryRetry: () =>
      new Promise((resolve) => {
        releaseRetry = resolve;
      }),
  }).then((result) => {
    settled = true;
    return result;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(discoveryAttempts, 1);
  assert.equal(settled, false);

  releaseRetry();
  assert.deepEqual(await cleanup, { ok: true, signalSent: true });
  assert.equal(discoveryAttempts, 2);
});
