import type {
  WorkspaceClient,
  WorkspaceRuntimeEvent,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import { defineTool } from "@flue/runtime";
import { buildPersonalRemoteAgentConversationId } from "@openmeld/schemas";
import { type GenericSchema, parse } from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
  readRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import {
  createComputerCommandTool,
  readCommandSlice,
  stopRemoteAgentComputerCommands,
  stopStoredComputerCommands,
} from "../flue-adapter/computer-command";
import { resolveRemoteAgentComputerName } from "../flue-adapter/computer-identity";
import { cancelFlueRemoteAgentExecution } from "../flue-adapter/execution-cancellation";
import { finishRemoteAgentComputerCommands } from "../flue-adapter/execution-cleanup";
import { checkRemoteAgentExecutionFinish } from "../flue-adapter/execution-finish";
import { reconcileRemoteAgentExecution } from "../flue-adapter/execution-reconciliation";
import { executeRemoteAgentToolDefinition } from "../flue-adapter/tool-execution";
import {
  createSubmitTurnRequest,
  createSubmitTurnRequestV2,
  TEST_NOW_MS,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const cleanupAccess = vi.hoisted(() => vi.fn());
vi.mock(
  "../flue-adapter/agent-computer-workspace-access",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../flue-adapter/agent-computer-workspace-access")
    >()),
    createAgentComputerWorkspaceAccess: cleanupAccess,
    materializeAgentComputerWorkspace: async () => ({
      workingDirectory: "/computer/spaces/a",
      documents: null,
    }),
  })
);

function context(submissionId: string, personal = false) {
  const base = createSubmitTurnRequestV2();
  const conversationId = buildPersonalRemoteAgentConversationId(base);
  const request = personal
    ? {
        ...base,
        v: 4 as const,
        conversationId,
        runtimeConversation: { generation: 0, id: conversationId },
        conversationIdentity: {
          kind: "personal_agent" as const,
          agentProfileId: base.agentProfileId,
        },
      }
    : createSubmitTurnRequest();
  return {
    ...createRemoteAgentCallbackContext({
      request,
      nowMs: TEST_NOW_MS,
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: submissionId,
        status: "pending",
        submissionId,
      },
    }),
    computerIsolationVersion: 2 as const,
  };
}

// The fake implements the installed vendor's retained event-stream contract.
// Disposing a reader detaches it; only killExec signals the underlying process.
function handle(
  id: string,
  events: WorkspaceRuntimeEvent<"utf8">[] = [],
  close = false
) {
  const stream = new ReadableStream<WorkspaceRuntimeEvent<"utf8">>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      if (close) {
        controller.close();
      }
    },
  });
  return Object.assign(stream, {
    id,
    backend: "container",
    result: vi.fn(),
    kill: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }) as WorkspaceRuntimeExecHandle<"utf8">;
}

function fixture() {
  const storage = new InMemoryDurableObjectStorage();
  const processes = new Set<string>();
  const exec = vi.fn((_source: string, options: { id: string }) => {
    processes.add(options.id);
    return Promise.resolve(handle(options.id));
  });
  const getExec = vi.fn((id: string) => {
    if (!processes.has(id)) {
      return Promise.reject(new Error("EEXEC_LOST"));
    }
    return Promise.resolve(handle(id));
  });
  const killExec = vi.fn((_id: string) => Promise.resolve());
  const workspace = {
    runtime: { exec, getExec, killExec },
  } as unknown as WorkspaceClient;
  const workspaceAccess = {
    withWorkspace: async <T>(
      operation: (value: WorkspaceClient) => Promise<T>
    ) => await operation(workspace),
  };
  const tool = (submissionId = "execution-a", personal = false) =>
    createComputerCommandTool({
      context: context(submissionId, personal),
      storage,
      workspaceAccess,
      workingDirectory: "/computer/spaces/a",
    });
  return { tool, exec, getExec, killExec, processes, storage, workspaceAccess };
}

