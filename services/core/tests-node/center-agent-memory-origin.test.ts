import type {
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  resolveExplicitMemoryEpisodeOrigin,
  resolveExplicitMemorySourceDeliveryDb,
  resolveExplicitMemorySourceTurnRequest,
} from "../src/center-agent-memory/explicit-memory-origin";
import type { CoreBindings } from "../src/lib/bindings";

describe("explicit organization memory origin", () => {
  it("reads the source delivery from the Wake evidence ledger when domain stores are split", () => {
    const localStateDb = {} as D1Database;
    const wakeEvidenceDb = {} as D1Database;
    const env = {
      OPENMELD_DB: undefined,
      OPENMELD_LOCAL_STATE_DB: localStateDb,
      OPENMELD_WAKE_EVIDENCE_DB: wakeEvidenceDb,
    } as unknown as CoreBindings;

    expect(resolveExplicitMemorySourceDeliveryDb(env)).toBe(wakeEvidenceDb);
    expect(resolveExplicitMemorySourceDeliveryDb(env)).not.toBe(localStateDb);
  });

  it("uses the execution recovery request after hosted admission clears the transient request", () => {
    const recoveryRequest = createWorkerSubmitRequest();

    expect(
      resolveExplicitMemorySourceTurnRequest({
        executionRecoverySubmitRequest: recoveryRequest,
        workerSubmitRequest: null,
        workerSubmitRequestState: "absent",
      })
    ).toBe(recoveryRequest);
  });

  it("still accepts a valid transient request before hosted admission finishes", () => {
    const workerSubmitRequest = createWorkerSubmitRequest();

    expect(
      resolveExplicitMemorySourceTurnRequest({
        executionRecoverySubmitRequest: null,
        workerSubmitRequest,
        workerSubmitRequestState: "valid",
      })
    ).toBe(workerSubmitRequest);
  });

  it("preserves the exact Message Channel surface behind an explicit save", () => {
    const turnEnvelope = createTurnEnvelope({
      spaceId: "lark:connection_1:chat_1:root_message_1",
      trigger: {
        connectionId: "connection_1",
        conversationId: "lark:connection_1:chat_1:root_message_1",
        provider: "lark",
        source: "message_channel",
      },
    });

    expect(
      resolveExplicitMemoryEpisodeOrigin({
        createdAtMs: 1200,
        expectedOrganizationId: "org_1",
        expectedProfileId: "agent_1",
        organizationId: "org_1",
        profileId: "agent_1",
        sourceMessageId: "message_1",
        turnEnvelope,
      })
    ).toEqual({
      messageChannelProvider: "lark",
      occurredAtMs: 1200,
      source: "message_channel_conversation",
      sourceConversationId: "lark:connection_1:chat_1:root_message_1",
      sourceMessageId: "message_1",
    });
  });

  it("keeps explicit save mechanism separate from a shared Space source", () => {
    const turnEnvelope = createTurnEnvelope({
      spaceId: "space_launch",
      trigger: { source: "space_wake" },
    });

    expect(
      resolveExplicitMemoryEpisodeOrigin({
        createdAtMs: 1200,
        expectedOrganizationId: "org_1",
        expectedProfileId: "agent_1",
        organizationId: "org_1",
        profileId: "agent_1",
        sourceMessageId: "message_1",
        turnEnvelope,
      })
    ).toEqual({
      occurredAtMs: 1200,
      source: "space_conversation",
      sourceConversationId: "space_launch",
      sourceMessageId: "message_1",
    });
  });

  it.each([
    {
      interactionEnvironment: "requester_private" as const,
      isCenterAgentDm: true,
      label: "private Web DM",
      trigger: { source: "web_dm" as const },
    },
    {
      interactionEnvironment: "requester_private" as const,
      isCenterAgentDm: false,
      label: "private Slack DM",
      trigger: {
        conversationId: "slack:T123:D123:1700000000.000001",
        source: "slack" as const,
      },
    },
    {
      interactionEnvironment: "requester_private" as const,
      isCenterAgentDm: false,
      label: "private Lark DM",
      trigger: {
        connectionId: "connection_1",
        conversationId: "lark:connection_1:chat_1:root_message_1",
        provider: "lark" as const,
        source: "message_channel" as const,
      },
    },
    {
      interactionEnvironment: "requester_private" as const,
      isCenterAgentDm: false,
      label: "private Feishu DM",
      trigger: {
        connectionId: "connection_1",
        conversationId: "feishu:connection_1:chat_1:root_message_1",
        provider: "feishu" as const,
        source: "message_channel" as const,
      },
    },
    {
      interactionEnvironment: "externally_shared" as const,
      isCenterAgentDm: false,
      label: "externally shared channel",
      trigger: {
        connectionId: "connection_1",
        conversationId: "feishu:connection_1:chat_1:root_message_1",
        provider: "feishu" as const,
        source: "message_channel" as const,
      },
    },
  ])("rejects an explicit Organization memory save from a $label", ({
    interactionEnvironment,
    isCenterAgentDm,
    trigger,
  }) => {
    const baseEnvelope = createTurnEnvelope({
      spaceId: "conversation_1",
      trigger,
    });
    const turnEnvelope: RemoteAgentTurnEnvelope = {
      ...baseEnvelope,
      interactionEnvironment,
      space: {
        ...baseEnvelope.space,
        isCenterAgentDm,
        kind: isCenterAgentDm ? "dm" : baseEnvelope.space.kind,
      },
    };

    expect(() =>
      resolveExplicitMemoryEpisodeOrigin({
        createdAtMs: 1200,
        expectedOrganizationId: "org_1",
        expectedProfileId: "agent_1",
        organizationId: "org_1",
        profileId: "agent_1",
        sourceMessageId: "message_1",
        turnEnvelope,
      })
    ).toThrow(
      "Explicit Organization memory requires an organization-shared conversation"
    );
  });

  it("fails closed when a Routine has no original conversation source", () => {
    const turnEnvelope = createTurnEnvelope({
      spaceId: "space_publication_destination",
      trigger: {
        authorizedActions: [],
        destination: {
          kind: "space",
          spaceId: "space_publication_destination",
        },
        externalActionPolicy: "standard",
        routineId: "routine_1",
        routineName: "Daily launch review",
        runId: "routine_run_1",
        scheduledFor: 1200,
        source: "routine",
      },
    });

    expect(() =>
      resolveExplicitMemoryEpisodeOrigin({
        createdAtMs: 1200,
        expectedOrganizationId: "org_1",
        expectedProfileId: "agent_1",
        organizationId: "org_1",
        profileId: "agent_1",
        sourceMessageId: "routine_run_1",
        turnEnvelope,
      })
    ).toThrow("does not preserve an original conversation source");
  });

  it("fails closed when the stored turn does not match the authorized delivery", () => {
    const turnEnvelope = createTurnEnvelope({
      spaceId: "space_launch",
      trigger: { source: "space_wake" },
    });

    expect(() =>
      resolveExplicitMemoryEpisodeOrigin({
        createdAtMs: 1200,
        expectedOrganizationId: "org_other",
        expectedProfileId: "agent_1",
        organizationId: "org_1",
        profileId: "agent_1",
        sourceMessageId: "message_1",
        turnEnvelope,
      })
    ).toThrow("organization identity does not match");
  });
});

