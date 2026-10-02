import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { FlueObservation } from "@flue/runtime";
import {
  defineTool,
  observe,
  setProvider,
  useAgentFinish,
  useAgentStart,
  useModel,
  useTool,
} from "@flue/runtime";
import {
  createCloudflareAgentRuntime,
  createFlueContext,
  resolveModel,
} from "@flue/runtime/internal";
import { sqlite } from "@flue/runtime/node";
import { object } from "valibot";
import { expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  listRemoteAgentUsageRecords,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  initializeRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";
import { normalizeFluePromptUsage } from "../agent-core/usage";
import { reconcileRemoteAgentExecution } from "../flue-adapter/execution-reconciliation";
import { createCenterAgentObservationDispatcher } from "../flue-adapter/observation-dispatcher";
import { handleCenterAgentObservation } from "../flue-adapter/stream-observer";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

it.each([
  { ending: "failed", restart: false },
  { ending: "aborted", restart: false },
  { ending: "before_model", restart: false },
  { ending: "failed", restart: true },
  { ending: "aborted", restart: true },
  { ending: "before_model", restart: true },
] as const)("retains only recorded usage for $ending, restart=$restart", async ({
  ending,
  restart,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "flue-terminal-usage-"));
  const databasePath = join(directory, "runtime.sqlite");
  let database = sqlite(databasePath);
  await database.migrate?.();
  let stores = await database.connect();
  const provider = fauxProvider({
    provider: "terminal-usage",
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });
  setProvider(provider.provider);
  const model = provider.getModel();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const hold = defineTool({
    name: "hold",
    description: "Pause at a controlled external boundary.",
    input: object({}),
    run: async () => {
      entered.resolve();
      await release.promise;
      return { output: "released" };
    },
  });
  function Center() {
    useModel(`${model.provider}/${model.id}`);
    if (ending === "aborted") {
      useTool(hold);
    }
    if (ending === "before_model") {
      useAgentStart(() => {
        throw new Error("Preparation failed before the provider ran.");
      });
    }
    if (ending === "failed") {
      useAgentFinish(() => {
        throw new Error("Failure after the recorded provider response.");
      });
    }
    return "Read the records and report the outcome.";
  }
  Center.durability = { maxAttempts: 5, timeoutMs: 0 };
  Center.joinQueuedDeliveries = false;
  provider.setResponses([
    ending === "aborted"
      ? fauxAssistantMessage(fauxToolCall("hold", {}), {
          stopReason: "toolUse",
        })
      : fauxAssistantMessage(
          "This draft must not be published as a successful answer."
        ),
  ]);
  const submissionId = `terminal-${ending}-${restart}`;
  const request = createSubmitTurnRequest();
  let storage = new InMemoryDurableObjectStorage();
  const identity = {
    idempotencyKey: request.idempotencyKey,
    organizationId: request.organizationId,
    spaceId: request.spaceId,
    submissionId,
    v: 1 as const,
  };
  await initializeRemoteAgentExecutionState({
    acceptedAtMs: Date.now(),
    identity,
    storage,
  });
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      request,
      nowMs: Date.now(),
      ack: {
        accepted: true,
        createdAt: Date.now(),
        idempotencyKey: request.idempotencyKey,
        submissionId,
        requestId: submissionId,
        status: "pending",
      },
    })
  );
  const completeRemoteAgentSubmission = vi.fn().mockResolvedValue({
    status: "accepted",
    publishedSignalId: "terminal-result",
  });
  const coreWorker = { completeRemoteAgentSubmission };
  const pending: Promise<void>[] = [];
  const observations: FlueObservation[] = [];
  const publisher = createRemoteAgentStreamPublisher();
  const dispatch = createCenterAgentObservationDispatcher({
    handle: (event) =>
      handleCenterAgentObservation({
        event,
        resolveDependencies: () => ({
          storage,
          coreWorker,
          env: {} as CloudflareBindings,
        }),
        streamPublisher: publisher,
      }),
    scheduleBackground: (task) => {
      pending.push(task);
    },
  });
  const unsubscribe = observe((event) => {
    if (event.submissionId !== submissionId) {
      return;
    }
    observations.push(event);
    if (
      !restart &&
      event.type === "operation" &&
      event.operationKind === "prompt"
    ) {
      dispatch(event);
    }
  });
  const runtime = createCloudflareAgentRuntime({
    agents: [{ agent: Center, name: "center-agent-v2" }],
    createContext: ({ agentName, instance, request: req, submissionId: id }) =>
      createFlueContext({
        agentConfig: { resolveModel },
        agentName,
        env: {},
        id: instance.name,
        req,
        submissionId: id,
      }),
    runWithInstanceContext: (_instance, _agent, callback) => callback(),
  });
  function owner() {
    const fibers: Promise<void>[] = [];
    const instance = {
      name: "terminal-usage",
      ctx: { id: { toString: () => "same-object" }, storage: {} },
      env: {},
      schedule: async () => undefined,
      runFiber: (
        _name: string,
        callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
      ) => {
        const fiber = callback({ stash: () => undefined });
        fibers.push(fiber);
        return fiber;
      },
    };
    runtime.attach(instance, { agentName: "center-agent-v2", ...stores });
    return { instance, fibers };
  }
  const first = owner();
  try {
    await runtime.onStart(first.instance, () => undefined);
    await runtime.onRequest(
      first.instance,
      new Request("https://flue.internal/__flue/internal/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent: "center-agent-v2",
          id: first.instance.name,
          submissionId,
          acceptedAt: new Date().toISOString(),
          message: { kind: "user", body: "Read and report." },
        }),
      })
    );
    await runtime.drainSubmissions(first.instance);
    if (ending === "aborted") {
      await entered.promise;
      await requestRemoteAgentExecutionCancellation({
        identity,
        storage,
        nowMs: Date.now(),
      });
      await runtime.onRequest(
        first.instance,
        new Request(
          `https://flue.internal/agents/center-agent-v2/terminal-usage/abort?submissionId=${submissionId}`,
          { method: "POST" }
        )
      );
      release.resolve();
    }
    await Promise.allSettled(first.fibers);
    await Promise.all(pending);
    const reported = observations.flatMap((event) =>
      event.type === "turn" && event.response.usage
        ? [event.response.usage]
        : []
    );
    // Include a provider response that reports consumption while acknowledging
    // cancellation too. This expectation comes from actual provider receipts,
    // independently of the runtime's canonical aggregation implementation.
    const expectedUsage =
      reported.length === 0
        ? null
        : normalizeFluePromptUsage({
            input: reported.reduce((sum, usage) => sum + usage.input, 0),
            output: reported.reduce((sum, usage) => sum + usage.output, 0),
            cacheRead: reported.reduce(
              (sum, usage) => sum + usage.cacheRead,
              0
            ),
            cacheWrite: reported.reduce(
              (sum, usage) => sum + usage.cacheWrite,
              0
            ),
            totalTokens: reported.reduce(
              (sum, usage) => sum + usage.totalTokens,
              0
            ),
            cost: {
              input: reported.reduce((sum, usage) => sum + usage.cost.input, 0),
              output: reported.reduce(
                (sum, usage) => sum + usage.cost.output,
                0
              ),
              cacheRead: reported.reduce(
                (sum, usage) => sum + usage.cost.cacheRead,
                0
              ),
              cacheWrite: reported.reduce(
                (sum, usage) => sum + usage.cost.cacheWrite,
                0
              ),
              total: reported.reduce((sum, usage) => sum + usage.cost.total, 0),
            },
          });
    if (ending !== "before_model") {
      expect(expectedUsage?.totalTokens).toBeGreaterThan(0);
    } else {
      expect(provider.state.callCount).toBe(0);
    }
    const operation = observations.find(
      (event) =>
        event.type === "operation" &&
        event.operationKind === "prompt" &&
        event.isError
    );
    expect(operation).toBeDefined();
    if (!restart && operation?.type === "operation") {
      expect(normalizeFluePromptUsage(operation.usage)).toEqual(expectedUsage);
    }
    let instance = first.instance;
    if (restart) {
      // No application terminal observer has run. Reopen the actual SQLite
      // file and retain only admission/cancellation records in application storage.
      expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
      await database.close?.();
      database = sqlite(databasePath);
      await database.migrate?.();
      stores = await database.connect();
      const restored = new InMemoryDurableObjectStorage();
      for (const [key, value] of await storage.list()) {
        await restored.put(key, JSON.parse(JSON.stringify(value)));
      }
      storage = restored;
      instance = owner().instance;
      await runtime.onStart(instance, () => undefined);
    }
    const projection = await runtime.readSubmission(instance, submissionId);
    expect(projection).toMatchObject({ status: "settled" });
    expect(projection?.completedOutput).toBeUndefined();
    for (let index = 0; index < 3; index += 1) {
      await expect(
        reconcileRemoteAgentExecution({
          identity,
          storage,
          coreWorker,
          readSubmission: (id) => runtime.readSubmission(instance, id),
        })
      ).resolves.toMatchObject({
        execution: { status: ending === "aborted" ? "aborted" : "failed" },
      });
    }
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("draft") })
    );
    const context = await readRemoteAgentCallbackContext(storage, submissionId);
    expect(context?.lastUsage ?? null).toEqual(expectedUsage);
    const records = await listRemoteAgentUsageRecords(storage);
    if (ending === "before_model") {
      expect(records).toHaveLength(0);
    } else {
      expect(context?.modelId).toBe(`${model.provider}/${model.id}`);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        usage: expectedUsage,
        modelId: `${model.provider}/${model.id}`,
      });
    }
  } finally {
    release.resolve();
    await Promise.allSettled(first.fibers);
    await Promise.allSettled(pending);
    unsubscribe();
    await database.close?.();
    await rm(directory, { recursive: true, force: true });
  }
});
