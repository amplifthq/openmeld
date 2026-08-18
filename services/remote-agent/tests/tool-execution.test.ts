import { object } from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  beginRemoteAgentToolAttempt,
  RemoteAgentNoProgressError,
  RemoteAgentToolCallBudgetExceededError,
  RemoteAgentToolProgressStateInvalidError,
} from "../agent-core/tool-progress";
import { RemoteAgentToolResultTooLargeError } from "../agent-core/tool-result-boundary";
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
  it("fails an oversized direct tool result explicitly without retaining its payload", () => {
    let thrown: unknown;
    try {
      toBoundedRemoteAgentToolResult({
        toolName: "github_list_pull_request_files",
        value: { patch: "A".repeat(200_000) },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RemoteAgentToolResultTooLargeError);
    expect(thrown).toMatchObject({
      limitBytes: 131_072,
      reasonCode: "remote_agent.tool_result_too_large",
      toolName: "github_list_pull_request_files",
    });
    expect((thrown as Error).message).toContain(
      "Narrow the request with search, filters, pagination, or segmented file reads"
    );
    expect(JSON.stringify(thrown)).not.toContain("AAAA");
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

  it("enforces one durable tool-call budget across the whole submission", async () => {
    const { storage } = await createToolExecutionTestContext();
    const execute = vi.fn(async () => ({ ok: true }));
    const definition: RemoteAgentToolDefinition = {
      description: "Exercise the submission budget.",
      execute,
      input: object({}),
      name: "budgeted_tool",
    };

    for (let attempt = 0; attempt < 64; attempt += 1) {
      await executeRemoteAgentToolDefinition({
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
    expect(execute).toHaveBeenCalledTimes(64);
  });

  it("accounts for concurrent outer and inner attempts without losing budget updates", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const attempts = await Promise.all(
      Array.from({ length: 64 }, (_, attempt) =>
        beginRemoteAgentToolAttempt({
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

  it("restarts the budget only when a valid durable state has expired", async () => {
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
    ).resolves.toMatchObject({ callNumber: 1 });
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
    ).rejects.toBeInstanceOf(RemoteAgentTurnEndedError);
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
