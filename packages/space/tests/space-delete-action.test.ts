import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it } from "vitest";
import { resolveSpaceDeleteActionVisibility } from "../src";

const HUMAN_CREATOR_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_CREATOR_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("space delete action visibility", () => {
  it("shows delete for a human-created space only to the creator profile", () => {
    const snapshot = createSpaceMembersSnapshot({
      humans: [
        createSpaceMemberHumanSnapshot({
          memberSource: "space_creator",
          memberSourceLabel: "Creator",
          ownerUserId: "owner-1",
          profileId: HUMAN_CREATOR_PROFILE_ID,
        }),
        createSpaceMemberHumanSnapshot({
          memberSource: "joined_directly",
          memberSourceLabel: "Joined directly",
          ownerUserId: "owner-1",
          profileId: OTHER_HUMAN_PROFILE_ID,
        }),
      ],
    });

    expect(
      resolveSpaceDeleteActionVisibility({
        currentProfileId: HUMAN_CREATOR_PROFILE_ID,
        membersSnapshot: snapshot,
      })
    ).toEqual({
      reason: "human_creator_profile",
      visible: true,
    });
    expect(
      resolveSpaceDeleteActionVisibility({
        currentProfileId: OTHER_HUMAN_PROFILE_ID,
        membersSnapshot: snapshot,
      })
    ).toEqual({
      reason: "not_creator_or_owner",
      visible: false,
    });
  });

  it("shows delete for an agent-created space only to a human profile from the same owner", () => {
    const snapshot = createSpaceMembersSnapshot({
      agents: [
        createSpaceMemberAgentSnapshot({
          memberSource: "space_creator",
          memberSourceLabel: "Creator",
          ownerUserId: "owner-1",
          profileId: AGENT_CREATOR_PROFILE_ID,
        }),
      ],
      humans: [
        createSpaceMemberHumanSnapshot({
          memberSource: "joined_directly",
          memberSourceLabel: "Joined directly",
          ownerUserId: "owner-1",
          profileId: HUMAN_CREATOR_PROFILE_ID,
        }),
        createSpaceMemberHumanSnapshot({
          memberSource: "joined_directly",
          memberSourceLabel: "Joined directly",
          ownerUserId: "owner-2",
          profileId: OTHER_HUMAN_PROFILE_ID,
        }),
      ],
    });

    expect(
      resolveSpaceDeleteActionVisibility({
        currentProfileId: HUMAN_CREATOR_PROFILE_ID,
        membersSnapshot: snapshot,
      })
    ).toEqual({
      reason: "agent_creator_owner_human_profile",
      visible: true,
    });
    expect(
      resolveSpaceDeleteActionVisibility({
        currentProfileId: AGENT_CREATOR_PROFILE_ID,
        membersSnapshot: snapshot,
      })
    ).toEqual({
      reason: "not_creator_or_owner",
      visible: false,
    });
    expect(
      resolveSpaceDeleteActionVisibility({
        currentProfileId: OTHER_HUMAN_PROFILE_ID,
        membersSnapshot: snapshot,
      })
    ).toEqual({
      reason: "not_creator_or_owner",
      visible: false,
    });
  });

  it("hides delete when membership evidence is unavailable", () => {
    expect(
      resolveSpaceDeleteActionVisibility({
        currentProfileId: HUMAN_CREATOR_PROFILE_ID,
        membersSnapshot: null,
      })
    ).toEqual({
      reason: "members_unavailable",
      visible: false,
    });
  });
});
