import {
  appendPluginConnectionReplyLink,
  buildOpenMeldNavigationAction,
} from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { continuePluginConnection } from "../src/connectors/plugin-connection-continuation";
import type { CoreBindings } from "../src/lib/bindings";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";

const owner = vi.hoisted(() => ({
  membership: vi.fn(),
  slug: vi.fn(),
  signals: vi.fn(),
  directory: vi.fn(),
  delivery: vi.fn(),
  connection: vi.fn(),
  permission: vi.fn(),
  receipts: vi.fn(),
  post: vi.fn(),
  localSource: vi.fn(),
  localProfile: vi.fn(),
  localPermission: vi.fn(),
  localBinding: vi.fn(),
}));
vi.mock("../src/organizations/organization-context", () => ({
  resolveActiveOrganizationMembership: owner.membership,
  readOrganizationRouteSlug: owner.slug,
}));
vi.mock("../src/rpc/methods", () => ({
  rpcListSignals: owner.signals,
  rpcGetSpaceMemberDirectory: owner.directory,
  rpcPostSignalOnceByClientMessageId: owner.post,
  rpcReadPluginConnectionLocalSource: owner.localSource,
}));
vi.mock(
  "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo",
  () => ({ readRemoteAgentNativeDeliveryByExecution: owner.delivery })
);
vi.mock("../src/connectors/connector-connection-repository", () => ({
  selectActiveConnectorConnection: owner.connection,
}));
vi.mock("../src/connectors/plugin-access", () => ({
  requireRemotePluginConnection: owner.permission,
  requirePluginPermission: owner.localPermission,
}));
vi.mock("../src/center-agent/connector-action-operation-repository", () => ({
  listConnectorOperationReceiptsForContinuation: owner.receipts,
}));

vi.mock("../src/connectors/plugin-local-caller", () => ({
  requirePluginProfile: owner.localProfile,
}));
vi.mock(
  "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo",
  () => ({ readPrimaryAgentProfileBindingRecord: owner.localBinding })
);

const request = createSubmitTurnRequest();
const humanId = request.author.profileId as string;
const env = {
  OPENMELD_POSTGRESQL: {
    connectionString:
      "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
  },
  WEB_APP_URL: "https://openmeld.ai",
} as CoreBindings;
const input = {
  spaceId: request.spaceId,
  sourceSignalId: "reply-1",
  service: "github",
  scope: "member",
  context: {
    activeOrganizationId: request.organizationId,
    actorContext: {
      requestId: "click-1",
      profileKind: "human",
      openMeldProfileId: humanId,
      callerPrincipalId: "user_1",
    },
  },
};

function delivery(overrides: Partial<RemoteAgentNativeDeliveryRecord> = {}) {
  return {
    deliveryId: "delivery-1",
    organizationId: request.organizationId,
    spaceId: request.spaceId,
    profileId: request.agentProfileId,
    bindingId: request.bindingId,
    dispatchId: request.dispatchId,
    status: "completed",
    failureCode: null,
    publishedSignalId: "reply-1",
    conversationKind: "space",
    routineRunId: null,
    workerSubmitRequest: request,
    triggerMessageId: request.triggerMessageId,
    threadContext: {
      threadId: "thr_11111111-1111-4111-8111-111111111111",
      rootSignalId: "thread-root",
    },
    createdAtMs: 100,
    completedAtMs: 200,
    ...overrides,
  };
}

