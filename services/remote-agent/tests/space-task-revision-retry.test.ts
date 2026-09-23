import {
  SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
  spaceTaskMutationReceiptSchema,
  spaceTaskSchema,
} from "@openmeld/schemas";
import type { MutateSpaceTaskBody } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  isSpaceTaskRevisionConflictError,
  mutateSpaceTaskRefreshingOnRevisionConflict,
} from "../agent-core/space-task-revision-retry";

const TASK_ID = "tsk_55555555-5555-4555-8555-555555555555";
const ACTOR = {
  ownerUserId: "user-avery",
  profileId: "agt_22222222-2222-4222-8222-222222222222",
  profileKind: "agent" as const,
  profileName: "Builder",
};

const request: MutateSpaceTaskBody = {
  action: "update_brief",
  description: "New acceptance criteria.",
  expectedRevision: 1,
  operationId: "op-1",
};

const receipt = (revision: number) =>
  spaceTaskMutationReceiptSchema.parse({
    applied: true,
    event: {
      actor: ACTOR,
      createdAt: "2026-09-15T01:00:00.000Z",
      detail: null,
      eventId: "tse_55555555-5555-4555-8555-555555555555",
      fromPhase: "to_do",
      operationId: revision === 2 ? "op-1" : "op-2",
      taskId: TASK_ID,
      taskRevision: revision,
      toPhase: "to_do",
      type: "brief_updated",
    },
    task: spaceTaskSchema.parse({
      assignee: ACTOR,
      automaticReworkRounds: 0,
      completionConditions: [],
      createdAt: "2026-09-15T00:00:00.000Z",
      createdBy: ACTOR,
      description: "New acceptance criteria.",
      needsHumanDecision: false,
      phase: "to_do",
      requestedBy: ACTOR,
      result: null,
      review: null,
      reviewer: null,
      revision,
      sourceSignalId: null,
      spaceId: "space-1",
      taskId: TASK_ID,
      threadId: null,
      title: "Ship Tasks",
      updatedAt: "2026-09-15T01:00:00.000Z",
    }),
  });

describe("Space Task mutation revision retry", () => {
  it("refreshes only a provider observation after a typed revision conflict", async () => {
    const observation: MutateSpaceTaskBody = {
      action: "observe_external_work_item",
      expectedRevision: 1,
      lastObservedState: "closed",
      number: 42,
      operationId: "op-1",
      owner: "org",
      provider: "github",
      repo: "repo",
    };
    const mutate = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          `HTTP 409: ${JSON.stringify({
            ok: false,
            error: {
              code: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
              message:
                "This Task changed from revision 1 to 2. Refresh it and try again.",
            },
          })}`
        )
      )
      .mockResolvedValueOnce(receipt(3));
    const readCurrentRevision = vi.fn(async () => 2);

    await expect(
      mutateSpaceTaskRefreshingOnRevisionConflict({
        mutate,
        readCurrentRevision,
        request: observation,
      })
    ).resolves.toMatchObject({ task: { revision: 3 } });

    expect(readCurrentRevision).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenNthCalledWith(1, observation);
    expect(mutate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "observe_external_work_item",
        lastObservedState: "closed",
        expectedRevision: 2,
      })
    );
    expect(mutate.mock.calls[1]?.[0].operationId).not.toBe("op-1");
  });

  it.each<MutateSpaceTaskBody>([
    request,
    {
      action: "review",
      decision: "accepted",
      expectedRevision: 3,
      expectedResultRevision: 1,
      operationId: "accept-result-one",
    },
  ])("does not rebase a semantic $action over a concurrent change", async (semanticRequest) => {
    const error = new Error("Task changed", {
      cause: {
        code: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
        message: "Read the changed Task before deciding again.",
        status: 409,
      },
    });
    const mutate = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(receipt(6));
    const readCurrentRevision = vi.fn(async () => 5);
    await expect(
      mutateSpaceTaskRefreshingOnRevisionConflict({
        mutate,
        readCurrentRevision,
        request: semanticRequest,
      })
    ).rejects.toBe(error);
    expect(mutate).toHaveBeenCalledOnce();
    expect(readCurrentRevision).not.toHaveBeenCalled();
  });

  it("does not retry a different Task failure", async () => {
    const error = new Error("space_task.forbidden");
    const mutate = vi.fn(() => {
      throw error;
    });

    await expect(
      mutateSpaceTaskRefreshingOnRevisionConflict({
        mutate,
        readCurrentRevision: async () => 2,
        request,
      })
    ).rejects.toBe(error);
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("recognizes Worker RPC cause payloads", () => {
    const error = new Error("conflict") as Error & { cause?: unknown };
    error.cause = {
      code: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
      message:
        "This Task changed from revision 1 to 2. Refresh it and try again.",
      status: 409,
    };
    expect(isSpaceTaskRevisionConflictError(error)).toBe(true);
  });

  it("recognizes mixed-version Gateway wrapping on upstreamCode", () => {
    expect(
      isSpaceTaskRevisionConflictError(
        new Error(
          `HTTP 409: ${JSON.stringify({
            ok: false,
            error: {
              code: "upstream_error",
              message:
                "This Task changed from revision 1 to 2. Refresh it and try again.",
              upstreamCode: SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
            },
          })}`
        )
      )
    ).toBe(true);
  });
});
