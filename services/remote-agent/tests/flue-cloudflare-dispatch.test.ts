import { readdir, readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  type Context,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  defineAgent,
  defineTool,
  registerProvider,
  type SessionEnv,
} from "@flue/runtime";
import {
  type AgentExecutionStore,
  type AgentSubmission,
  type AgentSubmissionStore,
  createCloudflareAgentRuntime,
  createFlueContext,
  type FlueContextInternal,
  InMemoryAttachmentStore,
  InMemoryConversationStreamStore,
  resetProviderRuntime,
  resolveModel,
  type SubmissionAttemptRef,
  type SubmissionDurability,
} from "@flue/runtime/internal";
import { sqlite } from "@flue/runtime/node";
import { object } from "valibot";
import { describe, expect, it, vi } from "vitest";

const REQUEUE_BEFORE_INPUT_SQL_PATTERN =
  /UPDATE flue_agent_submissions[\s\S]*input_applied_at IS NULL[\s\S]*RETURNING/iu;
const SQL_ROW_QUERY_PATTERN =
  /^(?:\s*)(?:EXPLAIN|PRAGMA|SELECT)\b|\bRETURNING\b/iu;

function ownsRunningAttempt(
  submission: AgentSubmission,
  attempt: SubmissionAttemptRef
): boolean {
  return (
    submission.status === "running" &&
    submission.submissionId === attempt.submissionId &&
    submission.attemptId === attempt.attemptId
  );
}

