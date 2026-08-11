import assert from "node:assert/strict";
import test from "node:test";

import { createAgentControllerProcessTableSnapshotReader } from "../dist/agent-controller-process.js";
import {
  resolveAgentControllerSupervisedProcessIds,
  signalAgentControllerProcessTree,
  terminateRemainingAgentControllerProcesses,
} from "../dist/index.js";

test("shares one process-table snapshot across a simultaneous controller stop phase", () => {
  let nowMs = 0;
  let readCount = 0;
  const readProcessTable = createAgentControllerProcessTableSnapshotReader({
    maxAgeMs: 75,
    now: () => nowMs,
    readProcessTable: () => {
      readCount += 1;
      return `snapshot-${String(readCount)}`;
    },
  });

  assert.equal(readProcessTable(), "snapshot-1");
  nowMs = 74;
  assert.equal(readProcessTable(), "snapshot-1");
  assert.equal(readCount, 1);

  nowMs = 75;
  assert.equal(readProcessTable(), "snapshot-2");
  assert.equal(readCount, 2);
});

test("shares one process-table timeout without suppressing the bounded retry", () => {
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
        throw timeoutError;
      }
      return "retry-snapshot";
    },
  });

  assert.throws(() => readProcessTable(), timeoutError);
  nowMs = 74;
  assert.throws(() => readProcessTable(), timeoutError);
  assert.equal(readCount, 1);

  nowMs = 100;
  assert.equal(readProcessTable(), "retry-snapshot");
  assert.equal(readCount, 2);
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
});

test("signals the process group when descendant inspection times out", () => {
  const timeoutError = Object.assign(new Error("spawnSync ps ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
  const killCalls = [];
  const discoveryFailures = [];
  const events = [];
  const trackedDescendantProcessIds = new Set([4343]);

  const sent = signalAgentControllerProcessTree({
    killProcess: (processId, signal) => {
      killCalls.push({ processId, signal });
      events.push("signal");
      return true;
    },
    listSupervisedProcessIds: () => {
      throw timeoutError;
    },
    processId: 4242,
    reportDiscoveryFailure: (failure) => {
      discoveryFailures.push(failure);
      events.push("diagnostic");
    },
    signal: "SIGTERM",
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
    trackedDescendantProcessIds,
  });

  assert.equal(sent, true);
  assert.deepEqual(killCalls, [
    { processId: -4242, signal: "SIGTERM" },
    { processId: 4343, signal: "SIGTERM" },
  ]);
  assert.deepEqual(discoveryFailures, [
    {
      error: timeoutError,
      processId: 4242,
      signal: "SIGTERM",
      source: "supervision_marker",
    },
  ]);
  assert.deepEqual(events, ["signal", "signal", "diagnostic"]);
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
        listSupervisedProcessIds: () => [],
        processId: 4242,
        signal: "SIGKILL",
        signalTarget: "process_group",
        supervisionId: "supervision-4242",
      }),
    signalError
  );
});

test("reports post-exit cleanup failures without trapping the caller", () => {
  const cleanupError = Object.assign(new Error("kill EINVAL"), {
    code: "EINVAL",
  });
  const cleanupFailures = [];

  const sent = terminateRemainingAgentControllerProcesses({
    killProcess: () => {
      throw cleanupError;
    },
    listSupervisedProcessIds: () => [],
    processId: 4242,
    reportCleanupFailure: (failure) => {
      cleanupFailures.push(failure);
    },
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
  });

  assert.equal(sent, false);
  assert.deepEqual(cleanupFailures, [
    {
      error: cleanupError,
      processId: 4242,
      signal: "SIGKILL",
    },
  ]);
});

test("retries supervised discovery when the leader exits during an inspection failure", () => {
  const timeoutError = Object.assign(new Error("spawnSync ps ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
  const killCalls = [];
  const discoveryFailures = [];
  let discoveryAttempts = 0;

  terminateRemainingAgentControllerProcesses({
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
        throw timeoutError;
      }
      return [4343];
    },
    processId: 4242,
    reportDiscoveryFailure: (failure) => {
      discoveryFailures.push(failure);
    },
    scheduleDiscoveryRetry: (retry) => retry(),
    signalTarget: "process_group",
    supervisionId: "supervision-4242",
  });

  assert.equal(discoveryAttempts, 2);
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