describe("retained Computer commands", () => {
  it("preserves a shell receipt that completes after cleanup takes its snapshot", async () => {
    const f = fixture();
    await f.tool().execute({ action: "start", key: "a", command: "sleep 20" });
    let finishShell!: (value: WorkspaceRuntimeExecHandle<"utf8">) => void;
    let shellId = "";
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.exec.mockImplementationOnce(
      (_source, options) =>
        new Promise((resolve) => {
          shellId = options.id;
          finishShell = resolve;
          entered();
        })
    );
    const shell = f.tool().execute({
      action: "start",
      key: "b",
      command: "printf retained",
      backend: "worker-shell",
    });
    await started;
    f.getExec.mockImplementationOnce(async (id) => {
      finishShell(
        handle(
          shellId,
          [
            { id: shellId, seq: 1, name: "stdout", value: "retained" },
            { id: shellId, seq: 2, name: "exit", code: 0 },
          ],
          true
        )
      );
      await shell;
      return handle(id, [{ id, seq: 1, name: "exit", code: 0 }], true);
    });
    await expect(
      stopStoredComputerCommands({
        context: context("execution-a"),
        storage: f.storage,
        access: () => f.workspaceAccess,
      })
    ).resolves.toEqual({ unfinished: 0, lostDuringCleanup: false });
    await expect(
      f.tool().execute({ action: "poll", key: "b" })
    ).resolves.toMatchObject({ status: "completed", stdout: "retained" });
  });

  it("reports clipped output instead of silently presenting it as complete", async () => {
    const result = await readCommandSlice(
      handle(
        "large",
        [
          { id: "large", seq: 1, name: "stdout", value: "x".repeat(50_001) },
          { id: "large", seq: 2, name: "exit", code: 0 },
        ],
        true
      ),
      "large",
      0,
      1000
    );
    expect(result).toMatchObject({
      status: "completed",
      outputTruncated: true,
    });
    expect(result.stdout).toHaveLength(50_000);
  });

  it("finishes cleanup for a current invocation that never acquired a Computer", async () => {
    await expect(
      stopRemoteAgentComputerCommands({
        context: { ...context("ownerless"), computerIsolationVersion: 3 },
        env: {},
        storage: new InMemoryDurableObjectStorage(),
      })
    ).resolves.toEqual({ unfinished: 0, lostDuringCleanup: false });
  });
  it.each([
    1, 2,
  ])("rejects a cancelled invocation before launch at boundary %i", async (cancelAt) => {
    const f = fixture();
    let checks = 0;
    const tool = createComputerCommandTool({
      context: context("cancelled-task"),
      storage: f.storage,
      workspaceAccess: f.workspaceAccess,
      workingDirectory: "/computer/tasks/cancelled-task",
      assertCanStart: async () => {
        checks += 1;
        if (checks === cancelAt) {
          throw new Error("computer.invocation_stopped");
        }
        await Promise.resolve();
      },
    });
    await expect(
      tool.execute({ action: "start", key: "late", command: "touch result" })
    ).rejects.toThrow("computer.invocation_stopped");
    expect(f.processes.size).toBe(0);
  });

  it.each([
    { cancel: false, personal: false },
    { cancel: true, personal: false },
    { cancel: true, personal: true },
  ])("keeps a safety-fenced command stoppable and recovers cleanup before publication ($personal, Stop=$cancel)", async ({
    cancel,
    personal,
  }) => {
    const f = fixture();
    const executionContext = context("execution-a", personal);
    const identity = buildRemoteAgentExecutionIdentity(executionContext);
    await putRemoteAgentCallbackContext(f.storage, executionContext);
    await initializeRemoteAgentExecutionState({
      identity,
      storage: f.storage,
      acceptedAtMs: TEST_NOW_MS,
    });
    const expectedName = resolveRemoteAgentComputerName(executionContext);
    cleanupAccess.mockImplementation(({ computerId }) => {
      if (computerId !== expectedName) {
        throw new Error(`Accessed another Computer: ${computerId}`);
      }
      return f.workspaceAccess;
    });
    const idFromName = vi.fn((name: string) => name);
    const env = {
      AGENT_COMPUTER: {
        idFromName,
        get: vi.fn(() => ({})),
      },
    };
    // Historical receipts remain in execution storage and keep their old address.
    const definition = f.tool("execution-a", personal);
    const invoke = () =>
      executeRemoteAgentToolDefinition({
        definition,
        storage: f.storage,
        submissionId: "execution-a",
        callLimit: 1,
        toolInput: { action: "start", key: "long", command: "sleep 300" },
      });
    await invoke();
    await expect(invoke()).rejects.toThrow("safety limit");
    await expect(
      readRemoteAgentExecutionState({ identity, storage: f.storage })
    ).resolves.toMatchObject({
      execution: { status: "pending", completedAtMs: null },
    });
    const completeRemoteAgentSubmission = vi.fn(() =>
      Promise.resolve({ status: "accepted" as const })
    );
    const readSubmission = vi.fn(() =>
      Promise.resolve({ status: "running" as "running" | "settled" })
    );
    const reconcile = () =>
      reconcileRemoteAgentExecution({
        identity,
        storage: f.storage,
        env,
        readSubmission,
        coreWorker: { completeRemoteAgentSubmission },
      });
    await reconcile();
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
    expect(f.killExec).not.toHaveBeenCalled();
    const abortSubmission = vi.fn(async () => {
      await stopRemoteAgentComputerCommands({
        context: executionContext,
        storage: f.storage,
        env,
      });
      return { aborted: true };
    });
    if (cancel) {
      await expect(
        cancelFlueRemoteAgentExecution({
          scheduleReconciliation: vi.fn(async () => undefined),
          identity,
          storage: f.storage,
          nowMs: TEST_NOW_MS + 1,
          abortSubmission,
        })
      ).resolves.toMatchObject({
        response: { status: "cancellation_requested" },
        abortedFlueSubmission: true,
      });
      expect(abortSubmission).toHaveBeenCalledOnce();
    }
    readSubmission.mockResolvedValue({ status: "settled" });
    // Reconstruct through the recovery entry point, without a prompt observer.
    await expect(reconcile()).rejects.toThrow(
      "termination is not yet confirmed"
    );
    expect(f.killExec).toHaveBeenCalled();
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
    f.getExec.mockImplementation((id) =>
      Promise.resolve(
        handle(id, [{ id, name: "exit", seq: 1, code: 143 }], true)
      )
    );
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: cancel ? "aborted" : "failed" },
    });
    await reconcile();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureCode: cancel
          ? "remote_agent.execution_cancelled"
          : "remote_agent.tool_call_budget_exceeded",
      })
    );
    expect(f.exec).toHaveBeenCalledOnce();
    expect(idFromName.mock.calls.length).toBeGreaterThan(1);
    expect(idFromName.mock.calls.every(([name]) => name === expectedName)).toBe(
      true
    );
  });
  it("keeps owned work pending until its retained completion receipt is collected", async () => {
    const f = fixture();
    const append = vi.fn();
    const check = () =>
      checkRemoteAgentExecutionFinish({
        context: context("execution-a"),
        storage: f.storage,
        finish: { append },
      });
    await check();
    expect(append).not.toHaveBeenCalled();
    const started = (await f
      .tool()
      .execute({ action: "start", key: "long", command: "sleep 300" })) as {
      id: string;
    };
    await check();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "owned_commands_pending",
        body: expect.stringContaining('"long"'),
      })
    );
    expect(f.killExec).not.toHaveBeenCalled();
    f.getExec.mockImplementation(async (id) =>
      handle(id, [{ id, name: "exit", seq: 1, code: 0 }], true)
    );
    await f.tool().execute({ action: "poll", key: "long", waitSeconds: 0 });
    append.mockClear();
    await check();
    expect(append).not.toHaveBeenCalled();
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(started.id).toBeTruthy();
  });
  it("still signals every owned command when terminal output inspection fails", async () => {
    const f = fixture();
    const ids: string[] = [];
    for (const key of ["first", "second"]) {
      const result = (await f
        .tool()
        .execute({ action: "start", key, command: "sleep 300" })) as {
        id: string;
      };
      ids.push(result.id);
    }
    await f
      .tool("other-execution")
      .execute({ action: "start", key: "other", command: "sleep 300" });
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    f.getExec.mockRejectedValue(
      new TypeError(
        "The readable side of this TransformStream is no longer readable."
      )
    );
    await expect(
      stopRemoteAgentComputerCommands({
        context: context("execution-a"),
        storage: f.storage,
        env: { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } },
      })
    ).rejects.toThrow();
    expect(f.killExec.mock.calls.map(([id]) => id)).toEqual(ids);
  });
  it("recognizes execution loss confirmed by Stop after output inspection fails", async () => {
    const f = fixture();
    const started = (await f.tool().execute({
      action: "start",
      key: "lost",
      command: "sleep 300",
    })) as { id: string };
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    f.getExec.mockRejectedValue(new TypeError("Output transport failed"));
    f.killExec.mockRejectedValue(
      Object.assign(new Error("Computer runtime replaced"), {
        name: "WorkspaceExecutionLostError",
        code: "EEXEC_LOST",
      })
    );
    const input = {
      context: context("execution-a"),
      env: { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } },
      storage: f.storage,
    };
    await expect(stopRemoteAgentComputerCommands(input)).rejects.toThrow(
      "a retained execution was confirmed lost"
    );
    await expect(stopRemoteAgentComputerCommands(input)).resolves.toEqual({
      unfinished: 0,
      lostDuringCleanup: true,
    });
    expect(f.killExec).toHaveBeenCalledOnce();
    expect(f.killExec.mock.calls[0]?.[0]).toBe(started.id);
  });
  it("keeps reported lost commands from failing recovered work during cleanup", async () => {
    const f = fixture();
    const started = await f
      .tool()
      .execute({ action: "start", key: "lost", command: "sleep 300" });
    // The installed SDK reports a runtime identity mismatch with this code.
    const lost = Object.assign(new Error("Computer runtime replaced"), {
      name: "WorkspaceExecutionLostError",
      code: "EEXEC_LOST",
    });
    f.getExec.mockRejectedValue(lost);
    await expect(
      f.tool().execute({ action: "poll", key: "lost" })
    ).rejects.toMatchObject({ code: "EEXEC_LOST" });
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    await expect(
      stopRemoteAgentComputerCommands({
        context: context("execution-a"),
        storage: f.storage,
        env: { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } },
      })
    ).resolves.toMatchObject({ unfinished: 0 });
    expect(f.killExec).not.toHaveBeenCalled();
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(started).toMatchObject({ key: "lost", status: "running" });
  });

  it.each([
    { personal: false, commandCount: 1, cancel: false },
    { personal: true, commandCount: 4, cancel: true },
  ])("settles $commandCount commands first lost during cleanup (personal=$personal, Stop=$cancel)", async ({
    personal,
    commandCount,
    cancel,
  }) => {
    const f = fixture();
    const executionContext = context("execution-a", personal);
    const identity = buildRemoteAgentExecutionIdentity(executionContext);
    await putRemoteAgentCallbackContext(f.storage, executionContext);
    await initializeRemoteAgentExecutionState({
      identity,
      storage: f.storage,
      acceptedAtMs: TEST_NOW_MS,
    });
    for (let index = 0; index < commandCount; index += 1) {
      await f.tool("execution-a", personal).execute({
        action: "start",
        key: `long-${index}`,
        command: "sleep 300",
      });
    }
    const lost = Object.assign(new Error("Computer runtime replaced"), {
      name: "WorkspaceExecutionLostError",
      code: "EEXEC_LOST",
    });
    f.getExec.mockRejectedValue(lost);
    f.killExec.mockRejectedValue(lost);
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    const env = { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } };
    if (cancel) {
      await expect(
        cancelFlueRemoteAgentExecution({
          scheduleReconciliation: vi.fn(async () => undefined),
          abortSubmission: async () => {
            await stopRemoteAgentComputerCommands({
              context: executionContext,
              env,
              storage: f.storage,
            });
            return { aborted: true };
          },
          identity,
          nowMs: TEST_NOW_MS + 1,
          reason: "Stopped by the user.",
          storage: f.storage,
        })
      ).resolves.toMatchObject({
        response: { status: "cancellation_requested" },
      });
    } else {
      // Simulate a restart after command loss was saved but before the
      // execution failure was recorded. Reconciliation must not publish Done.
      await expect(
        stopRemoteAgentComputerCommands({
          context: executionContext,
          env,
          storage: f.storage,
        })
      ).rejects.toThrow("a retained execution was confirmed lost");
    }
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      status: "accepted" as const,
    }));
    const reconcile = () =>
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        env,
        identity,
        readSubmission: async () => ({
          status: "settled" as const,
          ...(cancel
            ? {}
            : {
                completedOutput: { submissionId: "execution-a", text: "Done" },
              }),
        }),
        storage: f.storage,
      });
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: cancel ? "aborted" : "failed" },
    });
    await reconcile();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureCode: cancel
          ? "remote_agent.execution_cancelled"
          : "remote_agent.turn_not_completed",
      })
    );
    expect(f.exec).toHaveBeenCalledTimes(commandCount);
    expect(f.getExec).toHaveBeenCalledTimes(commandCount);
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("waits for other owned work after one command is confirmed lost", async () => {
    const f = fixture();
    const executionContext = context("execution-a");
    const identity = buildRemoteAgentExecutionIdentity(executionContext);
    await putRemoteAgentCallbackContext(f.storage, executionContext);
    await initializeRemoteAgentExecutionState({
      identity,
      storage: f.storage,
      acceptedAtMs: TEST_NOW_MS,
    });
    const lostCommand = (await f.tool().execute({
      action: "start",
      key: "lost",
      command: "sleep 300",
    })) as { id: string };
    const liveCommand = (await f.tool().execute({
      action: "start",
      key: "live",
      command: "sleep 300",
    })) as { id: string };
    const otherCommand = (await f.tool("other-execution").execute({
      action: "start",
      key: "other",
      command: "sleep 300",
    })) as { id: string };
    const lost = Object.assign(new Error("Computer runtime replaced"), {
      name: "WorkspaceExecutionLostError",
      code: "EEXEC_LOST",
    });
    f.getExec.mockImplementation((id) =>
      id === lostCommand.id ? Promise.reject(lost) : Promise.resolve(handle(id))
    );
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      status: "accepted" as const,
    }));
    const reconcile = () =>
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        env: { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } },
        identity,
        readSubmission: async () => ({
          status: "settled" as const,
          completedOutput: { submissionId: "execution-a", text: "Done" },
        }),
        storage: f.storage,
      });
    await expect(reconcile()).rejects.toThrow(
      "Computer command cleanup failed"
    );
    await expect(
      readRemoteAgentExecutionState({ identity, storage: f.storage })
    ).resolves.toMatchObject({ execution: { status: "pending" } });
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
    expect(f.killExec.mock.calls.map(([id]) => id)).toEqual([liveCommand.id]);
    expect(f.killExec).not.toHaveBeenCalledWith(
      otherCommand.id,
      expect.anything()
    );
    f.getExec.mockImplementation(async (id) =>
      handle(id, [{ id, name: "exit", seq: 1, code: 143 }], true)
    );
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: "failed" },
    });
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
  });

  it.each([
    { personal: false, commandCount: 1 },
    { personal: true, commandCount: 4 },
  ])("publishes one failure after $commandCount exact Computer records disappear (personal=$personal)", async ({
    personal,
    commandCount,
  }) => {
    const f = fixture();
    const executionContext = context("execution-a", personal);
    const identity = buildRemoteAgentExecutionIdentity(executionContext);
    await putRemoteAgentCallbackContext(f.storage, executionContext);
    await initializeRemoteAgentExecutionState({
      identity,
      storage: f.storage,
      acceptedAtMs: TEST_NOW_MS,
    });
    const keys = Array.from(
      { length: commandCount },
      (_, index) => `long-${index}`
    );
    for (const key of keys) {
      await f.tool("execution-a", personal).execute({
        action: "start",
        key,
        command: "sleep 300",
      });
    }
    const missing = (id: string) =>
      Object.assign(new Error(`no exec record for id ${id}`), {
        code: "ENOENT",
      });
    f.getExec.mockImplementation((id) => Promise.reject(missing(id)));
    f.killExec.mockImplementation((id) => Promise.reject(missing(id)));
    for (const key of keys) {
      await expect(
        f.tool("execution-a", personal).execute({
          action: "poll",
          key,
          waitSeconds: 0,
        })
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        f.tool("execution-a", personal).execute({ action: "stop", key })
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    const env = { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } };

    await expect(
      finishRemoteAgentComputerCommands({
        context: executionContext,
        env,
        storage: f.storage,
      })
    ).rejects.toThrow("a retained execution was confirmed lost");
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      status: "accepted" as const,
    }));
    const reconcile = async () =>
      await reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        env,
        identity,
        readSubmission: async () => ({ status: "settled" }),
        storage: f.storage,
      });
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: "failed" },
    });
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: "failed" },
    });
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        submissionId: "execution-a",
        failureDetail: expect.stringContaining(
          "a retained execution was confirmed lost"
        ),
      })
    );
    expect(f.exec).toHaveBeenCalledTimes(commandCount);
    expect(f.getExec).toHaveBeenCalledTimes(commandCount * 2);
    expect(f.killExec).toHaveBeenCalledTimes(commandCount * 2);
  });

  it("acknowledges Stop and publishes one aborted outcome when a retained command is gone", async () => {
    const f = fixture();
    const executionContext = context("execution-a");
    const identity = buildRemoteAgentExecutionIdentity(executionContext);
    await putRemoteAgentCallbackContext(f.storage, executionContext);
    await initializeRemoteAgentExecutionState({
      identity,
      storage: f.storage,
      acceptedAtMs: TEST_NOW_MS,
    });
    await f
      .tool()
      .execute({ action: "start", key: "long", command: "sleep 300" });
    const missing = Object.assign(new Error("no exec record"), {
      code: "ENOENT",
    });
    f.getExec.mockRejectedValue(missing);
    f.killExec.mockRejectedValue(missing);
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    const env = { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } };
    const abortSubmission = vi.fn(async () => {
      await stopRemoteAgentComputerCommands({
        context: executionContext,
        env,
        storage: f.storage,
      });
      return { aborted: true };
    });

    await expect(
      cancelFlueRemoteAgentExecution({
        scheduleReconciliation: vi.fn(async () => undefined),
        abortSubmission,
        identity,
        nowMs: TEST_NOW_MS + 1,
        reason: "Stopped by the user.",
        storage: f.storage,
      })
    ).resolves.toMatchObject({
      response: { status: "cancellation_requested" },
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      status: "accepted" as const,
    }));
    const reconcile = async () =>
      await reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        env,
        identity,
        readSubmission: async () => ({ status: "settled" }),
        storage: f.storage,
      });
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: "aborted" },
    });
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: "aborted" },
    });
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(f.exec).toHaveBeenCalledOnce();
  });

  it("keeps cleanup pending when inspection is missing but Stop has no exit proof", async () => {
    const f = fixture();
    const started = (await f
      .tool()
      .execute({ action: "start", key: "long", command: "sleep 300" })) as {
      id: string;
    };
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    const env = { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } };
    f.getExec.mockRejectedValueOnce(
      Object.assign(new Error("no exec record"), { code: "ENOENT" })
    );
    await expect(
      stopRemoteAgentComputerCommands({
        context: context("execution-a"),
        env,
        storage: f.storage,
      })
    ).rejects.toThrow("Computer command cleanup failed");
    expect(f.killExec).toHaveBeenCalledWith(started.id, {
      backend: "container",
      signal: "SIGTERM",
    });
    f.getExec.mockImplementation(async (id) =>
      handle(id, [{ id, name: "exit", seq: 1, code: 143 }], true)
    );
    await expect(
      stopRemoteAgentComputerCommands({
        context: context("execution-a"),
        env,
        storage: f.storage,
      })
    ).resolves.toMatchObject({ unfinished: 0 });
    expect(f.getExec).toHaveBeenCalledTimes(2);
  });

  it("reports a native live subscriber as running and later reads the retained exit", async () => {
    const f = fixture();
    const started = (await f
      .tool()
      .execute({ action: "start", key: "quiet", command: "sleep 300" })) as {
      id: string;
    };
    f.getExec.mockRejectedValueOnce(
      Object.assign(new Error("already has a live subscriber"), {
        code: "EEXEC_BUSY",
      })
    );
    expect(
      await f
        .tool()
        .execute({ action: "poll", key: "quiet", after: 1, waitSeconds: 0 })
    ).toMatchObject({
      id: started.id,
      status: "running",
      exitCode: null,
      outputPending: true,
      after: 1,
    });
    f.getExec.mockResolvedValueOnce(
      handle(
        started.id,
        [{ id: started.id, seq: 2, name: "exit", code: 0 }],
        true
      )
    );
    expect(
      await f
        .tool()
        .execute({ action: "poll", key: "quiet", after: 1, waitSeconds: 0 })
    ).toMatchObject({ status: "completed", exitCode: 0, after: 2 });
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.killExec).not.toHaveBeenCalled();
  });
  it("registers through the actual pinned Flue tool boundary", () => {
    const tool = fixture().tool();
    expect(() =>
      defineTool({
        name: tool.name,
        description: tool.description,
        input: tool.input as GenericSchema<Record<string, unknown>, unknown>,
        run: () => Promise.resolve({ output: "unused" }),
      })
    ).not.toThrow();
  });
  it("reattaches after adapter reconstruction without rerunning the command", async () => {
    const f = fixture();
    const request = {
      action: "start",
      key: "report",
      command: "python3 report.py",
    };
    await f.tool().execute(request);
    await f.tool().execute(request);
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.getExec).toHaveBeenCalledTimes(1);
    expect(f.killExec).not.toHaveBeenCalled();
    expect(await f.tool().execute({ action: "list" })).toMatchObject([
      { key: "report" },
    ]);
  });

  it("rejects another execution's control key and rejects changed commands", async () => {
    const f = fixture();
    await f.tool().execute({
      action: "start",
      key: "report",
      command: "python3 report.py",
    });
    await expect(
      f.tool("execution-b").execute({ action: "stop", key: "report" })
    ).rejects.toThrow("Unknown Computer command");
    await expect(
      f
        .tool()
        .execute({ action: "start", key: "report", command: "rm report.py" })
    ).rejects.toThrow("different command");
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("does not respawn when a previously launched process is lost", async () => {
    const f = fixture();
    const request = {
      action: "start",
      key: "report",
      command: "python3 report.py",
    };
    await f.tool().execute(request);
    f.processes.clear();
    await expect(f.tool().execute(request)).rejects.toThrow("EEXEC_LOST");
    expect(f.exec).toHaveBeenCalledTimes(1);
  });

  it("preserves an uncertain launch receipt instead of retrying its side effects", async () => {
    const f = fixture();
    f.exec.mockRejectedValueOnce(new Error("Transport lost after dispatch"));
    const request = {
      action: "start",
      key: "upload",
      command: "python3 upload.py",
    };
    await expect(f.tool().execute(request)).rejects.toThrow("Transport lost");
    await expect(f.tool().execute(request)).rejects.toThrow("EEXEC_LOST");
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(await f.tool().execute({ action: "list" })).toMatchObject([
      { key: "upload" },
    ]);
  });

  it("stops a launch that returns after its cancellation request", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.exec.mockImplementationOnce(async (_source, options) => {
      entered?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return handle(options.id);
    });
    const launch = f.tool().execute({
      action: "start",
      key: "report",
      command: "python3 report.py",
    });
    await started;
    await f.tool().execute({ action: "stop", key: "report" });
    release?.();
    await expect(launch).rejects.toThrow("stopped during launch");
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.killExec).toHaveBeenCalledTimes(2);
  });

  it("keeps cancellation distinct from completed execution", async () => {
    const f = fixture();
    await f.tool().execute({
      action: "start",
      key: "report",
      command: "python3 report.py",
    });
    expect(
      await f.tool().execute({ action: "stop", key: "report" })
    ).toMatchObject({ status: "stop_requested" });
    expect(f.killExec).toHaveBeenCalledTimes(1);
    await expect(
      f.tool().execute({
        action: "start",
        key: "report",
        command: "python3 report.py",
      })
    ).rejects.toThrow("already stopped");
  });

  it("yields partial output without terminating a running process", async () => {
    const run = handle("run", [
      { id: "run", seq: 1, name: "stdout", value: "START\n" },
    ]);
    expect(await readCommandSlice(run, "report", 0, 1)).toEqual({
      id: "run",
      key: "report",
      status: "running",
      exitCode: null,
      stdout: "START\n",
      stderr: "",
      after: 1,
    });
    expect(run.kill).not.toHaveBeenCalled();
  });

  it("accepts the SDK's fractional output cursor through both tool validators", async () => {
    const f = fixture();
    const tool = f.tool();
    f.exec.mockImplementationOnce((_source, options) =>
      Promise.resolve(
        handle(options.id, [
          { id: options.id, seq: 4.5, name: "stderr", value: "�" },
          { id: options.id, seq: 5, name: "exit", code: 0 },
        ])
      )
    );
    const started = (await tool.execute({
      action: "start",
      key: "utf8",
      command: "example",
    })) as { id: string; after: number };
    expect(started.after).toBe(4.5);
    f.getExec.mockResolvedValueOnce(
      handle(
        started.id,
        [{ id: started.id, seq: 5, name: "exit", code: 0 }],
        true
      )
    );
    const input = parse(
      tool.input as GenericSchema<
        Record<string, unknown>,
        Record<string, unknown>
      >,
      {
        action: "poll",
        key: "utf8",
        after: started.after,
      }
    );
    await expect(tool.execute(input)).resolves.toMatchObject({
      status: "completed",
      after: 5,
    });
    expect(f.getExec).toHaveBeenCalledWith(
      started.id,
      expect.objectContaining({ resume: 4.5 })
    );
  });

  it("requires an exit receipt and drains file sync before reporting completion", async () => {
    const run = handle(
      "run",
      [
        { id: "run", seq: 2, name: "stdout", value: "DONE\n" },
        { id: "run", seq: 3, name: "exit", code: 0 },
      ],
      true
    );
    expect(await readCommandSlice(run, "report", 1, 10)).toMatchObject({
      status: "completed",
      exitCode: 0,
      stdout: "DONE\n",
      after: 3,
    });
    await expect(
      readCommandSlice(handle("missing", [], true), "report", 0, 10)
    ).rejects.toThrow("without an exit receipt");
  });

  it("bounds pending file sync and leaves the exit receipt available to the next poll", async () => {
    const events: WorkspaceRuntimeEvent<"utf8">[] = [
      { id: "run", seq: 2, name: "stdout", value: "DONE\n" },
      { id: "run", seq: 3, name: "exit", code: 0 },
    ];
    const run = handle("run", events);
    const slice = await readCommandSlice(run, "report", 1, 10);
    expect(slice).toMatchObject({
      status: "running",
      after: 2,
      stdout: "DONE\n",
    });
    expect(run.locked).toBe(false);
    expect(run[Symbol.dispose]).toHaveBeenCalled();
    expect(run.kill).not.toHaveBeenCalled();
    // The vendor resumes strictly after the supplied sequence. Only the exit
    // should replay; output already delivered to the model must not repeat.
    const resumed = handle(
      "run",
      events.filter((event) => event.seq > slice.after),
      true
    );
    expect(
      await readCommandSlice(resumed, "report", slice.after, 10)
    ).toMatchObject({
      status: "completed",
      exitCode: 0,
      after: 3,
      stdout: "",
    });
  }, 500);

  it("honors Stop after exit while file sync is pending", async () => {
    const run = handle("run", [{ id: "run", seq: 1, name: "exit", code: 0 }]);
    const controller = new AbortController();
    const reading = readCommandSlice(run, "report", 0, 1000, controller.signal);
    const rejected = expect(reading).rejects.toThrow("User stopped execution");
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error("User stopped execution"));
    await rejected;
    expect(run.locked).toBe(false);
    expect(run[Symbol.dispose]).toHaveBeenCalled();
  }, 500);
});
