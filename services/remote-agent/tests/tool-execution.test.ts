import { object } from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { ConnectorActionOutcomeUnknownError } from "../agent-core/connector-tools";
import {
  buildRemoteAgentExecutionIdentity,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
  readRemoteAgentExecutionState,
  readRemoteAgentRequestedExecutionFailure,
} from "../agent-core/execution-state";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  beginRemoteAgentToolAttempt,
  RemoteAgentNoProgressError,
  RemoteAgentToolCallBudgetExceededError,
  RemoteAgentToolProgressStateInvalidError,
} from "../agent-core/tool-progress";
import { isRemoteAgentToolResultWithinLimit } from "../agent-core/tool-result-boundary";
import {
  assertRemoteAgentTurnAllowsToolExecution,
  cleanupExpiredRemoteAgentTurnEndMarkers,
  markRemoteAgentTurnEnded,
  RemoteAgentTurnEndedError,
} from "../agent-core/turn-end";
import {
  executeRemoteAgentToolDefinition,
  toBoundedRemoteAgentToolResult,
} from "../flue-adapter/tool-execution";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SUBMISSION_ID = "submission-turn-end";

describe("Remote Agent tool execution", () => {
  it.each([
    {
      source: "direct",
      window: "unverified",
      replay: { allowed: false, reason: "window_unverified" },
    },
    {
      source: "code_mode",
      window: "unverified",
      replay: { allowed: false, reason: "window_unverified" },
    },
    {
      source: "direct",
      window: "active",
      replay: {
        allowed: true,
        maxAttempts: 1,
        remainingWindowMs: expect.any(Number),
      },
    },
    {
      source: "code_mode",
      window: "active",
      replay: {
        allowed: true,
        maxAttempts: 1,
        remainingWindowMs: expect.any(Number),
      },
    },
    {
      source: "direct",
      window: "expired",
      replay: { allowed: false, reason: "window_expired" },
    },
    {
      source: "code_mode",
      window: "replayed",
      replay: { allowed: false, reason: "already_replayed" },
    },
  ] as const)("preserves $window replay permission through $source without exposing provider details", async ({
    source,
    window,
    replay,
  }) => {
    const { storage } = await createToolExecutionTestContext();
    const result = await executeRemoteAgentToolDefinition({
      source,
      storage,
      submissionId: SUBMISSION_ID,
      toolInput: {},
      definition: {
        description: "Attempt an authorized comment.",
        name: "github_create_issue_comment",
        input: object({}),
        execute: () =>
          Promise.reject(
            new ConnectorActionOutcomeUnknownError({
              actionId: "github.create_issue_comment",
              operationId: "comment-1",
              cause: new Error("synthetic-private-provider-detail"),
              operationReplayExpiresAtMs:
                window === "unverified"
                  ? undefined
                  : performance.now() + (window === "expired" ? -1 : 60_000),
              operationReplayed: window === "replayed",
              replay:
                window === "active" || window === "expired"
                  ? { allowed: true, remainingWindowMs: 60_000, maxAttempts: 1 }
                  : undefined,
            })
          ),
      },
    });
    expect(result).toMatchObject({
      status: "outcome_unknown",
      operationId: "comment-1",
      executionConfirmation: "unknown",
      replay,
    });
    const text = JSON.stringify(result);
    expect(text).toContain("write may already have succeeded");
    expect(text).toContain(
      window === "active"
        ? "You may retry exactly once"
        : "Do not retry this write"
    );
    expect(text).toContain("Never repeat the write with a new operationId");
    expect(text).toContain("Original operationId: comment-1");
    expect(text).not.toContain("synthetic-private-provider-detail");
  });
  it.each([
    "A",
    "中文",
    "😀",
    '"\\\n\t',
  ])("returns honest bounded evidence for oversized %j results without inventing a continuation", (text) => {
    const value = {
      data: { content: text.repeat(200_000), truncated: true },
      operationId: "write-1",
      status: "completed",
    };
    const result = toBoundedRemoteAgentToolResult({
      toolName: "example_write",
      value,
    });

    expect(result).toMatchObject({
      toolName: "example_write",
      toolExecution: "returned",
      resultMetadata: { operationId: "write-1", status: "completed" },
      presentation: {
        kind: "partial",
        reasonCode: "remote_agent.tool_result_too_large",
        continuation: null,
        originalJsonBytes: new TextEncoder().encode(JSON.stringify(value))
          .byteLength,
      },
    });
    const preview = (
      result as { resultPreview: { prefix: string; suffix: string } }
    ).resultPreview;
    expect(preview.prefix).toContain('{"data":{"content":');
    expect(preview.suffix).toContain('"truncated":true');
    expect(preview.prefix.isWellFormed()).toBe(true);
    expect(preview.suffix.isWellFormed()).toBe(true);
    expect(isRemoteAgentToolResultWithinLimit(result)).toBe(true);
    expect(
      isRemoteAgentToolResultWithinLimit({ output: JSON.stringify(result) })
    ).toBe(true);
    expect(JSON.stringify(result)).toContain("Do not repeat a write");
  });

  it.each([
    "completed",
    "failed",
  ] as const)("preserves a %s receipt even when preceding metadata consumes the budget", (status) => {
    const receipt = {
      operationId: "write-receipt-in-the-middle",
      providerExecutionId: "provider-receipt-in-the-middle",
      status,
      success: status === "completed",
      replayed: false,
    };
    const result = toBoundedRemoteAgentToolResult({
      toolName: "example_action",
      value: {
        metadata: "m".repeat(7980),
        ...receipt,
        detail: "x".repeat(200_000),
      },
    });
    expect(result).toMatchObject({
      toolExecution: "returned",
      resultMetadata: receipt,
      presentation: { kind: "partial" },
    });
    const preview = (result as { resultPreview: unknown }).resultPreview;
    expect(JSON.stringify(preview)).not.toContain(receipt.operationId);
    expect(JSON.stringify(preview)).not.toContain(receipt.providerExecutionId);
    expect(isRemoteAgentToolResultWithinLimit(result)).toBe(true);
  });

  it("preserves every semantic field in a bounded structured result", () => {
    const result = {
      attribution: { via: "github:amplifthq/kairos" },
      continuation: { nextOffsetUtf16: 2048 },
      data: { content: "bounded" },
      navigationAction: {
        type: "open_space",
        spaceId: "space_123",
      },
    };

    expect(
      toBoundedRemoteAgentToolResult({
        toolName: "bounded_structured_read",
        value: result,
      })
    ).toEqual(result);
  });

  it("blocks one unchanged observation after three identical results but allows a different probe", async () => {
    const { storage } = await createToolExecutionTestContext();
    const execute = vi.fn(async () => ({ status: "waiting" }));
    const definition: RemoteAgentToolDefinition = {
      description: "Read one external status.",
      execute,
      input: object({}),
      name: "read_status",
      progressTracking: "observation",
    };
    const call = (toolInput: Record<string, unknown>) =>
      executeRemoteAgentToolDefinition({
        definition,
        storage,
        submissionId: SUBMISSION_ID,
        toolInput,
      });

    await expect(call({ id: "same" })).resolves.toEqual({
      status: "waiting",
    });
    await expect(call({ id: "same" })).resolves.toEqual({
      status: "waiting",
    });
    await expect(call({ id: "same" })).rejects.toBeInstanceOf(
      RemoteAgentNoProgressError
    );
    await expect(call({ id: "same" })).rejects.toBeInstanceOf(
      RemoteAgentNoProgressError
    );
    expect(execute).toHaveBeenCalledTimes(3);

    await expect(call({ id: "different" })).resolves.toEqual({
      status: "waiting",
    });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("allows repeated observations while their returned state is changing", async () => {
    const { storage } = await createToolExecutionTestContext();
    let version = 0;
    const definition: RemoteAgentToolDefinition = {
      description: "Read one changing external status.",
      execute: () => {
        version += 1;
        return Promise.resolve({ version });
      },
      input: object({}),
      name: "read_changing_status",
      progressTracking: "observation",
    };

    for (let expectedVersion = 1; expectedVersion <= 4; expectedVersion += 1) {
      await expect(
        executeRemoteAgentToolDefinition({
          definition,
          storage,
          submissionId: SUBMISSION_ID,
          toolInput: { id: "same" },
        })
      ).resolves.toEqual({ version: expectedVersion });
    }
  });

  it("detects unchanged observation loops even when the model alternates probes", async () => {
    const { storage } = await createToolExecutionTestContext();
    const execute = vi.fn(async (input: Record<string, unknown>) => ({
      id: input.id,
      status: "waiting",
    }));
    const definition: RemoteAgentToolDefinition = {
      description: "Read one of two unchanged external statuses.",
      execute,
      input: object({}),
      name: "read_alternating_status",
      progressTracking: "observation",
    };
    const call = (id: string) =>
      executeRemoteAgentToolDefinition({
        definition,
        storage,
        submissionId: SUBMISSION_ID,
        toolInput: { id },
      });

    await expect(call("a")).resolves.toMatchObject({ id: "a" });
    await expect(call("b")).resolves.toMatchObject({ id: "b" });
    await expect(call("a")).resolves.toMatchObject({ id: "a" });
    await expect(call("b")).resolves.toMatchObject({ id: "b" });
    await expect(call("a")).rejects.toBeInstanceOf(RemoteAgentNoProgressError);
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("does not infer no-progress semantics for tools that can produce effects", async () => {
    const { storage } = await createToolExecutionTestContext();
    const execute = vi.fn(async () => ({ status: "completed" }));
    const definition: RemoteAgentToolDefinition = {
      description: "Perform one explicitly authorized effect.",
      execute,
      input: object({}),
      name: "write_action",
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        executeRemoteAgentToolDefinition({
          definition,
          storage,
          submissionId: SUBMISSION_ID,
          toolInput: { operationId: "stable" },
        })
      ).resolves.toEqual({ status: "completed" });
    }
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("continues past the former checkpoint and records a safety failure at the configured limit", async () => {
    const { storage } = await createToolExecutionTestContext();
    const execute = vi.fn(async () => ({ ok: true }));
    const definition: RemoteAgentToolDefinition = {
      description: "Exercise the submission budget.",
      execute,
      input: object({}),
      name: "budgeted_tool",
    };

    for (let attempt = 0; attempt < 70; attempt += 1) {
      await executeRemoteAgentToolDefinition({
        callLimit: 70,
        definition,
        storage,
        submissionId: SUBMISSION_ID,
        toolInput: { attempt },
      });
    }
    await expect(
      executeRemoteAgentToolDefinition({
        definition,
        storage,
        submissionId: SUBMISSION_ID,
        toolInput: { attempt: 64 },
      })
    ).rejects.toBeInstanceOf(RemoteAgentToolCallBudgetExceededError);
    expect(execute).toHaveBeenCalledTimes(70);
    await expect(
      readRemoteAgentCallbackContext(storage, SUBMISSION_ID)
    ).resolves.not.toHaveProperty("workLoopCheckpoint");
    const context = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    if (!context) {
      throw new Error("Missing execution context");
    }
    await expect(
      readRemoteAgentExecutionState({
        storage,
        identity: buildRemoteAgentExecutionIdentity(context),
      })
    ).resolves.toMatchObject({
      execution: { status: "pending", completedAtMs: null },
    });
    await markRemoteAgentExecutionProgress({
      identity: buildRemoteAgentExecutionIdentity(context),
      storage,
      nowMs: TEST_NOW_MS + 1,
      progressKind: "tool_failed",
    });
    await expect(
      readRemoteAgentRequestedExecutionFailure({
        identity: buildRemoteAgentExecutionIdentity(context),
        storage,
      })
    ).resolves.toMatchObject({
      code: "remote_agent.tool_call_budget_exceeded",
    });
    await expect(
      completeRemoteAgentExecutionState({
        identity: buildRemoteAgentExecutionIdentity(context),
        storage,
        nowMs: TEST_NOW_MS + 1,
        status: "completed",
        completedText: "Everything is done.",
      })
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("charges direct no-progress refusals without repeating the redundant read", async () => {
    const { storage } = await createToolExecutionTestContext();
    const execute = vi.fn(() => Promise.resolve({ status: "waiting" }));
    const definition: RemoteAgentToolDefinition = {
      name: "unchanged_observation",
      description: "Read a status.",
      input: object({}),
      execute,
      progressTracking: "observation",
    };
    const call = () =>
      executeRemoteAgentToolDefinition({
        definition,
        storage,
        submissionId: SUBMISSION_ID,
        toolInput: {},
        callLimit: 4,
      });
    await call();
    await call();
    await expect(call()).rejects.toBeInstanceOf(RemoteAgentNoProgressError);
    await expect(call()).rejects.toBeInstanceOf(RemoteAgentNoProgressError);
    await expect(call()).rejects.toBeInstanceOf(
      RemoteAgentToolCallBudgetExceededError
    );
    await expect(call()).rejects.toThrow("tool execution is fenced");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("retains a frozen assignment allowance across replacement submissions and idle time", async () => {
    const { storage } = await createToolExecutionTestContext();
    const original = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    if (!original) {
      throw new Error("Missing execution context");
    }
    const attempt = (
      submissionId: string,
      callLimit: number,
      nowMs = TEST_NOW_MS
    ) =>
      beginRemoteAgentToolAttempt({
        storage,
        submissionId,
        callLimit,
        nowMs,
        toolName: "read",
        toolInput: {},
      });
    await expect(attempt(SUBMISSION_ID, 2)).resolves.toMatchObject({
      callNumber: 1,
    });
    const replacement = {
      ...original,
      submissionId: "replacement",
      idempotencyKey: "replacement-key",
    };
    await putRemoteAgentCallbackContext(storage, replacement);
    await expect(
      attempt("replacement", 100, TEST_NOW_MS + 86_400_000)
    ).resolves.toMatchObject({ callNumber: 2, callLimit: 2 });
    await expect(attempt("replacement", 100)).rejects.toBeInstanceOf(
      RemoteAgentToolCallBudgetExceededError
    );
  });

  it("accounts for concurrent outer and inner attempts without losing budget updates", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const attempts = await Promise.all(
      Array.from({ length: 64 }, (_, attempt) =>
        beginRemoteAgentToolAttempt({
          callLimit: 64,
          storage,
          submissionId: "submission-concurrent-budget",
          toolInput: { attempt },
          toolName: attempt % 2 === 0 ? "codemode" : "direct_tool",
        })
      )
    );

    expect(
      attempts.map((attempt) => attempt.callNumber).sort((a, b) => a - b)
    ).toEqual(Array.from({ length: 64 }, (_, index) => index + 1));
    await expect(
      beginRemoteAgentToolAttempt({
        storage,
        submissionId: "submission-concurrent-budget",
        toolInput: { attempt: 64 },
        toolName: "codemode",
      })
    ).rejects.toBeInstanceOf(RemoteAgentToolCallBudgetExceededError);
  });

  it("carries a legacy checkpoint's spent allowance into its replacement", async () => {
    const { storage } = await createToolExecutionTestContext();
    const original = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    if (!original?.turnEnvelope) {
      throw new Error("Missing original turn context");
    }
    await putRemoteAgentCallbackContext(storage, {
      ...original,
      workLoopCheckpoint: {
        v: 1,
        reason: "tool_call_budget_exhausted",
        toolCallLimit: 64,
      },
    });
    await putRemoteAgentCallbackContext(storage, {
      ...original,
      submissionId: "legacy-replacement",
      turnEnvelope: {
        ...original.turnEnvelope,
        workLoopContinuation: {
          v: 1,
          reason: "tool_call_budget_exhausted",
          attempt: 1,
          previousSubmissionId: SUBMISSION_ID,
        },
      },
    });
    const attempt = () =>
      beginRemoteAgentToolAttempt({
        storage,
        submissionId: "legacy-replacement",
        callLimit: 65,
        toolName: "read",
        toolInput: {},
      });
    await expect(attempt()).resolves.toMatchObject({
      callNumber: 65,
      callLimit: 65,
    });
    await expect(attempt()).rejects.toBeInstanceOf(
      RemoteAgentToolCallBudgetExceededError
    );
  });

  it.each([
    {
      callCount: 63,
      expiresAtMs: TEST_NOW_MS + 60_000,
      observations: [],
      v: 2,
    },
    {
      callCount: "63",
      expiresAtMs: TEST_NOW_MS + 60_000,
      observations: [],
      v: 1,
    },
    {
      callCount: 63,
      expiresAtMs: TEST_NOW_MS + 60_000,
      observations: [{ repeatCount: 3 }],
      v: 1,
    },
  ])("fails closed when durable tool progress is invalid: %j", async (state) => {
    const storage = new InMemoryDurableObjectStorage();
    await storage.putExpiring(
      buildToolProgressKey("submission-invalid-budget"),
      state,
      TEST_NOW_MS + 120_000
    );

    const attempt = beginRemoteAgentToolAttempt({
      nowMs: TEST_NOW_MS,
      storage,
      submissionId: "submission-invalid-budget",
      toolInput: {},
      toolName: "must_not_run",
    });

    await expect(attempt).rejects.toBeInstanceOf(
      RemoteAgentToolProgressStateInvalidError
    );
    await expect(attempt).rejects.toMatchObject({
      name: "RemoteAgentToolProgressStateInvalidError",
      reasonCode: "remote_agent.tool_progress_state_invalid",
    });
    await expect(
      storage.get(buildToolProgressKey("submission-invalid-budget"))
    ).resolves.toEqual(state);
  });

  it("does not refill the allowance when an idle execution resumes after legacy expiry", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const submissionId = "submission-expired-budget";
    await storage.putExpiring(
      buildToolProgressKey(submissionId),
      {
        callCount: 64,
        expiresAtMs: TEST_NOW_MS - 1,
        observations: [],
        v: 1,
      },
      TEST_NOW_MS + 120_000
    );

    await expect(
      beginRemoteAgentToolAttempt({
        nowMs: TEST_NOW_MS,
        storage,
        submissionId,
        toolInput: {},
        toolName: "new_turn_tool",
      })
    ).resolves.toMatchObject({ callNumber: 65 });
  });

  it("does not execute tools after detecting invalid durable progress", async () => {
    const { storage } = await createToolExecutionTestContext();
    await storage.putExpiring(
      buildToolProgressKey(SUBMISSION_ID),
      {
        callCount: 64,
        expiresAtMs: Date.now() + 60_000,
        observations: [],
        v: 2,
      },
      Date.now() + 120_000
    );
    const execute = vi.fn(async () => ({ ok: true }));
    const definition: RemoteAgentToolDefinition = {
      description: "Must not execute with corrupt progress.",
      execute,
      input: object({}),
      name: "must_not_execute",
    };

    await expect(
      executeRemoteAgentToolDefinition({
        definition,
        storage,
        submissionId: SUBMISSION_ID,
        toolInput: {},
      })
    ).rejects.toBeInstanceOf(RemoteAgentToolProgressStateInvalidError);
    await expect(
      executeRemoteAgentToolDefinition({
        definition,
        storage,
        submissionId: SUBMISSION_ID,
        toolInput: {},
      })
    ).rejects.toThrow("remote_agent.tool_progress_state_invalid");
    expect(execute).not.toHaveBeenCalled();
  });

  it("serializes tool calls and blocks later work after a turn-ending result", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: SUBMISSION_ID,
        status: "pending",
        submissionId: SUBMISSION_ID,
      },
      nowMs: TEST_NOW_MS,
      request,
    });
    await putRemoteAgentCallbackContext(storage, context);
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: TEST_NOW_MS,
      identity: buildRemoteAgentExecutionIdentity(context),
      storage,
    });

    const turnEndingToolControl: {
      finish?: () => void;
      reportStarted?: () => void;
    } = {};
    const turnEndingToolStarted = new Promise<void>((resolve) => {
      turnEndingToolControl.reportStarted = resolve;
    });
    const turnEndingTool: RemoteAgentToolDefinition = {
      description: "Ends the current work loop.",
      endsTurnAfter: (...args: unknown[]) =>
        (args[1] as Record<string, unknown> | undefined)?.completionMode ===
        "resume_parent_when_all_terminal",
      execute: () =>
        new Promise<unknown>((resolve) => {
          turnEndingToolControl.finish = () => {
            resolve({ status: "watching" });
          };
          turnEndingToolControl.reportStarted?.();
        }),
      input: object({}),
      name: "watch_task",
    };
    const laterExecute = vi.fn(async () => ({ ok: true }));
    const laterTool: RemoteAgentToolDefinition = {
      description: "Must not run after the work loop ends.",
      execute: laterExecute,
      input: object({}),
      name: "poll_task",
    };

    const ending = executeRemoteAgentToolDefinition({
      definition: turnEndingTool,
      storage,
      submissionId: SUBMISSION_ID,
      toolInput: {
        completionMode: "resume_parent_when_all_terminal",
      },
    });
    await turnEndingToolStarted;
    const later = executeRemoteAgentToolDefinition({
      definition: laterTool,
      storage,
      submissionId: SUBMISSION_ID,
      toolInput: {},
    });
    if (!turnEndingToolControl.finish) {
      throw new Error("expected turn-ending tool control");
    }
    turnEndingToolControl.finish();

    await expect(ending).resolves.toEqual({ status: "watching" });
    await expect(later).rejects.toBeInstanceOf(RemoteAgentTurnEndedError);
    expect(laterExecute).not.toHaveBeenCalled();
  });

  it("removes expired turn-end markers through the admission cleanup path", async () => {
    const storage = new InMemoryDurableObjectStorage();
    await markRemoteAgentTurnEnded({
      nowMs: 1000,
      storage,
      submissionId: SUBMISSION_ID,
      toolName: "watch_task",
    });
    await expect(
      assertRemoteAgentTurnAllowsToolExecution({
        storage,
        submissionId: SUBMISSION_ID,
      })
    ).rejects.toBeInstanceOf(RemoteAgentTurnEndedError);

    await expect(
      cleanupExpiredRemoteAgentTurnEndMarkers({
        nowMs: 1000 + 60 * 60 * 1000,
        storage,
      })
    ).resolves.toEqual({
      deleted: 1,
      nextCleanupAtMs: null,
    });
    await expect(
      assertRemoteAgentTurnAllowsToolExecution({
        storage,
        submissionId: SUBMISSION_ID,
      })
    ).resolves.toBeUndefined();
  });
});

async function createToolExecutionTestContext(): Promise<{
  storage: InMemoryDurableObjectStorage;
}> {
  const storage = new InMemoryDurableObjectStorage();
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: SUBMISSION_ID,
      status: "pending",
      submissionId: SUBMISSION_ID,
    },
    nowMs: TEST_NOW_MS,
    request,
  });
  await putRemoteAgentCallbackContext(storage, context);
  await initializeRemoteAgentExecutionState({
    acceptedAtMs: TEST_NOW_MS,
    identity: buildRemoteAgentExecutionIdentity(context),
    storage,
  });
  return { storage };
}

function buildToolProgressKey(submissionId: string): string {
  return `openmeld:remote-agent:tool-progress:${encodeURIComponent(submissionId)}`;
}
