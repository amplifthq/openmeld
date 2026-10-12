import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type WorkspaceClient,
  type WorkspaceRuntimeEvent,
  type WorkspaceRuntimeExecHandle,
  WorkspaceSyncPendingError,
} from "@cloudflare/computer";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineTool, init, observe, useModel, useTool } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { strictObject } from "valibot";
import { expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import {
  bindComputerCommandTarget,
  type ComputerCommandRecord,
  createComputerCommandTool,
  readStoredComputerInvocation,
  requestStoredComputerCleanup,
} from "../flue-adapter/computer-command";
import {
  COMPUTER_COMMAND_PREFIX,
  ComputerCommandSqlStorage,
} from "../flue-adapter/computer-command-storage";
import { registerComputerInvocation } from "../flue-adapter/computer-invocations";
import { cancelFlueRemoteAgentExecution } from "../flue-adapter/execution-cancellation";
import {
  checkRemoteAgentExecutionFinish,
  useRemoteAgentExecutionFinish,
} from "../flue-adapter/execution-finish";
import { extractAssistantText } from "../flue-adapter/observation";
import { toFlueJsonValue } from "../flue-adapter/tool-execution";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { collectDueComputerCommands } from "./fixtures/computer-command-results";
import { InMemoryDurableObjectStorage } from "./storage";

function context(submissionId: string) {
  const request = {
    ...createSubmitTurnRequest(),
    idempotencyKey: `remote-agent:finish-wait:${submissionId}`,
  };
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
    computerIsolationVersion: 3 as const,
  };
}

// The retained stream and admission callback come from the installed SDK's
// public types. Only native preparation and process I/O are controlled here.
function completedHandle(id: string): WorkspaceRuntimeExecHandle<"utf8"> {
  const events: WorkspaceRuntimeEvent<"utf8">[] = [
    { id, name: "stdout", seq: 1, value: "ORIGINAL-RESULT-781\n" },
    { id, name: "exit", seq: 2, code: 0 },
  ];
  return Object.assign(
    new ReadableStream<WorkspaceRuntimeEvent<"utf8">>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(event);
        }
        controller.close();
      },
    }),
    {
      id,
      backend: "container",
      result: async () => ({
        status: "completed",
        exitCode: 0,
        stdout: "ORIGINAL-RESULT-781\n",
        stderr: "",
        pushed: 0,
        pulled: 0,
        skipped: [],
        sync: { status: "complete", applied: 0, skipped: [] },
      }),
      kill: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    }
  ) as WorkspaceRuntimeExecHandle<"utf8">;
}

