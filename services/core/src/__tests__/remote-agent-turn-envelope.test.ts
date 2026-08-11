import type {
  OpenMeldDaemonDispatchQueueMessage,
  RemoteAgentWorkerAuthorContext,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  discardFrozenContextScopeForNewTurn,
  parseCoreOwnedRemoteAgentTurnEnvelope,
} from "../remote-agent/application/center-agent-context-scope";
import {
  buildRemoteAgentTurnEnvelope,
  resolveRemoteAgentTurnEnvelope,
} from "../remote-agent/application/turn-envelope";

describe("remote agent turn envelope", () => {
  it("resolves Core-owned context facts for a Center Agent DM turn", async () => {
    const envelope = await resolveRemoteAgentTurnEnvelope({
      author: {
        displayName: "Felix",
        profileId: "hum_123",
        profileKind: "human",
      } as RemoteAgentWorkerAuthorContext,
      centerAgentProfileId: "agt_center",
      db: createTurnEnvelopeDb() as unknown as D1Database,
      message: createDispatchMessage(),
      organizationId: "org_personal",
      webAppUrl: "https://openmeld.test",
    });

    expect(envelope).toEqual({
      contextScopePlan: {
        authenticationSecrets: "never_available",
        interactionEnvironment: "requester_private",
        memberMemory: "use_and_share",
        organizationDocuments: "share_when_authorized",
        organizationMemory: "share_when_authorized",
        organizationSkills: "share_when_authorized",
        protectedInformation: "share_when_authorized",
        requesterIdentity: "verified_member",
        resultAudience: "requester_only",
        v: 1,
      },
      interactionEnvironment: "requester_private",
      sender: {
        kind: "member",
        id: "member_123",
        displayName: "Felix",
        ownerUserId: "user_123",
        profileId: "hum_123",
        role: "owner",
        verified: true,
      },
      space: {
        id: "space_dm",
        name: "Felix and Center Agent",
        kind: "dm",
        isCenterAgentDm: true,
      },
      organization: {
        id: "org_personal",
        name: "Felix",
        personal: true,
        memberCount: 1,
        webUrl: "https://openmeld.test/o/personal-felix",
      },
      centerAgent: {
        profileName: "Felix's Center Agent",
        profileHandle: "felixs-center-agent",
      },
      centerAgentInteractionSource: {
        client: "codex",
        kind: "local_agent",
        sessionId: "codex-thread-1",
      },
      trigger: {
        source: "web_dm",
      },
    });
  });

  it("marks non-DM Space wakes as shared Space triggers", () => {
    expect(
      buildRemoteAgentTurnEnvelope({
        sender: {
          kind: "agent_profile",
          id: "agt_research",
          displayName: "Research Agent",
          verified: true,
        },
        space: {
          id: "space_shared",
          name: "Launch Room",
          kind: "space",
          isCenterAgentDm: false,
        },
        organization: {
          id: "org_team",
          name: "OpenMeld Labs",
          personal: false,
          memberCount: 4,
        },
        centerAgent: {
          profileName: "Center Agent",
          profileHandle: "center-agent",
        },
      })
    ).toMatchObject({
      contextScopePlan: {
        interactionEnvironment: "organization_shared",
        memberMemory: "never_available",
        resultAudience: "organization_members",
        v: 1,
      },
      interactionEnvironment: "organization_shared",
      space: {
        kind: "space",
        isCenterAgentDm: false,
      },
      trigger: {
        source: "space_wake",
      },
    });
  });

  it("rejects an audience change that tries to reuse a frozen private scope", () => {
    const privateEnvelope = buildRemoteAgentTurnEnvelope({
      sender: {
        displayName: "Felix",
        id: "member_1",
        kind: "member",
        ownerUserId: "user_1",
        verified: true,
      },
      space: {
        id: "space_dm",
        isCenterAgentDm: true,
        kind: "dm",
        name: "Felix and Center Agent",
      },
      organization: {
        id: "org_team",
        memberCount: 4,
        name: "OpenMeld Labs",
        personal: false,
      },
      centerAgent: {
        profileHandle: "center-agent",
        profileName: "Center Agent",
      },
    });

    expect(() =>
      parseCoreOwnedRemoteAgentTurnEnvelope({
        ...privateEnvelope,
        interactionEnvironment: "externally_shared",
        space: {
          id: "slack:T123:C123:1710000000.000100",
          isCenterAgentDm: false,
          kind: "space",
          name: "#launch",
        },
        trigger: { source: "slack" },
      })
    ).toThrow("Center Agent Context Scope Plan no longer matches this turn");
  });

  it("replans only the new linked-identity turn instead of upgrading the original turn", () => {
    const unlinkedEnvelope = parseCoreOwnedRemoteAgentTurnEnvelope({
      centerAgent: {
        profileHandle: "center-agent",
        profileName: "Center Agent",
      },
      interactionEnvironment: "externally_shared",
      organization: {
        id: "org_team",
        memberCount: 4,
        name: "OpenMeld Labs",
        personal: false,
      },
      sender: {
        displayName: "Felix",
        id: "slack:T123:U123",
        kind: "member",
        messageChannelIdentity: {
          connectionId: "T123",
          provider: "slack",
          providerUserId: "U123",
        },
        verified: false,
      },
      space: {
        id: "slack:T123:C123:1710000000.000100",
        isCenterAgentDm: false,
        kind: "space",
        name: "#launch",
      },
      trigger: { source: "slack" },
    });

    const linkedEnvelope = parseCoreOwnedRemoteAgentTurnEnvelope({
      ...discardFrozenContextScopeForNewTurn(unlinkedEnvelope),
      sender: {
        displayName: "Felix",
        id: "member_1",
        kind: "member",
        messageChannelIdentity: {
          connectionId: "T123",
          provider: "slack",
          providerUserId: "U123",
        },
        ownerUserId: "user_1",
        profileId: "profile_1",
        verified: true,
      },
    });

    expect(unlinkedEnvelope.contextScopePlan).toMatchObject({
      memberMemory: "never_available",
      requesterIdentity: "connected_organization_member",
    });
    expect(linkedEnvelope.contextScopePlan).toMatchObject({
      memberMemory: "use_privately",
      requesterIdentity: "verified_member",
    });
  });
});

