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
