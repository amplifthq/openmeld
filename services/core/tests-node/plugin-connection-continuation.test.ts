import {
  appendPluginConnectionReplyLink,
  buildOpenMeldNavigationAction,
  pluginActionRequestIntentSchema,
  pluginConnectionLocalSourceRequestSchema,
} from "@openmeld/schemas";
import { normalizeListSignalsReadQuerySemantics } from "@openmeld/schemas/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { continuePluginConnection } from "../src/connectors/plugin-connection-continuation";
import type { CoreBindings } from "../src/lib/bindings";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import type { ListSignalsInput } from "../src/rpc/methods";

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
  replyPlacement: vi.fn(),
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

const request = createSubmitTurnRequest({ spaceId: "a".repeat(64) });
const humanId = request.author.profileId as string;
const env = {
  OPENMELD_POSTGRESQL: {
    connectionString:
      "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
  },
  WEB_APP_URL: "https://openmeld.ai",
  OPENMELD_SPACES: {
    idFromString: (id: string) => id,
    get: () => ({ rpcResolveNativeReplyPlacement: owner.replyPlacement }),
  },
} as unknown as CoreBindings;
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

function mockLocalSource() {
  owner.delivery.mockResolvedValue(null);
  owner.localBinding.mockResolvedValue({
    bindingId: request.bindingId,
    bindingState: "enabled_primary",
    runtimeKind: "openmeld_service",
  });
  owner.localSource.mockImplementation((_env, sourceInput) => {
    pluginConnectionLocalSourceRequestSchema.parse(sourceInput);
    return {
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
    };
  });
}

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
    workerSubmitRequest: null,
    executionRecoverySubmitRequest: request,
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
    owner.localProfile.mockImplementation((_env, id) => ({
      profileKind: id === humanId ? "human" : "agent",
      ownerUserId: "user_1",
      organizationId: request.organizationId,
    }));
    owner.membership.mockResolvedValue({
      ok: true,
      userId: "user_1",
      memberId: "member_123",
      organizationId: request.organizationId,
      role: "owner",
    });
    owner.slug.mockResolvedValue("acme");
    owner.signals.mockImplementation((_env, query: ListSignalsInput) => {
      normalizeListSignalsReadQuerySemantics({
        recentOnly: query.recent === true,
        hasExplicitLimit: query.limit !== undefined,
        limit: query.limit ?? null,
        afterSignalId: query.afterSignalId ?? null,
        aroundSignalId: query.aroundSignalId ?? null,
        beforeCount: query.beforeCount ?? null,
        afterCount: query.afterCount ?? null,
      });
      return {
        signals: [
          {
            id: request.triggerMessageId,
            type: "signal.text",
            profile: { kind: "human", profileId: humanId },
            data: { text: "Original request" },
          },
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
      };
    });
    owner.directory.mockResolvedValue({
      members: [
        { profileId: humanId },
        { profileId: request.agentProfileId, allowedRelations: { wake: true } },
      ],
    });
    owner.delivery.mockResolvedValue(delivery());
    owner.replyPlacement.mockResolvedValue({
      dispatchId: request.dispatchId,
      sourceSignalId: request.triggerMessageId,
      profileId: request.agentProfileId,
      threadContext: delivery().threadContext,
      locked: true,
    });
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

  it.each([
    ["approved", true],
    ["approved-linear", true],
    ["approved-from-another-profile", true],
    ["approved-local-from-another-profile", true],
    ["approved-other-account", false],
    ["changed-source", false],
    ["changed-account", false],
  ] as const)("continues only the exact %s Plugin operation", async (scenario, allowed) => {
    const service = scenario === "approved-linear" ? "linear" : "github";
    const account = `${service}-member`;
    const sourceInput = { ...input, service };
    owner.connection.mockResolvedValue({
      connection: { connectionName: account, scope: "member", updatedAtMs: 42 },
      selection: "requester",
    });
    if (scenario === "approved-other-account") {
      owner.localProfile.mockResolvedValue({
        profileKind: "human",
        ownerUserId: "another-account",
      });
    }
    if (scenario === "approved-local-from-another-profile") {
      mockLocalSource();
    }
    const approval = {
      requestId: "11111111-1111-4111-8111-111111111111",
      intent: pluginActionRequestIntentSchema.parse({
        organizationId: request.organizationId,
        userId: "user_1",
        actorProfileId: request.agentProfileId,
        operationId: "original-issue-write",
        sourceRequestKey: "delivery-1",
        sourceSpaceId: request.spaceId,
        sourceSignalId:
          scenario === "changed-source"
            ? "another-message"
            : request.triggerMessageId,
        connection: {
          connectionName:
            scenario === "changed-account" ? "other-account" : account,
          scope: "member",
          ownerUserId: "user_1",
          ownerDisplayName: "Avery",
          service,
        },
        connectionUpdatedAtMs: 42,
        accessRevision: 1,
        service,
        actionId:
          service === "linear"
            ? "linear.create_linear_issue"
            : "github.create_issue",
        effect: "write",
        input:
          service === "linear"
            ? { teamId: "team-id" }
            : { owner: "northstar", repo: "review" },
        ...(scenario === "approved-local-from-another-profile"
          ? {}
          : {
              recovery: {
                input:
                  service === "linear"
                    ? {
                        title: "Original issue",
                        description: "Original body",
                        team_id: "team-id",
                      }
                    : { title: "Original issue", body: "Original body" },
              },
            }),
      }),
    };
    if (!allowed) {
      await expect(
        continuePluginConnection(env, sourceInput, approval)
      ).rejects.toThrow("plugin.continue.");
      expect(owner.post).not.toHaveBeenCalled();
      return;
    }
    const approvalInput = scenario.includes("from-another-profile")
      ? {
          ...sourceInput,
          context: {
            ...input.context,
            actorContext: {
              ...input.context.actorContext,
              openMeldProfileId: "33333333-3333-4333-8333-333333333333",
            },
          },
        }
      : sourceInput;
    await continuePluginConnection(env, approvalInput, approval);
    const first = owner.post.mock.calls[0]?.[1];
    expect(first.context.actorContext.openMeldProfileId).toBe(humanId);
    expect(first.profile.profileId).toBe(humanId);
    if (scenario === "approved-local-from-another-profile") {
      expect(
        owner.localSource.mock.calls[0]?.[1].context.actorContext
          .openMeldProfileId
      ).toBe(humanId);
    }
    expect(first.text).not.toContain("Operation receipts");
    expect(owner.receipts).not.toHaveBeenCalled();
    if (approval.intent.recovery) {
      expect(first.text).toBe(
        `Approved creating the ${service === "linear" ? "Linear" : "GitHub"} issue. Continue the original request.`
      );
      expect(first.text).not.toContain(approval.requestId);
      expect(first.text).not.toContain(approval.intent.operationId);
      expect(first.pluginContinuation.approvedActionRequestId).toBe(
        approval.requestId
      );
    } else {
      expect(first.text).toContain("original-issue-write");
    }
    expect(first.messageEnvelope.replyToSignalId).toBe(
      request.triggerMessageId
    );
    expect(first.threadContext ?? null).toEqual(
      scenario === "approved-local-from-another-profile"
        ? null
        : delivery().threadContext
    );
    await continuePluginConnection(env, approvalInput, approval);
    expect(owner.post.mock.calls[1]?.[1].clientMessageId).toBe(
      first.clientMessageId
    );
  });

  it.each([
    "https://openmeld.ai",
    "https://app.openmeld.ai",
  ])("continues the original human's persisted task at %s with its Thread and completed receipts", async (webAppUrl) => {
    expect(owner.post).not.toHaveBeenCalled();
    const result = await continuePluginConnection(
      { ...env, WEB_APP_URL: webAppUrl },
      input
    );
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

  it("continues a main-conversation request inside the Thread owned by its published native reply", async () => {
    owner.delivery.mockResolvedValue(delivery({ threadContext: null }));
    await continuePluginConnection(env, input);
    expect(owner.replyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: request.spaceId,
        dispatchId: request.dispatchId,
        sourceSignalId: request.triggerMessageId,
        profileId: request.agentProfileId,
        lock: true,
      })
    );
    expect(owner.post).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        threadContext: delivery().threadContext,
        pluginContinuation: expect.objectContaining({
          threadContext: delivery().threadContext,
        }),
      })
    );
  });

  it("continues a completed Local Agent reply through the same Message/Wake owner and checks Local rather than Hosted permissions", async () => {
    mockLocalSource();
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
    { executionRecoverySubmitRequest: null, workerSubmitRequest: request },
    {
      executionRecoverySubmitRequest: {
        ...request,
        dispatchId: "unrelated-dispatch",
      },
    },
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
