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
  extractMentionTokensFromText,
  listSpaceMemberMentionLookupTokens,
  resolvePreferredSpaceMemberMentionToken,
} from "../src/space/mention-token";

describe("mention-token parity", () => {
  it("extracts canonical mention labels from the shared mention parser", () => {
    expect(
      extractMentionTokensFromText(
        "ping @Agent(wake). then @A.B(reference)... and ignore @Not Canonical"
      )
    ).toEqual(["Agent", "A.B"]);
  });

  it("resolves the preferred mention token from the shared target identity truth", () => {
    const snapshot = createSnapshot({
      agents: [
        createAgentMember({
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          profileName: "Ops Bot",
          mentionAlias: "ops_alpha",
        }),
        createAgentMember({
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          profileName: "Ops Bot",
          mentionAlias: "ops_bravo",
        }),
      ],
    });
    const member = snapshot.agents[0];
    if (!member) {
      throw new Error("expected an agent member in the snapshot");
    }

    expect(
      resolvePreferredSpaceMemberMentionToken({
        member,
        snapshot,
      })
    ).toBe("ops_alpha");
  });

  it("returns the exact mention labels projected by the shared target identity catalog", () => {
    const snapshot = createSnapshot({
      humans: [
        createHumanMember({
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Budget Analyst",
          mentionAlias: "budget_analyst",
        }),
      ],
    });
    const member = snapshot.humans[0];
    if (!member) {
      throw new Error("expected a human member in the snapshot");
    }

    expect(
      listSpaceMemberMentionLookupTokens({
        member,
        snapshot,
      })
    ).toEqual([
      "Budget Analyst",
      "budget_analyst",
      "Budget Analyst-11111",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
});

function createSnapshot(input: {
  humans?: SpaceMemberHumanSnapshot[];
  agents?: SpaceMemberAgentSnapshot[];
}): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: input.agents,
    generatedAt: "2026-04-10T00:00:00.000Z",
    humans: input.humans,
    spaceId: "space-mention-token",
  });
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
}): SpaceMemberHumanSnapshot {
  return createSpaceMemberHumanSnapshot({
    addedAt: "2026-04-10T00:00:00.000Z",
    createdAt: "2026-04-10T00:00:00.000Z",
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    mentionAlias: input.mentionAlias ?? null,
    ownerName: input.profileName,
    ownerUserId: input.profileId,
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-04-10T00:00:00.000Z",
  });
}

function createAgentMember(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
}): SpaceMemberAgentSnapshot {
  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-04-10T00:00:00.000Z",
    addedByDisplayName: "Alice",
    addedByOwnerUserId: "11111111-1111-4111-8111-111111111111",
    addedByProfileId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-04-10T00:00:00.000Z",
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    memberSourceLabel: "Added by Alice",
    mentionAlias: input.mentionAlias ?? null,
    ownerName: "Alice",
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-04-10T00:00:00.000Z",
  });
}