describe("Flue Cloudflare dispatch patch", () => {
  it("requeues the patched SQL row only for its exact pre-input attempt", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      let loseNextRequeueResponse = false;
      const submissions = await createPatchedSqlSubmissionStore(database, {
        afterRows: (query, rows) => {
          if (
            loseNextRequeueResponse &&
            rows.length === 1 &&
            REQUEUE_BEFORE_INPUT_SQL_PATTERN.test(query)
          ) {
            loseNextRequeueResponse = false;
            throw new Error(
              "The SQL commit succeeded but its response was lost."
            );
          }
        },
      });
      const firstSubmissionId = "submission-sql-cas-input-applied";
      const firstAttempt = await claimSqlSubmission({
        attemptId: "attempt-sql-current",
        submissionId: firstSubmissionId,
        submissions,
      });

      await expect(
        submissions.requeueSubmissionBeforeInputApplied({
          attemptId: "attempt-sql-wrong",
          submissionId: firstSubmissionId,
        })
      ).resolves.toBe(false);
      await expect(
        submissions.markSubmissionInputApplied(firstAttempt, {
          maxRetry: 10,
          timeoutAt: 0,
        })
      ).resolves.toBe(true);
      await expect(
        submissions.requeueSubmissionBeforeInputApplied(firstAttempt)
      ).resolves.toBe(false);

      const secondSubmissionId = "submission-sql-cas-concurrent";
      const secondAttempt = await claimSqlSubmission({
        attemptId: "attempt-sql-concurrent",
        submissionId: secondSubmissionId,
        submissions,
      });
      const outcomes = await Promise.all([
        submissions.requeueSubmissionBeforeInputApplied(secondAttempt),
        submissions.requeueSubmissionBeforeInputApplied(secondAttempt),
      ]);

      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const concurrentlyRequeued =
        await submissions.getSubmission(secondSubmissionId);
      expect(concurrentlyRequeued).toMatchObject({ status: "queued" });
      expect(concurrentlyRequeued?.attemptId).toBeUndefined();
      expect(concurrentlyRequeued?.inputAppliedAt).toBeUndefined();

      const thirdSubmissionId = "submission-sql-cas-ambiguous-commit";
      const thirdAttempt = await claimSqlSubmission({
        attemptId: "attempt-sql-ambiguous-commit",
        submissionId: thirdSubmissionId,
        submissions,
      });
      loseNextRequeueResponse = true;

      await expect(
        submissions.requeueSubmissionBeforeInputApplied(thirdAttempt)
      ).rejects.toThrow("commit succeeded but its response was lost");
      await expect(
        submissions.requeueSubmissionBeforeInputApplied(thirdAttempt)
      ).resolves.toBe(false);
      const ambiguouslyCommitted =
        await submissions.getSubmission(thirdSubmissionId);
      expect(ambiguouslyCommitted).toMatchObject({ status: "queued" });
      expect(ambiguouslyCommitted?.attemptId).toBeUndefined();
      expect(ambiguouslyCommitted?.inputAppliedAt).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("settles a truly pre-input exhausted submission without initializing the agent", async () => {
    const submissionId = "submission-exhausted-before-agent-initialization";
    const attemptId = "attempt-exhausted-before-agent-initialization";
    const durableObjectId = "durable-object-center-agent-exhausted";
    const runningSubmission: AgentSubmission = {
      acceptedAt: Date.parse("2026-08-01T00:00:00.000Z"),
      attemptCount: 5,
      attemptId,
      canonicalReadyAt: Date.parse("2026-08-01T00:00:00.000Z"),
      input: {
        acceptedAt: "2026-08-01T00:00:00.000Z",
        agent: "center-agent",
        dispatchId: submissionId,
        id: "space-exhausted",
        input: { message: "Finish or fail visibly." },
        kind: "dispatch",
        submissionId,
      },
      kind: "dispatch",
      leaseExpiresAt: 0,
      maxRetry: 5,
      ownerId: durableObjectId,
      sequence: 1,
      sessionKey: "agent:space-exhausted:default:default",
      startedAt: Date.parse("2026-08-01T00:00:00.000Z"),
      status: "running",
      submissionId,
      timeoutAt: 0,
    };
    let unsettled = true;
    const failSubmission = vi.fn(() => {
      unsettled = false;
      return Promise.resolve(true);
    });
    const initializeRootHarness = vi.fn(() =>
      Promise.reject(
        new Error("The agent initializer must not run after retry exhaustion.")
      )
    );
    const submissions = {
      deleteAttemptMarker: () => Promise.resolve(),
      failSubmission,
      getSubmission: () => Promise.resolve(runningSubmission),
      hasUnsettledSubmissions: () => Promise.resolve(unsettled),
      listAttemptMarkers: () => Promise.resolve([]),
      listPendingSubmissionSettlements: () => Promise.resolve([]),
      listRunnableSubmissions: () => Promise.resolve([]),
      listRunningSubmissions: () =>
        Promise.resolve(unsettled ? [runningSubmission] : []),
      listUnreadySubmissions: () => Promise.resolve([]),
    };
    const prepared = {
      agentName: "center-agent",
      attachmentStore: new InMemoryAttachmentStore(),
      conversationStreamStore: new InMemoryConversationStreamStore(),
      executionStore: { submissions } as unknown as AgentExecutionStore,
    };
    const runtime = createCloudflareAgentRuntime({
      agents: [{ definition: {} as never, name: "center-agent" }],
      createContext: () =>
        ({ initializeRootHarness }) as unknown as FlueContextInternal,
      runWithInstanceContext: (_instance, _agentName, callback) => callback(),
    });
    const instance = {
      __unsafe_ensureInitialized: () => Promise.resolve(),
      ctx: {
        id: { toString: () => durableObjectId },
        storage: {},
      },
      env: {},
      name: "space-exhausted",
      runFiber: async (
        _name: string,
        callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
      ) => await callback({ stash: () => undefined }),
      schedule: () => Promise.resolve(),
    };

    runtime.attach(instance, prepared);
    await runtime.wakeSubmissions(instance);

    expect(failSubmission).toHaveBeenCalledOnce();
    expect(initializeRootHarness).not.toHaveBeenCalled();
  });

  it("settles a completed durable conversation before judging its final attempt exhausted", async () => {
    const fixture = createExhaustedInterruptedSubmissionFixture({
      inspectionState: "completed",
    });

    await fixture.runtime.wakeSubmissions(fixture.instance);

    expect(fixture.inspectSubmissionInput).toHaveBeenCalledOnce();
    expect(fixture.reconstructSubmissionResult).toHaveBeenCalledOnce();
    expect(fixture.completeSubmission).toHaveBeenCalledOnce();
    expect(fixture.failSubmission).not.toHaveBeenCalled();
  });

  it("settles a requested cancellation before judging its final attempt exhausted", async () => {
    const fixture = createExhaustedInterruptedSubmissionFixture({
      abortRequestedAt: Date.parse("2026-08-01T00:00:01.000Z"),
      inspectionState: "absent",
    });

    await fixture.runtime.wakeSubmissions(fixture.instance);

    expect(fixture.inspectSubmissionInput).toHaveBeenCalledOnce();
    expect(fixture.completeSubmission).not.toHaveBeenCalled();
    expect(fixture.failSubmission).toHaveBeenCalledOnce();
    expect(fixture.recordSubmissionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "aborted" })
    );
  });

  it("exposes a lightweight submission read to Cloudflare extensions", async () => {
    const submission = {
      acceptedAt: 1000,
      attemptCount: 5,
      canonicalReadyAt: 1000,
      error: "Agent submission exhausted its retry budget.",
      input: {
        acceptedAt: "1970-01-01T00:00:01.000Z",
        agent: "center-agent",
        dispatchId: "submission-terminal",
        id: "space-terminal",
        input: { message: "Hello" },
        kind: "dispatch" as const,
        submissionId: "submission-terminal",
      },
      kind: "dispatch" as const,
      leaseExpiresAt: 0,
      maxRetry: 5,
      sequence: 1,
      sessionKey: "agent:space-terminal:default:default",
      status: "settled" as const,
      submissionId: "submission-terminal",
      timeoutAt: 0,
    } satisfies AgentSubmission;
    const getSubmission = vi.fn(async () => submission);
    const prepared = {
      agentName: "center-agent",
      attachmentStore: new InMemoryAttachmentStore(),
      conversationStreamStore: new InMemoryConversationStreamStore(),
      executionStore: {
        submissions: { getSubmission },
      } as unknown as AgentExecutionStore,
    };
    const runtime = createCloudflareAgentRuntime({
      agents: [{ definition: {} as never, name: "center-agent" }],
      createContext: () => ({}) as FlueContextInternal,
      runWithInstanceContext: (_instance, _agentName, callback) => callback(),
    });
    const instance = {
      __unsafe_ensureInitialized: () => Promise.resolve(),
      ctx: {
        id: { toString: () => "durable-object-terminal" },
        storage: {},
      },
      env: {},
      name: "space-terminal",
      runFiber: (
        _name: string,
        callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
      ) => callback({ stash: () => undefined }),
      schedule: () => Promise.resolve(),
    };

    runtime.attach(instance, prepared);

    await expect(
      (
        instance as typeof instance & {
          __unsafe_readSubmission(
            submissionId: string
          ): Promise<AgentSubmission | null>;
        }
      ).__unsafe_readSubmission(submission.submissionId)
    ).resolves.toEqual(submission);
    expect(getSubmission).toHaveBeenCalledWith(submission.submissionId);
  });

  it("recovers a durable submission after the Durable Object instance is replaced", async () => {
    const submissionId = "submission-recovered-after-instance-replacement";
    const attemptId = "attempt-interrupted-by-instance-replacement";
    const durableObjectId = "durable-object-center-agent-space-recovery";
    const input = {
      acceptedAt: "2026-08-01T00:00:00.000Z",
      agent: "center-agent",
      dispatchId: submissionId,
      id: "space-recovery",
      input: { message: "Recover this submission." },
      kind: "dispatch" as const,
      submissionId,
    };
    const runningSubmission: AgentSubmission = {
      acceptedAt: Date.parse(input.acceptedAt),
      attemptCount: 1,
      attemptId,
      canonicalReadyAt: Date.parse(input.acceptedAt),
      input,
      inputAppliedAt: Date.parse(input.acceptedAt),
      kind: "dispatch",
      leaseExpiresAt: 0,
      maxRetry: 10,
      ownerId: durableObjectId,
      sequence: 1,
      sessionKey: "agent:space-recovery:default:default",
      startedAt: Date.parse(input.acceptedAt),
      status: "running",
      submissionId,
      timeoutAt: Date.parse("2026-08-02T00:00:00.000Z"),
    };

    let unsettled = true;
    let claimed = false;
    let runFiberCalls = 0;
    let completeSubmissionCalls = 0;
    let releaseOldFiber: (() => void) | undefined;
    const oldFiber = new Promise<void>((resolve) => {
      releaseOldFiber = resolve;
    });
    const submissions = {
      claimSubmission: () => {
        claimed = true;
        return Promise.resolve(runningSubmission);
      },
      completeSubmission: () => {
        completeSubmissionCalls += 1;
        unsettled = false;
        return Promise.resolve(true);
      },
      deleteAttemptMarker: () => Promise.resolve(),
      hasUnsettledSubmissions: () => Promise.resolve(unsettled),
      insertAttemptMarker: () => Promise.resolve(),
      listAttemptMarkers: () => Promise.resolve([]),
      listPendingSubmissionSettlements: () => Promise.resolve([]),
      listRunnableSubmissions: () =>
        Promise.resolve(
          claimed
            ? []
            : [
                {
                  ...runningSubmission,
                  attemptId: undefined,
                  status: "queued" as const,
                },
              ]
        ),
      listRunningSubmissions: () =>
        Promise.resolve(claimed ? [runningSubmission] : []),
      listUnreadySubmissions: () => Promise.resolve([]),
      requestSubmissionRecovery: () => Promise.resolve(true),
    };
    const prepared = {
      agentName: "center-agent",
      attachmentStore: new InMemoryAttachmentStore(),
      conversationStreamStore: new InMemoryConversationStreamStore(),
      executionStore: { submissions } as unknown as AgentExecutionStore,
    };
    const recoveredSession = {
      inspectSubmissionInput: async () => "completed" as const,
      reconstructSubmissionResult: async () => ({ text: "Recovered." }),
    };
    const runtime = createCloudflareAgentRuntime({
      agents: [{ definition: {} as never, name: "center-agent" }],
      createContext: () =>
        ({
          initializeRootHarness: async () => ({
            session: async () => recoveredSession,
          }),
        }) as unknown as FlueContextInternal,
      runWithInstanceContext: (_instance, _agentName, callback) => callback(),
    });
    const createInstance = () => ({
      __unsafe_ensureInitialized: () => Promise.resolve(),
      ctx: {
        id: { toString: () => durableObjectId },
        storage: {},
      },
      env: {},
      name: "space-recovery",
      runFiber: async () => {
        runFiberCalls += 1;
        await oldFiber;
      },
      schedule: () => Promise.resolve(),
    });
    const interruptedInstance = createInstance();
    const recoveredInstance = createInstance();

    runtime.attach(interruptedInstance, prepared);
    const interruptedWake = runtime.wakeSubmissions(interruptedInstance);

    try {
      await vi.waitFor(() => expect(runFiberCalls).toBe(1));

      runtime.attach(recoveredInstance, prepared);
      await runtime.onFiberRecovered(
        recoveredInstance,
        {
          name: "flue:submission-attempt",
          snapshot: { attemptId, submissionId },
        },
        () => Promise.resolve()
      );
      await runtime.wakeSubmissions(recoveredInstance);

      expect(completeSubmissionCalls).toBe(1);
    } finally {
      releaseOldFiber?.();
      await interruptedWake;
    }
  });

  it("recovers uncertain durable work without replaying the initial model turn or recorded external action", async () => {
    const agentName = "uncertain-recovery-agent";
    const instanceName = "space-uncertain-recovery";
    const submissionId = "submission-uncertain-recovery";
    const providerId = "uncertain-recovery-provider";
    const modelId = "uncertain-recovery-model";
    const completedActionName = "record_external_action";
    const interruptedActionName = "observe_after_external_action";
    let completedActionCalls = 0;
    let interruptedActionCalls = 0;
    let releaseInterruptedAction: (() => void) | undefined;
    const interruptedAction = new Promise<{ observed: true }>((resolve) => {
      releaseInterruptedAction = () => resolve({ observed: true });
    });
    const tools = [
      defineTool({
        description: "Record one externally visible action.",
        input: object({}),
        name: completedActionName,
        run: () => {
          completedActionCalls += 1;
          return { recorded: true };
        },
      }),
      defineTool({
        description: "Observe state after the external action.",
        input: object({}),
        name: interruptedActionName,
        run: async () => {
          interruptedActionCalls += 1;
          return await interruptedAction;
        },
      }),
    ];
    const faux = registerFauxProvider({
      api: "uncertain-recovery-faux",
      models: [{ contextWindow: 32_000, id: modelId, maxTokens: 1024 }],
      provider: providerId,
    });
    registerProvider(providerId, {
      api: faux.api as never,
      baseUrl: "https://uncertain-recovery.invalid",
      contextWindow: 32_000,
      maxTokens: 1024,
      models: { [modelId]: { contextWindow: 32_000, maxTokens: 1024 } },
    });
    const initialModelTurn = vi.fn(() =>
      fauxAssistantMessage(
        [
          fauxToolCall(completedActionName, {}, { id: "call-recorded" }),
          fauxToolCall(interruptedActionName, {}, { id: "call-interrupted" }),
        ],
        { stopReason: "toolUse" }
      )
    );
    const continuationModelTurn = vi.fn((_context: Context) => {
      return fauxAssistantMessage(
        "Recovered from durable action evidence without repeating the action."
      );
    });
    faux.setResponses([initialModelTurn, continuationModelTurn]);

    const persistence = sqlite();
    let interruptedWake: Promise<void> | undefined;
    try {
      await persistence.migrate?.();
      const stores = await persistence.connect();
      const sessionEnv = createUncertainRecoverySessionEnv();
      const agent = defineAgent(() => ({
        instructions:
          "Record the external action, observe it, then report completion.",
        model: `${providerId}/${modelId}`,
        sandbox: { createSessionEnv: async () => sessionEnv },
        skipLocalContextDiscovery: true,
        tools,
      }));
      const runtime = createCloudflareAgentRuntime({
        agents: [{ definition: agent, name: agentName }],
        createContext: ({ agentName: targetAgentName, instance, request }) =>
          createFlueContext({
            agentConfig: { resolveModel },
            agentName: targetAgentName,
            createDefaultEnv: async () => sessionEnv,
            env: {},
            id: instance.name,
            req: request,
          }),
        runWithInstanceContext: (_instance, _agentName, callback) => callback(),
      });
      const createInstance = () => ({
        __unsafe_ensureInitialized: () => Promise.resolve(),
        ctx: {
          id: { toString: () => "durable-object-uncertain-recovery" },
          storage: {},
        },
        env: {},
        name: instanceName,
        runFiber: async (
          _name: string,
          callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
        ) => await callback({ stash: () => undefined }),
        schedule: () => Promise.resolve(),
      });
      const prepared = {
        agentName,
        attachmentStore: stores.attachmentStore,
        conversationStreamStore: stores.conversationStreamStore,
        executionStore: stores.executionStore,
      };
      const interruptedInstance = createInstance();
      runtime.attach(interruptedInstance, prepared);
      const admission = await runtime.onRequest(
        interruptedInstance,
        new Request("https://flue.invalid/__flue/internal/dispatch", {
          body: JSON.stringify({
            acceptedAt: "2026-08-26T03:24:37.710Z",
            agent: agentName,
            dispatchId: submissionId,
            id: instanceName,
            input: {
              message:
                "Perform the external action exactly once, then observe it.",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      );
      if (!admission) {
        throw new Error("The Flue dispatch route did not handle admission.");
      }
      expect(admission.status).toBe(200);

      interruptedWake = runtime.wakeSubmissions(interruptedInstance);
      interruptedWake.catch(() => undefined);
      await vi.waitFor(async () => {
        expect(completedActionCalls).toBe(1);
        expect(interruptedActionCalls).toBe(1);
        const stream = await stores.conversationStreamStore.read(
          `agents/${agentName}/${instanceName}`,
          { limit: 100, offset: "-1" }
        );
        expect(
          stream.batches
            .flatMap((batch) => batch.records)
            .filter(
              (record) =>
                record.type === "tool_outcome" &&
                record.toolName === completedActionName
            )
        ).toHaveLength(1);
      });
      expect(faux.state.callCount).toBe(1);
      expect(initialModelTurn).toHaveBeenCalledTimes(1);
      expect(continuationModelTurn).not.toHaveBeenCalled();

      const interruptedSubmission =
        await stores.executionStore.submissions.getSubmission(submissionId);
      expect(interruptedSubmission).toMatchObject({
        inputAppliedAt: expect.any(Number),
        status: "running",
      });
      if (!interruptedSubmission?.attemptId) {
        throw new Error("The interrupted attempt was not durably owned.");
      }
      const preRecoveryStream = await stores.conversationStreamStore.read(
        `agents/${agentName}/${instanceName}`,
        { limit: 100, offset: "-1" }
      );
      await expect(
        classifyPatchedDurableSubmission(
          preRecoveryStream.batches.flatMap((batch) => batch.records),
          submissionId
        )
      ).resolves.toMatchObject({ kind: "tool_use_unresolved" });

      const replacementInstance = createInstance();
      runtime.attach(replacementInstance, prepared);
      await runtime.onFiberRecovered(
        replacementInstance,
        {
          name: "flue:submission-attempt",
          snapshot: {
            attemptId: interruptedSubmission.attemptId,
            submissionId,
          },
        },
        () => Promise.resolve()
      );
      await runtime.wakeSubmissions(replacementInstance);

      await expect(
        stores.executionStore.submissions.getSubmission(submissionId)
      ).resolves.toMatchObject({ status: "settled" });
      expect(completedActionCalls).toBe(1);
      expect(interruptedActionCalls).toBe(1);
      expect(faux.state.callCount).toBe(2);
      expect(initialModelTurn).toHaveBeenCalledTimes(1);
      expect(continuationModelTurn).toHaveBeenCalledTimes(1);
      const continuationContext = continuationModelTurn.mock.calls[0]?.[0];
      expect(
        continuationContext?.messages.filter(
          (message) => message.role === "toolResult"
        )
      ).toHaveLength(2);
      expect(
        continuationContext?.messages.filter(
          (message) =>
            message.role === "toolResult" &&
            message.toolCallId === "call-recorded"
        )
      ).toHaveLength(1);
      expect(
        continuationContext?.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.content.some(
              (content) =>
                content.type === "toolCall" && content.id === "call-recorded"
            )
        )
      ).toBe(true);
      const recoveredStream = await stores.conversationStreamStore.read(
        `agents/${agentName}/${instanceName}`,
        { limit: 100, offset: "-1" }
      );
      expect(
        recoveredStream.batches
          .flatMap((batch) => batch.records)
          .filter(
            (record) =>
              record.type === "tool_outcome" &&
              record.toolName === completedActionName
          )
      ).toHaveLength(1);
    } finally {
      releaseInterruptedAction?.();
      await interruptedWake?.catch(() => undefined);
      await persistence.close?.();
      faux.unregister();
      resetProviderRuntime();
    }
  });

  it("lets a replacement instance reclaim a failed attempt before input is applied", async () => {
    const submissionId = "submission-reclaimed-before-input-application";
    const durableObjectId = "durable-object-center-agent-pre-input-recovery";
    const input = {
      acceptedAt: "2026-08-26T03:24:37.710Z",
      agent: "center-agent",
      dispatchId: submissionId,
      id: "space-pre-input-recovery",
      input: { message: "Read the current OpenMeld Tasks." },
      kind: "dispatch" as const,
      submissionId,
    };
    const createQueuedSubmission = (maxRetry = 10): AgentSubmission => ({
      acceptedAt: Date.parse(input.acceptedAt),
      attemptCount: 0,
      canonicalReadyAt: Date.parse(input.acceptedAt),
      input,
      kind: "dispatch",
      leaseExpiresAt: 0,
      maxRetry,
      sequence: 1,
      sessionKey: "agent:space-pre-input-recovery:default:default",
      status: "queued",
      submissionId,
      timeoutAt: 0,
    });
    let submission = createQueuedSubmission();
    const completeSubmission = vi.fn((attempt: SubmissionAttemptRef) => {
      if (!ownsRunningAttempt(submission, attempt)) {
        return Promise.resolve(false);
      }
      submission = {
        ...submission,
        leaseExpiresAt: 0,
        status: "settled",
      };
      return Promise.resolve(true);
    });
    const failSubmission = vi.fn(
      (attempt: SubmissionAttemptRef, error: unknown) => {
        if (!ownsRunningAttempt(submission, attempt)) {
          return Promise.resolve(false);
        }
        submission = {
          ...submission,
          error: error instanceof Error ? error.message : String(error),
          leaseExpiresAt: 0,
          status: "settled",
        };
        return Promise.resolve(true);
      }
    );
    const requeueSubmissionBeforeInputApplied = vi.fn(
      (attempt: SubmissionAttemptRef) => {
        if (
          !ownsRunningAttempt(submission, attempt) ||
          submission.inputAppliedAt !== undefined
        ) {
          return Promise.resolve(false);
        }
        submission = {
          ...submission,
          attemptId: undefined,
          leaseExpiresAt: 0,
          ownerId: undefined,
          recoveryRequestedAt: undefined,
          startedAt: undefined,
          status: "queued",
        };
        return Promise.resolve(true);
      }
    );
    const submissions = {
      claimSubmission: (
        claim: Parameters<AgentSubmissionStore["claimSubmission"]>[0]
      ) => {
        if (
          submission.status !== "queued" ||
          submission.submissionId !== claim.submissionId
        ) {
          return Promise.resolve(null);
        }
        submission = {
          ...submission,
          attemptCount: submission.attemptCount + 1,
          attemptId: claim.attemptId,
          leaseExpiresAt: claim.leaseExpiresAt,
          ownerId: claim.ownerId,
          startedAt: Date.now(),
          status: "running",
        };
        return Promise.resolve(submission);
      },
      completeSubmission,
      deleteAttemptMarker: () => Promise.resolve(),
      failSubmission,
      getSubmission: (requestedSubmissionId: string) =>
        Promise.resolve(
          requestedSubmissionId === submission.submissionId ? submission : null
        ),
      hasUnsettledSubmissions: () =>
        Promise.resolve(submission.status !== "settled"),
      insertAttemptMarker: () => Promise.resolve(),
      listAttemptMarkers: () => Promise.resolve([]),
      listPendingSubmissionSettlements: () => Promise.resolve([]),
      listRunnableSubmissions: () =>
        Promise.resolve(submission.status === "queued" ? [submission] : []),
      listRunningSubmissions: () =>
        Promise.resolve(submission.status === "running" ? [submission] : []),
      listUnreadySubmissions: () => Promise.resolve([]),
      markSubmissionInputApplied: (
        attempt: SubmissionAttemptRef,
        durability?: SubmissionDurability
      ) => {
        if (!ownsRunningAttempt(submission, attempt)) {
          return Promise.resolve(false);
        }
        submission = {
          ...submission,
          inputAppliedAt: Date.now(),
          maxRetry: durability?.maxRetry ?? submission.maxRetry,
          timeoutAt: durability?.timeoutAt ?? submission.timeoutAt,
        };
        return Promise.resolve(true);
      },
      requeueSubmissionBeforeInputApplied,
    };
    const prepared = {
      agentName: "center-agent",
      attachmentStore: new InMemoryAttachmentStore(),
      conversationStreamStore: new InMemoryConversationStreamStore(),
      executionStore: { submissions } as unknown as AgentExecutionStore,
    };
    let processInputCalls = 0;
    let modelExecutionCalls = 0;
    const processBehaviors: Array<
      "fail_after_input" | "fail_before_input" | "succeed"
    > = ["fail_before_input", "succeed"];
    const runtime = createCloudflareAgentRuntime({
      agents: [{ definition: {} as never, name: "center-agent" }],
      createContext: () =>
        ({
          initializeRootHarness: async () => ({
            session: async () => ({
              processSubmissionInput: (
                _submissionInput: unknown,
                options: {
                  onInputApplied?: (
                    durability?: SubmissionDurability
                  ) => Promise<void>;
                }
              ) => {
                processInputCalls += 1;
                const behavior = processBehaviors.shift();
                let result: Promise<{ text: string }>;
                if (behavior === "fail_before_input") {
                  result = Promise.reject(
                    new Error(
                      "Connection closed before this instance applied the input."
                    )
                  );
                } else {
                  result = (async () => {
                    await options.onInputApplied?.({
                      maxRetry: 10,
                      timeoutAt: 0,
                    });
                    modelExecutionCalls += 1;
                    if (behavior === "fail_after_input") {
                      throw new Error(
                        "Execution failed after input application."
                      );
                    }
                    return { text: "Recovered exactly once." };
                  })();
                }
                result.catch(() => undefined);
                return Object.assign(result, { abort: vi.fn() });
              },
            }),
          }),
        }) as unknown as FlueContextInternal,
      runWithInstanceContext: (_instance, _agentName, callback) => callback(),
    });
    const createInstance = () => ({
      __unsafe_ensureInitialized: () => Promise.resolve(),
      ctx: {
        id: { toString: () => durableObjectId },
        storage: {},
      },
      env: {},
      name: "space-pre-input-recovery",
      runFiber: async (
        _name: string,
        callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
      ) => await callback({ stash: () => undefined }),
      schedule: () => Promise.resolve(),
    });

    const interruptedInstance = createInstance();
    runtime.attach(interruptedInstance, prepared);
    await runtime.wakeSubmissions(interruptedInstance);

    expect(requeueSubmissionBeforeInputApplied).toHaveBeenCalledOnce();
    expect(submission.status).toBe("queued");
    expect(submission.inputAppliedAt).toBeUndefined();
    expect(failSubmission).not.toHaveBeenCalled();
    expect(modelExecutionCalls).toBe(0);

    const replacementInstance = createInstance();
    runtime.attach(replacementInstance, prepared);
    await runtime.wakeSubmissions(replacementInstance);

    expect(processInputCalls).toBe(2);
    expect(modelExecutionCalls).toBe(1);
    expect(completeSubmission).toHaveBeenCalledOnce();
    expect(failSubmission).not.toHaveBeenCalled();
    expect(submission.status).toBe("settled");

    submission = createQueuedSubmission(1);
    processBehaviors.push("fail_before_input");
    const exhaustedInstance = createInstance();
    runtime.attach(exhaustedInstance, prepared);
    await runtime.wakeSubmissions(exhaustedInstance);

    expect(requeueSubmissionBeforeInputApplied).toHaveBeenCalledOnce();
    expect(failSubmission).toHaveBeenCalledOnce();
    expect(modelExecutionCalls).toBe(1);
    expect(submission.status).toBe("settled");

    submission = createQueuedSubmission();
    processBehaviors.push("fail_after_input");
    const postInputFailureInstance = createInstance();
    runtime.attach(postInputFailureInstance, prepared);
    await runtime.wakeSubmissions(postInputFailureInstance);

    expect(requeueSubmissionBeforeInputApplied).toHaveBeenCalledTimes(2);
    expect(failSubmission).toHaveBeenCalledTimes(2);
    expect(modelExecutionCalls).toBe(2);
    expect(submission.status).toBe("settled");
  });

  it("keeps model reconciliation out of Durable Object startup", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const startupStart = source.indexOf("onStart(inherited)", coordinatorStart);
    const startupEnd = source.indexOf("wakeSubmissions()", startupStart);
    const recoveryStart = source.indexOf(
      "onFiberRecovered(ctx, inherited)",
      coordinatorStart
    );
    const recoveryEnd = source.indexOf("get agentName()", recoveryStart);

    expect(startupStart).toBeGreaterThanOrEqual(0);
    expect(startupEnd).toBeGreaterThan(startupStart);
    expect(recoveryStart).toBeGreaterThanOrEqual(0);
    expect(recoveryEnd).toBeGreaterThan(recoveryStart);

    const startupMethod = source.slice(startupStart, startupEnd);
    const recoveryMethod = source.slice(recoveryStart, recoveryEnd);

    expect(startupMethod).toContain("await this.restoreSubmissionWake()");
    expect(startupMethod).not.toContain("reconcileSubmissions");
    expect(recoveryMethod).toContain("await this.restoreSubmissionWake()");
    expect(recoveryMethod).toContain(
      "await this.submissions.requestSubmissionRecovery"
    );
    expect(recoveryMethod).not.toContain("reconcileSubmissions");
  });

  it("returns durable admission without waiting for the model fiber", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const admissionStart = source.indexOf("async admitDispatch(request)");
    const admissionEnd = source.indexOf(
      "function submissionAttemptMarkerKey",
      admissionStart
    );

    expect(admissionStart).toBeGreaterThanOrEqual(0);
    expect(admissionEnd).toBeGreaterThan(admissionStart);

    const admissionMethod = source.slice(admissionStart, admissionEnd);
    const deferredWakeCalls = admissionMethod.match(
      /await this\.armSubmissionWake\(\{ delaySeconds: 1, idempotent: false \}\);/g
    );

    expect(deferredWakeCalls).toHaveLength(2);
    expect(admissionMethod).not.toContain("delaySeconds: 0");
    expect(admissionMethod).not.toContain("reconcileSubmissions");
    expect(admissionMethod).not.toContain("materializeSubmissionConversation");
    expect(admissionMethod).not.toContain("markSubmissionCanonicalReady");
  });

  it("reduces durable conversation history once per read page", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const conversationModule = (await readdir(distDirectory)).find(
      (entry) => entry.startsWith("flue-app-") && entry.endsWith(".mjs")
    );

    if (!conversationModule) {
      throw new Error("Could not find Flue's conversation runtime module.");
    }

    const source = await readFile(
      join(distDirectory, conversationModule),
      "utf8"
    );
    const loaderStart = source.indexOf(
      "async function loadReducedConversationState(options)"
    );
    const loaderEnd = source.indexOf(
      "async function loadReducedConversationPrefix(options)",
      loaderStart
    );

    expect(loaderStart).toBeGreaterThanOrEqual(0);
    expect(loaderEnd).toBeGreaterThan(loaderStart);

    const loader = source.slice(loaderStart, loaderEnd);

    expect(loader).toContain(
      "const records = read.batches.flatMap((batch) => batch.records)"
    );
    expect(loader).toContain(
      "state = reduceConversationRecords(state, records, read.nextOffset)"
    );
    expect(loader).not.toContain("for (const batch of read.batches)");
  });

  it("logs the exact canonical record that makes conversation replay fail", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const conversationModule = (await readdir(distDirectory)).find(
      (entry) =>
        entry.startsWith("conversation-projections-") && entry.endsWith(".mjs")
    );

    if (!conversationModule) {
      throw new Error("Could not find Flue's conversation projections module.");
    }

    const source = await readFile(
      join(distDirectory, conversationModule),
      "utf8"
    );
    const failStart = source.indexOf("function fail(record, reason)");
    const failEnd = source.indexOf("//#endregion", failStart);

    expect(failStart).toBeGreaterThanOrEqual(0);
    expect(failEnd).toBeGreaterThan(failStart);
    expect(source.slice(failStart, failEnd)).toContain(
      'console.error("[flue:conversation-record-invalid]", error.meta)'
    );
  });

  it("materializes queued conversation state from the scheduled wake", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const wakeStart = source.indexOf("wakeSubmissions()", coordinatorStart);
    const wakeEnd = source.indexOf("onRequest(request)", wakeStart);
    const reconcileStart = source.indexOf(
      "async reconcileSubmissions(",
      coordinatorStart
    );
    const reconcileEnd = source.indexOf(
      "logSubmissionReconciliationFailure(",
      reconcileStart
    );

    expect(wakeStart).toBeGreaterThanOrEqual(0);
    expect(wakeEnd).toBeGreaterThan(wakeStart);
    expect(reconcileStart).toBeGreaterThan(wakeEnd);
    expect(reconcileEnd).toBeGreaterThan(reconcileStart);

    const wakeMethod = source.slice(wakeStart, wakeEnd);
    const reconcileMethod = source.slice(reconcileStart, reconcileEnd);

    expect(wakeMethod).toContain("await this.reconcileSubmissions({");
    expect(wakeMethod).toContain("driverAlreadyArmed: true");
    expect(wakeMethod).toContain("awaitAttempts: true");
    expect(reconcileMethod).toContain(
      "this.submissions.listUnreadySubmissions()"
    );
    expect(reconcileMethod).toContain(
      "await this.materializeSubmissionConversation(submission.input, agent)"
    );
    expect(reconcileMethod).toContain(
      "await this.submissions.markSubmissionCanonicalReady"
    );
  });

  it("materializes only the unsettled head of each session", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const submissionStoreModule = (await readdir(distDirectory)).find(
      (entry) => entry.startsWith("sql-run-store-") && entry.endsWith(".mjs")
    );

    if (!submissionStoreModule) {
      throw new Error("Could not find Flue's submission store module.");
    }

    const source = await readFile(
      join(distDirectory, submissionStoreModule),
      "utf8"
    );
    const unreadyStart = source.indexOf("async listUnreadySubmissions()");
    const unreadyEnd = source.indexOf(
      "async listRunnableSubmissions()",
      unreadyStart
    );

    expect(unreadyStart).toBeGreaterThanOrEqual(0);
    expect(unreadyEnd).toBeGreaterThan(unreadyStart);

    const unreadyMethod = source.slice(unreadyStart, unreadyEnd);

    expect(unreadyMethod).toContain("FROM flue_agent_submissions AS current");
    expect(unreadyMethod).toContain("AND NOT EXISTS (");
    expect(unreadyMethod).toContain(
      "WHERE earlier.session_key = current.session_key"
    );
    expect(unreadyMethod).toContain(
      "AND earlier.status IN ('queued', 'running', 'terminalizing')"
    );
    expect(unreadyMethod).toContain("AND earlier.sequence < current.sequence");
  });

  it("distinguishes a later canonical dispatch from same-turn continuation signals", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const projectionsModule = (await readdir(distDirectory)).find(
      (entry) =>
        entry.startsWith("conversation-projections-") && entry.endsWith(".mjs")
    );

    if (!projectionsModule) {
      throw new Error("Could not find Flue's conversation projections module.");
    }

    const runtime = (await import(
      pathToFileURL(join(distDirectory, projectionsModule)).href
    )) as {
      n: (
        conversation: {
          activeLeafId: string;
          entries: Map<string, unknown>;
          inProgressMessages: Map<string, unknown>;
        },
        inputEntryId: string,
        options: { contextWindow: number }
      ) => { kind: string };
    };
    const interruptedInputId = "entry_dispatch_r";
    const laterInputId = "entry_dispatch_v";
    const laterAssistantId = "entry_assistant_v";
    const entries = new Map<string, unknown>([
      [
        interruptedInputId,
        {
          id: interruptedInputId,
          message: {
            attributes: {},
            content: "Reply with R.",
            role: "signal",
            tagName: "dispatch",
            timestamp: 1,
            type: "dispatch_input",
          },
          parentId: null,
          timestamp: 1,
          type: "message",
        },
      ],
      [
        laterInputId,
        {
          id: laterInputId,
          message: {
            attributes: {},
            content: "Reply with V.",
            role: "signal",
            tagName: "dispatch",
            timestamp: 2,
            type: "dispatch_input",
          },
          parentId: interruptedInputId,
          timestamp: 2,
          type: "message",
        },
      ],
      [
        laterAssistantId,
        {
          id: laterAssistantId,
          message: {
            content: [{ text: "Acknowledged V", type: "text" }],
            role: "assistant",
            stopReason: "stop",
            timestamp: 3,
          },
          parentId: laterInputId,
          timestamp: 3,
          type: "message",
        },
      ],
    ]);

    expect(
      runtime.n(
        {
          activeLeafId: laterAssistantId,
          entries,
          inProgressMessages: new Map(),
        },
        interruptedInputId,
        { contextWindow: 0 }
      )
    ).toEqual({ kind: "advanced_past_input" });

    const interruptedAssistantId = "entry_assistant_interrupted";
    const continuationSignalId = "entry_stream_continued";
    const continuationEntries = new Map<string, unknown>([
      [
        interruptedInputId,
        {
          id: interruptedInputId,
          message: {
            attributes: {},
            content: "Reply with R.",
            role: "signal",
            tagName: "dispatch",
            timestamp: 1,
            type: "dispatch_input",
          },
          parentId: null,
          timestamp: 1,
          type: "message",
        },
      ],
      [
        interruptedAssistantId,
        {
          id: interruptedAssistantId,
          message: {
            content: [],
            role: "assistant",
            stopReason: "aborted",
            timestamp: 2,
          },
          parentId: interruptedInputId,
          timestamp: 2,
          type: "message",
        },
      ],
      [
        continuationSignalId,
        {
          id: continuationSignalId,
          message: {
            attributes: {},
            content: "",
            role: "signal",
            tagName: "stream",
            timestamp: 3,
            type: "stream_continued",
          },
          parentId: interruptedAssistantId,
          timestamp: 3,
          type: "message",
        },
      ],
    ]);

    expect(
      runtime.n(
        {
          activeLeafId: continuationSignalId,
          entries: continuationEntries,
          inProgressMessages: new Map(),
        },
        interruptedInputId,
        { contextWindow: 0 }
      )
    ).toMatchObject({
      kind: "resume",
      mode: "stream_continuation",
    });
  });

  it("keeps same-session work durable across submission settlement", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const distDirectory = join(dirname(runtimePackageJson), "dist");
    const coordinatorSource = await readFile(
      join(distDirectory, "internal.mjs"),
      "utf8"
    );
    const conversationModule = (await readdir(distDirectory)).find(
      (entry) =>
        entry.startsWith("conversation-stream-store-") && entry.endsWith(".mjs")
    );

    if (!conversationModule) {
      throw new Error("Could not find Flue's conversation store module.");
    }

    const conversationSource = await readFile(
      join(distDirectory, conversationModule),
      "utf8"
    );
    const processStart = conversationSource.indexOf(
      "async function processSubmission(opts)"
    );
    const processEnd = conversationSource.indexOf(
      "async function failInterruptedSubmission",
      processStart
    );
    const coordinatorStart = coordinatorSource.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const entryStart = coordinatorSource.indexOf(
      "async processSubmissionEntry(submission, signal)",
      coordinatorStart
    );
    const entryEnd = coordinatorSource.indexOf(
      "async admitAttachedSubmission",
      entryStart
    );

    expect(processStart).toBeGreaterThanOrEqual(0);
    expect(processEnd).toBeGreaterThan(processStart);
    expect(entryStart).toBeGreaterThanOrEqual(0);
    expect(entryEnd).toBeGreaterThan(entryStart);

    const processMethod = conversationSource.slice(processStart, processEnd);
    const entryMethod = coordinatorSource.slice(entryStart, entryEnd);

    expect(processMethod).toContain("await opts.onSettled?.()");
    expect(entryMethod).toContain("onSettled: () =>");
    expect(entryMethod).toContain(
      "return this.armSubmissionWake({ delaySeconds: 1, idempotent: false }).catch"
    );
  });

  it("releases settled attempts from the fiber callback", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const attemptStart = source.indexOf(
      "async startSubmissionAttempt(submission, options = {})",
      coordinatorStart
    );
    const attemptEnd = source.indexOf("async abortInstance()", attemptStart);

    expect(attemptStart).toBeGreaterThanOrEqual(0);
    expect(attemptEnd).toBeGreaterThan(attemptStart);

    const attemptMethod = source.slice(attemptStart, attemptEnd);
    const fiberStart = attemptMethod.indexOf("this.instance.runFiber(");
    const outerPromiseHandlersStart = attemptMethod.indexOf("running.catch(");

    expect(fiberStart).toBeGreaterThanOrEqual(0);
    expect(outerPromiseHandlersStart).toBeGreaterThan(fiberStart);

    const fiberCallback = attemptMethod.slice(
      fiberStart,
      outerPromiseHandlersStart
    );

    expect(fiberCallback).toContain("finally {");
    expect(fiberCallback).toContain(
      "await this.releaseSubmissionAttempt(attemptKey, submission.submissionId, attempt)"
    );
    expect(attemptMethod).toContain(
      "async releaseSubmissionAttempt(attemptKey, submissionId, attempt)"
    );
  });

  it("keeps scheduled submission fibers inside the alarm invocation", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const source = await readFile(
      join(dirname(runtimePackageJson), "dist", "internal.mjs"),
      "utf8"
    );
    const coordinatorStart = source.indexOf(
      "var CloudflareAgentCoordinator = class"
    );
    const attemptStart = source.indexOf(
      "async startSubmissionAttempt(submission, options = {})",
      coordinatorStart
    );
    const attemptEnd = source.indexOf("async abortInstance()", attemptStart);

    expect(attemptStart).toBeGreaterThanOrEqual(0);
    expect(attemptEnd).toBeGreaterThan(attemptStart);

    const attemptMethod = source.slice(attemptStart, attemptEnd);
    const fiberStart = attemptMethod.indexOf(
      "running = this.instance.runFiber("
    );
    const settledPromise = attemptMethod.indexOf(
      "const settled = running.catch(",
      fiberStart
    );
    const awaitedSettlement = attemptMethod.indexOf(
      "if (options.awaitCompletion) await settled",
      settledPromise
    );
    const releaseStart = attemptMethod.indexOf(
      "async releaseSubmissionAttempt(attemptKey, submissionId, attempt)"
    );
    const ownedAttempt = attemptMethod.indexOf(
      "const ownedAttempt = this.activeAttempts.delete(attemptKey)",
      releaseStart
    );
    const durableWake = attemptMethod.indexOf(
      "await this.armSubmissionWake({ delaySeconds: 1, idempotent: false })",
      ownedAttempt
    );

    expect(fiberStart).toBeGreaterThanOrEqual(0);
    expect(settledPromise).toBeGreaterThan(fiberStart);
    expect(awaitedSettlement).toBeGreaterThan(settledPromise);
    expect(releaseStart).toBeGreaterThanOrEqual(0);
    expect(ownedAttempt).toBeGreaterThan(releaseStart);
    expect(attemptMethod).toContain("if (!ownedAttempt) return");
    expect(durableWake).toBeGreaterThan(ownedAttempt);
    expect(attemptMethod).not.toContain("this.instance.ctx.waitUntil(settled)");
    expect(attemptMethod).not.toContain("setTimeout(resolve, 0)");
    expect(attemptMethod).not.toContain("post_fiber_handoff");
    expect(attemptMethod).not.toContain("async continueSubmissionQueue()");
    expect(attemptMethod).not.toContain("}).finally(async () => {");

    const wakeStart = source.indexOf("wakeSubmissions()", coordinatorStart);
    const wakeEnd = source.indexOf("onRequest(request)", wakeStart);
    expect(wakeStart).toBeGreaterThanOrEqual(0);
    expect(wakeEnd).toBeGreaterThan(wakeStart);
    const wakeMethod = source.slice(wakeStart, wakeEnd);
    expect(wakeMethod).toContain("await this.reconcileSubmissions({");
    expect(wakeMethod).toContain("driverAlreadyArmed: true");
    expect(wakeMethod).toContain("awaitAttempts: true");
  });
});

