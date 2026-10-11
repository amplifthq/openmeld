import type { CloudComputerInvocationState } from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildRemoteAgentCallbackContextKey,
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import { reconcileAndRedeliverRemoteAgentCallbacks } from "../flue-adapter/center-agent-admission";
import {
  bindComputerCommandTarget,
  type ComputerCommandRecord,
} from "../flue-adapter/computer-command";
import { COMPUTER_COMMAND_PREFIX } from "../flue-adapter/computer-command-storage";
import {
  finishRemoteAgentComputerCommands,
  listComputerCleanupHandoffs,
  reportComputerFinishFacts,
  requestComputerCleanup,
  retryComputerCleanupHandoffs,
} from "../flue-adapter/execution-cleanup";
import {
  type ComputerFinishState,
  checkRemoteAgentExecutionFinish,
} from "../flue-adapter/execution-finish";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

afterEach(() => vi.useRealTimers());

async function fixture(legacy = false) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW_MS);
  const request = createSubmitTurnRequest();
  const context = {
    ...createRemoteAgentCallbackContext({
      request,
      nowMs: TEST_NOW_MS,
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: "original",
        submissionId: "original",
        status: "pending",
      },
    }),
    computerIsolationVersion: legacy ? (2 as const) : (3 as const),
  };
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(storage, context);
  if (!legacy) {
    await bindComputerCommandTarget({
      storage,
      submissionId: "original",
      computerName: "personal-computer:original-owner",
    });
  }
  const state: CloudComputerInvocationState = {
    invocationId: "original",
    total: 0,
    unfinished: 0,
    pendingResults: 0,
    unavailable: 0,
    commands: [],
  };
  const requestComputerCleanup = vi.fn(async () => state);
  const readComputerInvocation = vi.fn(async () => state);
  const idFromName = vi.fn((name: string) => name);
  return {
    context,
    storage,
    state,
    requestComputerCleanup,
    input: {
      context,
      storage,
      env: {
        AGENT_COMPUTER: {
          idFromName,
          get: () => ({
            requestComputerCleanup,
            readComputerInvocation,
            registerComputerInvocation: async () => undefined,
          }),
        },
      },
    },
  };
}

it("retains Stop delivery through a lost RPC reply and missing callback projection without poisoning recovered results", async () => {
  const f = await fixture();
  f.requestComputerCleanup.mockRejectedValueOnce(new Error("lost RPC reply"));
  await expect(requestComputerCleanup(f.input)).resolves.toMatchObject({
    accepted: false,
    attempts: 1,
  });
  await f.storage.delete(buildRemoteAgentCallbackContextKey("original"));
  vi.setSystemTime(TEST_NOW_MS + 5000);
  await expect(retryComputerCleanupHandoffs(f.input)).resolves.toBeNull();
  expect(f.requestComputerCleanup.mock.calls).toHaveLength(2);
  expect(await listComputerCleanupHandoffs(f.storage)).toMatchObject([
    { accepted: true, nextAttemptAtMs: null },
  ]);
  await expect(finishRemoteAgentComputerCommands(f.input)).resolves.toBeNull();
});

it("keeps an acknowledged Stop monotonic when resuming observation loses its reply", async () => {
  const f = await fixture();
  await requestComputerCleanup(f.input);
  f.requestComputerCleanup.mockRejectedValueOnce(
    new Error("resume reply lost")
  );
  await expect(
    requestComputerCleanup({ ...f.input, resume: true })
  ).resolves.toMatchObject({ accepted: true, resumeRequested: true });
  vi.setSystemTime(TEST_NOW_MS + 5000);
  await retryComputerCleanupHandoffs(f.input);
  expect(await listComputerCleanupHandoffs(f.storage)).toMatchObject([
    { accepted: true, resumeRequested: false },
  ]);
});

it("retries and rearms Stop delivery even when callback recovery fails first", async () => {
  const f = await fixture();
  f.requestComputerCleanup.mockRejectedValue(new Error("Stop reply lost"));
  await requestComputerCleanup(f.input);
  vi.setSystemTime(TEST_NOW_MS + 5000);
  const callbackFailure = new Error("callback projection unavailable");
  vi.spyOn(f.storage, "list").mockRejectedValueOnce(callbackFailure);
  const schedule = vi.fn(async () => undefined);
  await expect(
    reconcileAndRedeliverRemoteAgentCallbacks({
      ...f.input,
      readSubmission: async () => null,
      schedule,
    })
  ).rejects.toBe(callbackFailure);
  expect(f.requestComputerCleanup).toHaveBeenCalledTimes(2);
  expect(schedule).toHaveBeenCalledWith(
    10,
    "retryRemoteAgentCallbacks",
    expect.any(Object),
    { idempotent: true }
  );
  expect(await listComputerCleanupHandoffs(f.storage)).toMatchObject([
    { attempts: 2, nextAttemptAtMs: TEST_NOW_MS + 15_000 },
  ]);
});

it("pauses bounded automatic Stop delivery and permits only an explicit resume of the same identity", async () => {
  const f = await fixture();
  f.requestComputerCleanup.mockRejectedValue(new Error("Computer unavailable"));
  for (let index = 0; index < 10; index++) {
    vi.setSystemTime(TEST_NOW_MS + index * 300_000);
    await requestComputerCleanup(f.input);
  }
  expect(f.requestComputerCleanup).toHaveBeenCalledTimes(8);
  expect(await listComputerCleanupHandoffs(f.storage)).toMatchObject([
    { attempts: 8, nextAttemptAtMs: null, accepted: false },
  ]);
  f.requestComputerCleanup.mockResolvedValue(f.state);
  await expect(
    requestComputerCleanup({ ...f.input, resume: true })
  ).resolves.toMatchObject({ accepted: true, attempts: 1 });
  expect(f.requestComputerCleanup).toHaveBeenLastCalledWith("original", true);
});

