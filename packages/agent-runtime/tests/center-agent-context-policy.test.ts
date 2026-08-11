import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  freezeCenterAgentContextScopePlan,
  resolveCenterAgentContextScopePlan,
} from "../src/center-agent-context-policy";

describe("Center Agent context policy", () => {
  it("keeps the same verified requester continuity while changing disclosure for a shared channel", () => {
    const privatePolicy = resolveCenterAgentContextScopePlan(
      createEnvelope({
        interactionEnvironment: "requester_private",
        source: "web_dm",
      })
    );
    const sharedPolicy = resolveCenterAgentContextScopePlan(
      createEnvelope({
        interactionEnvironment: "externally_shared",
        source: "slack",
      })
    );

    expect(privatePolicy.requesterIdentity).toBe("verified_member");
    expect(privatePolicy.resultAudience).toBe("requester_only");
    expect(sharedPolicy.requesterIdentity).toBe("verified_member");
    expect(sharedPolicy.resultAudience).toBe("external_conversation");
    expect(privatePolicy.memberMemory).toBe("use_and_share");
    expect(sharedPolicy.memberMemory).toBe("use_privately");
    expect(sharedPolicy.organizationDocuments).toBe("use_privately");
    expect(sharedPolicy.organizationMemory).toBe("use_privately");
    expect(sharedPolicy.organizationSkills).toBe("use_privately");
  });

  it("lets a connected internal channel member use organization context without inventing personal continuity", () => {
    const envelope = createEnvelope({
      interactionEnvironment: "externally_shared",
      source: "message_channel",
    });
    envelope.sender = {
      displayName: "Ashley",
      id: "lark:connection-1:user-1",
      kind: "member",
      messageChannelIdentity: {
        connectionId: "connection-1",
        provider: "lark",
        providerUserId: "user-1",
      },
      verified: false,
    };

    expect(resolveCenterAgentContextScopePlan(envelope)).toMatchObject({
      memberMemory: "never_available",
      organizationDocuments: "use_privately",
      organizationMemory: "use_privately",
      organizationSkills: "use_privately",
      requesterIdentity: "connected_organization_member",
    });
  });

  it("makes organization and member context unavailable to an external participant", () => {
    const envelope = createEnvelope({
      interactionEnvironment: "externally_shared",
      source: "slack",
    });
    envelope.sender = {
      displayName: "External guest",
      id: "slack:team-1:guest-1",
      kind: "member",
      verified: false,
    };

    expect(resolveCenterAgentContextScopePlan(envelope)).toMatchObject({
      memberMemory: "never_available",
      organizationDocuments: "never_available",
      organizationMemory: "never_available",
      organizationSkills: "never_available",
      requesterIdentity: "external_participant",
    });
  });

  it("preserves the frozen interaction environment for a cross-channel Task continuation", () => {
    const envelope = createEnvelope({
      interactionEnvironment: "externally_shared",
      source: "task_continuation",
    });

    expect(resolveCenterAgentContextScopePlan(envelope)).toMatchObject({
      interactionEnvironment: "externally_shared",
      memberMemory: "use_privately",
      organizationDocuments: "use_privately",
      organizationMemory: "use_privately",
      organizationSkills: "use_privately",
    });
  });

  it("derives a safe environment for a legacy envelope that predates the frozen field", () => {
    const envelope = createEnvelope({ source: "web_dm" });

    expect(resolveCenterAgentContextScopePlan(envelope)).toMatchObject({
      interactionEnvironment: "requester_private",
      memberMemory: "use_and_share",
      organizationDocuments: "share_when_authorized",
      organizationMemory: "share_when_authorized",
      organizationSkills: "share_when_authorized",
    });
  });

  it("freezes one versioned scope plan that later execution can verify", () => {
    const frozen = freezeCenterAgentContextScopePlan(
      createEnvelope({
        interactionEnvironment: "externally_shared",
        source: "slack",
      })
    );

    expect(frozen.contextScopePlan).toEqual({
      authenticationSecrets: "never_available",
      interactionEnvironment: "externally_shared",
      memberMemory: "use_privately",
      organizationDocuments: "use_privately",
      organizationMemory: "use_privately",
      organizationSkills: "use_privately",
      protectedInformation: "use_privately",
      requesterIdentity: "verified_member",
      resultAudience: "external_conversation",
      v: 1,
    });
    expect(resolveCenterAgentContextScopePlan(frozen)).toEqual(
      frozen.contextScopePlan
    );
  });

  it("fails closed when a frozen plan no longer matches the requester or audience", () => {
    const frozen = freezeCenterAgentContextScopePlan(
      createEnvelope({
        interactionEnvironment: "requester_private",
        source: "web_dm",
      })
    );

    expect(() =>
      resolveCenterAgentContextScopePlan({
        ...frozen,
        interactionEnvironment: "externally_shared",
        space: {
          ...frozen.space,
          isCenterAgentDm: false,
          kind: "space",
        },
        trigger: { source: "slack" },
      })
    ).toThrow("Center Agent Context Scope Plan no longer matches this turn");
  });
});

function createEnvelope(input: {
  interactionEnvironment?: RemoteAgentTurnEnvelope["interactionEnvironment"];
  source: "message_channel" | "slack" | "task_continuation" | "web_dm";
}): RemoteAgentTurnEnvelope {
  let trigger: RemoteAgentTurnEnvelope["trigger"];
  if (input.source === "message_channel") {
    trigger = {
      connectionId: "connection-1",
      conversationId: "conversation-1",
      provider: "lark",
      source: "message_channel",
    };
  } else if (input.source === "task_continuation") {
    trigger = {
      delegationId: "delegation-1",
      outcome: {
        errorCode: null,
        eventId: "event-1",
        occurredAtMs: 1,
        publishedSignalId: "signal-1",
        status: "succeeded",
      },
      source: "task_continuation",
      subscriptionId: "subscription-1",
      watchedTask: {
        deliveryId: "delivery-1",
        kind: "native_delivery",
        v: 1,
      },
    };
  } else {
    trigger = { source: input.source };
  }

  return {
    centerAgent: {
      profileHandle: "center-agent",
      profileName: "Center Agent",
    },
    ...(input.interactionEnvironment
      ? { interactionEnvironment: input.interactionEnvironment }
      : {}),
    organization: {
      id: "organization-1",
      memberCount: 3,
      name: "OpenMeld",
      personal: false,
    },
    sender: {
      displayName: "Felix",
      id: "member-1",
      kind: "member",
      ownerUserId: "user-1",
      profileId: "profile-1",
      verified: true,
    },
    space: {
      id: "conversation-1",
      isCenterAgentDm: input.source === "web_dm",
      kind: input.source === "web_dm" ? "dm" : "space",
      name: "Conversation",
    },
    trigger,
  };
}
