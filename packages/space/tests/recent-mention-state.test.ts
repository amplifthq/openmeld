import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it } from "vitest";
import {
  buildRecentMentionRankByProfileId,
  buildSpaceMentionProfileIndex,
  mergeRecentMentionProfileIds,
  normalizeRecentMentionProfileIds,
  resolveNextRecentMentionProfileIdsForQueuedText,
} from "../src/index";

describe("space recent mention state", () => {
  it("normalizes, dedupes, caps, and prunes recent profile ids", () => {
    expect(
      normalizeRecentMentionProfileIds({
        profileIds: [" hum_a ", "", "hum_b", "hum_a", "hum_c"],
        maxRecentProfileIds: 2,
        allowedProfileIds: ["hum_a", "hum_c"],
      })
    ).toEqual(["hum_a", "hum_c"]);
  });

  it("merges recent mentions with newest ids first", () => {
    expect(
      mergeRecentMentionProfileIds({
        currentRecentProfileIds: ["hum_a", "agt_b", "hum_c"],
        usedProfileIds: ["agt_b", "hum_d"],
      })
    ).toEqual(["agt_b", "hum_d", "hum_a", "hum_c"]);
  });

  it("builds recent rank maps from the normalized MRU list", () => {
    expect(
      buildRecentMentionRankByProfileId(["hum_b", "hum_b", "agt_a"])
    ).toEqual(
      new Map([
        ["hum_b", 0],
        ["agt_a", 1],
      ])
    );
  });

  it("updates MRU from queued text using right-to-left mention order", () => {
    const mentionProfileIndex = buildSpaceMentionProfileIndex({
      spaceId: "ops-room",
      generatedAt: "2026-03-19T00:00:00.000Z",
      summary: {
        totalCount: 3,
        humanCount: 1,
        agentCount: 2,
        liveNowCount: 0,
        wakeableAgentCount: 2,
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
        createAgentMember({
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          profileName: "Watcher",
        }),
      ],
    });

    expect(
      resolveNextRecentMentionProfileIdsForQueuedText({
        currentRecentProfileIds: ["11111111-1111-4111-8111-111111111111"],
        submittedText:
          "@Ops Bot(wake) sync with @Watcher(reference) and @Ops Bot(reference)",
        mentionProfileIndex,
        allowedProfileIds: [
          "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "11111111-1111-4111-8111-111111111111",
        ],
      })
    ).toEqual([
      "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("updates MRU from canonical mentions before falling back to legacy parsing", () => {
    expect(
      resolveNextRecentMentionProfileIdsForQueuedText({
        currentRecentProfileIds: ["11111111-1111-4111-8111-111111111111"],
        submittedText:
          "@Ops Bot(wake) sync with @Watcher(reference) and @Ops Bot(reference)",
        mentionsInTextOrder: [
          {
            profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
          {
            profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
          {
            profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        ],
        mentionProfileIndex: null,
        allowedProfileIds: [
          "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "11111111-1111-4111-8111-111111111111",
        ],
      })
    ).toEqual([
      "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("uses structured target ids before text fallback", () => {
    expect(
      resolveNextRecentMentionProfileIdsForQueuedText({
        currentRecentProfileIds: ["11111111-1111-4111-8111-111111111111"],
        submittedText: "@ops-bot sync with @watcher",
        structuredMentionProfileIdsInTextOrder: [
          "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ],
        mentionProfileIndex: null,
        allowedProfileIds: [
          "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "11111111-1111-4111-8111-111111111111",
        ],
      })
    ).toEqual([
      "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
});

function createHumanMember(input: { profileId: string; profileName: string }) {
  return createSpaceMemberHumanSnapshot({
    status: "active",
    profileId: input.profileId,
    profileName: input.profileName,
    liveNow: false,
    mentionAlias: null,
  });
}

function createAgentMember(input: { profileId: string; profileName: string }) {
  return createSpaceMemberAgentSnapshot({
    status: "active",
    agentControllerRef: "builtin:codex",
    ownerName: "Felix",
    ownerUserId: "user_felix",
    profileId: input.profileId,
    profileName: input.profileName,
    liveNow: false,
    mentionAlias: null,
    wakeabilityReasonCodes: [],
    wakeabilityReasonText: "This profile can be woken in Space",
    wakeabilityStatus: "ready",
    wakeRouteEvidence: {
      observedAt: "2026-03-13T00:00:00.000Z",
      reasonCode: "online",
      status: "online",
    },
  });
}
