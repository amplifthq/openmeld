import { createDaemonRouteObservationSummary } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  buildSpaceMentionProfileIndex,
  collectResolvedSpaceMentions,
  listRecentMentionProfileIdsFromText,
} from "../src";

describe("space mention resolution", () => {
  it("resolves exact canonical mention labels and ignores unknown or non-canonical text", () => {
    const index = buildSpaceMentionProfileIndex({
      spaceId: "ops-room",
      generatedAt: "2026-03-19T00:00:00.000Z",
      summary: {
        totalCount: 3,
        humanCount: 2,
        agentCount: 1,
        liveNowCount: 0,
        wakeableAgentCount: 1,
        offlineAgentCount: 0,
        unavailableAgentCount: 0,
      },
      humans: [
        createHumanMember({
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Shared Name",
        }),
        createHumanMember({
          profileId: "22222222-2222-4222-8222-222222222222",
          profileName: "Shared-Name",
        }),
      ],
      agents: [
        createAgentMember({
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          profileName: "Ops Bot",
        }),
      ],
    });

    expect(
      collectResolvedSpaceMentions({
        text: [
          "@shared-name check bare text only.",
          "@Ops Bot(wake) then @Missing(wake).",
        ].join("\n"),
        index,
      }).map((match) => ({
        mentionText: match.mentionText,
        profileId: match.profileIdentity.openMeldProfileId,
      }))
    ).toEqual([
      {
        mentionText: "@Ops Bot(wake)",
        profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ]);
  });

  it("returns recent profile ids from right to left for canonical mentions", () => {
    const index = buildSpaceMentionProfileIndex({
      spaceId: "ops-room",
      generatedAt: "2026-03-19T00:00:00.000Z",
      summary: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        liveNowCount: 0,
        wakeableAgentCount: 1,
        offlineAgentCount: 0,
        unavailableAgentCount: 0,
      },
      humans: [
        createHumanMember({
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix Space",
        }),
      ],
      agents: [
        createAgentMember({
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          profileName: "Ops Bot",
        }),
      ],
    });

    const text = [
      "hello @Ops Bot(wake)!",
      "loop in @Felix Space(reference), then @Ops Bot(wake).",
    ].join(" ");

    expect(
      collectResolvedSpaceMentions({
        text,
        index,
      }).map((match) => match.mentionText)
    ).toEqual(["@Ops Bot(wake)", "@Felix Space(reference)", "@Ops Bot(wake)"]);

    expect(
      listRecentMentionProfileIdsFromText({
        text,
        index,
      })
    ).toEqual([
      "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("keeps exact label matching case-sensitive and supports profile-id fallback and spaced names", () => {
    const agentProfileId = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const humanProfileId = "33333333-3333-4333-8333-333333333333";
    const index = buildSpaceMentionProfileIndex({
      spaceId: "ops-room",
      generatedAt: "2026-03-19T00:00:00.000Z",
      summary: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        liveNowCount: 0,
        wakeableAgentCount: 1,
        offlineAgentCount: 0,
        unavailableAgentCount: 0,
      },
      humans: [
        createHumanMember({
          profileId: humanProfileId,
          profileName: "OpenMeld Dev Local Test",
        }),
      ],
      agents: [
        createAgentMember({
          profileId: agentProfileId,
          profileName: "Budget Analyst",
        }),
      ],
    });

    expect(
      collectResolvedSpaceMentions({
        text: [
          "@budget analyst(wake) should not match.",
          `@${agentProfileId}(wake) should match by profile id.`,
          "@OpenMeld Dev Local Test(reference) should match spaced name.",
        ].join(" "),
        index,
      }).map((match) => ({
        mentionText: match.mentionText,
        profileId: match.profileIdentity.openMeldProfileId,
      }))
    ).toEqual([
      {
        mentionText: `@${agentProfileId}(wake)`,
        profileId: agentProfileId,
      },
      {
        mentionText: "@OpenMeld Dev Local Test(reference)",
        profileId: humanProfileId,
      },
    ]);
  });

  it("resolves canonical mentions only when the relation is allowed for that target", () => {
    const index = buildSpaceMentionProfileIndex({
      spaceId: "ops-room",
      generatedAt: "2026-03-19T00:00:00.000Z",
      summary: {
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
        liveNowCount: 0,
        wakeableAgentCount: 1,
        offlineAgentCount: 0,
        unavailableAgentCount: 0,
      },
      humans: [
        createHumanMember({
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix Space",
        }),
      ],
      agents: [
        createAgentMember({
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          profileName: "Ops Bot",
        }),
      ],
    });

    expect(
      collectResolvedSpaceMentions({
        text: [
          "@Felix Space(wake) should not resolve.",
          "@Ops Bot(wake) should resolve.",
          "@Felix Space(reference) should resolve.",
        ].join(" "),
        index,
      }).map((match) => ({
        mentionText: match.mentionText,
        profileId: match.profileIdentity.openMeldProfileId,
      }))
    ).toEqual([
      {
        mentionText: "@Ops Bot(wake)",
        profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        mentionText: "@Felix Space(reference)",
        profileId: "11111111-1111-4111-8111-111111111111",
      },
    ]);

    expect(
      listRecentMentionProfileIdsFromText({
        text: [
          "@Felix Space(wake) ignored invalid relation",
          "@Ops Bot(wake) valid wake",
          "@Felix Space(reference) valid reference",
        ].join(" "),
        index,
      })
    ).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
  });
});

function createHumanMember(input: { profileId: string; profileName: string }) {
  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "human" as const,
    mentionAlias: null,
    status: "active" as const,
    memberSource: "space_creator" as const,
    memberSourceLabel: "Creator",
    addedAt: "2026-03-19T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    addedByProfileId: null,
    addedByOwnerUserId: null,
    addedByDisplayName: null,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: input.profileId,
    ownerName: input.profileName,
  };
}

function createAgentMember(input: { profileId: string; profileName: string }) {
  const observedAt = "2026-03-19T00:00:00.000Z";

  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: "agent" as const,
    mentionAlias: null,
    status: "active" as const,
    memberSource: "added_by_member" as const,
    memberSourceLabel: "Added by Felix",
    addedAt: "2026-03-19T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    addedByProfileId: "11111111-1111-4111-8111-111111111111",
    addedByOwnerUserId: "usr_felix",
    addedByDisplayName: "Felix",
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "usr_felix",
    ownerName: "Felix",
    agentControllerRef: "builtin:codex",
    agentControllerConversationId: null,
    wakeRouteEvidence: createDaemonRouteObservationSummary({
      observedAt,
      status: "online",
    }),
    wakeState: "wakeable" as const,
    wakeability: {
      status: "ready" as const,
      reasonCodes: [],
      reasonText: "This profile can be woken in Space",
    },
  };
}
