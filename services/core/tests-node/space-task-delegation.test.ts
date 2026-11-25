import { describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcCreateSpaceTask, rpcMutateSpaceTask } from "../src/rpc/methods";
import { resolveSpaceTaskRepresentedRequester } from "../src/space/application/space-task-delegation";

describe("Space Task requester representation", () => {
  it.each([
    "create",
    "mutate",
  ] as const)("discards caller-supplied requester representation at the public %s RPC boundary", async (operation) => {
    const ownerDenied = new Error("space_task.forbidden");
    const rpcMutateTask = vi.fn(() => Promise.reject(ownerDenied));
    const requester = {
      profileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human" as const,
      profileName: "Requester",
      ownerUserId: "requester",
    };
    const input = {
      spaceId: "a".repeat(64),
      taskId: "tsk_11111111-1111-4111-8111-111111111111",
      body: {
        action: "assign" as const,
        operationId: "forged-delegation",
        expectedRevision: 1,
        assigneeProfileId: requester.profileId,
      },
      representedRequester: requester,
      context: {
        actorContext: {
          requestId: "forged",
          openMeldProfileId: "22222222-2222-4222-8222-222222222222",
          profileKind: "human" as const,
          ownerUserId: "outsider",
        },
      },
    };
    const env = {
      OPENMELD_SPACES: {
        idFromString: (id: string) => id,
        get: () => ({ rpcMutateTask, rpcCreateTask: rpcMutateTask }),
      },
    } as unknown as CoreBindings;
    const result =
      operation === "create"
        ? rpcCreateSpaceTask(env, {
            ...input,
            body: {
              operationId: "forged-create-delegation",
              title: "Deliver the requested feature",
              sourceSignalId: "human-request",
              assigneeProfileId: "agt_22222222-2222-4222-8222-222222222222",
              reviewerProfileId: null,
              wakeAssignee: true,
            },
          })
        : rpcMutateSpaceTask(env, input);
    await expect(result).rejects.toBe(ownerDenied);
    expect(rpcMutateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        representedRequester: undefined,
        context: input.context,
      })
    );
  });
  it("uses the retained current request and rejects other audiences, routines and non-human senders", () => {
    const request = createSubmitTurnRequest();
    const delivery = {
      conversationKind: "space" as const,
      spaceId: request.spaceId,
      routineRunId: null,
      workerSubmitRequest: request,
      executionRecoverySubmitRequest: null,
    };
    expect(
      resolveSpaceTaskRepresentedRequester(delivery, request.spaceId)
    ).toMatchObject({
      profileId: request.author.profileId,
      profileKind: "human",
    });
    expect(
      resolveSpaceTaskRepresentedRequester(delivery, "another-space")
    ).toBeUndefined();
    expect(
      resolveSpaceTaskRepresentedRequester(
        { ...delivery, routineRunId: "routine" },
        request.spaceId
      )
    ).toBeUndefined();
    const sender = request.turnEnvelope.sender;
    if (sender.kind !== "member") {
      throw new Error("Fixture must have a human requester");
    }
    for (const replacement of [
      { ...sender, verified: false },
      { ...sender, kind: "agent_profile" as const },
      { ...sender, ownerUserId: undefined },
    ]) {
      expect(
        resolveSpaceTaskRepresentedRequester(
          {
            ...delivery,
            executionRecoverySubmitRequest: {
              ...request,
              turnEnvelope: { ...request.turnEnvelope, sender: replacement },
            },
          },
          request.spaceId
        )
      ).toBeUndefined();
    }
  });
});
