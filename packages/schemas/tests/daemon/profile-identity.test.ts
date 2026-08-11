import { describe, expect, it } from "vitest";
import {
  openMeldActorContextSchema,
  openMeldProfileIdSchema,
  openMeldRequestContextSchema,
  resolvedOpenMeldProfileSchema,
} from "../../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const SECOND_AGENT_PROFILE_ID = "agt_44444444-4444-4444-8444-444444444444";
const OPENMELD_SYSTEM_PROFILE_ID = "openmeld-system";

describe("daemon profile identity schema", () => {
  it("accepts valid OpenMeld runtime profile ids", () => {
    expect(openMeldProfileIdSchema.safeParse(HUMAN_PROFILE_ID).success).toBe(
      true
    );
    expect(openMeldProfileIdSchema.safeParse(AGENT_PROFILE_ID).success).toBe(
      true
    );
  });

  it("rejects invalid OpenMeld runtime profile ids", () => {
    expect(openMeldProfileIdSchema.safeParse("hum_fake").success).toBe(false);
    expect(openMeldProfileIdSchema.safeParse("agt_invalid").success).toBe(
      false
    );
  });

  it("accepts a canonical resolved OpenMeld profile", () => {
    const result = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "OpenClaw Agent",
      ownerUserId: "owner-1",
      profileHandle: "openclaw-agent",
      ownerName: "Felix",
      agentControllerRef: "builtin:openclaw",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a resolved profile with missing required fields", () => {
    const result = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      ownerUserId: "owner-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a resolved profile with the synthetic OpenMeld system profile id", () => {
    const result = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: OPENMELD_SYSTEM_PROFILE_ID,
      profileKind: "system",
      profileName: "OpenMeld System",
      ownerUserId: "owner-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects blank canonical text fields", () => {
    const blankOwnerUserId = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "OpenClaw Agent",
      ownerUserId: "   ",
    });
    const blankRequestId = openMeldActorContextSchema.safeParse({
      requestId: "   ",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
    });
    const blankAgentControllerRef = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      agentControllerRef: "   ",
    });

    expect(blankOwnerUserId.success).toBe(false);
    expect(blankRequestId.success).toBe(false);
    expect(blankAgentControllerRef.success).toBe(false);
  });

  it("normalizes canonical text fields to trimmed output", () => {
    const resolvedProfile = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "OpenClaw Agent",
      ownerUserId: " owner-1 ",
      agentControllerRef: " builtin:openclaw ",
    });
    const actorContext = openMeldActorContextSchema.safeParse({
      requestId: " req-1 ",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      ownerUserId: " owner-1 ",
      dispatchChainId: " chain-1 ",
      visitedProfileIdsHash: " sha256:abc ",
    });
    const requestContext = openMeldRequestContextSchema.safeParse({
      actorContext: {
        requestId: " req-1 ",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
      },
      agentControllerConversationId: " ctx-1 ",
    });

    expect(resolvedProfile.success).toBe(true);
    if (!resolvedProfile.success) {
      throw new Error("resolved profile should succeed");
    }
    expect(resolvedProfile.data.ownerUserId).toBe("owner-1");
    expect(resolvedProfile.data.agentControllerRef).toBe("builtin:openclaw");

    expect(actorContext.success).toBe(true);
    if (!actorContext.success) {
      throw new Error("actor context should succeed");
    }
    expect(actorContext.data.requestId).toBe("req-1");
    expect(actorContext.data.ownerUserId).toBe("owner-1");
    expect(actorContext.data.dispatchChainId).toBe("chain-1");
    expect(actorContext.data.visitedProfileIdsHash).toBe("sha256:abc");

    expect(requestContext.success).toBe(true);
    if (!requestContext.success) {
      throw new Error("request context should succeed");
    }
    expect(requestContext.data.actorContext.requestId).toBe("req-1");
    expect(requestContext.data.agentControllerConversationId).toBe("ctx-1");
  });

  it("rejects legacy and management-only fields on resolved profiles", () => {
    const withLegacyAlias = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "OpenClaw Agent",
      ownerUserId: "owner-1",
      profileId: AGENT_PROFILE_ID,
    });
    const withLegacyProfile = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "OpenClaw Agent",
      ownerUserId: "owner-1",
      profile: AGENT_PROFILE_ID,
    });
    const withManagementField = resolvedOpenMeldProfileSchema.safeParse({
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "OpenClaw Agent",
      ownerUserId: "owner-1",
      bindingState: "bound",
    });

    expect(withLegacyAlias.success).toBe(false);
    expect(withLegacyProfile.success).toBe(false);
    expect(withManagementField.success).toBe(false);
  });

  it("accepts a canonical OpenMeld actor context", () => {
    const result = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileHandle: "openclaw-agent",
      profileName: "OpenClaw Agent",
      ownerUserId: "owner-1",
      ownerName: "Felix",
      agentControllerRef: "builtin:openclaw",
      dispatchChainId: "chain-1",
      autoRelayDepth: 2,
      visitedProfileIds: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
      visitedProfileIdsHash: "sha256:abc",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a canonical OpenMeld system actor context", () => {
    const result = openMeldActorContextSchema.safeParse({
      requestId: "req-system-1",
      openMeldProfileId: OPENMELD_SYSTEM_PROFILE_ID,
      profileKind: "system",
      profileName: "OpenMeld System",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a system actor context with a non-system openMeldProfileId", () => {
    const result = openMeldActorContextSchema.safeParse({
      requestId: "req-system-2",
      openMeldProfileId: HUMAN_PROFILE_ID,
      profileKind: "system",
      profileName: "OpenMeld System",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-system actor context with openmeld-system as openMeldProfileId", () => {
    const result = openMeldActorContextSchema.safeParse({
      requestId: "req-human-1",
      openMeldProfileId: OPENMELD_SYSTEM_PROFILE_ID,
      profileKind: "human",
      profileName: "Felix",
    });

    expect(result.success).toBe(false);
  });

  it("rejects actor context legacy aliases and continuation-only fields", () => {
    const legacyProfileId = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileId: AGENT_PROFILE_ID,
    });
    const legacyProfile = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profile: AGENT_PROFILE_ID,
    });
    const withSpacePassword = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      spacePassword: "secret",
    });
    const withAgentControllerConversationId =
      openMeldActorContextSchema.safeParse({
        requestId: "req-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        agentControllerConversationId: "ctx-1",
      });
    const withUpstreamConversation = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      agentControllerConversation: {
        providerId: "openclaw",
        refKind: "session",
        conversationRefId: "session-1",
      },
    });

    expect(legacyProfileId.success).toBe(false);
    expect(legacyProfile.success).toBe(false);
    expect(withSpacePassword.success).toBe(false);
    expect(withAgentControllerConversationId.success).toBe(false);
    expect(withUpstreamConversation.success).toBe(false);
  });

  it("rejects invalid visited profile ids in actor context", () => {
    const result = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      visitedProfileIds: ["agt_invalid"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative and non-integer auto relay depth", () => {
    const negative = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      autoRelayDepth: -1,
    });
    const nonInteger = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      autoRelayDepth: 1.5,
    });

    expect(negative.success).toBe(false);
    expect(nonInteger.success).toBe(false);
  });

  it("rejects unknown fields on actor context", () => {
    const result = openMeldActorContextSchema.safeParse({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      ignored: "drift",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a canonical OpenMeld request context", () => {
    const result = openMeldRequestContextSchema.safeParse({
      actorContext: {
        requestId: "req-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        profileHandle: "openclaw-agent",
        profileName: "OpenClaw Agent",
        ownerUserId: "owner-1",
      },
      agentControllerConversationId: "ctx-1",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a request context for the internal OpenMeld system actor", () => {
    const result = openMeldRequestContextSchema.safeParse({
      actorContext: {
        requestId: "req-system-3",
        openMeldProfileId: OPENMELD_SYSTEM_PROFILE_ID,
        profileKind: "system",
        profileName: "OpenMeld System",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects legacy and out-of-scope fields on request context", () => {
    const withProfileId = openMeldRequestContextSchema.safeParse({
      actorContext: {
        requestId: "req-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
      },
      profileId: AGENT_PROFILE_ID,
    });
    const withLegacyProfile = openMeldRequestContextSchema.safeParse({
      actorContext: {
        requestId: "req-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
      },
      profile: AGENT_PROFILE_ID,
    });
    const withSpacePassword = openMeldRequestContextSchema.safeParse({
      actorContext: {
        requestId: "req-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
      },
      spacePassword: "secret",
    });
    const withUpstreamConversation = openMeldRequestContextSchema.safeParse({
      actorContext: {
        requestId: "req-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
      },
      agentControllerConversation: {
        providerId: "codex",
        refKind: "thread",
        conversationRefId: "thread-1",
      },
    });

    expect(withProfileId.success).toBe(false);
    expect(withLegacyProfile.success).toBe(false);
    expect(withSpacePassword.success).toBe(false);
    expect(withUpstreamConversation.success).toBe(false);
  });
});
