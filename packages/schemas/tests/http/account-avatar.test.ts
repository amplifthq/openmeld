import { describe, expect, it } from "vitest";
import {
  accountAvatarCommitRpcInputSchema,
  accountAvatarMimeTypeSchema,
  buildAccountAvatarObjectKey,
  buildAccountAvatarPublicPath,
  parseAccountAvatarReferenceFromUrl,
} from "../../src";

const profileId = "default-human-profile-1";
const assetId = "11111111-1111-4111-8111-111111111111";

describe("account avatar contracts", () => {
  it("builds one canonical profile-owned object key and public path", () => {
    expect(buildAccountAvatarObjectKey({ assetId, profileId })).toBe(
      "profiles/default-human-profile-1/avatars/11111111-1111-4111-8111-111111111111.webp"
    );
    expect(buildAccountAvatarPublicPath({ assetId, profileId })).toBe(
      "/v1/profile-avatars/default-human-profile-1/11111111-1111-4111-8111-111111111111.webp"
    );
  });

  it("recognizes only canonical managed avatar URLs", () => {
    expect(
      parseAccountAvatarReferenceFromUrl(
        "https://gateway.openmeld.ai/v1/profile-avatars/default-human-profile-1/11111111-1111-4111-8111-111111111111.webp"
      )
    ).toEqual({ assetId, profileId });
    expect(
      parseAccountAvatarReferenceFromUrl(
        "https://example.com/v1/profile-avatars/default-human-profile-1/not-a-uuid.webp"
      )
    ).toBeNull();
    expect(
      parseAccountAvatarReferenceFromUrl(
        "https://example.com/v1/profile-avatars/default-human-profile-1/11111111-1111-4111-8111-111111111111.webp?size=small"
      )
    ).toBeNull();
  });

  it("shares the bounded identity-image upload formats", () => {
    expect(accountAvatarMimeTypeSchema.safeParse("image/jpeg").success).toBe(
      true
    );
    expect(accountAvatarMimeTypeSchema.safeParse("image/png").success).toBe(
      true
    );
    expect(accountAvatarMimeTypeSchema.safeParse("image/webp").success).toBe(
      true
    );
    expect(accountAvatarMimeTypeSchema.safeParse("image/svg+xml").success).toBe(
      false
    );
  });

  it("keeps profile ownership validation at the Auth commit boundary", () => {
    expect(
      accountAvatarCommitRpcInputSchema.safeParse({
        actorUserId: "user-owner",
        expectedAvatar: null,
        expectedDefaultHumanProfileId: profileId,
        nextAvatar: {
          assetId,
          profileId: "different-profile",
          url: "https://gateway.openmeld.ai/v1/profile-avatars/different-profile/11111111-1111-4111-8111-111111111111.webp",
        },
      }).success
    ).toBe(true);
  });

  it("carries bounded session refresh headers on the internal commit", () => {
    const parsed = accountAvatarCommitRpcInputSchema.parse({
      actorUserId: "user-owner",
      expectedAvatar: null,
      expectedDefaultHumanProfileId: profileId,
      headers: { cookie: "better-auth.session_token=test" },
      nextAvatar: null,
    });

    expect(parsed.headers).toEqual({
      cookie: "better-auth.session_token=test",
    });
  });
});
