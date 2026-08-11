import { beforeEach, describe, expect, it, vi } from "vitest";
import { rpcCenterAgentRequestMemberAttention } from "../src/center-agent/application/center-agent-attention-rpc";
import type { CoreBindings } from "../src/lib/bindings";

const readNativeDelivery = vi.hoisted(() => vi.fn());
const prepareCenterAgentCandidate = vi.hoisted(() => vi.fn());
const createAttentionRequest = vi.hoisted(() => vi.fn());
const prepareHostedRequest = vi.hoisted(() => vi.fn());
const readTaskAttempt = vi.hoisted(() => vi.fn());
const projectTaskAttention = vi.hoisted(() => vi.fn());

vi.mock(
  "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo",
  () => ({
    readRemoteAgentNativeDeliveryBySubmissionId: readNativeDelivery,
  })
);
vi.mock("../src/space/application/space-inbox-center-agent-candidate", () => ({
  prepareSpaceInboxCandidateForCenterAgent: prepareCenterAgentCandidate,
}));
vi.mock(
  "../src/center-agent/application/center-agent-attention-service",
  () => ({
    createCenterAgentAttentionRequest: createAttentionRequest,
  })
);
vi.mock("../src/center-agent/application/represented-member-request", () => ({
  prepareHostedCenterAgentRequest: prepareHostedRequest,
}));
vi.mock(
  "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo",
  () => ({
    readCenterAgentTaskAttemptByTaskHandle: readTaskAttempt,
  })
);
vi.mock(
  "../src/center-agent-tasks/application/center-agent-task-attention-projector",
  () => ({
    projectCenterAgentTaskNeedsAttention: projectTaskAttention,
  })
);

describe("Center Agent attention RPC", () => {
  beforeEach(() => {
    readNativeDelivery.mockReset().mockResolvedValue(nativeDelivery());
    prepareCenterAgentCandidate
      .mockReset()
      .mockImplementation(
        async (input: {
          candidate: { sourceTarget: { signalId: string; spaceId: string } };
        }) => ({
          ...input.candidate,
          sourceTarget: {
            kind: "center_agent",
            signalId: input.candidate.sourceTarget.signalId,
            spaceId: input.candidate.sourceTarget.spaceId,
          },
        })
      );
    createAttentionRequest.mockReset().mockResolvedValue({
      importance: "urgent",
      requestId: "submission-one",
    });
    prepareHostedRequest.mockReset().mockResolvedValue({
      activeOrganization: { organizationId: "org-one" },
      actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
      db: membershipDb(true),
    });
    readTaskAttempt.mockReset().mockResolvedValue(null);
    projectTaskAttention.mockReset().mockResolvedValue(true);
  });

  it("accepts only the current verified native Space delivery and creates the canonical request", async () => {
    await expect(
      rpcCenterAgentRequestMemberAttention(env(), request())
    ).resolves.toEqual({
      importance: "urgent",
      instruction:
        "This urgent request is now in Needs action and uses the member's urgent notification preferences. Explain the concrete time-sensitive or blocking risk without exaggeration.",
      organizationId: "org-one",
      requestId: "submission-one",
    });

    expect(readNativeDelivery).toHaveBeenCalledWith({
      db: expect.anything(),
      submissionId: "submission-one",
    });
    expect(createAttentionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        impact: "work_blocked",
        organizationId: "org-one",
        recipientUserId: "user-one",
        sourceTarget: {
          kind: "center_agent",
          signalId: "signal-one",
          spaceId: "space-one",
        },
      })
    );
  });

  it("rejects a submission that is not the current verified conversation", async () => {
    await expect(
      rpcCenterAgentRequestMemberAttention(
        env(),
        request({ submissionId: "submission-other" })
      )
    ).rejects.toMatchObject({
      code: "center_agent.attention_request_delivery_mismatch",
      status: 403,
    });
    expect(readNativeDelivery).not.toHaveBeenCalled();
    expect(createAttentionRequest).not.toHaveBeenCalled();
  });

  it("routes a Task delivery to the canonical Task Needs action projection", async () => {
    const deliveryDb = { owner: "wake-evidence" } as unknown as D1Database;
    const inboxDb = { owner: "inbox" } as unknown as D1Database;
    const taskDb = { owner: "local-state" } as unknown as D1Database;
    readNativeDelivery.mockResolvedValue(
      nativeDelivery({ conversationKind: "message_channel" })
    );
    readTaskAttempt.mockResolvedValue({ generation: 1, taskId: "task-one" });

    await expect(
      rpcCenterAgentRequestMemberAttention(
        env({ deliveryDb, inboxDb, taskDb }),
        request()
      )
    ).resolves.toMatchObject({
      importance: "urgent",
      organizationId: "org-one",
      requestId: "submission-one",
    });
    expect(readNativeDelivery).toHaveBeenCalledWith({
      db: deliveryDb,
      submissionId: "submission-one",
    });
    expect(readTaskAttempt).toHaveBeenCalledWith({
      db: taskDb,
      organizationId: "org-one",
      taskHandle: {
        deliveryId: "delivery-one",
        kind: "native_delivery",
        v: 1,
      },
    });
    expect(projectTaskAttention).toHaveBeenCalledWith({
      deliveryId: "delivery-one",
      importance: "urgent",
      inboxDb,
      nowMs: expect.any(Number),
      organizationId: "org-one",
      prompt: "Choose the release owner so work can continue.",
      requestId: "submission-one",
      taskDb,
    });
    expect(createAttentionRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["a Routine delivery", { routineRunId: "routine-run-one" }],
    ["a non-Space delivery", { conversationKind: "message_channel" }],
    ["a delivery without a represented member", { onBehalfOfUserId: null }],
  ] as const)("rejects %s", async (_label, override) => {
    readNativeDelivery.mockResolvedValue(nativeDelivery(override));

    await expect(
      rpcCenterAgentRequestMemberAttention(env(), request())
    ).rejects.toMatchObject({
      code: "center_agent.attention_request_delivery_mismatch",
      status: 403,
    });
    expect(createAttentionRequest).not.toHaveBeenCalled();
  });
});

