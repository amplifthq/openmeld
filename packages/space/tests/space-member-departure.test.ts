import { describe, expect, it } from "vitest";
import { resolveSpaceMemberDeparture } from "../src/access/member-departure";

const departingUserId = "departing-user";
const ownHuman = {
  profileId: "human-profile",
  profileKind: "human",
  ownerUserId: departingUserId,
};
const privateSpace = {
  departingUserId,
  ownerUserIds: [departingUserId],
  visibility: "private",
  accessMode: "members_only",
  allowGuests: false,
  isDirectMessage: false,
  historicalMembers: [ownHuman],
};

describe("Space member departure", () => {
  it.each([
    ["only the departing human", [ownHuman]],
    [
      "the departing person's human profiles and Agents",
      [
        ownHuman,
        { ...ownHuman, profileId: "another-human-profile" },
        {
          profileId: "personal-agent",
          profileKind: "agent",
          ownerUserId: departingUserId,
        },
      ],
    ],
    [
      "the departing human and the verified Organization Center Agent",
      [
        ownHuman,
        {
          profileId: "center-agent",
          profileKind: "agent",
          ownerUserId: null,
          isOrganizationCenterAgent: true,
        },
      ],
    ],
  ])("closes a private Space used by %s", (_, historicalMembers) => {
    expect(
      resolveSpaceMemberDeparture({ ...privateSpace, historicalMembers })
    ).toBe("close");
  });

  it.each([
    ["another human", "human", "another-user", false],
    ["another person's Agent", "agent", "another-user", false],
    ["an unresolved human", "human", null, false],
    ["an unverified Organization Agent", "agent", null, false],
    ["an unknown profile kind", "system", departingUserId, false],
    [
      "a Center Agent with conflicting ownership",
      "agent",
      "another-user",
      true,
    ],
  ])("requires handoff when the history includes %s", (_, profileKind, ownerUserId, isOrganizationCenterAgent) => {
    expect(
      resolveSpaceMemberDeparture({
        ...privateSpace,
        historicalMembers: [
          ownHuman,
          {
            profileId: "historical-participant",
            profileKind,
            ownerUserId,
            isOrganizationCenterAgent,
          },
        ],
      })
    ).toBe("handoff_required");
  });

  it.each([
    { visibility: "public" },
    { accessMode: "public" },
    { accessMode: "protected" },
    { allowGuests: true },
    { visibility: undefined },
    { accessMode: undefined },
    { allowGuests: undefined },
    { isDirectMessage: undefined },
    { historicalMembers: undefined },
    { historicalMembers: [] },
    {
      historicalMembers: [
        {
          profileId: "agent-only",
          profileKind: "agent",
          ownerUserId: departingUserId,
        },
      ],
    },
    { ownerUserIds: undefined },
    { ownerUserIds: [departingUserId, ""] },
  ])("requires handoff without complete sole-user private access evidence: %j", (evidence) => {
    expect(resolveSpaceMemberDeparture({ ...privateSpace, ...evidence })).toBe(
      "handoff_required"
    );
  });

  it("demotes the departing owner when another owner retains a shared Space", () => {
    expect(
      resolveSpaceMemberDeparture({
        ...privateSpace,
        ownerUserIds: [departingUserId, "remaining-owner"],
        visibility: "public",
        historicalMembers: [
          ownHuman,
          {
            profileId: "collaborator",
            profileKind: "human",
            ownerUserId: "remaining-owner",
          },
        ],
      })
    ).toBe("demote");
  });

  it.each([
    { ownerUserIds: ["remaining-owner"] },
    { isDirectMessage: true },
  ])("does not require handoff when departure has no ordinary-Space ownership: %j", (evidence) => {
    expect(resolveSpaceMemberDeparture({ ...privateSpace, ...evidence })).toBe(
      "not_owner"
    );
  });
});
