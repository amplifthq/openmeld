import { describe, expect, it } from "vitest";
import { toProfileView } from "../src/lib/profiles/profile-view";

describe("Agent Profile avatar response versioning", () => {
  const profile = {
    profileId: "agt_11111111-1111-4111-8111-111111111111",
    profileName: "Agent",
    profileHandle: "agent",
    profileKind: "agent" as const,
    isDefault: false,
    status: "active" as const,
    ownerUserId: "user-1",
    organizationId: "org-1",
    source: "web_create",
    managedRole: null,
    avatarStyle: "fluid",
    avatarOptions: { color: "sage" as const },
    createdByUserId: "user-1",
    creationActorProfileId: null,
    creatorProfileId: null,
    lastUsedAt: null,
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    updatedAt: new Date("2026-09-10T00:00:00.000Z"),
  };

  it("keeps the old response shape until the caller opts in", () => {
    expect(toProfileView(profile)).not.toHaveProperty("avatarStyle");
    expect(toProfileView(profile)).not.toHaveProperty("avatarOptions");
    expect(
      toProfileView(profile, { includeAvatarStyle: true }).avatarOptions
    ).toEqual({ color: "sage" });
    expect(toProfileView(profile, { includeAvatarStyle: true })).toHaveProperty(
      "avatarStyle",
      "fluid"
    );
  });
});
