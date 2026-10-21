import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  WorkspaceClient,
  WorkspaceRuntimeEvent,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import { WorkspaceSyncPendingError } from "@cloudflare/computer";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, observe, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import {
  buildPersonalRemoteAgentConversationId,
  type CloudComputerCommandReference,
  cloudComputerResponseSchema,
} from "@openmeld/schemas";
import { type GenericSchema, object, parse } from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  bindComputerCommandTarget,
  createComputerCommandTool,
  readCommandSlice,
  readStoredComputerInvocation,
  requestStoredComputerCleanup,
  stopRemoteAgentComputerCommands,
  stopStoredComputerCommands,
} from "../flue-adapter/computer-command";
import { ComputerCommandSqlStorage } from "../flue-adapter/computer-command-storage";
import { executeAgentComputerCommand } from "../flue-adapter/computer-command-wait";
import { executeComputerHelper } from "../flue-adapter/computer-helper-execution";
import { resolveRemoteAgentComputerName } from "../flue-adapter/computer-identity";
import {
  readComputerRecovery,
  registerComputerInvocation,
} from "../flue-adapter/computer-invocations";
import {
  assertComputerMutationCanContinue,
  authorizeComputerObservation,
  createComputerRecoveryTool,
} from "../flue-adapter/computer-recovery";
import { cancelFlueRemoteAgentExecution } from "../flue-adapter/execution-cancellation";
import { finishRemoteAgentComputerCommands } from "../flue-adapter/execution-cleanup";
import {
  checkRemoteAgentExecutionFinish,
  useRemoteAgentExecutionFinish,
} from "../flue-adapter/execution-finish";
import { reconcileRemoteAgentExecution } from "../flue-adapter/execution-reconciliation";
import { advanceGitPackTransfer } from "../flue-adapter/github-working-copy-transfer";
import { extractAssistantText } from "../flue-adapter/observation";
import {
  executeRemoteAgentToolDefinition,
  toFlueJsonValue,
} from "../flue-adapter/tool-execution";
import {
  createSubmitTurnRequest,
  createSubmitTurnRequestV2,
  TEST_NOW_MS,
} from "./fixtures";
import { collectDueComputerCommands as collectComputerCommands } from "./fixtures/computer-command-results";
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
    result: vi.fn(() => {
      const exit = events.find((event) => event.name === "exit");
      return Promise.resolve({
        status: "completed",
        exitCode: exit?.code ?? 0,
        stdout: "",
        stderr: "",
        pushed: 0,
        pulled: 0,
        skipped: [],
        sync: { status: "complete", applied: 0, skipped: [] },
      });
    }),
    kill: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }) as WorkspaceRuntimeExecHandle<"utf8">;
}

const commandDatabases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of commandDatabases) {
    database.close();
  }
  commandDatabases.length = 0;
});

function fixture(databasePath = ":memory:") {
  let database = new DatabaseSync(databasePath);
  commandDatabases.push(database);
  const createStorage = () =>
    new ComputerCommandSqlStorage({
      exec(query, ...bindings) {
        const rows = database.prepare(query).all(...(bindings as never[]));
        return {
          toArray: () => rows,
          rowsWritten: Number(
            database.prepare("SELECT changes() AS count").get()?.count ?? 0
          ),
        };
      },
    });
  let storage = createStorage();
  const close = () => {
    database.close();
    commandDatabases.splice(commandDatabases.indexOf(database), 1);
  };
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
    executionSync: vi.fn(async () => undefined),
    resumeExecutionSync: vi.fn(async () => ({
      status: "complete" as const,
      outcome: {
        epoch: "retained",
        rev: 8,
        skipped: [],
        skippedTruncated: false,
      },
    })),
    maintainSync: vi.fn(async () => false),
    runtime: {
      exec,
      execWithAdmission: async (
        source: string,
        options: { id: string },
        admit: () => Promise<void>
      ) => {
        await admit();
        return await exec(source, options);
      },
      getExec,
      killExec,
    },
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
  return {
    tool,
    exec,
    getExec,
    killExec,
    processes,
    get storage() {
      return storage;
    },
    close,
    reopen() {
      close();
      database = new DatabaseSync(databasePath);
      commandDatabases.push(database);
      storage = createStorage();
    },
    workspaceAccess,
    workspace,
  };
}

function gitImportInput(f: ReturnType<typeof fixture>) {
  return {
    storage: f.storage,
    workspaceAccess: {
      ...f.workspaceAccess,
      computerOperation: async (
        request: import("@openmeld/schemas").CloudComputerOperation
      ) => {
        if (request.action !== "command") {
          throw new Error("Expected command");
        }
        return await f.tool(request.invocationId).execute(request.command);
      },
    },
    invocationId: "git-import",
    operationId: "checkout",
    packPath: "/computer/transfer/pack-1.pack",
    location: {
      directory: "/computer/repo",
      transportDirectory: "/computer/transfer",
      manifestDigest: "a".repeat(64),
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
      baselineBranch: "main",
      baselineCommit: "c".repeat(40),
      baselineTree: "d".repeat(40),
      baselineManifestDigest: "e".repeat(64),
    },
    expiresAtMs: Date.now() + 3_600_000,
  };
}