function createDispatchMessage(): OpenMeldDaemonDispatchQueueMessage {
  return {
    sourceEventId: "signal_123",
    sourceProfileNameSnapshot: "Felix",
    sourceSignalSnapshot: {
      centerAgentInteractionSource: {
        client: "codex",
        kind: "local_agent",
        sessionId: "codex-thread-1",
      },
      text: "Who am I?",
      profileId: "hum_123",
      profileKind: "human",
    },
    spaceId: "space_dm",
    spaceNameSnapshot: "Felix and Center Agent",
  } as OpenMeldDaemonDispatchQueueMessage;
}

function createTurnEnvelopeDb() {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: () => {
              if (sql.includes("FROM organizations")) {
                return {
                  name: "Felix",
                  slug: "personal-felix",
                  metadata: JSON.stringify({ personal: true }),
                  member_count: 1,
                };
              }
              if (sql.includes("profile_handle")) {
                return {
                  profile_name: "Felix's Center Agent",
                  profile_handle: "felixs-center-agent",
                };
              }
              if (sql.includes("FROM openmeld_profiles")) {
                return {
                  profile_id: "hum_123",
                  profile_name: "Felix",
                  profile_kind: "human",
                  owner_user_id: "user_123",
                  member_id: "member_123",
                  role: "owner",
                };
              }
              if (sql.includes("FROM space_index_spaces")) {
                return {
                  space_id: "space_dm",
                  organization_id: "org_personal",
                  space_purpose: "openmeld_dm_space",
                  direct_message_pair_key: "agt_center:hum_123",
                };
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}
