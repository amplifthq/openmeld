import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import {
  readPluginChannelRequestSource,
  resolveCurrentPluginChannelTarget,
} from "../src/connectors/plugin-channel-source";
import type { CoreBindings } from "../src/lib/bindings";
import { buildPluginChannelSourceProof } from "../src/remote-agent/application/plugin-channel-source-proof";

const owners = vi.hoisted(() => ({
  member: vi.fn(),
  delivery: vi.fn(),
  metadata: vi.fn(),
  workspace: vi.fn(),
  link: vi.fn(),
  target: vi.fn(),
  channelTarget: vi.fn(),
  registry: vi.fn(),
  token: vi.fn(),
  user: vi.fn(),
  message: vi.fn(),
}));
vi.mock("../src/lib/bindings", () => ({
  identityDb: () => ({}),
  localStateDb: () => ({}),
  wakeEvidenceDb: () => ({}),
}));
vi.mock("../src/organizations/organization-context", () => ({
  resolveActiveOrganizationMembership: owners.member,
}));
vi.mock(
  "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo",
  () => ({ readRemoteAgentNativeDeliveryByDeliveryId: owners.delivery })
);
vi.mock(
  "../src/remote-agent/infrastructure/d1/plugin-channel-metadata-repo",
  () => ({ readPluginChannelMetadata: owners.metadata })
);
vi.mock(
  "../src/remote-agent/infrastructure/d1/slack-workspace-binding-repo",
  () => ({ readRemoteAgentSlackWorkspaceBinding: owners.workspace })
);
vi.mock(
  "../src/remote-agent/infrastructure/d1/slack-user-identity-link-repo",
  () => ({ readSlackUserIdentityLink: owners.link })
);
vi.mock(
  "../src/remote-agent/application/message-channel-turn-resolution",
  () => ({
    resolveMessageChannelCenterAgentTarget: owners.target,
    resolveMessageChannelTurnTarget: owners.channelTarget,
  })
);
vi.mock(
  "../src/remote-agent/application/message-channel-provider-runtime",
  () => ({ createConfiguredMessageChannelProviderRegistry: owners.registry })
);
vi.mock("../src/remote-agent/application/slack-bot-token", () => ({
  resolveSlackBotToken: owners.token,
}));
vi.mock("../src/remote-agent/application/slack-client", async (load) => ({
  ...(await load<
    typeof import("../src/remote-agent/application/slack-client")
  >()),
  readSlackUserIdentity: owners.user,
  readSlackMessageByTimestamp: owners.message,
}));
const request = createSubmitTurnRequest();
const original = {
  ...request,
  turnEnvelope: {
    ...request.turnEnvelope,
    sender: {
      ...request.turnEnvelope.sender,
      messageChannelIdentity: {
        provider: "slack",
        connectionId: "team",
        providerUserId: "U1",
      },
    },
  },
};
const delivery = {
  deliveryId: "source",
  organizationId: request.organizationId,
  profileId: request.agentProfileId,
  bindingId: request.bindingId,
  spaceId: request.spaceId,
  completedAtMs: 2,
  status: "completed",
  conversationKind: "slack",
  failureCode: null,
  routineRunId: null,
  workerSubmitRequest: original,
  slackTeamId: "team",
  slackChannelId: "channel",
  slackThreadTs: "thread",
};
const input = {
  expectedOrganizationId: request.organizationId,
  requestId: "source",
  context: {
    activeOrganizationId: request.organizationId,
    actorContext: {
      requestId: "channel-source-test",
      profileKind: "human",
      openMeldProfileId: request.author.profileId,
      ownerUserId: "user_1",
    },
  },
};
const env = {} as CoreBindings;
let metadata: {
  v: number;
  kind: string;
  proof: Awaited<ReturnType<typeof buildPluginChannelSourceProof>>;
  intent: { service: string; scope: string; expiresAtMs: number };
};
beforeEach(async () => {
  for (const mock of Object.values(owners)) {
    mock.mockReset();
  }
  metadata = {
    v: 1,
    kind: "source",
    proof: await buildPluginChannelSourceProof({
      provider: "slack",
      messageId: "message",
      providerUserId: "U1",
      text: "Original",
      resourceIds: [],
    }),
    intent: {
      service: "github",
      scope: "shared",
      expiresAtMs: Date.now() + 60_000,
    },
  };
  owners.member.mockResolvedValue({
    ok: true,
    organizationId: request.organizationId,
    userId: "user_1",
    memberId: "member",
    role: "member",
  });
  owners.delivery.mockResolvedValue(delivery);
  owners.metadata.mockResolvedValue(metadata);
  owners.workspace.mockResolvedValue({
    organizationId: request.organizationId,
  });
  owners.link.mockResolvedValue({
    organizationId: request.organizationId,
    openmeldUserId: "user_1",
  });
  owners.target.mockResolvedValue({
    status: "resolved",
    target: {
      agentProfileId: request.agentProfileId,
      bindingId: request.bindingId,
      profileName: "Agent",
    },
  });
  owners.token.mockResolvedValue("private-bot-token");
  owners.user.mockResolvedValue({
    teamId: "team",
    isDeleted: false,
    isRestricted: false,
    isUltraRestricted: false,
    isStranger: false,
  });
  owners.message.mockResolvedValue({
    message: { ts: "message", userId: "U1", text: "Original", files: [] },
  });
});
describe("channel request IDs are not bearer authorization", () => {
  it("only previews for the original authenticated member and rechecks the actual linked provider and exact original", async () => {
    const source = await readPluginChannelRequestSource(env, input);
    const target = await resolveCurrentPluginChannelTarget(env, source);
    await target.readProof();
    expect(owners.message).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "channel",
        messageTs: "message",
        threadTs: "thread",
      })
    );
  });
  it.each([
    "feishu",
    "lark",
  ] as const)("verifies current %s membership/profile and preserves the exact provider conversation before reading source data", async (provider) => {
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
      providerUserId: "U1",
    };
    owners.delivery.mockResolvedValue({
      ...delivery,
      conversationKind: "message_channel",
      messageChannelLocator: locator,
      workerSubmitRequest: {
        ...original,
        turnEnvelope: {
          ...original.turnEnvelope,
          sender: {
            ...original.turnEnvelope.sender,
            messageChannelIdentity: identity,
          },
        },
      },
    });
    const proof = { ...metadata.proof, provider };
    owners.metadata.mockResolvedValue({ ...metadata, proof });
    const target = {
      participant: {
        kind: "member",
        member: { userId: "user_1", humanProfileId: request.author.profileId },
      },
      connection: { ...locator, organizationId: request.organizationId },
      centerAgent: {
        agentProfileId: request.agentProfileId,
        bindingId: request.bindingId,
      },
    };
    owners.channelTarget.mockResolvedValue({ status: "resolved", target });
    const readProof = vi.fn(async () => proof);
    owners.registry.mockReturnValue({
      require: () => ({ readPluginSourceProof: readProof }),
    });
    const source = await readPluginChannelRequestSource(env, input);
    await (await resolveCurrentPluginChannelTarget(env, source)).readProof();
    expect(readProof).toHaveBeenCalledWith(
      expect.objectContaining({ locator, messageId: "message" })
    );
    owners.channelTarget.mockResolvedValue({
      status: "resolved",
      target: {
        ...target,
        participant: {
          kind: "member",
          member: { userId: "user_1", humanProfileId: "different-profile" },
        },
      },
    });
    await expect(
      resolveCurrentPluginChannelTarget(env, source)
    ).rejects.toThrow("continuation_unavailable");
    expect(readProof).toHaveBeenCalledOnce();
  });

  it.each([
    "other_user",
    "other_profile",
    "other_org",
    "not_completed",
    "missing_intent",
    "expired",
    "unverified",
  ])("rejects %s before provider access", async (mode) => {
    if (mode === "other_user") {
      owners.member.mockResolvedValue({
        ok: true,
        organizationId: request.organizationId,
        userId: "admin",
        role: "owner",
      });
    }
    if (mode === "other_profile") {
      owners.delivery.mockResolvedValue({
        ...delivery,
        workerSubmitRequest: {
          ...original,
          author: { ...original.author, profileId: "different" },
        },
      });
    }
    if (mode === "other_org") {
      owners.delivery.mockResolvedValue({
        ...delivery,
        organizationId: "other",
      });
    }
    if (mode === "not_completed") {
      owners.delivery.mockResolvedValue({ ...delivery, status: "accepted" });
    }
    if (mode === "missing_intent") {
      owners.metadata.mockResolvedValue(null);
    }
    if (mode === "expired") {
      owners.metadata.mockResolvedValue({
        ...metadata,
        intent: { ...metadata.intent, expiresAtMs: 1 },
      });
    }
    if (mode === "unverified") {
      owners.delivery.mockResolvedValue({
        ...delivery,
        workerSubmitRequest: {
          ...original,
          turnEnvelope: {
            ...original.turnEnvelope,
            sender: { ...original.turnEnvelope.sender, verified: false },
          },
        },
      });
    }
    await expect(readPluginChannelRequestSource(env, input)).rejects.toThrow();
    expect(owners.token).not.toHaveBeenCalled();
  });
  it.each([
    "unlinked",
    "binding_changed",
    "provider_membership_revoked",
    "source_edited",
    "source_recalled",
  ])("blocks %s through the current authority, not frozen setup facts", async (mode) => {
    const source = await readPluginChannelRequestSource(env, input);
    if (mode === "unlinked") {
      owners.link.mockResolvedValue(null);
    }
    if (mode === "binding_changed") {
      owners.target.mockResolvedValue({
        target: {
          agentProfileId: request.agentProfileId,
          bindingId: "new-binding",
        },
      });
    }
    if (mode === "provider_membership_revoked") {
      owners.user.mockResolvedValue({ teamId: "team", isDeleted: true });
    }
    if (mode === "source_edited") {
      owners.message.mockResolvedValue({
        message: {
          ts: "message",
          userId: "U1",
          text: "Original",
          files: [],
          editedTs: "10.0",
        },
      });
    }
    if (mode === "source_recalled") {
      owners.message.mockResolvedValue({ message: null });
    }
    await expect(
      (async () => {
        const target = await resolveCurrentPluginChannelTarget(env, source);
        await target.readProof();
      })()
    ).rejects.toThrow();
  });
});