describe("retained Computer commands", () => {
  it("authorizes recovery by invocation/key even when the launch reference was lost", async () => {
    const f = fixture();
    const original = context("original");
    const current = context("later");
    await putRemoteAgentCallbackContext(f.storage, original);
    await bindComputerCommandTarget({
      storage: f.storage,
      submissionId: original.submissionId,
      computerName: "same-computer",
    });
    const input = {
      context: current,
      storage: f.storage,
      env: {},
      computerName: "same-computer",
      operation: {
        action: "command" as const,
        invocationId: original.submissionId,
        command: {
          action: "poll" as const,
          key: "git-import:checkout",
          waitSeconds: 0,
        },
      },
    };
    expect(await authorizeComputerObservation(input)).toEqual(input.operation);
    const addressedToCurrent = await authorizeComputerObservation({
      ...input,
      operation: {
        ...input.operation,
        command: {
          ...input.operation.command,
          reference: {
            invocationId: current.submissionId,
            key: input.operation.command.key,
            id: "current-command",
            backend: "container",
          },
        },
      },
    });
    expect(
      addressedToCurrent.action === "command" && addressedToCurrent.invocationId
    ).toBe(current.submissionId);
    await expect(
      authorizeComputerObservation({
        ...input,
        context: { ...current, spaceId: "another-space" },
      })
    ).rejects.toThrow("computer.recovery_identity_mismatch");
    await expect(
      authorizeComputerObservation({
        ...input,
        computerName: "another-computer",
      })
    ).rejects.toThrow("computer.recovery_identity_mismatch");
  });
  it("admits a confirmed Git retry before a later turn polls it", async () => {
    const f = fixture();
    const input = gitImportInput(f);
    let attempts = 0;
    f.exec.mockImplementation((_source, { id }) => {
      f.processes.add(id);
      attempts++;
      return Promise.resolve(
        attempts === 1
          ? handle(id, [{ id, seq: 1, name: "exit", code: 1 }], true)
          : handle(id)
      );
    });
    expect(await advanceGitPackTransfer(input)).toBe("running");
    expect(f.exec).toHaveBeenCalledTimes(2);
    expect(f.storage.hasUnfinishedCommands()).toBe(true);
    f.getExec.mockImplementation((id) =>
      Promise.resolve(handle(id, [{ id, seq: 1, name: "exit", code: 0 }], true))
    );
    expect(
      await advanceGitPackTransfer({ ...input, invocationId: "later-turn" })
    ).toBe("completed");
    expect(f.exec).toHaveBeenCalledTimes(2);
  });
  it.each([
    { loseAcknowledgement: false, recoverLater: false },
    { loseAcknowledgement: true, recoverLater: false },
    { loseAcknowledgement: true, recoverLater: true },
  ])("keeps a detached Git import in the command owner (lost acknowledgement=$loseAcknowledgement, recover later=$recoverLater)", async ({
    loseAcknowledgement,
    recoverLater,
  }) => {
    const f = fixture();
    const input = gitImportInput(f);
    let dropReply = loseAcknowledgement;
    const operation = input.workspaceAccess.computerOperation;
    input.workspaceAccess.computerOperation = async (request) => {
      const result = await operation(request);
      if (dropReply) {
        dropReply = false;
        throw new Error("Lost launch acknowledgement");
      }
      return result;
    };
    if (loseAcknowledgement) {
      await expect(advanceGitPackTransfer(input)).rejects.toThrow(
        "Lost launch acknowledgement"
      );
      expect(f.storage.hasUnfinishedCommands()).toBe(true);
    }
    if (recoverLater) {
      input.invocationId = "recovery-turn";
    }
    expect(await advanceGitPackTransfer(input)).toBe("running");
    // This is the same durable predicate the idle alarm uses after two minutes.
    expect(f.storage.hasUnfinishedCommands()).toBe(true);
    expect(await f.storage.nextCollectionAt()).not.toBeNull();
    const resumed = { ...input, invocationId: "later-checkout-turn" };
    expect(await advanceGitPackTransfer(resumed)).toBe("running");
    expect(f.exec).toHaveBeenCalledOnce();
    f.getExec.mockImplementation((id) =>
      Promise.resolve(handle(id, [{ id, seq: 1, name: "exit", code: 0 }], true))
    );
    expect(await advanceGitPackTransfer(resumed)).toBe("completed");
    expect(f.storage.hasUnfinishedCommands()).toBe(false);
    expect(f.exec).toHaveBeenCalledOnce();
  });
  it.each([
    1, 3,
  ])("retries confirmed Git import failures at most three times (failures=%s)", async (failures) => {
    const f = fixture();
    const input = gitImportInput(f);
    let remaining = failures;
    f.exec.mockImplementation((_source, { id }) =>
      Promise.resolve(
        handle(
          id,
          [{ id, seq: 1, name: "exit", code: remaining-- > 0 ? 1 : 0 }],
          true
        )
      )
    );
    if (failures === 3) {
      await expect(advanceGitPackTransfer(input)).rejects.toThrow(
        "github.checkout.git_transfer_failed"
      );
      await expect(advanceGitPackTransfer(input)).rejects.toThrow(
        "github.checkout.git_transfer_failed"
      );
      expect(f.exec).toHaveBeenCalledTimes(3);
    } else {
      expect(await advanceGitPackTransfer(input)).toBe("completed");
      expect(await advanceGitPackTransfer(input)).toBe("completed");
      expect(f.exec).toHaveBeenCalledTimes(2);
    }
    expect(f.storage.hasUnfinishedCommands()).toBe(false);
  });
  it.each([
    false,
    true,
  ])("reads saved output after execution loss and SQLite reopen (output=%s)", async (hasOutput) => {
    const directory = await mkdtemp(join(tmpdir(), "computer-lost-output-"));
    const f = fixture(join(directory, "receipts.sqlite"));
    try {
      f.exec.mockImplementation((_source, { id }) =>
        Promise.resolve(
          handle(
            id,
            hasOutput
              ? [
                  { id, seq: 1, name: "stdout", value: "SAVED PARTIAL\n" },
                  { id, seq: 2, name: "stderr", value: "SAVED WARNING\n" },
                ]
              : []
          )
        )
      );
      const starting = f.tool().execute({
        action: "start",
        key: "partial",
        command: "long-running-work",
      });
      const started = (await starting) as {
        reference: CloudComputerCommandReference;
        after: number;
      };
      f.getExec.mockRejectedValue(
        Object.assign(new Error("Computer runtime replaced"), {
          code: "EEXEC_LOST",
        })
      );
      const request = {
        action: "poll",
        key: "partial",
        reference: started.reference,
        after: 0,
        waitSeconds: 0,
      };
      const expected = {
        reference: started.reference,
        phase: "result_unavailable",
        nextAction: "inspect",
        status: "running",
        exitCode: null,
        after: started.after,
        stdout: hasOutput ? "SAVED PARTIAL\n" : "",
        stderr: hasOutput ? "SAVED WARNING\n" : "",
      };
      await expect(f.tool().execute(request)).resolves.toMatchObject(expected);
      f.reopen();
      const native = vi
        .spyOn(f.workspaceAccess, "withWorkspace")
        .mockRejectedValue(
          new Error("The replacement runtime must not be opened")
        );
      const execute = vi.fn(() => f.tool().execute(request));
      const retained = await executeAgentComputerCommand({
        operation: {
          action: "command",
          invocationId: "execution-a",
          command: { ...request, action: "poll", waitSeconds: 20 },
        },
        execute,
      });
      expect(retained).toMatchObject(expected);
      // The unchanged response parser is also used by existing Core and CLI.
      expect(
        cloudComputerResponseSchema.parse({
          computer: {
            id: "personal",
            ownerUserId: "owner",
            provider: "cloudflare",
            createdAtMs: 0,
          },
          observedAtMs: Date.now(),
          result: retained,
        }).result
      ).toMatchObject(expected);
      expect(retained).not.toHaveProperty("syncPending");
      expect(retained).not.toHaveProperty("syncError");
      expect(retained).not.toHaveProperty("outputPending");
      expect(execute).toHaveBeenCalledOnce();
      expect(native).not.toHaveBeenCalled();
      await expect(
        f.tool().execute({
          ...request,
          reference: { ...started.reference, id: "another-command" },
        })
      ).rejects.toMatchObject({ code: "computer.command_reference_mismatch" });
      await expect(
        f.tool().execute({ ...request, after: started.after })
      ).resolves.toMatchObject({ ...expected, stdout: "", stderr: "" });
      await expect(
        readStoredComputerInvocation({
          context: { submissionId: "execution-a" },
          storage: f.storage,
        })
      ).resolves.toMatchObject({
        unavailable: 1,
        pendingResults: 0,
        unfinished: 0,
        commands: [
          {
            resultUnavailable: true,
            terminationConfirmed: true,
            filesSynced: false,
            outputRetained: hasOutput,
            exitCode: null,
          },
        ],
      });
      expect(f.exec).toHaveBeenCalledOnce();
      expect(f.killExec).not.toHaveBeenCalled();
    } finally {
      f.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    false,
    true,
  ])("resumes file sync after native logs expire, including a historical refusal: %s", async (historical) => {
    const f = fixture();
    // Captured production failure: the command exited before its large file
    // tree finished syncing. The native log expired; the sync window did not.
    const key =
      "openmeld:remote-agent:computer-command:execution-a:expired-log";
    const id = "retained-execution";
    await f.storage.put(key, {
      id,
      key: "expired-log",
      fingerprint: "captured-exit",
      createdAt: Date.now() - 600_000,
      backend: "container",
      collectable: true,
      observation: {
        id,
        key: "expired-log",
        status: "running",
        exitCode: 17,
        stdout: "",
        stderr: "",
        after: 2,
        syncPending: true,
        ...(historical ? { syncError: "ENOENT", nextAction: "inspect" } : {}),
      },
      output: [{ after: 1, stdout: "saved result\n", stderr: "" }],
      ...(historical
        ? { loss: "ENOENT", lossConfirmed: true, lossReported: true }
        : {}),
      collection: { unconfirmedAttempts: 0, nextAttemptAtMs: null },
    });
    f.getExec.mockRejectedValue(
      Object.assign(new Error("no exec record"), { code: "ENOENT" })
    );
    vi.mocked(f.workspace.resumeExecutionSync).mockResolvedValueOnce({
      status: "pending",
      progress: {
        operationId: "retained-sync",
        generation: "retained-sync",
        backend: "container",
        direction: "pull",
        mode: "entries",
        phase: "transferring",
        checkpoint: "retained-cursor-1",
        cursor: { rev: 1, path: null },
        targetCursor: { rev: 8, path: null },
        entries: 1,
        bytes: 8,
        skipped: 0,
        complete: false,
      },
    });
    const pending = await f
      .tool()
      .execute({ action: "poll", key: "expired-log" });
    expect(pending).toMatchObject({
      status: "running",
      syncPending: true,
      exitCode: 17,
      stdout: "saved result\n",
    });
    if (historical) {
      expect(pending).toMatchObject({
        syncError: "ENOENT",
        nextAction: "inspect",
      });
      expect(await f.storage.get(key)).toMatchObject({ lossConfirmed: true });
    }
    const result = await f
      .tool()
      .execute({ action: "poll", key: "expired-log" });
    expect(result).toMatchObject({
      phase: "completed",
      status: "completed",
      exitCode: 17,
      stdout: "saved result\n",
    });
    expect(result).not.toHaveProperty("syncError");
    expect(result).not.toHaveProperty("syncPending");
    const saved = await f.storage.get<Record<string, unknown>>(key);
    expect(saved).not.toHaveProperty("loss");
    expect(saved).not.toHaveProperty("lossConfirmed");
    expect(f.exec).not.toHaveBeenCalled();
    expect(f.getExec).not.toHaveBeenCalled();
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("pauses file-sync observations without checkpoint progress and resumes on real progress", async () => {
    const f = fixture();
    const progress = {
      operationId: "sync",
      generation: "sync",
      backend: "container",
      direction: "pull" as const,
      mode: "entries" as const,
      checkpoint: "cursor-1",
      cursor: { rev: 1, path: null },
      targetCursor: { rev: 8, path: null },
      entries: 1,
      bytes: 8,
      skipped: 0,
      complete: false,
    };
    vi.mocked(f.workspace.resumeExecutionSync).mockImplementation(() =>
      Promise.resolve({ status: "pending", progress })
    );
    await f
      .tool()
      .execute({ action: "start", key: "sync-budget", command: "echo saved" });
    f.getExec.mockImplementation(async (id) =>
      handle(
        id,
        [
          { id, seq: 1, name: "stdout", value: "saved" },
          { id, seq: 2, name: "exit", code: 17 },
        ],
        true
      )
    );
    await f.tool().execute({ action: "poll", key: "sync-budget" });
    for (let attempt = 0; attempt < 8; attempt++) {
      await collectComputerCommands({
        storage: f.storage,
        workspaceAccess: f.workspaceAccess,
      });
    }
    const key =
      "openmeld:remote-agent:computer-command:execution-a:sync-budget";
    expect(await f.storage.get(key)).toMatchObject({
      collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
    });
    const calls = vi.mocked(f.workspace.resumeExecutionSync).mock.calls.length;
    await collectComputerCommands({
      storage: f.storage,
      workspaceAccess: f.workspaceAccess,
    });
    expect(f.workspace.resumeExecutionSync).toHaveBeenCalledTimes(calls);
    await f.tool().execute({ action: "poll", key: "sync-budget" });
    expect(await f.storage.get(key)).toMatchObject({
      collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
    });
    progress.checkpoint = "cursor-2";
    progress.cursor.rev = 2;
    await f.tool().execute({ action: "poll", key: "sync-budget" });
    expect(await f.storage.get(key)).toMatchObject({
      collection: { unconfirmedAttempts: 0 },
    });
    expect(f.exec).toHaveBeenCalledOnce();
  });

  it("resumes bounded preparation after reconstruction without treating it as an uncertain dispatch", async () => {
    const f = fixture();
    const progress = {
      operationId: "plan",
      generation: "plan",
      backend: "container",
      direction: "push" as const,
      mode: "entries" as const,
      phase: "preparing" as const,
      checkpoint: "opaque-checkpoint-1",
      cursor: { rev: 0, path: "/private/preparation-cursor" },
      targetCursor: { rev: 100, path: "/private/preparation-target" },
      entries: 16,
      bytes: 128,
      skipped: 1,
      complete: false,
    };
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    f.exec.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      throw new WorkspaceSyncPendingError(progress);
    });
    f.getExec.mockRejectedValue(
      Object.assign(new Error("Native command has not been admitted"), {
        code: "ENOENT",
      })
    );
    const starting = f
      .tool()
      .execute({ action: "start", key: "prepared", command: "echo retained" });
    await entered.promise;
    try {
      await expect(
        f.tool().execute({ action: "poll", key: "prepared", waitSeconds: 0 })
      ).resolves.toMatchObject({ phase: "launch_unknown", nextAction: "poll" });
      await expect(
        f.tool().execute({
          action: "start",
          key: "prepared",
          command: "echo retained",
        })
      ).resolves.toMatchObject({ phase: "launch_unknown", nextAction: "poll" });
      expect(f.exec).toHaveBeenCalledTimes(1);
      expect(f.processes.size).toBe(0);
    } finally {
      release.resolve();
      await starting;
    }
    const start = await starting;
    expect(start).toMatchObject({
      phase: "accepted",
      nextAction: "poll",
      preparation: {
        phase: "preparing",
        generation: "plan",
        checkpoint: "opaque-checkpoint-1",
        cursorRevision: 0,
        targetRevision: 100,
        entries: 16,
        bytes: 128,
        skipped: 1,
      },
    });
    expect(JSON.stringify(start)).not.toContain("/private/preparation-");
    expect(
      JSON.stringify([...(await f.storage.list()).values()])
    ).not.toContain("/private/preparation-");
    expect(f.processes.size).toBe(0);
    expect(f.getExec).toHaveBeenCalledTimes(2);
    f.getExec.mockReset();
    const nextProgress = {
      ...progress,
      checkpoint: "opaque-checkpoint-2",
      phase: "transferring" as const,
      entries: 2,
      bytes: 8,
      skipped: 0,
    };
    f.exec.mockRejectedValueOnce(new WorkspaceSyncPendingError(nextProgress));
    expect(
      await f
        .tool()
        .execute({ action: "poll", key: "prepared", waitSeconds: 0 })
    ).toMatchObject({
      preparation: {
        checkpoint: "opaque-checkpoint-2",
        phase: "transferring",
        entries: 2,
        bytes: 8,
        skipped: 0,
      },
    });
    expect(f.processes.size).toBe(0);
    // Recreate the tool: only its persisted request authorizes the first spawn.
    const launched = await f
      .tool()
      .execute({ action: "poll", key: "prepared", waitSeconds: 0 });
    expect(launched).not.toHaveProperty("preparation");
    expect(f.processes.size).toBe(1);
    expect(f.exec.mock.calls[2]?.[1].id).toBe(f.exec.mock.calls[0]?.[1].id);
  });

  it("stops a prepared command before dispatch and cleanup never looks for a nonexistent native handle", async () => {
    const f = fixture();
    f.exec.mockRejectedValueOnce(
      new WorkspaceSyncPendingError({
        operationId: "plan",
        generation: "plan",
        backend: "container",
        direction: "push",
        mode: "entries",
        phase: "preparing",
        cursor: { rev: 0, path: null },
        targetCursor: { rev: 100, path: null },
        entries: 0,
        bytes: 0,
        skipped: 0,
        complete: false,
      })
    );
    const prepared = await f.tool().execute({
      action: "start",
      key: "stop-prepared",
      command: "echo must-not-run",
    });
    expect(prepared).toHaveProperty("preparation.phase", "preparing");
    expect(prepared).not.toHaveProperty("preparation.checkpoint");
    expect(
      await f.tool().execute({ action: "stop", key: "stop-prepared" })
    ).toMatchObject({ status: "completed", exitCode: null });
    await f
      .tool()
      .execute({ action: "poll", key: "stop-prepared", waitSeconds: 0 });
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.getExec).not.toHaveBeenCalled();
    expect(f.killExec).not.toHaveBeenCalled();
    expect(f.processes.size).toBe(0);
  });

  it("durable cleanup finishes preparation before the background collector can dispatch", async () => {
    const f = fixture();
    f.exec.mockRejectedValueOnce(
      new WorkspaceSyncPendingError({
        operationId: "plan",
        generation: "plan",
        backend: "container",
        direction: "push",
        mode: "entries",
        phase: "preparing",
        cursor: { rev: 0, path: null },
        targetCursor: { rev: 100, path: null },
        entries: 0,
        bytes: 0,
        skipped: 0,
        complete: false,
      })
    );
    await f.tool().execute({
      action: "start",
      key: "cleanup-prepared",
      command: "echo must-not-run",
    });
    expect(
      await requestStoredComputerCleanup({
        context: { submissionId: "execution-a" },
        storage: f.storage,
      })
    ).toMatchObject({ unfinished: 0 });
    await collectComputerCommands(f);
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.getExec).not.toHaveBeenCalled();
    expect(f.killExec).not.toHaveBeenCalled();
    expect(f.processes.size).toBe(0);
  });

  it.each([
    false,
    true,
  ])("retains a read-only refusal without losing output or cleanup confirmation (cleanupLoss=%s)", async (cleanupLoss) => {
    const f = fixture();
    vi.mocked(f.workspace.resumeExecutionSync).mockResolvedValue({
      status: "complete",
      outcome: {
        epoch: "retained",
        rev: 8,
        skippedTruncated: false,
        skipped: [
          {
            path: "/protected/result.txt",
            mountRoot: "/protected",
            op: "write",
            reason: "read-only",
          },
        ],
      },
    });
    f.getExec.mockImplementation(async (id) => {
      if (cleanupLoss) {
        const key =
          "openmeld:remote-agent:computer-command:execution-a:readonly";
        const command = await f.storage.get<Record<string, unknown>>(key);
        // Cleanup can confirm loss while an earlier native observation is in flight.
        await f.storage.put(key, {
          ...command,
          lossConfirmed: true,
          lostDuringCleanup: true,
        });
      }
      const execution = handle(
        id,
        [
          { id, seq: 1, name: "stdout", value: "DONE" },
          { id, seq: 2, name: "exit", code: 0 },
        ],
        true
      );
      const result = await execution.result();
      execution.result = vi.fn(async () => ({
        ...result,
        sync: {
          status: "complete" as const,
          applied: 1,
          skipped: [
            {
              path: "/protected/result.txt",
              mountRoot: "/protected",
              op: "write" as const,
              reason: "read-only" as const,
            },
          ],
          skippedTruncated: false,
        },
      }));
      return execution;
    });
    await f.tool().execute({
      action: "start",
      key: "readonly",
      command: "produce results",
    });
    const result = await f
      .tool()
      .execute({ action: "poll", key: "readonly", waitSeconds: 1 });
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "DONE",
      syncPending: true,
      nextAction: "inspect",
      syncSkipped: { paths: ["/protected/result.txt"], truncated: false },
    });
    expect(result).not.toHaveProperty("syncError");
    if (cleanupLoss) {
      expect(
        await f.storage.get(
          "openmeld:remote-agent:computer-command:execution-a:readonly"
        )
      ).toMatchObject({ lossConfirmed: true, lostDuringCleanup: true });
    }
    const observations = f.getExec.mock.calls.length;
    await expect(
      f.tool().execute({ action: "poll", key: "readonly", waitSeconds: 1 })
    ).resolves.toMatchObject({
      exitCode: 0,
      syncPending: true,
      nextAction: "inspect",
      collection: { nextAttemptAtMs: null },
    });
    expect(f.getExec).toHaveBeenCalledTimes(observations);
    await expect(
      readStoredComputerInvocation({
        context: { submissionId: "execution-a" },
        storage: f.storage,
      })
    ).resolves.toMatchObject({ unfinished: 0, unavailable: 1 });
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("does not let a rejected concurrent helper stop the accepted command", async () => {
    const f = fixture();
    const bothListed = Promise.withResolvers<void>();
    const launched = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let lists = 0;
    f.getExec.mockImplementation(async (id) =>
      handle(id, [{ id, name: "exit", seq: 1, code: 0 }], true)
    );
    f.exec.mockImplementationOnce(async (_command, options) => {
      launched.resolve();
      await release.promise;
      return handle(
        options.id,
        [{ id: options.id, name: "exit", seq: 1, code: 0 }],
        true
      );
    });
    const workspaceAccess = {
      ...f.workspaceAccess,
      computerOperation: async (
        operation: import("@openmeld/schemas").CloudComputerOperation
      ) => {
        if (operation.action !== "command") {
          throw new Error("Unexpected operation");
        }
        if (operation.command.action === "list") {
          if (++lists === 2) {
            bothListed.resolve();
          }
          await bothListed.promise;
          return [];
        }
        return await f.tool().execute(operation.command);
      },
    };
    const requests = ["first output", "second output"].map((command) =>
      executeComputerHelper({
        workspaceAccess,
        invocationId: "execution-a",
        command,
        options: {
          backend: "container",
          receiptScope: "github:/checkout:prepare",
        },
      }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error })
      )
    );
    await launched.promise;
    const rejected = await Promise.race(requests);
    expect(rejected).toHaveProperty("error");
    expect(f.killExec).not.toHaveBeenCalled();
    release.resolve();
    const results = await Promise.all(requests);
    expect(results.filter((result) => "result" in result)).toHaveLength(1);
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("keeps a stopped pre-launch command unconfirmed through two missing-record replies until the original launch settles", async () => {
    const f = fixture();
    const launched = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let id = "";
    f.exec.mockImplementationOnce(async (_command, options) => {
      id = options.id;
      launched.resolve();
      await release.promise;
      return handle(id, [{ id, name: "exit", seq: 1, code: 143 }], true);
    });
    const missing = Object.assign(new Error("pre-exec push has not spawned"), {
      code: "ENOENT",
    });
    f.getExec.mockRejectedValue(missing);
    f.killExec.mockRejectedValue(missing);
    const launch = f
      .tool()
      .execute({ action: "start", key: "late", command: "prepare checkout" });
    const rejected = expect(launch).rejects.toThrow("stopped during launch");
    await launched.promise;
    await requestStoredComputerCleanup({
      context: { submissionId: "execution-a" },
      storage: f.storage,
    });
    await collectComputerCommands(f);
    await expect(
      readStoredComputerInvocation({
        context: { submissionId: "execution-a" },
        storage: f.storage,
      })
    ).resolves.toMatchObject({
      unfinished: 1,
      commands: [
        {
          phase: "launch_unknown",
          stopRequested: true,
          terminationConfirmed: false,
          collection: { nextAttemptAtMs: expect.any(Number) },
        },
      ],
    });
    f.killExec.mockResolvedValue();
    release.resolve();
    await rejected;
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.killExec).toHaveBeenLastCalledWith(id, {
      backend: "container",
      signal: "SIGTERM",
    });
  });

  it.each([
    "launch_reply_lost",
    "cancel_ack_without_exit",
  ])("retains internal Git helper execution and refuses replay after %s", async (fault) => {
    const f = fixture();
    const controller = new AbortController();
    f.exec.mockImplementationOnce((_command, options) => {
      f.processes.add(options.id);
      if (fault === "launch_reply_lost") {
        return Promise.reject(new Error("launch reply lost"));
      }
      controller.abort(new Error("helper cancelled"));
      return Promise.resolve(handle(options.id));
    });
    const workspaceAccess = {
      ...f.workspaceAccess,
      computerOperation: async (
        operation: import("@openmeld/schemas").CloudComputerOperation
      ) => {
        if (operation.action !== "command") {
          throw new Error("Unexpected file operation");
        }
        return await f.tool().execute(operation.command);
      },
    };
    const execute = (command: string, signal?: AbortSignal) =>
      executeComputerHelper({
        workspaceAccess,
        invocationId: "execution-a",
        command,
        options: {
          backend: "container",
          receiptScope: "github:/checkout:prepare",
          signal,
        },
      });
    await expect(
      execute("prepare checkout", controller.signal)
    ).rejects.toThrow("helper_result_unconfirmed");
    await expect(
      readStoredComputerInvocation({
        context: { submissionId: "execution-a" },
        storage: f.storage,
      })
    ).resolves.toMatchObject({
      total: 1,
      unfinished: 1,
      commands: [
        {
          stopRequested: fault !== "launch_reply_lost",
          terminationConfirmed: false,
        },
      ],
    });
    await expect(
      execute("prepare checkout with a new output path")
    ).rejects.toThrow("helper_result_unconfirmed");
    expect(f.exec).toHaveBeenCalledOnce();
    f.getExec.mockImplementation(async (id) =>
      handle(id, [{ id, name: "exit", seq: 1, code: 143 }], true)
    );
    await collectComputerCommands(f);
    f.exec.mockImplementation(async (_command, options) =>
      handle(
        options.id,
        [{ id: options.id, name: "exit", seq: 1, code: 0 }],
        true
      )
    );
    await expect(
      execute("prepare checkout after confirmed exit")
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(f.exec).toHaveBeenCalledTimes(2);
  });
  it("keeps a real Flue conversation usable after launch acknowledgement loss, with original cleanup and a durable explanation", async () => {
    const f = fixture();
    const storage = new InMemoryDurableObjectStorage();
    const savedFile = {
      fileId: "saved-report",
      name: "report.md",
      mimeType: "text/markdown",
      revision: 1,
      sizeBytes: 10,
    };
    const original = {
      ...context("execution-a"),
      computerIsolationVersion: 3 as const,
      outputFiles: [savedFile],
    };
    await putRemoteAgentCallbackContext(storage, original);
    await initializeRemoteAgentExecutionState({
      identity: buildRemoteAgentExecutionIdentity(original),
      storage,
      acceptedAtMs: TEST_NOW_MS,
    });
    await bindComputerCommandTarget({
      storage,
      submissionId: original.submissionId,
      computerName: "personal-computer:owner",
    });
    // The external process starts but its launch response is lost. Its native
    // identity must survive even if a subsequent lookup has no retained result.
    f.exec.mockRejectedValueOnce(new Error("dispatch acknowledgement lost"));
    await expect(
      f
        .tool()
        .execute({ action: "start", key: "publish", command: "publish-once" })
    ).rejects.toThrow("acknowledgement lost");
    f.getExec.mockRejectedValue(
      Object.assign(new Error("result unavailable"), { code: "ENOENT" })
    );
    await expect(
      f.tool().execute({ action: "poll", key: "publish", waitSeconds: 0 })
    ).resolves.toMatchObject({ phase: "launch_unknown", nextAction: "poll" });
    const computer = {
      registerComputerInvocation: (owner: unknown) =>
        registerComputerInvocation(f.storage, owner),
      readComputerRecovery: (query: unknown) =>
        readComputerRecovery(f.storage, query),
      readComputerInvocation: (invocationId: string) =>
        readStoredComputerInvocation({
          context: { submissionId: invocationId },
          storage: f.storage,
        }),
      requestComputerCleanup: (invocationId: string, resume?: boolean) =>
        requestStoredComputerCleanup({
          context: { submissionId: invocationId },
          storage: f.storage,
          resume,
        }),
    };
    const env = {
      AGENT_COMPUTER: {
        idFromName: (name: string) => name,
        get: () => computer,
      },
    };
    const directory = await mkdtemp(
      join(tmpdir(), "computer-failure-continuity-")
    );
    const provider = fauxProvider({
      provider: "computer-failure-continuity",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    let current = original;
    function CenterRecovery() {
      useModel(`${model.provider}/${model.id}`);
      useRemoteAgentExecutionFinish((finish, finishState, setFinishState) =>
        checkRemoteAgentExecutionFinish({
          context: current,
          env,
          storage,
          finish,
          finishState,
          setFinishState,
        })
      );
      return "Report confirmed results and unknown side effects. Do not replay writes.";
    }
    CenterRecovery.joinQueuedDeliveries = false;
    const explanation =
      "The saved report is retained. Publication is unconfirmed; I have not repeated it or requested Stop. The original command remains available for inspection.";
    provider.setResponses([
      fauxAssistantMessage("All publication work succeeded."),
      (ctx) => {
        expect(JSON.stringify(ctx.messages)).toContain(
          "owned_commands_pending"
        );
        return fauxAssistantMessage(
          "Publication is still unconfirmed. I cannot safely repeat it."
        );
      },
      (ctx) => {
        expect(JSON.stringify(ctx.messages)).toContain(
          "computer_result_incomplete"
        );
        expect(JSON.stringify(ctx.messages)).toContain("launch_unknown");
        return fauxAssistantMessage(explanation);
      },
      fauxAssistantMessage("I can answer this independent follow-up."),
    ]);
    let finalText = "";
    const unsubscribe = observe((event) => {
      if (event.type === "operation" && event.operationKind === "prompt") {
        const text = extractAssistantText(event);
        if (text) {
          finalText = text;
        }
      }
    });
    const runtime = await start({
      agents: [CenterRecovery],
      providers: [provider.provider],
      db: sqlite(join(directory, "history.sqlite")),
    });
    try {
      const agent = init(CenterRecovery, { id: "same-conversation" });
      const reply = await agent.read(
        await agent.dispatch("Finish this request.")
      );
      // History intentionally includes earlier model steps. Publication uses
      // the terminal operation output, never concatenated history or previews.
      expect(reply.text).toContain(explanation);
      expect(finalText).toBe(explanation);
      const send = vi
        .fn()
        .mockRejectedValueOnce(new Error("callback transport lost"))
        .mockResolvedValue({ status: "accepted" });
      const reconcile = () =>
        reconcileRemoteAgentExecution({
          env,
          storage,
          identity: buildRemoteAgentExecutionIdentity(original),
          coreWorker: { completeRemoteAgentSubmission: send },
          readSubmission: async () => ({
            status: "settled" as const,
            completedOutput: {
              submissionId: original.submissionId,
              text: finalText,
            },
          }),
        });
      await reconcile();
      await reconcile();
      expect(send.mock.calls.at(-1)?.[0]).toMatchObject({
        status: "failed",
        failureCode: "remote_agent.computer.command_cleanup_failed",
        explanationText: explanation,
        files: [savedFile],
        computerCleanup: { stopAccepted: false, state: { unfinished: 1 } },
      });
      await expect(
        readRemoteAgentExecutionState({
          identity: buildRemoteAgentExecutionIdentity(original),
          storage,
        })
      ).resolves.toMatchObject({
        result: {
          status: "failed",
          text: explanation,
          files: [savedFile],
          failureCode: "remote_agent.computer.command_cleanup_failed",
        },
      });
      current = {
        ...original,
        submissionId: "execution-b",
        idempotencyKey: "remote-agent:second",
        outputFiles: [],
      };
      await putRemoteAgentCallbackContext(storage, current);
      await bindComputerCommandTarget({
        storage,
        submissionId: current.submissionId,
        computerName: "personal-computer:owner",
      });
      await expect(
        assertComputerMutationCanContinue({ context: original, storage, env })
      ).resolves.toBeUndefined();
      await expect(
        assertComputerMutationCanContinue({ context: current, storage, env })
      ).resolves.toBeUndefined();
      const second = await agent.read(
        await agent.dispatch("Answer an independent question.")
      );
      expect(second.text).toBe("I can answer this independent follow-up.");
      const recovery = createComputerRecoveryTool({
        context: current,
        storage,
        env,
        authorize: async () => undefined,
      });
      await expect(
        recovery.execute({
          action: "inspect",
          invocationId: original.submissionId,
        })
      ).resolves.toMatchObject({
        state: {
          unfinished: 1,
          commands: [{ stopRequested: false, terminationConfirmed: false }],
        },
        savedFiles: [savedFile],
      });
      await expect(
        recovery.execute({ action: "inspect", invocationId: "another-agent" })
      ).rejects.toThrow("identity_mismatch");
      const nextGeneration = new InMemoryDurableObjectStorage();
      await bindComputerCommandTarget({
        storage: nextGeneration,
        submissionId: current.submissionId,
        computerName: "personal-computer:owner",
      });
      const recoveryAfterRollover = createComputerRecoveryTool({
        context: current,
        storage: nextGeneration,
        env,
        authorize: async () => undefined,
      });
      await expect(
        recoveryAfterRollover.execute({ action: "list" })
      ).resolves.toMatchObject({
        invocations: expect.arrayContaining([
          {
            invocationId: original.submissionId,
            unfinished: 1,
            pendingResults: 1,
            unavailable: 0,
            total: 1,
            commands: expect.any(Array),
          },
        ]),
      });
      await expect(
        recoveryAfterRollover.execute({
          action: "inspect",
          invocationId: original.submissionId,
        })
      ).resolves.toMatchObject({ state: { unfinished: 1 } });
      f.getExec.mockImplementation(async (id) =>
        handle(id, [{ id, name: "exit", seq: 1, code: 143 }], true)
      );
      await collectComputerCommands(f);
      await expect(
        assertComputerMutationCanContinue({ context: current, storage, env })
      ).resolves.toBeUndefined();
      expect(f.exec).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
      await runtime.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("pages original Computer receipts without disclosing another Space or Agent after conversation rollover", async () => {
    const f = fixture();
    const owner = {
      organizationId: "organization",
      spaceId: "space",
      agentProfileId: "agent",
    };
    for (let index = 0; index < 35; index++) {
      await registerComputerInvocation(f.storage, {
        ...owner,
        invocationId: `original-${String(index).padStart(2, "0")}`,
      });
    }
    await registerComputerInvocation(f.storage, {
      ...owner,
      spaceId: "private-space",
      invocationId: "private",
    });
    const first = await readComputerRecovery(f.storage, owner);
    expect(first.invocations).toHaveLength(32);
    const second = await readComputerRecovery(f.storage, {
      ...owner,
      cursor: first.nextCursor,
    });
    expect(second.invocations.map((item) => item.invocationId)).toEqual([
      "original-32",
      "original-33",
      "original-34",
    ]);
    expect(second.nextCursor).toBeNull();
    await expect(
      readComputerRecovery(f.storage, { ...owner, invocationId: "private" })
    ).rejects.toThrow("identity_mismatch");
    await expect(
      readComputerRecovery(f.storage, {
        ...owner,
        agentProfileId: "another-agent",
        invocationId: "original-00",
      })
    ).rejects.toThrow("identity_mismatch");
    await expect(
      registerComputerInvocation(f.storage, {
        ...owner,
        spaceId: "another-space",
        invocationId: "original-00",
      })
    ).rejects.toThrow("identity_mismatch");
  });

  it.each([
    {
      code: "ECONNRESET",
      phase: "launch",
      expectedCode: "ECONNRESET",
      expectedPhase: "launch",
    },
    {
      code: "private transport details",
      phase: "private transport details",
      expectedCode: undefined,
      expectedPhase: "start",
    },
    {
      code: "computer.observation_timeout",
      phase: "workspace-acquisition",
      expectedCode: "computer.observation_timeout",
      expectedPhase: "workspace-acquisition",
    },
  ])("keeps Computer failure diagnostics bounded ($code)", async ({
    code,
    phase,
    expectedCode,
    expectedPhase,
  }) => {
    const privateText = "Private Project Cedar command output";
    const f = fixture();
    const error = Object.assign(new Error(privateText), {
      name: privateText,
      code,
      phase,
    });
    f.exec.mockRejectedValueOnce(error);
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await expect(
        f
          .tool()
          .execute({ action: "start", key: "privacy", command: "run task" })
      ).rejects.toBe(error);
      const fields = warning.mock.calls.find(
        ([event]) => event === "[remote_agent.computer_command_failed]"
      )?.[1];
      expect(fields).toMatchObject({
        submissionId: "execution-a",
        action: "start",
        phase: expectedPhase,
        errorName: "Error",
      });
      expect(fields).toHaveProperty("commandId");
      expect(fields).not.toHaveProperty("error");
      expect(JSON.stringify(fields)).not.toContain(privateText);
      expect(JSON.stringify(fields)).not.toContain("private transport details");
      if (expectedCode) {
        expect(fields).toMatchObject({ errorCode: expectedCode });
      } else {
        expect(fields).not.toHaveProperty("errorCode");
      }
    } finally {
      warning.mockRestore();
    }
  });

  it.each([
    { action: "start", recovery: "poll", inspection: "ready" },
    { action: "stop", recovery: "poll", inspection: "ready" },
    { action: "stop", recovery: "collector", inspection: "ready" },
    { action: "stop", recovery: "poll", inspection: "error" },
    { action: "stop", recovery: "collector", inspection: "timeout" },
  ] as const)("recovers timed out Workspace acquisition (action=$action, recovery=$recovery, inspection=$inspection)", async ({
    action,
    recovery,
    inspection,
  }) => {
    const f = fixture();
    const startRequest = {
      action: "start",
      key: "late",
      command: "touch result",
    };
    if (action === "stop") {
      await f.tool().execute(startRequest);
    }
    const entered = Promise.withResolvers<void>();
    const acquired = Promise.withResolvers<void>();
    const disposed = Promise.withResolvers<void>();
    const inspected =
      Promise.withResolvers<WorkspaceRuntimeExecHandle<"utf8">>();
    const tool = createComputerCommandTool({
      context: context("execution-a"),
      storage: f.storage,
      workingDirectory: "/computer",
      workspaceAccess: {
        async withWorkspace(operation) {
          entered.resolve();
          await acquired.promise;
          try {
            return await f.workspaceAccess.withWorkspace(operation);
          } finally {
            disposed.resolve();
          }
        },
      },
    });
    vi.useFakeTimers();
    try {
      const launch = tool.execute(
        action === "start"
          ? startRequest
          : { action: "stop", key: "late", signal: "SIGKILL" }
      );
      const rejected =
        action === "start"
          ? expect(launch).resolves.toMatchObject({
              phase: "accepted",
              reference: { key: "late", invocationId: "execution-a" },
              observation: {
                status: "timed_out",
                phase: "workspace-acquisition",
              },
              nextAction: "poll",
            })
          : expect(launch).rejects.toMatchObject({
              code: "computer.observation_timeout",
              phase: "workspace-acquisition",
            });
      await entered.promise;
      await vi.advanceTimersByTimeAsync(action === "start" ? 60_000 : 5000);
      await rejected;
      acquired.resolve();
      await disposed.promise;
      expect(f.exec).toHaveBeenCalledTimes(action === "start" ? 0 : 1);
      expect(f.killExec).not.toHaveBeenCalled();
      if (action === "stop") {
        await expect(f.tool().execute(startRequest)).rejects.toThrow(
          "already stopped"
        );
        let stopped = false;
        f.killExec.mockImplementation(() => {
          stopped = true;
          return Promise.resolve();
        });
        f.getExec.mockImplementation((id) =>
          Promise.resolve(
            handle(
              id,
              stopped ? [{ id, seq: 1, name: "exit", code: 137 }] : [],
              stopped
            )
          )
        );
        if (inspection === "error") {
          f.getExec.mockRejectedValueOnce(
            new TypeError("Output transport failed")
          );
        } else if (inspection === "timeout") {
          f.getExec.mockImplementationOnce(() => inspected.promise);
        }
        const recovering =
          recovery === "collector"
            ? collectComputerCommands({
                storage: f.storage,
                workspaceAccess: f.workspaceAccess,
              })
            : f.tool().execute({ action: "poll", key: "late", waitSeconds: 1 });
        const recovered = recovering.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(1100);
        const receipt = await recovered;
        if (inspection === "error") {
          expect(receipt).toBeInstanceOf(TypeError);
        }
        expect(f.killExec).toHaveBeenCalledOnce();
        expect(f.killExec).toHaveBeenCalledWith(expect.any(String), {
          backend: "container",
          signal: "SIGKILL",
        });
        await expect(
          f.tool().execute({ action: "poll", key: "late", waitSeconds: 0 })
        ).resolves.toMatchObject({ status: "completed", exitCode: 137 });
        expect(f.killExec).toHaveBeenCalledOnce();
      }
      expect(
        await tool.execute({ action: "list", includeReceiptDetails: true })
      ).toMatchObject([
        { key: "late", ...(action === "start" ? { phase: "accepted" } : {}) },
      ]);
    } finally {
      acquired.resolve();
      inspected.resolve(handle("late-inspection"));
      await vi.advanceTimersByTimeAsync(100);
      vi.useRealTimers();
    }
  });

  it("bounds a stuck cancellation without killing the retained process", async () => {
    vi.useFakeTimers();
    try {
      const cancellation = Promise.withResolvers<void>();
      const cancel = vi.fn(() => cancellation.promise);
      const stream = new ReadableStream<WorkspaceRuntimeEvent<"utf8">>({
        cancel,
      });
      const run = Object.assign(stream, {
        id: "stuck-cancel",
        backend: "container",
        result: vi.fn(),
        kill: vi.fn(),
        [Symbol.dispose]: vi.fn(),
      }) as WorkspaceRuntimeExecHandle<"utf8">;
      const reading = readCommandSlice(run, "work", 0, 10);
      await vi.advanceTimersByTimeAsync(110);
      await expect(reading).resolves.toMatchObject({
        status: "running",
        exitCode: null,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(run.locked).toBe(false);
      expect(run[Symbol.dispose]).toHaveBeenCalledOnce();
      expect(run.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("collects other receipts while one native connection never returns", async () => {
    const f = fixture();
    const stuck = (await f
      .tool()
      .execute({ action: "start", key: "stuck", command: "sleep 30" })) as {
      id: string;
    };
    await f
      .tool("execution-b")
      .execute({ action: "start", key: "saved", command: "printf saved" });
    vi.useFakeTimers();
    try {
      const connection =
        Promise.withResolvers<WorkspaceRuntimeExecHandle<"utf8">>();
      f.getExec.mockImplementation((id) =>
        id === stuck.id
          ? connection.promise
          : Promise.resolve(
              handle(
                id,
                [
                  { id, seq: 1, name: "stdout", value: "saved" },
                  { id, seq: 2, name: "exit", code: 0 },
                ],
                true
              )
            )
      );
      const collecting = collectComputerCommands({
        storage: f.storage,
        workspaceAccess: f.workspaceAccess,
      });
      await vi.advanceTimersByTimeAsync(6100);
      await expect(collecting).resolves.toBe(true);
      f.getExec.mockRejectedValue(new Error("native records expired"));
      await expect(
        f.tool("execution-b").execute({ action: "poll", key: "saved" })
      ).resolves.toMatchObject({
        status: "completed",
        stdout: "saved",
        exitCode: 0,
      });
      expect(f.exec).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collects a dispatch whose acknowledgement was lost without failing an unstarted dispatch", async () => {
    const f = fixture();
    let nativeId = "";
    f.exec.mockImplementationOnce((_source, options) => {
      nativeId = options.id;
      return Promise.reject(new Error("dispatch acknowledgement lost"));
    });
    const launch = f.tool().execute({
      action: "start",
      key: "uncertain",
      command: "printf recovered",
    });
    await expect(launch).rejects.toThrow("dispatch acknowledgement lost");
    await expect(
      f.tool().execute({ action: "list", includeReceiptDetails: true })
    ).resolves.toMatchObject([{ key: "uncertain", phase: "launch_unknown" }]);
    f.getExec.mockRejectedValue(
      Object.assign(new Error("not dispatched yet"), { code: "ENOENT" })
    );
    await collectComputerCommands({
      storage: f.storage,
      workspaceAccess: f.workspaceAccess,
    });
    f.getExec.mockImplementation((id) =>
      Promise.resolve(
        handle(
          id,
          [
            { id, seq: 1, name: "stdout", value: "recovered" },
            { id, seq: 2, name: "exit", code: 0 },
          ],
          true
        )
      )
    );
    await collectComputerCommands({
      storage: f.storage,
      workspaceAccess: f.workspaceAccess,
    });
    await expect(
      f.tool().execute({ action: "poll", key: "uncertain" })
    ).resolves.toMatchObject({
      id: nativeId,
      status: "completed",
      exitCode: 0,
      stdout: "recovered",
    });
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("collects a result without model polls and serves it after native retention expires", async () => {
    const f = fixture();
    const started = (await f.tool().execute({
      action: "start",
      key: "retention",
      command: "printf done",
    })) as { id: string };
    f.getExec.mockImplementation((id) =>
      Promise.resolve(
        handle(
          id,
          [
            { id, seq: 1, name: "stdout", value: "done" },
            { id, seq: 2, name: "exit", code: 0 },
          ],
          true
        )
      )
    );
    await expect(
      collectComputerCommands({
        storage: f.storage,
        workspaceAccess: f.workspaceAccess,
      })
    ).resolves.toBe(false);
    f.getExec.mockRejectedValue(
      Object.assign(new Error("record expired"), { code: "ENOENT" })
    );
    const recovered = f.tool();
    await expect(
      recovered.execute({ action: "poll", key: "retention", after: 0 })
    ).resolves.toMatchObject({
      id: started.id,
      status: "completed",
      stdout: "done",
      exitCode: 0,
    });
    await expect(
      recovered.execute({ action: "poll", key: "retention", after: 2 })
    ).resolves.toMatchObject({ status: "completed", stdout: "" });
    await expect(
      stopStoredComputerCommands({
        context: context("execution-a"),
        storage: f.storage,
        access: () => f.workspaceAccess,
      })
    ).resolves.toEqual({ unfinished: 0, lostDuringCleanup: false });
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("preserves the inspect action when the first exit cannot synchronize", async () => {
    const f = fixture();
    vi.mocked(f.workspace.resumeExecutionSync).mockRejectedValue(
      Object.assign(new Error("file source missing"), { code: "ENOENT" })
    );
    f.exec.mockImplementationOnce((_source, options) =>
      Promise.resolve(
        handle(
          options.id,
          [
            { id: options.id, seq: 1, name: "stdout", value: "saved" },
            { id: options.id, seq: 2, name: "exit", code: 0 },
          ],
          true
        )
      )
    );
    f.getExec.mockRejectedValue(
      Object.assign(new Error("record expired"), { code: "ENOENT" })
    );
    const request = { action: "start", key: "sync", command: "printf saved" };
    await expect(f.tool().execute(request)).resolves.toMatchObject({
      status: "running",
      exitCode: 0,
      stdout: "saved",
      syncPending: true,
      syncError: "ENOENT",
      nextAction: "inspect",
    });
    await expect(f.tool().execute(request)).resolves.toMatchObject({
      nextAction: "inspect",
    });
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("preserves authoritative completion racing cleanup loss (settledFirst=%s)", async (settledFirst) => {
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
      .execute({ action: "start", key: "sync", command: "printf saved" });
    const run = (id: string) =>
      handle(
        id,
        [
          { id, seq: 1, name: "stdout", value: "saved" },
          { id, seq: 2, name: "exit", code: 0 },
        ],
        true
      );
    f.getExec.mockImplementation((id) => {
      const receipt = run(id);
      receipt.result = async () => ({
        status: "completed",
        exitCode: 0,
        stdout: "",
        stderr: "",
        pushed: 0,
        pulled: 0,
        skipped: [],
        sync: {
          status: "pending",
          applied: 0,
          skipped: [],
          error: "pull failed",
        },
      });
      return Promise.resolve(receipt);
    });
    vi.mocked(f.workspace.resumeExecutionSync).mockResolvedValueOnce({
      status: "pending",
      progress: {
        operationId: "sync",
        generation: "sync",
        backend: "container",
        direction: "pull",
        mode: "entries",
        checkpoint: "cursor-1",
        cursor: { rev: 1, path: null },
        targetCursor: { rev: 8, path: null },
        entries: 1,
        bytes: 8,
        skipped: 0,
        complete: false,
      },
    });
    await f.tool().execute({ action: "poll", key: "sync" });
    const entered = Promise.withResolvers<void>();
    const synchronized =
      Promise.withResolvers<
        Awaited<ReturnType<WorkspaceClient["resumeExecutionSync"]>>
      >();
    vi.mocked(f.workspace.resumeExecutionSync).mockImplementationOnce(() => {
      entered.resolve();
      return synchronized.promise;
    });
    const confirming = f
      .tool()
      .execute({ action: "poll", key: "sync", waitSeconds: 20 });
    await entered.promise;
    vi.mocked(f.workspace.resumeExecutionSync).mockRejectedValue(
      Object.assign(new Error("file source missing"), { code: "ENOENT" })
    );
    await collectComputerCommands({
      storage: f.storage,
      workspaceAccess: f.workspaceAccess,
    });
    await expect(
      stopStoredComputerCommands({
        context: executionContext,
        storage: f.storage,
        access: () => f.workspaceAccess,
        reportConfirmedLoss: true,
      })
    ).resolves.toEqual({ unfinished: 0, lostDuringCleanup: true });
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
          completedOutput: { submissionId: "execution-a", text: "Saved" },
        }),
        storage: f.storage,
      });
    if (settledFirst) {
      await reconcile();
    }
    synchronized.resolve({
      status: "complete",
      outcome: {
        epoch: "retained",
        rev: 8,
        skipped: [],
        skippedTruncated: false,
      },
    });
    await expect(confirming).resolves.toMatchObject({
      status: "completed",
      exitCode: 0,
    });
    await expect(
      stopStoredComputerCommands({
        context: executionContext,
        storage: f.storage,
        access: () => f.workspaceAccess,
        reportConfirmedLoss: true,
      })
    ).resolves.toEqual({ unfinished: 0, lostDuringCleanup: false });
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: settledFirst ? "failed" : "completed" },
    });
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it.each([
    "complete",
    "proof",
    "proof-lost",
    "ENOENT",
    "EEXEC_LOST",
  ] as const)("preserves exit and output after pending sync resolves as %s", async (outcome) => {
    const f = fixture();
    await f
      .tool()
      .execute({ action: "start", key: "sync", command: "printf saved" });
    let synced = false;
    vi.mocked(f.workspace.resumeExecutionSync).mockImplementation(async () => {
      await Promise.resolve();
      if (!synced) {
        return {
          status: "pending",
          progress: {
            operationId: "sync",
            generation: "sync",
            backend: "container",
            direction: "pull",
            mode: "entries",
            checkpoint: "cursor-1",
            cursor: { rev: 1, path: null },
            targetCursor: { rev: 8, path: null },
            entries: 1,
            bytes: 8,
            skipped: 0,
            complete: false,
          },
        };
      }
      return {
        status: "complete",
        outcome: {
          epoch: "retained",
          rev: 8,
          skipped: [],
          skippedTruncated: false,
        },
      };
    });
    f.getExec.mockImplementation((id) => {
      const run = handle(
        id,
        [
          { id, seq: 1, name: "stdout", value: "saved" },
          { id, seq: 2, name: "exit", code: 0 },
        ],
        true
      );
      run.result = () =>
        Promise.resolve({
          status: "completed",
          exitCode: 0,
          stdout: "",
          stderr: "",
          pushed: 0,
          pulled: 0,
          skipped: [],
          sync: synced
            ? { status: "complete", applied: 0, skipped: [] }
            : {
                status: "pending",
                applied: 0,
                skipped: [],
                error: "pull failed",
              },
        });
      return Promise.resolve(run);
    });
    await expect(
      f.tool().execute({ action: "poll", key: "sync" })
    ).resolves.toMatchObject({
      status: "running",
      syncPending: true,
      exitCode: 0,
      stdout: "saved",
      after: 2,
    });
    if (outcome === "proof") {
      vi.mocked(f.workspace.executionSync).mockResolvedValue({
        epoch: "retained",
        rev: 8,
        skipped: [],
        skippedTruncated: false,
      });
      f.getExec.mockRejectedValue(
        Object.assign(new Error("expired"), { code: "ENOENT" })
      );
      const calls = f.getExec.mock.calls.length;
      await expect(
        f.tool().execute({ action: "poll", key: "sync", after: 2 })
      ).resolves.toMatchObject({
        status: "completed",
        exitCode: 0,
        stdout: "",
      });
      expect(f.getExec).toHaveBeenCalledTimes(calls);
      expect(f.exec).toHaveBeenCalledOnce();
      return;
    }
    if (outcome !== "complete") {
      const lossCode = outcome === "proof-lost" ? "EEXEC_LOST" : outcome;
      if (outcome === "proof-lost") {
        vi.mocked(f.workspace.executionSync).mockResolvedValue({
          epoch: "retired",
          rev: 8,
          skipped: [],
          skippedTruncated: false,
          error: "EEXEC_LOST",
        });
      }
      f.getExec.mockRejectedValue(
        Object.assign(new Error("native receipt unavailable"), {
          code: lossCode,
        })
      );
      vi.mocked(f.workspace.resumeExecutionSync).mockRejectedValue(
        Object.assign(new Error("file source unavailable"), { code: lossCode })
      );
      await collectComputerCommands({
        storage: f.storage,
        workspaceAccess: f.workspaceAccess,
      });
      const observer = f.tool();
      await expect(
        observer.execute({ action: "poll", key: "sync" })
      ).resolves.toMatchObject({
        status: "running",
        exitCode: 0,
        stdout: "saved",
        syncError: lossCode,
        nextAction: "inspect",
      });
      const calls = f.getExec.mock.calls.length;
      await expect(
        f.tool().execute({ action: "poll", key: "sync", after: 2 })
      ).resolves.toMatchObject({
        status: "running",
        exitCode: 0,
        stdout: "",
        syncError: lossCode,
      });
      expect(f.getExec).toHaveBeenCalledTimes(calls);
      await expect(
        stopStoredComputerCommands({
          context: context("execution-a"),
          storage: f.storage,
          access: () => f.workspaceAccess,
        })
      ).resolves.toEqual({ unfinished: 0, lostDuringCleanup: false });
      expect(f.killExec).not.toHaveBeenCalled();
      expect(f.exec).toHaveBeenCalledOnce();
      return;
    }
    synced = true;
    await expect(
      f.tool().execute({ action: "poll", key: "sync", after: 2 })
    ).resolves.toMatchObject({ status: "completed", exitCode: 0, stdout: "" });
    expect(f.exec).toHaveBeenCalledOnce();
  });

  it.each([
    "container",
    "worker-shell",
  ] as const)("passes raw source and only supplies the container legacy alternative: %s", async (backend) => {
    const f = fixture();
    const command = "printf 'quoted output'; exit 17";
    await f
      .tool()
      .execute({ action: "start", key: "supervision", command, backend });
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.exec.mock.calls[0]?.[0]).toBe(command);
    const options = f.exec.mock.calls[0]?.[1];
    if (backend === "container") {
      expect(options).toHaveProperty(
        "legacySource",
        expect.stringContaining("exec /usr/bin/tini -s -g --")
      );
    } else {
      expect(options).not.toHaveProperty("legacySource");
    }
  });

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

  it.each([
    false,
    true,
  ])("recovers a command after real Flue compaction without relaunching (personal=%s)", async (personal) => {
    const f = fixture();
    const directory = await mkdtemp(join(tmpdir(), "computer-compaction-"));
    const provider = fauxProvider({
      provider: `computer-compaction-${personal}`,
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const summarizer = fauxProvider({
      provider: `computer-compaction-summary-${personal}`,
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    const summaryModel = summarizer.getModel();
    let step = 0;
    let compactions = 0;
    summarizer.setResponses(
      Array.from({ length: 14 }, () => () => {
        compactions++;
        // Omit IDs: recovery must not depend on summary quality or prompt wording.
        return fauxAssistantMessage(
          "A Computer command was started. Recover its receipt and collect its result."
        );
      })
    );
    let recoveredKey = "";
    let recoveredId = "";
    const command = f.tool("same-execution", personal);
    const native = defineTool({
      name: command.name,
      description: command.description,
      input: command.input as GenericSchema<Record<string, unknown>>,
      run: async ({ data }) => ({
        output: toFlueJsonValue(await command.execute(data)),
      }),
    });
    const evidence = defineTool({
      name: "evidence",
      description: "Read fixture evidence.",
      input: object({}),
      run: () => ({ output: "Unchanged evidence. ".repeat(700) }),
    });
    function CommandRecovery() {
      useModel(`${model.provider}/${model.id}`, {
        compaction: {
          model: `${summaryModel.provider}/${summaryModel.id}`,
          workingContextTokens: 6000,
          workingContextHeadroomTokens: 1500,
          keepRecentTokens: 512,
          maxSummaryTokens: 512,
          reserveTokens: 8192,
        },
      });
      useTool(native);
      useTool(evidence);
      return "Complete the command and recover its original key with list after context compaction.";
    }
    const runtime = await start({
      agents: [CommandRecovery],
      providers: [provider.provider, summarizer.provider],
      db: sqlite(join(directory, "history.sqlite")),
    });
    try {
      provider.setResponses(
        Array.from({ length: 14 }, () => (ctx) => {
          const call = (
            name: string,
            args: Parameters<typeof fauxToolCall>[1]
          ) =>
            fauxAssistantMessage(fauxToolCall(name, args), {
              stopReason: "toolUse",
            });
          switch (step++) {
            case 0:
              return call("computer_command", {
                action: "start",
                key: "original-job",
                command: "sleep 300",
              });
            case 1:
            case 2:
              return call("evidence", {});
            case 3:
              expect(compactions).toBeGreaterThan(0);
              return call("computer_command", { action: "list" });
            case 4: {
              const last = ctx.messages.findLast(
                (message) => message.role === "toolResult"
              );
              const text = last?.content.find((block) => block.type === "text");
              if (text?.type !== "text") {
                throw new Error("Missing command list");
              }
              const [receipt] = JSON.parse(text.text);
              recoveredKey = receipt.key;
              recoveredId = receipt.id;
              return call("computer_command", {
                action: "poll",
                key: recoveredKey,
                waitSeconds: 0,
              });
            }
            case 5:
              return call("computer_command", {
                action: "stop",
                key: recoveredKey,
              });
            case 6:
              f.getExec.mockImplementation((id) =>
                Promise.resolve(
                  handle(
                    id,
                    [
                      { id, seq: 1, name: "stdout", value: "FINAL RESULT" },
                      { id, seq: 2, name: "exit", code: 0 },
                    ],
                    true
                  )
                )
              );
              return call("computer_command", {
                action: "poll",
                key: recoveredKey,
                waitSeconds: 0,
              });
            default:
              expect(JSON.stringify(ctx.messages.at(-1))).toContain(
                "FINAL RESULT"
              );
              return fauxAssistantMessage(
                "The original command is stopped and its result was collected."
              );
          }
        })
      );
      const agent = init(CommandRecovery, { id: "same-conversation" });
      const result = await agent.read(
        await agent.dispatch(
          "Start one command, gather evidence, then cancel the command and collect its result."
        )
      );
      expect(result.text).toContain("result was collected");
      expect(f.exec).toHaveBeenCalledTimes(1);
      expect(recoveredKey).toBe("original-job");
      expect(f.killExec).toHaveBeenCalledWith(
        recoveredId,
        expect.objectContaining({ signal: "SIGTERM" })
      );
      expect(f.getExec).toHaveBeenCalledWith(recoveredId, expect.anything());
      await expect(
        f.tool("another-execution", personal).execute({ action: "list" })
      ).resolves.toEqual([]);
    } finally {
      await runtime.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
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
  ])("publishes a fenced outcome while retaining unresolved cleanup ($personal, Stop=$cancel)", async ({
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
    const completeRemoteAgentSubmission = vi.fn((_body: unknown) =>
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
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: cancel ? "aborted" : "failed" },
    });
    expect(f.killExec).toHaveBeenCalled();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission.mock.calls[0]?.[0]).toMatchObject({
      computerCleanup: {
        stopAccepted: true,
        state: {
          unfinished: 1,
          commands: [{ stopRequested: true, terminationConfirmed: false }],
        },
      },
    });
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
    expect(idFromName).toHaveBeenCalled();
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
  it.each([
    { code: "EEXEC_LOST", pendingStop: false, stopAcknowledged: false },
    { code: "ENOENT", pendingStop: false, stopAcknowledged: false },
    { code: "EEXEC_LOST", pendingStop: true, stopAcknowledged: false },
    { code: "ENOENT", pendingStop: true, stopAcknowledged: false },
    { code: "ENOENT", pendingStop: true, stopAcknowledged: true },
  ])("keeps reported $code commands from failing recovered work during cleanup (pending Stop=$pendingStop)", async ({
    code,
    pendingStop,
    stopAcknowledged,
  }) => {
    const f = fixture();
    const started = await f
      .tool()
      .execute({ action: "start", key: "lost", command: "sleep 300" });
    if (pendingStop) {
      if (stopAcknowledged) {
        await f.tool().execute({ action: "stop", key: "lost" });
      } else {
        f.killExec.mockRejectedValueOnce(
          new TypeError("Stop transport failed")
        );
        await expect(
          f.tool().execute({ action: "stop", key: "lost" })
        ).rejects.toThrow("Stop transport failed");
      }
    }
    // The installed SDK reports a runtime identity mismatch with this code.
    const lost = Object.assign(new Error("Computer runtime replaced"), {
      name: "WorkspaceExecutionLostError",
      code,
    });
    f.getExec.mockRejectedValue(lost);
    if (code === "ENOENT") {
      f.killExec.mockRejectedValue(lost);
    }
    const poll = f.tool().execute({ action: "poll", key: "lost" });
    if (code === "EEXEC_LOST" || pendingStop) {
      await expect(poll).resolves.toMatchObject({
        phase: "result_unavailable",
        nextAction: "inspect",
        exitCode: null,
      });
    } else {
      // Missing logs alone do not establish that the process was lost.
      await expect(poll).rejects.toMatchObject({
        code: "computer.execution_result_unavailable",
        cause: { status: 404, code: "computer.execution_result_unavailable" },
      });
    }
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    await expect(
      stopRemoteAgentComputerCommands({
        context: context("execution-a"),
        storage: f.storage,
        env: { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } },
      })
    ).resolves.toMatchObject({ unfinished: 0 });
    expect(f.killExec).toHaveBeenCalledTimes(
      (code === "ENOENT" ? 1 : 0) + (pendingStop ? 1 : 0)
    );
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
          : "remote_agent.computer.command_cleanup_failed",
      })
    );
    expect(f.exec).toHaveBeenCalledTimes(commandCount);
    expect(f.getExec).toHaveBeenCalledTimes(commandCount);
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("publishes a blocked outcome without abandoning other owned work after confirmed loss", async () => {
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
    await expect(
      f.tool().execute({ action: "poll", key: "lost", waitSeconds: 0 })
    ).resolves.toMatchObject({
      phase: "result_unavailable",
      nextAction: "inspect",
      exitCode: null,
    });
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
    await expect(reconcile()).resolves.toMatchObject({
      execution: { status: "failed" },
    });
    await expect(
      readRemoteAgentExecutionState({ identity, storage: f.storage })
    ).resolves.toMatchObject({ execution: { status: "failed" } });
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(f.killExec).not.toHaveBeenCalled();
    const retained = await readStoredComputerInvocation({
      storage: f.storage,
      context: { submissionId: "execution-a" },
    });
    expect(retained.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: expect.objectContaining({ id: lostCommand.id }),
          resultUnavailable: true,
          stopRequested: false,
          terminationConfirmed: true,
        }),
        expect.objectContaining({
          reference: expect.objectContaining({ id: liveCommand.id }),
          stopRequested: false,
          terminationConfirmed: false,
        }),
      ])
    );
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
  ])("publishes one failure for $commandCount observed unavailable results without Stop (personal=$personal)", async ({
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
        f
          .tool("execution-a", personal)
          .execute({ action: "poll", key, waitSeconds: 0 })
      ).rejects.toMatchObject({
        code: "computer.execution_result_unavailable",
      });
    }
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    const env = { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } };

    await expect(
      finishRemoteAgentComputerCommands({
        context: executionContext,
        env,
        storage: f.storage,
      })
    ).resolves.toMatchObject({
      code: "remote_agent.computer.command_cleanup_failed",
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      status: "accepted" as const,
    }));
    const reconcile = async () =>
      await reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        env,
        identity,
        readSubmission: async () => ({
          status: "settled",
          completedOutput: { submissionId: "execution-a", text: "Done" },
        }),
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
        computerCleanup: {
          stopAccepted: false,
          automaticRetryPaused: false,
          state: expect.objectContaining({ unavailable: commandCount }),
        },
      })
    );
    expect(f.exec).toHaveBeenCalledTimes(commandCount);
    expect(f.getExec).toHaveBeenCalledTimes(commandCount);
    expect(f.killExec).not.toHaveBeenCalled();
    const retained = await readStoredComputerInvocation({
      storage: f.storage,
      context: { submissionId: "execution-a" },
    });
    expect(retained.commands).toHaveLength(commandCount);
    for (const command of retained.commands) {
      expect(command).toMatchObject({
        resultUnavailable: true,
        stopRequested: false,
        terminationConfirmed: false,
      });
    }
  });

  it.each([
    false,
    true,
  ])("acknowledges Stop and publishes one aborted outcome when a retained command is gone (prior Stop acknowledged=%s)", async (priorStopAcknowledged) => {
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
    if (priorStopAcknowledged) {
      await expect(
        f.tool().execute({ action: "stop", key: "long" })
      ).resolves.toMatchObject({ status: "stop_requested" });
      expect(f.killExec).toHaveBeenCalledOnce();
    }
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
    const receipt = (await f.tool().execute(request)) as {
      id: string;
      reference: CloudComputerCommandReference;
    };
    expect(receipt).toMatchObject({
      phase: "running",
      reference: {
        invocationId: "execution-a",
        key: "report",
        id: receipt.id,
        backend: "container",
      },
    });
    await f.tool().execute(request);
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.getExec).toHaveBeenCalledTimes(1);
    expect(f.killExec).not.toHaveBeenCalled();
    expect(
      await f.tool().execute({ action: "list", includeReceiptDetails: true })
    ).toMatchObject([
      { key: "report", reference: receipt.reference, phase: "running" },
    ]);
    await expect(
      f.tool().execute({
        action: "poll",
        key: "report",
        reference: receipt.reference,
        waitSeconds: 0,
      })
    ).resolves.toMatchObject({ reference: receipt.reference });
    expect(f.exec).toHaveBeenCalledOnce();
    await expect(f.tool().execute({ action: "list" })).resolves.toEqual([
      { id: receipt.id, key: "report", createdAt: expect.any(Number) },
    ]);
  });

  it.each([
    { acknowledged: false, nativeCode: "ENOENT", phase: "launch_unknown" },
    {
      acknowledged: false,
      nativeCode: "EEXEC_LOST",
      phase: "result_unavailable",
    },
    {
      acknowledged: true,
      nativeCode: "EEXEC_LOST",
      phase: "result_unavailable",
    },
  ] as const)("reports unavailable native results without changing $phase identity", async ({
    acknowledged,
    nativeCode,
    phase,
  }) => {
    const f = fixture();
    if (!acknowledged) {
      f.exec.mockRejectedValueOnce(new Error("dispatch acknowledgement lost"));
    }
    const start = f.tool().execute({
      action: "start",
      key: "retained",
      command: "python3 report.py",
    });
    if (acknowledged) {
      await start;
    } else {
      await expect(start).rejects.toThrow("dispatch acknowledgement lost");
    }
    const listed = (await f
      .tool()
      .execute({ action: "list", includeReceiptDetails: true })) as {
      reference: CloudComputerCommandReference;
    }[];
    const reference = listed[0]?.reference;
    expect(reference).toBeDefined();
    // This native error contract was observed on the actual container and is
    // already used by the installed SDK's retained-execution boundary.
    f.getExec.mockRejectedValueOnce(
      Object.assign(new Error("native result is unavailable"), {
        code: nativeCode,
      })
    );
    const poll = f
      .tool()
      .execute({ action: "poll", key: "retained", reference, waitSeconds: 0 });
    if (nativeCode === "EEXEC_LOST") {
      await expect(poll).resolves.toMatchObject({
        reference,
        phase,
        nextAction: "inspect",
        exitCode: null,
      });
    } else {
      await expect(poll).resolves.toMatchObject({
        reference,
        phase,
        nextAction: "poll",
      });
    }
    await expect(
      f.tool().execute({ action: "list", includeReceiptDetails: true })
    ).resolves.toMatchObject([{ reference, phase }]);
    expect(f.exec).toHaveBeenCalledOnce();
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("rejects another execution's control key and rejects changed commands", async () => {
    const f = fixture();
    const receipt = (await f.tool().execute({
      action: "start",
      key: "report",
      command: "python3 report.py",
    })) as { reference: CloudComputerCommandReference };
    await expect(
      f.tool("execution-b").execute({ action: "stop", key: "report" })
    ).rejects.toMatchObject({
      code: "computer.command_not_found",
      cause: { status: 404, code: "computer.command_not_found" },
    });
    for (const changed of [
      { invocationId: "execution-b" },
      { key: "another-key" },
      { id: "another-native-id" },
      { backend: "worker-javascript" as const },
    ]) {
      await expect(
        f.tool().execute({
          action: "stop",
          key: "report",
          reference: { ...receipt.reference, ...changed },
        })
      ).rejects.toMatchObject({ code: "computer.command_reference_mismatch" });
    }
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

  it.each([
    false,
    true,
  ])("stops a late launch after its cancellation request (timedOut=%s)", async (timedOut) => {
    const f = fixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const lateStop = Promise.withResolvers<void>();
    const killedIds: string[] = [];
    f.killExec.mockImplementation((id) => {
      killedIds.push(id);
      if (killedIds.length === 2) {
        lateStop.resolve();
      }
      return Promise.resolve();
    });
    f.exec.mockImplementationOnce(async (_source, options) => {
      started.resolve();
      await release.promise;
      return handle(options.id);
    });
    if (timedOut) {
      vi.useFakeTimers();
    }
    try {
      const launch = f.tool().execute({
        action: "start",
        key: "report",
        command: "python3 report.py",
      });
      const rejected = timedOut
        ? expect(launch).resolves.toMatchObject({
            phase: "launch_unknown",
            observation: { status: "timed_out", phase: "launch" },
            nextAction: "poll",
          })
        : expect(launch).rejects.toThrow("stopped during launch");
      await started.promise;
      if (timedOut) {
        await vi.advanceTimersByTimeAsync(60_000);
        await rejected;
        expect(f.killExec).not.toHaveBeenCalled();
      }
      await f
        .tool()
        .execute({ action: "stop", key: "report", signal: "SIGKILL" });
      release.resolve();
      await lateStop.promise;
      await rejected;
      expect(f.exec).toHaveBeenCalledTimes(1);
      expect(f.killExec).toHaveBeenCalledTimes(2);
      expect(new Set(killedIds).size).toBe(1);
      expect(f.killExec.mock.calls).toEqual([
        [killedIds[0], { backend: "container", signal: "SIGKILL" }],
        [killedIds[0], { backend: "container", signal: "SIGKILL" }],
      ]);
    } finally {
      release.resolve();
      vi.useRealTimers();
    }
  });

  it("does not let an older Stop acknowledgement consume a newer signal", async () => {
    const f = fixture();
    await f
      .tool()
      .execute({ action: "start", key: "report", command: "sleep 300" });
    const entered = Promise.withResolvers<void>();
    const acknowledged = Promise.withResolvers<void>();
    let stopped = false;
    f.killExec
      .mockImplementationOnce(() => {
        entered.resolve();
        return acknowledged.promise;
      })
      .mockRejectedValueOnce(new TypeError("Stop transport failed"));
    const firstStop = f
      .tool()
      .execute({ action: "stop", key: "report", signal: "SIGTERM" });
    await entered.promise;
    await expect(
      f.tool().execute({ action: "stop", key: "report", signal: "SIGKILL" })
    ).rejects.toThrow("Stop transport failed");
    acknowledged.resolve();
    await firstStop;
    f.killExec.mockImplementation(() => {
      stopped = true;
      return Promise.resolve();
    });
    f.getExec.mockImplementation((id) =>
      Promise.resolve(
        handle(
          id,
          stopped ? [{ id, seq: 1, name: "exit", code: 137 }] : [],
          stopped
        )
      )
    );
    await expect(
      f.tool().execute({ action: "poll", key: "report", waitSeconds: 0 })
    ).resolves.toMatchObject({ status: "completed", exitCode: 137 });
    expect(f.killExec).toHaveBeenCalledTimes(3);
    expect(f.killExec).toHaveBeenNthCalledWith(3, expect.any(String), {
      backend: "container",
      signal: "SIGKILL",
    });
    await f.tool().execute({ action: "poll", key: "report", waitSeconds: 0 });
    expect(f.killExec).toHaveBeenCalledTimes(3);
    expect(f.exec).toHaveBeenCalledOnce();
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
        ])
      )
    );
    const started = (await tool.execute({
      action: "start",
      key: "utf8",
      command: "example",
    })) as { id: string; after: number };
    expect(started.after).toBe(4.5);
    f.getExec.mockImplementation((id) =>
      Promise.resolve(handle(id, [{ id, seq: 5, name: "exit", code: 0 }], true))
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
