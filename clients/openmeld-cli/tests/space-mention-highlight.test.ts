import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildSpaceMentionHighlightIndex,
  highlightSpaceMentions,
} from "../src/ui/space-mention-highlight";

const HUMAN_FELIX_PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const HUMAN_SHARED_PROFILE_ID_A = "22222222-2222-2222-2222-222222222222";
const HUMAN_SHARED_PROFILE_ID_B = "33333333-3333-3333-3333-333333333333";
const AGENT_OPS_BOT_PROFILE_ID = "agt_44444444-4444-4444-4444-444444444444";

describe("space mention highlight", () => {
  it("highlights exact canonical mentions for primary labels and profile ID fallback", () => {
    const index = buildSpaceMentionHighlightIndex(
      createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_FELIX_PROFILE_ID,
            profileName: "felix-in-space",
          }),
        ],
        agents: [
          createAgentMember({
            profileId: AGENT_OPS_BOT_PROFILE_ID,
            profileName: "ops-bot",
          }),
        ],
      })
    );

    const highlighted = highlightSpaceMentions({
      text: `hello @felix-in-space(mention), ping @${AGENT_OPS_BOT_PROFILE_ID}(wake) and @ops-bot(wake)!`,
      index,
      render: (mentionText, profileIdentity) =>
        `[${mentionText}|${profileIdentity.openMeldProfileId}]`,
    });

    expect(highlighted).toBe(
      `hello [@felix-in-space(mention)|${HUMAN_FELIX_PROFILE_ID}], ping [@${AGENT_OPS_BOT_PROFILE_ID}(wake)|${AGENT_OPS_BOT_PROFILE_ID}] and [@ops-bot(wake)|${AGENT_OPS_BOT_PROFILE_ID}]!`
    );
  });

  it("keeps sentence-ending punctuation outside the highlighted canonical mention", () => {
    const index = buildSpaceMentionHighlightIndex(
      createSnapshot({
        agents: [
          createAgentMember({
            profileId: AGENT_OPS_BOT_PROFILE_ID,
            profileName: "ops-bot",
          }),
        ],
      })
    );

    const highlighted = highlightSpaceMentions({
      text: "thanks @ops-bot(wake)... done.",
      index,
      render: (mentionText, profileIdentity) =>
        `[${mentionText}|${profileIdentity.openMeldProfileId}]`,
    });

    expect(highlighted).toBe(
      `thanks [@ops-bot(wake)|${AGENT_OPS_BOT_PROFILE_ID}]... done.`
    );
  });

  it("does not highlight ambiguous or partial canonical mention labels", () => {
    const index = buildSpaceMentionHighlightIndex(
      createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_SHARED_PROFILE_ID_A,
            profileName: "shared-name",
          }),
          createHumanMember({
            profileId: HUMAN_SHARED_PROFILE_ID_B,
            profileName: "shared-name",
          }),
        ],
      })
    );

    const highlighted = highlightSpaceMentions({
      text: "@shared-name(mention) is ambiguous, @shared-namehello(mention) is partial",
      index,
      render: (mentionText) => `[${mentionText}]`,
    });

    expect(highlighted).toBe(
      "@shared-name(mention) is ambiguous, @shared-namehello(mention) is partial"
    );
  });

  it("does not highlight case-variant canonical labels", () => {
    const index = buildSpaceMentionHighlightIndex(
      createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_FELIX_PROFILE_ID,
            profileName: "Felix-In-Space",
          }),
        ],
      })
    );

    const highlighted = highlightSpaceMentions({
      text: "hello @felix-in-space(mention)",
      index,
      render: (mentionText, profileIdentity) =>
        `[${mentionText}|${profileIdentity.openMeldProfileId}]`,
    });

    expect(highlighted).toBe("hello @felix-in-space(mention)");
  });

  it("highlights spaced profile names only through exact canonical syntax", () => {
    const index = buildSpaceMentionHighlightIndex(
      createSnapshot({
        humans: [
          createHumanMember({
            profileId: HUMAN_FELIX_PROFILE_ID,
            profileName: "OpenMeld Dev Local Test",
          }),
        ],
      })
    );

    const highlighted = highlightSpaceMentions({
      text: "hello @OpenMeld Dev Local Test(mention)",
      index,
      render: (mentionText, profileIdentity) =>
        `[${mentionText}|${profileIdentity.openMeldProfileId}]`,
    });

    expect(highlighted).toBe(
      `hello [@OpenMeld Dev Local Test(mention)|${HUMAN_FELIX_PROFILE_ID}]`
    );
  });
});

function createSnapshot(input: {
  humans?: SpaceMemberHumanSnapshot[];
  agents?: SpaceMemberAgentSnapshot[];
}): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: input.agents,
    generatedAt: "2026-03-10T00:00:00.000Z",
    humans: input.humans,
    spaceId: "ops-room",
  });
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
}): SpaceMemberHumanSnapshot {
  return createSpaceMemberHumanSnapshot({
    addedAt: "2026-03-10T00:00:00.000Z",
    createdAt: "2026-03-10T00:00:00.000Z",
    firstEnteredAt: "2026-03-10T00:00:00.000Z",
    lastEnteredAt: "2026-03-10T00:00:00.000Z",
    lastSeenAt: "2026-03-10T00:00:00.000Z",
    lastSeenLabel: "Seen now",
    liveNow: false,
    mentionAlias: null,
    ownerName: "Felix",
    ownerUserId: "owner-felix",
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-03-10T00:00:00.000Z",
  });
}

function createAgentMember(input: {
  profileId: string;
  profileName: string;
}): SpaceMemberAgentSnapshot {
  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-03-10T00:00:00.000Z",
    addedByDisplayName: "Felix",
    addedByOwnerUserId: "owner-felix",
    addedByProfileId: HUMAN_FELIX_PROFILE_ID,
    agentControllerRef: "builtin:ops-bot",
    createdAt: "2026-03-10T00:00:00.000Z",
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: "2026-03-10T00:00:00.000Z",
    lastSeenLabel: "Seen now",
    liveNow: false,
    ownerName: "Felix",
    ownerUserId: "owner-felix",
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-03-10T00:00:00.000Z",
  });
}