it("does not equate exit with saved files or upgrade an explained blocked task after cleanup completes", async () => {
  const f = await fixture();
  f.state.pendingResults = 1;
  await expect(
    finishRemoteAgentComputerCommands(f.input)
  ).resolves.toMatchObject({
    code: "remote_agent.computer.command_cleanup_failed",
  });
  await reportComputerFinishFacts({ ...f.input, state: f.state });
  f.state.pendingResults = 0;
  const result = await finishRemoteAgentComputerCommands({
    ...f.input,
    assistantText: "All done",
  });
  expect(result).toMatchObject({
    code: "remote_agent.computer.command_cleanup_failed",
    computerCleanup: { state: { pendingResults: 0 } },
  });
  expect(result?.explanationText).toBeUndefined();
});

it("limits changing Computer finish facts to two model feedback cycles", async () => {
  const f = await fixture();
  await initializeRemoteAgentExecutionState({
    identity: buildRemoteAgentExecutionIdentity(f.context),
    storage: f.storage,
    acceptedAtMs: TEST_NOW_MS,
  });
  Object.assign(f.state, {
    total: 1,
    unfinished: 1,
    pendingResults: 1,
    commands: [
      {
        reference: {
          invocationId: "original",
          key: "publish",
          id: "process-1",
          backend: "container",
        },
        phase: "running",
        after: 0,
        exitCode: null,
        outputRetained: true,
        filesSynced: false,
        stopRequested: false,
        terminationConfirmed: false,
        resultUnavailable: false,
        collection: null,
      },
    ],
  } satisfies Partial<CloudComputerInvocationState>);
  const append = vi.fn();
  let finishState: ComputerFinishState = null;
  for (let cycle = 0; cycle < 6; cycle++) {
    f.state.commands = f.state.commands.map((command) => ({
      ...command,
      after: cycle,
    }));
    await checkRemoteAgentExecutionFinish({
      ...f.input,
      finish: { append },
      finishState,
      setFinishState: (state) => {
        finishState = state;
      },
    });
  }
  expect(append.mock.calls.map(([signal]) => signal.type)).toEqual([
    "owned_commands_pending",
    "computer_result_incomplete",
  ]);
  expect(f.requestComputerCleanup).toHaveBeenCalledTimes(1);
  const result = await finishRemoteAgentComputerCommands({
    ...f.input,
    assistantText: "The previously observed output is saved.",
  });
  expect(result?.code).toBe("remote_agent.computer.command_cleanup_failed");
  expect(result?.explanationText).toBeUndefined();
});

async function retainLegacyRunningCommand(
  storage: InMemoryDurableObjectStorage
) {
  const key = `${COMPUTER_COMMAND_PREFIX}original:publish`;
  const receipt: ComputerCommandRecord = {
    id: "original-process",
    key: "publish",
    fingerprint: "original-command",
    createdAt: TEST_NOW_MS,
    launchAcknowledgedAt: TEST_NOW_MS,
    backend: "worker-shell",
    collectable: false,
  };
  await storage.put(key, receipt);
  return key;
}

it("keeps legacy Remote receipts due until the bounded cleanup obligation pauses", async () => {
  const f = await fixture(true);
  const receiptKey = await retainLegacyRunningCommand(f.storage);
  await expect(requestComputerCleanup(f.input)).resolves.toMatchObject({
    accepted: true,
    attempts: 1,
    nextAttemptAtMs: TEST_NOW_MS + 5000,
    state: { unfinished: 1, pendingResults: 1 },
  });
  vi.setSystemTime(TEST_NOW_MS + 5000);
  await expect(retryComputerCleanupHandoffs(f.input)).resolves.toBe(
    TEST_NOW_MS + 15_000
  );
  expect(await listComputerCleanupHandoffs(f.storage)).toMatchObject([
    { accepted: true, attempts: 2, nextAttemptAtMs: TEST_NOW_MS + 15_000 },
  ]);
  for (let attempt = 3; attempt <= 8; attempt++) {
    vi.setSystemTime(TEST_NOW_MS + attempt * 300_000);
    await retryComputerCleanupHandoffs(f.input);
  }
  expect(await listComputerCleanupHandoffs(f.storage)).toMatchObject([
    {
      accepted: true,
      attempts: 8,
      nextAttemptAtMs: null,
      state: { unfinished: 1 },
    },
  ]);
  await expect(f.storage.get(receiptKey)).resolves.toMatchObject({
    id: "original-process",
    stopRequested: true,
  });
  expect(f.requestComputerCleanup).not.toHaveBeenCalled();
});

it("pauses an unroutable legacy handoff instead of returning an already-due alarm", async () => {
  const f = await fixture(true);
  await retainLegacyRunningCommand(f.storage);
  await requestComputerCleanup(f.input);
  await f.storage.delete(buildRemoteAgentCallbackContextKey("original"));
  vi.setSystemTime(TEST_NOW_MS + 5000);
  await expect(retryComputerCleanupHandoffs(f.input)).resolves.toBeNull();
  await expect(retryComputerCleanupHandoffs(f.input)).resolves.toBeNull();
  expect(await listComputerCleanupHandoffs(f.storage)).toMatchObject([
    {
      accepted: true,
      attempts: 1,
      nextAttemptAtMs: null,
      state: { unfinished: 1 },
    },
  ]);
  expect(f.requestComputerCleanup).not.toHaveBeenCalled();
});
