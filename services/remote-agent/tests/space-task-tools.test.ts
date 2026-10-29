import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { getRemoteAgentOpenMeldToolDefinitions } from "../agent-core/tools";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

async function fixture(kind: "space" | "dm") {
  const request = createSubmitTurnRequest();
  request.turnEnvelope.space.kind = kind;
  const storage = new InMemoryDurableObjectStorage();
  const ack = {
    accepted: true,
    createdAt: TEST_NOW_MS,
    idempotencyKey: request.idempotencyKey,
    requestId: "task-tools",
    status: "pending",
    submissionId: "task-tools",
  } as const;
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({ ack, nowMs: TEST_NOW_MS, request })
  );
  return { storage, request, submissionId: ack.submissionId };
}

describe("conversation Task tool boundary", () => {
  it.each([
    "space",
    "dm",
  ] as const)("lists Tasks in the authorized %s using the admitted Agent identity", async (kind) => {
    const { request, ...context } = await fixture(kind);
    const listSpaceTasks = vi.fn(async () => ({ tasks: [], truncated: false }));
    const tool = getRemoteAgentOpenMeldToolDefinitions({
      ...context,
      coreWorker: { listSpaceTasks },
    }).find((item) => item.name === "openmeld_manage_space_tasks");
    if (!tool) {
      throw new Error("Task tool missing");
    }
    await expect(tool.execute({ action: "list" })).resolves.toEqual({
      tasks: [],
      truncated: false,
    });
    expect(listSpaceTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: request.spaceId,
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: request.agentProfileId,
            profileKind: "agent",
          }),
        }),
      })
    );
  });

  it.each([
    { action: "create", title: "Record an unassigned request" },
    {
      action: "create_and_delegate",
      title: "Deliver the Guide feature",
      operationId: "delegate-guide-v1",
      assigneeProfileId: "agt_22222222-2222-4222-8222-222222222222",
      reviewerProfileId: "agt_33333333-3333-4333-8333-333333333333",
    },
    {
      action: "create",
      title: "Record explicitly assigned work",
      assigneeProfileId: "agt_22222222-2222-4222-8222-222222222222",
    },
    {
      action: "delegate",
      assigneeProfileId: "agt_22222222-2222-4222-8222-222222222222",
      reviewerProfileId: "agt_33333333-3333-4333-8333-333333333333",
    },
    { action: "mark_in_progress" },
    { action: "submit_result", summary: "Verified the Task flow." },
    { action: "review", decision: "accepted", expectedResultRevision: 2 },
  ])("forwards a private $action through Core and preserves its authorization denial", async (action) => {
    const { request, ...context } = await fixture("dm");
    const denied = new Error("space.membership_required");
    const taskRpc = vi.fn(() => Promise.reject(denied));
    const tool = getRemoteAgentOpenMeldToolDefinitions({
      ...context,
      coreWorker: { mutateSpaceTask: taskRpc, createSpaceTask: taskRpc },
    }).find((item) => item.name === "openmeld_manage_space_tasks");
    if (!tool) {
      throw new Error("Task tool missing");
    }
    const taskId = "tsk_11111111-1111-4111-8111-111111111111";
    await expect(
      tool.execute({ ...action, taskId, expectedRevision: 2 })
    ).rejects.toBe(denied);
    const creates =
      action.action === "create" || action.action === "create_and_delegate";
    let expectedBody: Record<string, unknown> = action;
    if (creates) {
      expectedBody = {
        title: action.title,
        assigneeProfileId: action.assigneeProfileId ?? null,
        ...(action.action === "create_and_delegate"
          ? {
              operationId: action.operationId,
              wakeAssignee: true,
              reviewerProfileId: action.reviewerProfileId,
            }
          : {}),
      };
    } else if (action.action === "delegate") {
      expectedBody = {
        action: "assign",
        assigneeProfileId: action.assigneeProfileId,
        reviewerProfileId: action.reviewerProfileId,
        wakeAssignee: true,
        operationId: `task-delegate:${context.submissionId}:${taskId}:2`,
      };
    }
    expect(taskRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: request.spaceId,
        ...(creates ? {} : { taskId }),
        body: expect.objectContaining(expectedBody),
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: request.agentProfileId,
          }),
        }),
      })
    );
  });

  it.each([
    "delegate",
    "create_and_delegate",
  ] as const)("refuses %s without an explicit reviewer decision before any Core mutation", async (action) => {
    const { request: _request, ...context } = await fixture("space");
    const mutateSpaceTask = vi.fn();
    const tool = getRemoteAgentOpenMeldToolDefinitions({
      ...context,
      coreWorker: { mutateSpaceTask },
    }).find((item) => item.name === "openmeld_manage_space_tasks");
    if (!tool) {
      throw new Error("Task tool missing");
    }
    await expect(
      tool.execute({
        action,
        title: "Deliver the Guide feature",
        operationId: "delegate-guide-v1",
        taskId: "tsk_11111111-1111-4111-8111-111111111111",
        expectedRevision: 1,
        assigneeProfileId: "agt_22222222-2222-4222-8222-222222222222",
      })
    ).rejects.toThrow("explicit reviewerProfileId");
    expect(mutateSpaceTask).not.toHaveBeenCalled();
  });
});
