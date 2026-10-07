import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequestV2 } from "../../remote-agent/tests/fixtures";
import { requireSessionHistoryHostedRequester } from "../src/computers/session-history-hosted-requester";
import type { CoreBindings } from "../src/lib/bindings";

const evidence = vi.hoisted(() => ({
  caller: vi.fn(),
  delivery: vi.fn(),
  delegation: vi.fn(),
  member: vi.fn(),
}));
vi.mock("@openmeld/db/postgresql", () => ({ getPostgresDatabase: () => ({}) }));
vi.mock("../src/remote-agent/application/remote-agent-tool-caller", () => ({
  requireRemoteAgentToolCaller: evidence.caller,
}));
vi.mock(
  "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo",
  () => ({ readRemoteAgentNativeDeliveryBySubmissionId: evidence.delivery })
);
vi.mock("../src/remote-agent/application/delegated-requester", () => ({
  readRemoteAgentDelegatedRequester: evidence.delegation,
}));
vi.mock("../src/organizations/organization-context", () => ({
  resolveOrganizationMembershipById: evidence.member,
}));

const env = {} as CoreBindings;
const context: OpenMeldRequestContext = {
  actorContext: {
    requestId: "request",
    profileKind: "agent",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner",
    callerPrincipalId: "owner",
  },
  agentControllerConversationId: "caller-supplied",
};
function delivery() {
  const request = createSubmitTurnRequestV2();
  request.turnEnvelope.sender = {
    kind: "member",
    id: "owner",
    displayName: "Owner",
    ownerUserId: "owner",
    verified: true,
  };
  return {
    deliveryId: "human-delivery",
    profileId: "reader",
    organizationId: "org",
    status: "accepted",
    conversationKind: "space",
    spaceId: "space",
    routineRunId: null,
    workerSubmitRequest: request,
    executionRecoverySubmitRequest: null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  evidence.caller.mockResolvedValue({
    actorProfileId: "reader",
    activeOrganization: { organizationId: "org" },
    context: { ...context, agentControllerConversationId: "verified-delivery" },
  });
  evidence.delivery.mockResolvedValue(delivery());
  evidence.member.mockResolvedValue({ ok: true });
});
describe("hosted history request provenance", () => {
  it("uses the authenticated delivery and frozen audience instead of caller claims", async () => {
    const source = delivery();
    source.workerSubmitRequest.turnEnvelope.interactionEnvironment =
      "externally_shared";
    source.workerSubmitRequest.turnEnvelope.contextScopePlan = undefined;
    evidence.delivery.mockResolvedValue(source);
    const result = await requireSessionHistoryHostedRequester(env, context);
    expect(evidence.delivery).toHaveBeenCalledWith({
      db: {},
      submissionId: "verified-delivery",
    });
    expect(result.requester).toMatchObject({
      ownerUserId: "owner",
      requesterUserId: "owner",
      readerProfileId: "reader",
      requestRootId: "human-delivery",
      audience: "externally_shared",
    });
  });
  it.each([
    "completed",
    "different_profile",
    "different_org",
    "routine",
    "unverified",
    "revoked",
  ])("denies %s before transport", async (scenario) => {
    const source = delivery();
    if (scenario === "completed") {
      source.status = "completed";
    }
    if (scenario === "different_profile") {
      source.profileId = "other-agent";
    }
    if (scenario === "different_org") {
      source.organizationId = "other-org";
    }
    if (scenario === "routine") {
      Object.assign(source, { routineRunId: "scheduled-run" });
    }
    if (
      scenario === "unverified" &&
      source.workerSubmitRequest.turnEnvelope.sender.kind === "member"
    ) {
      source.workerSubmitRequest.turnEnvelope.sender.verified = false;
    }
    if (scenario === "revoked") {
      evidence.member.mockResolvedValue({ ok: false });
    }
    evidence.delivery.mockResolvedValue(source);
    await expect(
      requireSessionHistoryHostedRequester(env, context)
    ).rejects.toThrow();
  });
  it("requires the recorded human root for an Agent sender", async () => {
    const source = delivery();
    source.workerSubmitRequest.turnEnvelope.sender = {
      kind: "agent_profile",
      id: "center",
      profileId: "center",
      displayName: "Center",
      verified: true,
    };
    evidence.delivery.mockResolvedValue(source);
    evidence.delegation.mockResolvedValue(null);
    await expect(
      requireSessionHistoryHostedRequester(env, context)
    ).rejects.toThrow();
    evidence.delegation.mockResolvedValue({
      userId: "owner",
      parentDeliveryId: "original-human",
    });
    await expect(
      requireSessionHistoryHostedRequester(env, context)
    ).resolves.toMatchObject({
      requester: {
        requestRootId: "original-human",
        delegatorProfileId: "center",
        requesterUserId: "owner",
      },
    });
  });
});
