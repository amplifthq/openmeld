import { describe, expect, it } from "vitest";
import {
  buildSpaceProfileAddPlan,
  type SpaceProfileAddProfile,
} from "../src/membership/profile-add-plan";

const HUMAN_CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const HUMAN_WORK_ID = "22222222-2222-4222-8222-222222222222";
const HUMAN_OTHER_OWNER_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_CODEX_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_CLAUDE_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_INACTIVE_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("space profile add plan", () => {
  it("builds a generic profile plan without treating membership as readiness", () => {
    const plan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      currentMembers: [{ profileId: AGENT_CLAUDE_ID, status: "active" }],
      currentOwnerUserId: "user-1",
      mode: "profiles",
      profiles: buildProfiles(),
      selector: { kind: "all" },
    });

    expect(plan.selectedProfileIds).toEqual([AGENT_CODEX_ID, HUMAN_WORK_ID]);
    expect(
      plan.selectableCandidates.map((candidate) => candidate.profileId)
    ).toEqual([AGENT_CODEX_ID, HUMAN_WORK_ID]);
    expect(
      plan.alreadyJoinedCandidates.map((candidate) => candidate.profileId)
    ).toEqual([AGENT_CLAUDE_ID]);
    expect(
      plan.excludedCandidates.map((candidate) => [
        candidate.profileId,
        candidate.excludedReason,
      ])
    ).toEqual([
      [AGENT_INACTIVE_ID, "inactive_profile"],
      [HUMAN_OTHER_OWNER_ID, "different_owner"],
      [HUMAN_CURRENT_ID, "current_acting_profile"],
    ]);
  });

  it("limits add-agents to Agent Profiles", () => {
    const plan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      currentMembers: [],
      currentOwnerUserId: "user-1",
      mode: "agents",
      profiles: buildProfiles(),
      selector: {
        kind: "profile_ids",
        profileIds: [AGENT_CODEX_ID, HUMAN_WORK_ID],
      },
    });

    expect(plan.selectedProfileIds).toEqual([AGENT_CODEX_ID]);
    expect(plan.invalidSelections).toEqual([
      { profileId: HUMAN_WORK_ID, reason: "kind_mismatch" },
    ]);
  });

  it("rejects explicit current profile selection by default", () => {
    const plan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      currentMembers: [],
      currentOwnerUserId: "user-1",
      mode: "human_profiles",
      profiles: buildProfiles(),
      selector: {
        kind: "profile_ids",
        profileIds: [HUMAN_CURRENT_ID],
      },
    });

    expect(plan.selectedProfileIds).toEqual([]);
    expect(plan.invalidSelections).toEqual([
      { profileId: HUMAN_CURRENT_ID, reason: "current_acting_profile" },
    ]);
  });

  it("allows explicit current profile selection when requested", () => {
    const plan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      allowCurrentProfile: true,
      currentMembers: [],
      currentOwnerUserId: "user-1",
      mode: "human_profiles",
      profiles: buildProfiles(),
      selector: {
        kind: "profile_ids",
        profileIds: [HUMAN_CURRENT_ID],
      },
    });

    expect(plan.selectedProfileIds).toEqual([HUMAN_CURRENT_ID]);
    expect(
      plan.selectedCandidates.map((candidate) => [
        candidate.profileId,
        candidate.excludedReason,
      ])
    ).toEqual([[HUMAN_CURRENT_ID, null]]);
  });

  it("limits human profile adds to Human Profiles", () => {
    const plan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      currentMembers: [],
      currentOwnerUserId: "user-1",
      mode: "human_profiles",
      profiles: buildProfiles(),
      selector: {
        kind: "profile_ids",
        profileIds: [HUMAN_WORK_ID, AGENT_CODEX_ID],
      },
    });

    expect(plan.selectedProfileIds).toEqual([HUMAN_WORK_ID]);
    expect(plan.invalidSelections).toEqual([
      { profileId: AGENT_CODEX_ID, reason: "kind_mismatch" },
    ]);
  });

  it("keeps explicit already-joined profiles valid while all selects only new profiles", () => {
    const explicitPlan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      currentMembers: [{ profileId: AGENT_CODEX_ID, status: "active" }],
      currentOwnerUserId: "user-1",
      mode: "agents",
      profiles: buildProfiles(),
      selector: {
        kind: "profile_ids",
        profileIds: [AGENT_CODEX_ID, AGENT_CLAUDE_ID],
      },
    });
    const allPlan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      currentMembers: [{ profileId: AGENT_CODEX_ID, status: "active" }],
      currentOwnerUserId: "user-1",
      mode: "agents",
      profiles: buildProfiles(),
      selector: { kind: "all" },
    });

    expect(explicitPlan.selectedProfileIds).toEqual([
      AGENT_CODEX_ID,
      AGENT_CLAUDE_ID,
    ]);
    expect(allPlan.selectedProfileIds).toEqual([AGENT_CLAUDE_ID]);
  });

  it("reports missing explicit profiles without inventing fallback membership", () => {
    const plan = buildSpaceProfileAddPlan({
      actingProfileId: HUMAN_CURRENT_ID,
      currentMembers: [],
      currentOwnerUserId: "user-1",
      mode: "profiles",
      profiles: buildProfiles(),
      selector: {
        kind: "profile_ids",
        profileIds: ["agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
      },
    });

    expect(plan.selectedProfileIds).toEqual([]);
    expect(plan.invalidSelections).toEqual([
      {
        profileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        reason: "not_found",
      },
    ]);
  });
});

function buildProfiles(): SpaceProfileAddProfile[] {
  return [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      ownerUserId: "user-1",
      profileId: HUMAN_CURRENT_ID,
      profileKind: "human",
      profileName: "Felix",
      status: "active",
    },
    {
      createdAt: "2026-01-02T00:00:00.000Z",
      ownerUserId: "user-1",
      profileId: HUMAN_WORK_ID,
      profileKind: "human",
      profileName: "Work",
      status: "active",
    },
    {
      createdAt: "2026-01-03T00:00:00.000Z",
      ownerUserId: "user-1",
      profileId: AGENT_CODEX_ID,
      profileKind: "agent",
      profileName: "Codex",
      status: "active",
    },
    {
      createdAt: "2026-01-04T00:00:00.000Z",
      ownerUserId: "user-1",
      profileId: AGENT_CLAUDE_ID,
      profileKind: "agent",
      profileName: "Claude",
      status: "active",
    },
    {
      createdAt: "2026-01-05T00:00:00.000Z",
      ownerUserId: "user-1",
      profileId: AGENT_INACTIVE_ID,
      profileKind: "agent",
      profileName: "Inactive",
      status: "inactive",
    },
    {
      createdAt: "2026-01-06T00:00:00.000Z",
      ownerUserId: "user-2",
      profileId: HUMAN_OTHER_OWNER_ID,
      profileKind: "human",
      profileName: "Other Owner",
      status: "active",
    },
  ];
}