function computerFixture(preparationSteps = 2, deferNativeAck = false) {
  const database = new DatabaseSync(":memory:");
  const storage = new ComputerCommandSqlStorage({
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
  const nativeStarts = vi.fn((id: string) => completedHandle(id));
  const nativeAdmitted = Promise.withResolvers<void>();
  const releaseNativeAck = Promise.withResolvers<void>();
  const preparationIds: string[] = [];
  const killExec = vi.fn(async () => undefined);
  let exited = false;
  const workspace = {
    executionSync: vi.fn(
      async (): ReturnType<WorkspaceClient["executionSync"]> =>
        exited
          ? {
              epoch: "generation-1",
              rev: 100,
              skipped: [],
              skippedTruncated: false,
            }
          : undefined
    ),
    maintainSync: vi.fn(async () => false),
    runtime: {
      execWithAdmission: async (
        _command: string,
        options: { id: string },
        admit: () => Promise<void>
      ) => {
        preparationIds.push(options.id);
        if (preparationIds.length <= preparationSteps) {
          const progress = {
            operationId: "preparation",
            generation: "generation-1",
            checkpoint: `checkpoint-${preparationIds.length}`,
            backend: "container",
            direction: "push" as const,
            mode: "entries" as const,
            phase: "preparing" as const,
            cursor: { rev: preparationIds.length, path: null },
            targetCursor: { rev: 100, path: null },
            entries: 1,
            bytes: 16,
            skipped: 0,
            complete: false,
          };
          throw new WorkspaceSyncPendingError(progress);
        }
        await admit();
        const handle = nativeStarts(options.id);
        nativeAdmitted.resolve();
        if (deferNativeAck) {
          await releaseNativeAck.promise;
        }
        exited = true;
        return handle;
      },
      getExec: async (id: string) => completedHandle(id),
      killExec,
    },
  } as unknown as WorkspaceClient;
  const workspaceAccess = {
    withWorkspace: async <T>(
      operation: (value: WorkspaceClient) => Promise<T>
    ) => await operation(workspace),
  };
  const tool = createComputerCommandTool({
    context: { submissionId: "original" },
    storage,
    workspaceAccess,
    workingDirectory: "/computer",
  });
  return {
    database,
    storage,
    nativeStarts,
    nativeAdmitted,
    releaseNativeAck,
    preparationIds,
    killExec,
    workspaceAccess,
    tool,
  };
}

it.each([
  "completed",
  "completed_read_failure",
  "completed_before_second_finish",
  "completed_eighth_observation",
  "failed_eighth_observation",
  "expired_eighth_observation",
  "abort",
  "stop",
] as const)("keeps the original Flue finish wait and Computer receipt coherent through %s", async (ending) => {
  const completed = ending.startsWith("completed");
  const eighthObservation = ending.endsWith("eighth_observation");
  const blocked = eighthObservation && !completed;
  const deferredAck =
    ending === "completed" || ending === "completed_read_failure";
  const f = computerFixture(eighthObservation ? 1 : 2, deferredAck);
  const storage = new InMemoryDurableObjectStorage();
  let current = context("original");
  const bind = async () => {
    await putRemoteAgentCallbackContext(storage, current);
    await initializeRemoteAgentExecutionState({
      identity: buildRemoteAgentExecutionIdentity(current),
      storage,
      acceptedAtMs: TEST_NOW_MS,
    });
    await bindComputerCommandTarget({
      storage,
      submissionId: current.submissionId,
      computerName: "personal-computer:owner",
    });
  };
  await bind();
  const started = await f.tool.execute({
    action: "start",
    key: "once",
    command: "produce original result",
  });
  expect(started).toMatchObject({
    preparation: { checkpoint: "checkpoint-1" },
  });
  const releaseObservation = Promise.withResolvers<void>();
  let collecting: Promise<boolean> | undefined;
  let restoreClock: (() => void) | undefined;
  if (eighthObservation) {
    const entered = Promise.withResolvers<void>();
    const withWorkspace = f.workspaceAccess.withWorkspace;
    f.workspaceAccess.withWorkspace = async (operation) => {
      entered.resolve();
      await releaseObservation.promise;
      if (ending === "failed_eighth_observation") {
        throw Object.assign(new Error("Workspace acquisition failed"), {
          code: "ECONNRESET",
        });
      }
      return await withWorkspace(operation);
    };
    for (const [key, command] of await f.storage.list<ComputerCommandRecord>({
      prefix: COMPUTER_COMMAND_PREFIX,
    })) {
      await f.storage.put(key, {
        ...command,
        collection: { unconfirmedAttempts: 7, nextAttemptAtMs: Date.now() },
      });
    }
    collecting = collectDueComputerCommands(f);
    await entered.promise;
  }
  const secondFinish = Promise.withResolvers<void>();
  const progressObserved = Promise.withResolvers<void>();
  const waitingObservation = Promise.withResolvers<void>();
  const waitingForNativeAck = Promise.withResolvers<void>();
  const cleanupRequested = Promise.withResolvers<void>();
  let reads = 0;
  let launchUnknownReads = 0;
  const requestCleanup = vi.fn((invocationId: string) => {
    cleanupRequested.resolve();
    return requestStoredComputerCleanup({
      context: { submissionId: invocationId },
      storage: f.storage,
    });
  });
  const env = {
    AGENT_COMPUTER: {
      idFromName: (name: string) => name,
      get: () => ({
        registerComputerInvocation: (owner: unknown) =>
          registerComputerInvocation(f.storage, owner),
        requestComputerCleanup: requestCleanup,
        readComputerInvocation: async (invocationId: string) => {
          const state = await readStoredComputerInvocation({
            context: { submissionId: invocationId },
            storage: f.storage,
          });
          reads += 1;
          if (reads === 2) {
            secondFinish.resolve();
          }
          if (reads === 3) {
            waitingObservation.resolve();
            if (ending === "completed_read_failure") {
              throw Object.assign(
                new Error("Computer observation reply lost"),
                {
                  code: "ECONNRESET",
                }
              );
            }
          }
          if (
            state.commands.some((command) => command.phase === "launch_unknown")
          ) {
            launchUnknownReads += 1;
            if (launchUnknownReads === 2) {
              waitingForNativeAck.resolve();
            }
          }
          if (
            state.commands.some(
              (command) => command.preparation?.checkpoint === "checkpoint-2"
            )
          ) {
            progressObserved.resolve();
          }
          return state;
        },
      }),
    },
  };
  const directory = await mkdtemp(join(tmpdir(), "computer-finish-wait-"));
  const provider = fauxProvider({
    provider: `computer-finish-${ending}`,
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  const model = provider.getModel();
  let modelCalls = 0;
  let finalText = "";
  const resultReads = vi.fn(async () => ({
    output: toFlueJsonValue(
      await f.tool.execute({ action: "poll", key: "once", waitSeconds: 0 })
    ),
  }));
  const readOriginal = defineTool({
    name: "read_original_result",
    description: "Read the original command's retained result.",
    input: strictObject({}),
    run: resultReads,
  });
  function FinishWait() {
    useModel(`${model.provider}/${model.id}`, { compaction: false });
    useTool(readOriginal);
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
    return "Read original command results before explaining the outcome. Never repeat the command.";
  }
  FinishWait.joinQueuedDeliveries = false;
  const explanation =
    "The original command completed: ORIGINAL-RESULT-781. I did not repeat it.";
  const blockedExplanation =
    "The original command result is not confirmed. I have not repeated the command.";
  const next = "I can continue with a new independent request.";
  const responses: Parameters<typeof provider.setResponses>[0] = [
    () => {
      modelCalls += 1;
      return fauxAssistantMessage("The work is done.");
    },
    async (ctx) => {
      modelCalls += 1;
      expect(JSON.stringify(ctx.messages)).toContain("owned_commands_pending");
      if (ending === "completed_before_second_finish") {
        await collectDueComputerCommands(f);
        await collectDueComputerCommands(f);
      }
      return fauxAssistantMessage("I am ready to finish again.");
    },
  ];
  if (completed) {
    responses.push(
      (ctx) => {
        modelCalls += 1;
        expect(JSON.stringify(ctx.messages)).toContain(
          "computer_results_ready"
        );
        return fauxAssistantMessage(fauxToolCall("read_original_result", {}), {
          stopReason: "toolUse",
        });
      },
      (ctx) => {
        modelCalls += 1;
        expect(JSON.stringify(ctx.messages)).toContain("ORIGINAL-RESULT-781");
        return fauxAssistantMessage(explanation);
      }
    );
  } else if (blocked) {
    responses.push((ctx) => {
      modelCalls += 1;
      expect(JSON.stringify(ctx.messages)).toContain(
        "computer_result_incomplete"
      );
      return fauxAssistantMessage(blockedExplanation);
    });
  }
  responses.push(() => {
    modelCalls += 1;
    return fauxAssistantMessage(next);
  });
  provider.setResponses(responses);
  const unsubscribe = observe((event) => {
    if (event.type === "operation" && event.operationKind === "prompt") {
      const text = extractAssistantText(event);
      if (text) {
        finalText = text;
      }
    }
  });
  const runtime = await start({
    agents: [FinishWait],
    providers: [provider.provider],
    db: sqlite(join(directory, "history.sqlite")),
  });
  const agent = init(FinishWait, { id: "same-conversation" });
  try {
    const receipt = await agent.dispatch("Complete the original work.");
    const read = agent.read(receipt).catch((error: unknown) => error);
    expect(await Promise.race([secondFinish.promise, read])).toBeUndefined();
    if (eighthObservation) {
      expect(
        await Promise.race([
          waitingObservation.promise.then(() => "waiting"),
          cleanupRequested.promise.then(() => "stopped"),
        ])
      ).toBe("waiting");
      expect(modelCalls).toBe(2);
      expect(requestCleanup).not.toHaveBeenCalled();
      expect(f.nativeStarts).not.toHaveBeenCalled();
      const command = [
        ...(
          await f.storage.list<ComputerCommandRecord>({
            prefix: COMPUTER_COMMAND_PREFIX,
          })
        ).values(),
      ][0];
      expect(command?.collection).toMatchObject({
        unconfirmedAttempts: 8,
        nextAttemptAtMs: null,
      });
      if (ending === "expired_eighth_observation") {
        const expiresAt = command?.collection?.observationExpiresAtMs;
        if (typeof expiresAt !== "number") {
          throw new Error("Missing active observation deadline");
        }
        expect(expiresAt).toBeGreaterThan(Date.now());
        const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1);
        restoreClock = () => clock.mockRestore();
      } else {
        releaseObservation.resolve();
        await collecting;
      }
    } else if (ending !== "completed_before_second_finish") {
      await collectDueComputerCommands(f);
      expect(
        await Promise.race([
          progressObserved.promise.then(() => "progress"),
          cleanupRequested.promise.then(() => "stopped"),
        ])
      ).toBe("progress");
      expect(modelCalls).toBe(2);
      expect(requestCleanup).not.toHaveBeenCalled();
      expect(f.killExec).not.toHaveBeenCalled();
      expect(f.nativeStarts).not.toHaveBeenCalled();
    }
    if (completed) {
      if (deferredAck) {
        collecting = collectDueComputerCommands(f);
        await f.nativeAdmitted.promise;
        expect(
          await readStoredComputerInvocation({
            context: { submissionId: "original" },
            storage: f.storage,
          })
        ).toMatchObject({ commands: [{ phase: "launch_unknown" }] });
        expect(
          await Promise.race([
            waitingForNativeAck.promise.then(() => "waiting"),
            cleanupRequested.promise.then(() => "stopped"),
          ])
        ).toBe("waiting");
        expect(modelCalls).toBe(2);
        expect(requestCleanup).not.toHaveBeenCalled();
        expect(f.killExec).not.toHaveBeenCalled();
        expect(f.nativeStarts).toHaveBeenCalledOnce();
        f.releaseNativeAck.resolve();
        await collecting;
      }
      expect(await read).toMatchObject({
        text: expect.stringContaining(explanation),
      });
      expect(finalText).toBe(explanation);
      expect(resultReads).toHaveBeenCalledOnce();
      expect(f.nativeStarts).toHaveBeenCalledOnce();
      expect(new Set(f.preparationIds).size).toBe(1);
      expect(requestCleanup).not.toHaveBeenCalled();
    } else if (blocked) {
      expect(await read).toMatchObject({
        text: expect.stringContaining(blockedExplanation),
      });
      expect(finalText).toBe(blockedExplanation);
      expect(requestCleanup).toHaveBeenCalledOnce();
      expect(resultReads).not.toHaveBeenCalled();
      releaseObservation.resolve();
      await collecting;
      expect(f.nativeStarts).not.toHaveBeenCalled();
    } else {
      if (ending === "stop") {
        await cancelFlueRemoteAgentExecution({
          storage,
          identity: buildRemoteAgentExecutionIdentity(current),
          nowMs: Date.now(),
          scheduleReconciliation: async () => undefined,
          abortSubmission: async () => {
            await requestCleanup(current.submissionId);
            await agent.abort();
            return { aborted: true };
          },
        });
      } else {
        await agent.abort();
      }
      expect(await read).toMatchObject({ outcome: "aborted" });
      expect(modelCalls).toBe(2);
      if (ending === "stop") {
        await collectDueComputerCommands(f);
        expect(f.preparationIds).toHaveLength(2);
        expect(requestCleanup).toHaveBeenCalledOnce();
      }
      expect(f.nativeStarts).not.toHaveBeenCalled();
    }
    current = context("follow-up");
    await bind();
    expect(
      (await agent.read(await agent.dispatch("Answer a new question."))).text
    ).toBe(next);
    expect(f.nativeStarts).toHaveBeenCalledTimes(completed ? 1 : 0);
    expect(f.killExec).not.toHaveBeenCalled();
    expect(provider.getPendingResponseCount()).toBe(0);
  } finally {
    await agent.abort();
    releaseObservation.resolve();
    f.releaseNativeAck.resolve();
    await collecting;
    restoreClock?.();
    unsubscribe();
    await runtime.stop();
    f.database.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