async function createPatchedSqlSubmissionStore(
  database: DatabaseSync,
  hooks: {
    afterRows?: (query: string, rows: Record<string, unknown>[]) => void;
  } = {}
): Promise<AgentSubmissionStore> {
  const runtimePackageJson = findPackageJSON("@flue/runtime", import.meta.url);
  if (!runtimePackageJson) {
    throw new Error("Could not find Flue's runtime package.");
  }
  const distDirectory = join(dirname(runtimePackageJson), "dist");
  const storeModuleName = (await readdir(distDirectory)).find(
    (entry) => entry.startsWith("sql-run-store-") && entry.endsWith(".mjs")
  );
  if (!storeModuleName) {
    throw new Error("Could not find Flue's SQL submission store module.");
  }
  const module = (await import(
    pathToFileURL(join(distDirectory, storeModuleName)).href
  )) as {
    a(sql: ReturnType<typeof createCloudflareSqlHarness>): void;
    i(
      sql: ReturnType<typeof createCloudflareSqlHarness>,
      transaction: <T>(run: () => T) => T
    ): AgentExecutionStore;
  };
  const sql = createCloudflareSqlHarness(database, hooks);
  module.a(sql);
  return module.i(sql, (run) => run()).submissions;
}

async function claimSqlSubmission(input: {
  attemptId: string;
  submissionId: string;
  submissions: AgentSubmissionStore;
}): Promise<SubmissionAttemptRef> {
  await input.submissions.admitDispatch({
    acceptedAt: "2026-08-26T03:24:37.710Z",
    agent: "center-agent",
    dispatchId: input.submissionId,
    id: `space-${input.submissionId}`,
    input: { message: "Read the current OpenMeld Tasks." },
  });
  await input.submissions.markSubmissionCanonicalReady(input.submissionId);
  const claimed = await input.submissions.claimSubmission({
    attemptId: input.attemptId,
    leaseExpiresAt: Date.now() + 60_000,
    ownerId: "durable-object-sql-cas",
    submissionId: input.submissionId,
  });
  if (!claimed?.attemptId) {
    throw new Error("SQL submission was not claimed.");
  }
  return {
    attemptId: claimed.attemptId,
    submissionId: claimed.submissionId,
  };
}

