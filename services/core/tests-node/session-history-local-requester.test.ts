import type { SessionHistoryRpcInput } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSessionHistoryLocalRequester } from "../src/computers/session-history-local-requester";
import type { CoreBindings } from "../src/lib/bindings";

const evidence = vi.hoisted(() => ({
  profile: vi.fn(),
  binding: vi.fn(),
  source: vi.fn(),
  access: vi.fn(),
  delegation: vi.fn(),
  member: vi.fn(),
}));
vi.mock("@openmeld/db/postgresql", () => ({ getPostgresDatabase: () => ({}) }));
vi.mock("../src/connectors/plugin-local-caller", () => ({
  requirePluginProfile: evidence.profile,
}));
vi.mock(
  "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo",
  () => ({ readPrimaryAgentProfileBindingRecord: evidence.binding })
);
vi.mock("../src/dispatch/application/plugin-request-provenance", () => ({
  readPluginDispatchRequester: evidence.source,
}));
vi.mock(
  "../src/dispatch/infrastructure/runtime-transport/runtime-transport-shard",
  () => ({
    resolveRuntimeTransportOwnerShard: () => ({
      rpcAuthorizeExecutionAccess: evidence.access,
    }),
  })
);
vi.mock(
  "../src/center-agent/application/recorded-delegation-requester",
  () => ({ readRecordedDelegationRequester: evidence.delegation })
);
vi.mock("../src/organizations/organization-context", () => ({
  resolveOrganizationMembershipById: evidence.member,
}));

const env = {} as CoreBindings;
const request: SessionHistoryRpcInput = {
  organizationId: "org",
  deviceId: "computer",
  runtimeLane: "dev-local",
  context: {
    actorContext: {
      requestId: "request",
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "agent",
      ownerUserId: "owner",
      callerPrincipalId: "owner",
    },
  },
  execution: {
    dispatchId: "dispatch",
    executionTokenEcho: {
      executionToken: "test-token",
      tokenFingerprint: "test-fingerprint",
      runId: "run",
      runtimeCoordinatorExecutionId: "execution",
    },
  },
  request: {
    operation: "read_session",
    projectId: "project",
    sessionId: "session",
    offset: 0,
    limit: 20,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  evidence.profile.mockImplementation(async (_env, profileId) => ({
    profileId,
    profileKind: profileId === "source" ? "human" : "agent",
    ownerUserId: "owner",
    organizationId: "org",
    status: "active",
  }));
  evidence.binding.mockResolvedValue({
    bindingState: "enabled_primary",
    runtimeKind: "openmeld_service",
    bindingId: "binding",
    agentControllerRef: "builtin:codex",
    openMeldServiceRuntimeId: "service",
  });
  evidence.source.mockResolvedValue({
    profileId: "source",
    spaceId: "space",
    sourceClientMessageId: "message",
    sourceSignalId: "signal",
  });
  evidence.access.mockResolvedValue({ allowed: true });
  evidence.member.mockResolvedValue({ ok: true });
});
describe("session history execution provenance", () => {
  it("rejects missing execution proof before reading dispatch provenance", async () => {
    await expect(
      requireSessionHistoryLocalRequester(
        env,
        { ...request, execution: undefined },
        "owner"
      )
    ).rejects.toThrow();
    expect(evidence.source).not.toHaveBeenCalled();
  });
  it("rejects denied execution authority even when the profile belongs to the owner", async () => {
    evidence.access.mockResolvedValue({
      allowed: false,
      reasonCode: "execution_not_found",
    });
    await expect(
      requireSessionHistoryLocalRequester(env, request, "owner")
    ).rejects.toThrow();
    expect(evidence.member).not.toHaveBeenCalled();
  });
  it("does not infer a human root from another Agent's ownership", async () => {
    evidence.profile.mockResolvedValue({
      profileKind: "agent",
      ownerUserId: "owner",
      organizationId: "org",
      status: "active",
    });
    evidence.delegation.mockResolvedValue(null);
    await expect(
      requireSessionHistoryLocalRequester(env, request, "owner")
    ).rejects.toThrow();
  });
  it("accepts direct owner requests only after exact execution scope validation", async () => {
    const result = await requireSessionHistoryLocalRequester(
      env,
      request,
      "owner"
    );
    expect(result).toMatchObject({
      requesterUserId: "owner",
      readerProfileId: request.context.actorContext.openMeldProfileId,
      spaceId: "space",
      audience: "space",
    });
    expect(evidence.access).toHaveBeenCalledWith({
      executionTokenEcho: request.execution?.executionTokenEcho,
      expectedExecutionScope: {
        dispatchId: "dispatch",
        runtimeCoordinatorExecutionId: "execution",
        sourceClientMessageId: "message",
        spaceId: "space",
        targetProfileId: request.context.actorContext.openMeldProfileId,
      },
      expectedAuthorityScope: {
        bindingId: "binding",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "service",
      },
    });
  });
  it("rejects another human owner and revoked membership", async () => {
    evidence.profile.mockImplementation(async (_env, id) => ({
      profileKind: id === "source" ? "human" : "agent",
      ownerUserId: id === "source" ? "coworker" : "owner",
      organizationId: "org",
      status: "active",
    }));
    await expect(
      requireSessionHistoryLocalRequester(env, request, "owner")
    ).rejects.toThrow();
    evidence.profile.mockImplementation(async (_env, id) => ({
      profileKind: id === "source" ? "human" : "agent",
      ownerUserId: "owner",
      organizationId: "org",
      status: "active",
    }));
    evidence.member.mockResolvedValue({ ok: false });
    await expect(
      requireSessionHistoryLocalRequester(env, request, "owner")
    ).rejects.toThrow();
  });
  it("preserves the recorded human root across an admitted one-hop delegation", async () => {
    evidence.profile.mockResolvedValue({
      profileKind: "agent",
      ownerUserId: "owner",
      organizationId: "org",
      status: "active",
    });
    evidence.delegation.mockResolvedValue({
      userId: "owner",
      parentDeliveryId: "human-delivery",
    });
    const result = await requireSessionHistoryLocalRequester(
      env,
      request,
      "owner"
    );
    expect(result).toMatchObject({
      requestRootId: "human-delivery",
      requesterUserId: "owner",
      delegatorProfileId: "source",
    });
    evidence.delegation.mockResolvedValue({
      userId: "coworker",
      parentDeliveryId: "other-delivery",
    });
    await expect(
      requireSessionHistoryLocalRequester(env, request, "owner")
    ).rejects.toThrow();
  });
});