function createTurnEnvelope(input: {
  spaceId: string;
  trigger: RemoteAgentTurnEnvelope["trigger"];
}): RemoteAgentTurnEnvelope {
  return {
    centerAgent: {
      profileHandle: "center-agent",
      profileName: "Center Agent",
    },
    organization: {
      id: "org_1",
      memberCount: 2,
      name: "OpenMeld",
      personal: false,
    },
    interactionEnvironment: "organization_shared",
    sender: {
      displayName: "Maya",
      id: "member_1",
      kind: "member",
      ownerUserId: "user_1",
      verified: true,
    },
    space: {
      id: input.spaceId,
      isCenterAgentDm: false,
      kind: "space",
      name: "Launch Room",
    },
    trigger: input.trigger,
  };
}

function createWorkerSubmitRequest(): RemoteAgentWorkerSubmitTurnRequest {
  return {
    agentProfileId: "agent_1",
    agentProfileOwnerUserId: "center_agent_owner",
    author: {
      displayName: "Maya",
      profileId: "human_1",
      profileKind: "human",
    },
    bindingId: "binding_1",
    dispatchId: "dispatch_1",
    idempotencyKey: "dispatch_1:agent_1",
    messages: [{ content: "Remember this.", role: "user" }],
    onBehalfOf: null,
    organizationId: "org_1",
    spaceId: "space_launch",
    triggerMessageId: "message_1",
    turnEnvelope: createTurnEnvelope({
      spaceId: "space_launch",
      trigger: { source: "space_wake" },
    }),
    v: 1,
  };
}
