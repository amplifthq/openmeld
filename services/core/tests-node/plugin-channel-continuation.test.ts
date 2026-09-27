import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubmitTurnRequest,
  TEST_CENTER_AGENT_MODEL_ROUTE,
} from "../../remote-agent/tests/fixtures";
import {
  continuePluginChannelConnection,
  previewPluginChannelConnection,
} from "../src/connectors/plugin-channel-continuation";
import type { CoreBindings } from "../src/lib/bindings";

const owner = vi.hoisted(() => ({
  source: vi.fn(),
  target: vi.fn(),
  proof: vi.fn(),
  connection: vi.fn(),
  permission: vi.fn(),
  receipts: vi.fn(),
  select: vi.fn(),
  slack: vi.fn(),
  lark: vi.fn(),
}));
vi.mock("../src/connectors/plugin-channel-source", () => ({
  readPluginChannelRequestSource: owner.source,
  resolveCurrentPluginChannelTarget: owner.target,
  channelContinuationDenied: (message: string) => new Error(message),
}));
vi.mock("../src/connectors/connector-connection-repository", () => ({
  selectActiveConnectorConnection: owner.connection,
}));
vi.mock("../src/connectors/plugin-access", () => ({
  requireRemotePluginConnection: owner.permission,
}));
vi.mock("../src/center-agent/connector-action-operation-repository", () => ({
  listConnectorOperationReceiptsForContinuation: owner.receipts,
}));
vi.mock(
  "../src/remote-agent/infrastructure/d1/plugin-channel-metadata-repo",
  () => ({ selectPluginChannelAccount: owner.select })
);
vi.mock("../src/remote-agent/application/native-delivery-service", () => ({
  submitRemoteAgentSlackNativeDelivery: owner.slack,
}));
vi.mock(
  "../src/remote-agent/application/message-channel-native-delivery-service",
  () => ({ submitRemoteAgentMessageChannelNativeDelivery: owner.lark })
);
const request = createSubmitTurnRequest();
const input = {
  requestId: "source",
  expectedOrganizationId: request.organizationId,
  scope: "shared",
  context: {
    activeOrganizationId: request.organizationId,
    actorContext: {
      requestId: "channel-continue-test",
      profileKind: "human",
      openMeldProfileId: request.author.profileId,
      ownerUserId: "user_1",
    },
  },
};
const source = {
  db: {},
  identities: {},
  state: {},
  member: {
    organizationId: request.organizationId,
    memberId: "member",
    userId: "user_1",
    role: "member",
  },
  delivery: {
    deliveryId: "source",
    profileId: request.agentProfileId,
    bindingId: request.bindingId,
    spaceId: request.spaceId,
    completedAtMs: 2,
    createdAtMs: 1,
    triggerText: "Original",
  },
  request,
  sender: request.turnEnvelope.sender,
  intent: {
    service: "github",
    scope: "choose",
    expiresAtMs: Date.now() + 60_000,
  },
  metadata: {
    kind: "source",
    proof: {
      provider: "slack",
      messageId: "original",
      providerUserId: "U1",
      fingerprint: "a".repeat(64),
      revision: null,
    },
  },
  identity: { provider: "slack" },
};
const target = {
  kind: "slack",
  target: {
    profileName: "Agent",
    modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
    ownerUserId: null,
  },
  slackTeamId: "team",
  slackChannelId: "channel",
  slackThreadTs: "thread",
  readProof: owner.proof,
};
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected recorded fixture invocation");
  }
  return value;
}
const env = {} as CoreBindings;
beforeEach(() => {
  for (const mock of Object.values(owner)) {
    mock.mockReset();
  }
  owner.source.mockResolvedValue(source);
  owner.target.mockResolvedValue(target);
  owner.connection.mockResolvedValue({
    connection: {
      service: "github",
      scope: "shared",
      connectionName: "github-org",
      updatedAtMs: 42,
    },
  });
  owner.receipts.mockResolvedValue([
    {
      operationId: "already-done",
      status: "completed",
      actionId: "existing.write",
    },
  ]);
  owner.select.mockImplementation(async (_db, _id, selected) => selected);
  owner.slack.mockResolvedValue({ status: "submitted" });
});
describe("explicit external Plugin continuation composes existing owners", () => {
  it("preview is read-only and never selects a connection or starts a task", async () => {
    expect(
      await previewPluginChannelConnection(env, { ...input, scope: undefined })
    ).toMatchObject({ service: "github", provider: "slack" });
    expect(owner.select).not.toHaveBeenCalled();
    expect(owner.slack).not.toHaveBeenCalled();
  });
  it("rechecks the original before acceptance and submits repeat clicks with the same destination, account and operation identity", async () => {
    for (let i = 0; i < 2; i += 1) {
      expect(await continuePluginChannelConnection(env, input)).toMatchObject({
        status: "requested",
        requestId: "source",
      });
    }
    expect(owner.slack).toHaveBeenCalledTimes(2);
    const first = required(owner.slack.mock.calls[0])[0].request;
    const again = required(owner.slack.mock.calls[1])[0].request;
    expect(first.idempotencyKey).toBe(again.idempotencyKey);
    expect(first).toMatchObject({
      agentProfileId: request.agentProfileId,
      conversationId: request.spaceId,
      slackChannelId: "channel",
      slackThreadTs: "thread",
      pluginSelection: {
        scope: "shared",
        connectionName: "github-org",
        connectionUpdatedAtMs: 42,
      },
      pluginSourceProof: source.metadata.proof,
    });
    expect(first.sourceText).toContain("already-done");
    expect(owner.proof.mock.invocationCallOrder[0]).toBeLessThan(
      required(owner.select.mock.invocationCallOrder[0])
    );
    expect(owner.select.mock.invocationCallOrder[0]).toBeLessThan(
      required(owner.slack.mock.invocationCallOrder[0])
    );
    expect(first.turnEnvelope.sender.verified).toBe(true);
  });
  it.each([
    "feishu",
    "lark",
  ] as const)("continues %s through the actual shared submission adapter with preserved original identity and proof", async (provider) => {
    const locator = {
      provider,
      connectionId: "connection",
      appId: "app",
      tenantKey: "tenant",
      chatId: "chat",
      rootMessageId: "root",
    };
    const identity = {
      provider,
      connectionId: "connection",
      providerUserId: "ou_user",
    };
    const sender = { ...source.sender, messageChannelIdentity: identity };
    owner.source.mockResolvedValue({
      ...source,
      identity,
      sender,
      metadata: {
        ...source.metadata,
        proof: { ...source.metadata.proof, provider },
      },
      request: {
        ...request,
        turnEnvelope: {
          ...request.turnEnvelope,
          sender,
          trigger: {
            source: "message_channel",
            provider,
            connectionId: "connection",
            conversationId: request.spaceId,
          },
          channelContext: {
            provider,
            conversationId: request.spaceId,
            currentMessageId: "original",
            messages: [],
            sync: { mode: "snapshot", status: "complete" },
          },
        },
      },
    });
    owner.target.mockResolvedValue({
      kind: "lark",
      locator,
      registry: {},
      readProof: owner.proof,
      target: {
        centerAgent: {
          agentProfileId: request.agentProfileId,
          bindingId: request.bindingId,
          profileName: "Agent",
          profileHandle: "agent",
          modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        },
        participant: {
          kind: "member",
          member: {
            memberId: "member",
            userId: "user_1",
            humanProfileId: request.author.profileId,
            role: "member",
            userDisplayName: "Ari",
            memberCount: 2,
            organizationName: "Acme",
            organizationPersonal: false,
          },
        },
      },
    });
    owner.lark.mockResolvedValue({ status: "submitted" });
    expect(await continuePluginChannelConnection(env, input)).toMatchObject({
      status: "requested",
      provider,
    });
    expect(owner.slack).not.toHaveBeenCalled();
    const published = required(owner.lark.mock.calls[0])[0].request;
    expect(published).toMatchObject({
      locator,
      pluginSelection: { scope: "shared", connectionName: "github-org" },
      pluginSourceProof: { provider },
      turnEnvelope: {
        sender: {
          ownerUserId: "user_1",
          profileId: request.author.profileId,
          verified: true,
        },
        trigger: { provider, connectionId: "connection" },
      },
    });
    expect(published.turnEnvelope.channelContext.currentMessageId).toBe(
      published.triggerMessageId
    );
  });

  it.each([
    "pending",
    "outcome_unknown",
    "source_changed",
    "permission",
    "connection_replaced",
    "scope_mismatch",
  ])("does not dispatch on %s", async (mode) => {
    if (mode === "pending" || mode === "outcome_unknown") {
      owner.receipts.mockResolvedValue([{ operationId: "old", status: mode }]);
    }
    if (mode === "source_changed") {
      owner.proof.mockRejectedValue(new Error("original_request_changed"));
    }
    if (mode === "permission") {
      owner.permission.mockRejectedValue(new Error("revoked"));
    }
    if (mode === "connection_replaced") {
      owner.source.mockResolvedValue({
        ...source,
        metadata: {
          ...source.metadata,
          selection: {
            scope: "shared",
            connectionName: "previous",
            connectionUpdatedAtMs: 41,
          },
        },
      });
    }
    if (mode === "scope_mismatch") {
      owner.source.mockResolvedValue({
        ...source,
        intent: { ...source.intent, scope: "member" },
      });
    }
    await expect(continuePluginChannelConnection(env, input)).rejects.toThrow();
    expect(owner.slack).not.toHaveBeenCalled();
    expect(owner.lark).not.toHaveBeenCalled();
  });
  it("rejects client task text, account names, target IDs and requester overrides", async () => {
    await expect(
      continuePluginChannelConnection(env, {
        ...input,
        sourceText: "Do something else",
        targetProfileId: "other",
      })
    ).rejects.toThrow();
    expect(owner.source).not.toHaveBeenCalled();
  });
});