function createCloudflareSqlHarness(
  database: DatabaseSync,
  hooks: {
    afterRows?: (query: string, rows: Record<string, unknown>[]) => void;
  } = {}
) {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = database.prepare(query);
      if (returnsSqlRows(statement, query)) {
        const rows = statement.all(...(bindings as never[])) as Record<
          string,
          unknown
        >[];
        hooks.afterRows?.(query, rows);
        return { rowsWritten: 0, toArray: () => rows };
      }
      const result = statement.run(...(bindings as never[]));
      return {
        rowsWritten: Number(result.changes),
        toArray: () => [] as Record<string, unknown>[],
      };
    },
  };
}

function returnsSqlRows(_statement: StatementSync, query: string): boolean {
  return SQL_ROW_QUERY_PATTERN.test(query);
}

function createExhaustedInterruptedSubmissionFixture(input: {
  abortRequestedAt?: number;
  inspectionState: "absent" | "completed";
}) {
  const submissionId = `submission-exhausted-${input.inspectionState}`;
  const durableObjectId = "durable-object-center-agent-exhausted-recovery";
  const runningSubmission: AgentSubmission = {
    acceptedAt: Date.parse("2026-08-01T00:00:00.000Z"),
    attemptCount: 5,
    attemptId: `attempt-exhausted-${input.inspectionState}`,
    canonicalReadyAt: Date.parse("2026-08-01T00:00:00.000Z"),
    input: {
      acceptedAt: "2026-08-01T00:00:00.000Z",
      agent: "center-agent",
      dispatchId: submissionId,
      id: "space-exhausted-recovery",
      input: { message: "Finish the durable outcome before failing." },
      kind: "dispatch",
      submissionId,
    },
    inputAppliedAt: Date.parse("2026-08-01T00:00:00.100Z"),
    kind: "dispatch",
    leaseExpiresAt: 0,
    maxRetry: 5,
    ownerId: durableObjectId,
    sequence: 1,
    sessionKey: "agent:space-exhausted-recovery:default:default",
    startedAt: Date.parse("2026-08-01T00:00:00.000Z"),
    status: "running",
    submissionId,
    timeoutAt: 0,
    ...(input.abortRequestedAt === undefined
      ? {}
      : { abortRequestedAt: input.abortRequestedAt }),
  };
  let unsettled = true;
  const completeSubmission = vi.fn(() => {
    unsettled = false;
    return Promise.resolve(true);
  });
  const failSubmission = vi.fn(() => {
    unsettled = false;
    return Promise.resolve(true);
  });
  const inspectSubmissionInput = vi.fn(() =>
    Promise.resolve(input.inspectionState)
  );
  const reconstructSubmissionResult = vi.fn(() =>
    Promise.resolve({ text: "Durable result recovered." })
  );
  const recordSubmissionTerminal = vi.fn(() => Promise.resolve());
  const initializeRootHarness = vi.fn(() =>
    Promise.resolve({
      session: () =>
        Promise.resolve({
          inspectSubmissionInput,
          reconstructSubmissionResult,
          recordSubmissionTerminal,
        }),
    })
  );
  const submissions = {
    completeSubmission,
    deleteAttemptMarker: () => Promise.resolve(),
    failSubmission,
    getSubmission: () => Promise.resolve(runningSubmission),
    hasUnsettledSubmissions: () => Promise.resolve(unsettled),
    listAttemptMarkers: () => Promise.resolve([]),
    listPendingSubmissionSettlements: () => Promise.resolve([]),
    listRunnableSubmissions: () => Promise.resolve([]),
    listRunningSubmissions: () =>
      Promise.resolve(unsettled ? [runningSubmission] : []),
    listUnreadySubmissions: () => Promise.resolve([]),
  };
  const runtime = createCloudflareAgentRuntime({
    agents: [{ definition: {} as never, name: "center-agent" }],
    createContext: () =>
      ({ initializeRootHarness }) as unknown as FlueContextInternal,
    runWithInstanceContext: (_instance, _agentName, callback) => callback(),
  });
  const instance = {
    __unsafe_ensureInitialized: () => Promise.resolve(),
    ctx: {
      id: { toString: () => durableObjectId },
      storage: {},
    },
    env: {},
    name: "space-exhausted-recovery",
    runFiber: async (
      _name: string,
      callback: (ctx: { stash(snapshot: unknown): void }) => Promise<void>
    ) => await callback({ stash: () => undefined }),
    schedule: () => Promise.resolve(),
  };
  runtime.attach(instance, {
    agentName: "center-agent",
    attachmentStore: new InMemoryAttachmentStore(),
    conversationStreamStore: new InMemoryConversationStreamStore(),
    executionStore: { submissions } as unknown as AgentExecutionStore,
  });
  return {
    completeSubmission,
    failSubmission,
    inspectSubmissionInput,
    instance,
    reconstructSubmissionResult,
    recordSubmissionTerminal,
    runtime,
  };
}