describe("Plugin continuation keeps existing identity and Wake owners", () => {
  beforeEach(() => {
    for (const mock of Object.values(owner)) {
      mock.mockReset();
    }
    owner.membership.mockResolvedValue({
      ok: true,
      userId: "user_1",
      memberId: "member_123",
      organizationId: request.organizationId,
      role: "owner",
    });
    owner.slug.mockResolvedValue("acme");
    owner.signals.mockResolvedValue({
      signals: [
        {
          id: "reply-1",
          type: "signal.text",
          profile: { kind: "agent", profileId: request.agentProfileId },
          data: {
            text: appendPluginConnectionReplyLink({
              text: "Connect GitHub for the remaining review.",
              action: buildOpenMeldNavigationAction({
                organizationWebUrl: "https://openmeld.ai/o/acme",
                target: {
                  kind: "plugin_connection",
                  service: "github",
                  scope: "member",
                },
              }),
            }),
            meta: { dispatchId: request.dispatchId },
          },
        },
      ],
      nextCursor: null,
    });
    owner.directory.mockResolvedValue({
      members: [
        { profileId: humanId },
        { profileId: request.agentProfileId, allowedRelations: { wake: true } },
      ],
    });
    owner.delivery.mockResolvedValue(delivery());
    owner.connection.mockResolvedValue({
      connection: {
        connectionName: "github-member",
        scope: "member",
        updatedAtMs: 42,
      },
      selection: "requester",
    });
    owner.permission.mockResolvedValue({});
    owner.receipts.mockResolvedValue([
      {
        operationId: "original-write",
        actionId: "github.create_pull_request",
        status: "completed",
      },
    ]);
    owner.post.mockResolvedValue({ id: "continued-1" });
  });

  it("continues as the original human in the authoritative Thread with completed receipts, not a callback-driven rerun", async () => {
    expect(owner.post).not.toHaveBeenCalled();
    const result = await continuePluginConnection(env, input);
    expect(result).toEqual({
      status: "requested",
      sourceSignalId: "reply-1",
      signalId: "continued-1",
      spaceId: request.spaceId,
      targetProfileId: request.agentProfileId,
      threadId: "thr_11111111-1111-4111-8111-111111111111",
    });
    expect(owner.post).toHaveBeenCalledOnce();
    const posted = owner.post.mock.calls[0]?.[1];
    if (!posted) {
      throw new Error("Expected a continuation message");
    }
    expect(posted).toMatchObject({
      spaceId: request.spaceId,
      authoringPolicy: "user_authored",
      profile: { kind: "human", profileId: humanId, owner: "user_1" },
      messageEnvelope: {
        activationTargets: [request.agentProfileId],
        replyToSignalId: request.triggerMessageId,
      },
      threadContext: {
        threadId: "thr_11111111-1111-4111-8111-111111111111",
        rootSignalId: "thread-root",
      },
    });
    expect(posted.pluginContinuation).toMatchObject({
      service: "github",
      scope: "member",
      connectionName: "github-member",
      connectionUpdatedAtMs: 42,
      source: { signalId: request.triggerMessageId },
      reply: { signalId: "reply-1" },
      requesterProfileId: humanId,
      requesterUserId: "user_1",
      targetProfileId: request.agentProfileId,
    });
    expect(posted.meta).not.toHaveProperty("pluginContinuation");
    expect(posted.clientMessageId).toBe(posted.meta.clientMessageId);
    expect(posted.text).toContain('"operationId":"original-write"');
    expect(posted.text).toContain(
      "Do not restart the task or repeat completed operations."
    );
    expect(owner.connection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user_1",
        preference: "requester",
      })
    );
    expect(owner.permission).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionName: "github-member",
        effect: "read",
      })
    );
  });

  it("continues a completed Local Agent reply through the same Message/Wake owner and checks Local rather than Hosted permissions", async () => {
    owner.delivery.mockResolvedValue(null);
    owner.localBinding.mockResolvedValue({
      bindingId: request.bindingId,
      bindingState: "enabled_primary",
      runtimeKind: "openmeld_service",
    });
    owner.localProfile.mockResolvedValue({
      profileKind: "agent",
      organizationId: request.organizationId,
      ownerUserId: "user_1",
    });
    owner.localSource.mockResolvedValue({
      executionId: "rc-execution",
      bindingId: request.bindingId,
      dispatchId: request.dispatchId,
      targetProfileId: request.agentProfileId,
      sourceSignalId: request.triggerMessageId,
      requesterProfileId: humanId,
      requesterDisplayName: "Maya",
      createdAtMs: 100,
      completedAtMs: 200,
      threadContext: null,
    });
    await continuePluginConnection(env, input);
    expect(owner.localPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        consumer: "local_agent",
        connectionName: "github-member",
        effect: "read",
      })
    );
    expect(owner.permission).not.toHaveBeenCalled();
    expect(owner.post).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        pluginContinuation: expect.objectContaining({
          sourceDispatchId: request.dispatchId,
          targetProfileId: request.agentProfileId,
        }),
      })
    );
    await continuePluginConnection(env, input);
    expect(owner.post.mock.calls[0]?.[1].clientMessageId).toBe(
      owner.post.mock.calls[1]?.[1].clientMessageId
    );
  });

  it("does not fall back to Local continuation when a known Hosted execution is invalid", async () => {
    owner.delivery.mockResolvedValue(delivery({ status: "accepted" }));
    await expect(continuePluginConnection(env, input)).rejects.toThrow();
    expect(owner.localSource).not.toHaveBeenCalled();
    expect(owner.post).not.toHaveBeenCalled();
  });

  it("retries through the same idempotent message identity even from a different browser request", async () => {
    await continuePluginConnection(env, input);
    await continuePluginConnection(env, {
      ...input,
      context: {
        ...input.context,
        actorContext: {
          ...input.context.actorContext,
          requestId: "another-tab",
        },
      },
    });
    const first = owner.post.mock.calls[0]?.[1];
    const second = owner.post.mock.calls[1]?.[1];
    if (!(first && second)) {
      throw new Error("Expected two calls to the idempotent owner");
    }
    expect(second.clientMessageId).toBe(first.clientMessageId);
  });

  it.each([
    "pending",
    "outcome_unknown",
  ])("blocks a previous %s operation instead of executing another write", async (status) => {
    owner.receipts.mockResolvedValue([
      {
        operationId: "uncertain",
        actionId: "github.create_pull_request",
        status,
      },
    ]);
    await expect(continuePluginConnection(env, input)).rejects.toThrow(
      "reconciliation"
    );
    expect(owner.post).not.toHaveBeenCalled();
  });

  it("does not borrow the original requester's identity when an admin connects the organization account", async () => {
    owner.membership.mockResolvedValue({
      ok: true,
      userId: "another-admin",
      memberId: "admin-2",
      organizationId: request.organizationId,
      role: "owner",
    });
    await expect(continuePluginConnection(env, input)).rejects.toThrow(
      "account that made this request"
    );
    expect(owner.post).not.toHaveBeenCalled();
  });

  it.each([
    { status: "accepted" },
    { status: "failed" },
    { failureCode: "remote_agent.stopped" },
    { publishedSignalId: "other-reply" },
    { organizationId: "other-org" },
    { routineRunId: "routine-run" },
  ] as Partial<RemoteAgentNativeDeliveryRecord>[])("rejects a mismatched, unfinished, stopped, or unattended execution: %j", async (change) => {
    owner.delivery.mockResolvedValue(delivery(change));
    await expect(continuePluginConnection(env, input)).rejects.toThrow();
    expect(owner.post).not.toHaveBeenCalled();
  });

  it("does not change the scope requested by the original task", async () => {
    await expect(
      continuePluginConnection(env, { ...input, scope: "shared" })
    ).rejects.toThrow("not interchangeable");
    expect(owner.connection).not.toHaveBeenCalled();
    expect(owner.post).not.toHaveBeenCalled();
  });

  it("requires fresh Agent permission and current conversation membership", async () => {
    owner.permission.mockRejectedValueOnce(new Error("Agent access revoked"));
    await expect(continuePluginConnection(env, input)).rejects.toThrow(
      "Agent access revoked"
    );
    owner.directory.mockResolvedValue({ members: [{ profileId: humanId }] });
    await expect(continuePluginConnection(env, input)).rejects.toThrow(
      "no longer participate"
    );
    expect(owner.post).not.toHaveBeenCalled();
  });

  it("rejects client-selected task text and target identities at the schema boundary", async () => {
    await expect(
      continuePluginConnection(env, {
        ...input,
        text: "Publish everything",
        targetProfileId: "other-agent",
      })
    ).rejects.toThrow("valid connection continuation");
    expect(owner.signals).not.toHaveBeenCalled();
  });
});
