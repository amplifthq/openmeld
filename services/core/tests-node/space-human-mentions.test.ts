import { describe, expect, it, vi } from "vitest";
import { resolveSpaceHumanMentionTargets } from "../src/space/application/human-mention-targets";

const member = {
  profileId: "11111111-1111-4111-8111-111111111111",
  profileName: "Space reporter",
  profileKind: "human" as const,
  ownerUserId: "reporter",
};
const colleague = {
  profileId: "22222222-2222-4222-8222-222222222222",
  profileName: "Organization reporter",
  profileKind: "human" as const,
  ownerUserId: "colleague",
  ownerName: "Organization reporter",
  agentControllerRef: null,
};

describe("Human Mention target resolution", () => {
  it("bounds Organization lookups without limiting existing Space member mentions", async () => {
    const ids = Array.from({ length: 26 }, (_, index) => `person-${index}`);
    const readOrganizationProfile = vi.fn(async () => colleague);
    await expect(
      resolveSpaceHumanMentionTargets({
        profileIds: ids,
        readSpaceMember: () => null,
        readOrganizationProfile,
      })
    ).rejects.toMatchObject({ code: "space.addressing.target_invalid" });
    expect(readOrganizationProfile).not.toHaveBeenCalled();
    await expect(
      resolveSpaceHumanMentionTargets({
        profileIds: ids,
        readSpaceMember: (profileId) => ({ ...member, profileId }),
        readOrganizationProfile,
      })
    ).resolves.toHaveLength(26);
  });
  it("distinguishes current Space members from verified Organization people without adding membership", async () => {
    const readOrganizationProfile = vi.fn(async () => colleague);
    await expect(
      resolveSpaceHumanMentionTargets({
        profileIds: [
          member.profileId,
          colleague.profileId,
          colleague.profileId,
        ],
        readSpaceMember: (id) => (id === member.profileId ? member : null),
        readOrganizationProfile,
      })
    ).resolves.toEqual([
      {
        profileId: member.profileId,
        profileName: member.profileName,
        ownerUserId: member.ownerUserId,
        scope: "space",
      },
      {
        profileId: colleague.profileId,
        profileName: colleague.profileName,
        ownerUserId: colleague.ownerUserId,
        scope: "organization",
      },
    ]);
    expect(readOrganizationProfile).toHaveBeenCalledExactlyOnceWith(
      colleague.profileId
    );
  });
  it.each([
    null,
    { ...colleague, profileKind: "agent" as const },
    { ...colleague, ownerUserId: null },
  ])("rejects a missing, non-Human or ownerless Organization target (%j)", async (profile) => {
    await expect(
      resolveSpaceHumanMentionTargets({
        profileIds: [colleague.profileId],
        readSpaceMember: () => null,
        readOrganizationProfile: async () => profile,
      })
    ).rejects.toMatchObject({
      code: "space.addressing.target_invalid",
      targetProfileId: colleague.profileId,
    });
  });
});