function createUncertainRecoverySessionEnv(): SessionEnv {
  return {
    cwd: "/workspace",
    exec: vi.fn(async () => ({ exitCode: 0, stderr: "", stdout: "" })),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    readFileBuffer: vi.fn(async () => new Uint8Array()),
    readdir: vi.fn(async () => []),
    resolvePath: (path) => (path.startsWith("/") ? path : `/workspace/${path}`),
    rm: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ isDirectory: false, isFile: true })),
    writeFile: vi.fn(async () => undefined),
  };
}

async function classifyPatchedDurableSubmission(
  records: readonly unknown[],
  submissionId: string
): Promise<{ kind: string }> {
  const runtimePackageJson = findPackageJSON("@flue/runtime", import.meta.url);
  if (!runtimePackageJson) {
    throw new Error("Could not find Flue's runtime package.");
  }
  const distDirectory = join(dirname(runtimePackageJson), "dist");
  const projectionModuleName = (await readdir(distDirectory)).find(
    (entry) =>
      entry.startsWith("conversation-projections-") && entry.endsWith(".mjs")
  );
  if (!projectionModuleName) {
    throw new Error("Could not find Flue's conversation projection module.");
  }
  const module = (await import(
    pathToFileURL(join(distDirectory, projectionModuleName)).href
  )) as {
    S(): unknown;
    n(
      conversation: unknown,
      inputEntryId: string,
      options: { contextWindow: number }
    ): { kind: string };
    w(state: unknown, records: readonly unknown[]): unknown;
  };
  const reduced = module.w(module.S(), records) as {
    conversations: Map<string, unknown>;
  };
  const conversation = reduced.conversations.values().next().value;
  if (!conversation) {
    throw new Error("The durable conversation could not be reduced.");
  }
  const encodedSubmissionId = Buffer.from(submissionId).toString("base64url");
  return module.n(conversation, `entry_dispatch_${encodedSubmissionId}`, {
    contextWindow: 32_000,
  });
}