function env(
  stores: {
    deliveryDb?: D1Database;
    inboxDb?: D1Database;
    taskDb?: D1Database;
  } = {}
): CoreBindings {
  const db = stores.inboxDb ?? ({} as D1Database);
  return {
    OPENMELD_DB: db,
    OPENMELD_LOCAL_STATE_DB: stores.taskDb ?? db,
    OPENMELD_SPACES: {} as DurableObjectNamespace,
    OPENMELD_WAKE_EVIDENCE_DB: stores.deliveryDb ?? db,
  } as unknown as CoreBindings;
}

function request(overrides: { submissionId?: string } = {}) {
  return {
    context: {
      activeOrganizationId: "org-one",
      actorContext: {
        agentControllerRef: "builtin:openmeld-remote-agent",
        callerPrincipalId: "owner-one",
        ownerUserId: "owner-one",
        profileKind: "agent" as const,
        profileName: "Center Agent",
        requestId: "request-one",
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      },
      agentControllerConversationId: "submission-one",
    },
    impact: "work_blocked" as const,
    prompt: "Choose the release owner so work can continue.",
    submissionId: overrides.submissionId ?? "submission-one",
    title: "Release owner needed",
  };
}

function nativeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    conversationKind: "space",
    deliveryId: "delivery-one",
    onBehalfOfProfileId: "usr_11111111-1111-4111-8111-111111111111",
    onBehalfOfUserId: "user-one",
    organizationId: "org-one",
    profileId: "agt_11111111-1111-4111-8111-111111111111",
    routineRunId: null,
    spaceId: "space-one",
    status: "accepted",
    triggerMessageId: "signal-one",
    ...overrides,
  };
}

function membershipDb(active: boolean): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => (active ? { active: 1 } : null),
      }),
    }),
  } as unknown as D1Database;
}
