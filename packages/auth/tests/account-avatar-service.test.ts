import { describe, expect, it, vi } from "vitest";
import {
  type AccountAvatarMutationRecord,
  type AccountAvatarMutationRepository,
  createAccountAvatarService,
} from "../src/account/account-avatar-service";

const currentAvatar =
  "https://gateway.openmeld.ai/v1/profile-avatars/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";
const ownerRecord: AccountAvatarMutationRecord = {
  avatar: currentAvatar,
  defaultHumanProfileId: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "user-owner",
};

function createRepository(input?: {
  compareAndSetResult?: boolean;
  record?: AccountAvatarMutationRecord | null;
}) {
  return {
    compareAndSetAvatar: vi.fn(async () => input?.compareAndSetResult ?? true),
    readForActor: vi.fn(async () =>
      input && Object.hasOwn(input, "record")
        ? (input.record ?? null)
        : ownerRecord
    ),
  } satisfies AccountAvatarMutationRepository;
}

describe("account avatar service", () => {
  it("prepares the current avatar for the active default Human Profile", async () => {
    const service = createAccountAvatarService({
      repository: createRepository(),
    });

    await expect(
      service.prepare({ actorUserId: "user-owner" })
    ).resolves.toEqual({
      currentAvatar,
      defaultHumanProfileId: ownerRecord.defaultHumanProfileId,
      ok: true,
    });
  });

  it("fails closed when the account has no active default Human Profile", async () => {
    const service = createAccountAvatarService({
      repository: createRepository({ record: null }),
    });

    await expect(
      service.prepare({ actorUserId: "user-owner" })
    ).resolves.toMatchObject({
      code: "account.avatar.profile_not_found",
      ok: false,
    });
  });

  it("commits only a managed URL owned by the prepared Human Profile", async () => {
    const repository = createRepository();
    const service = createAccountAvatarService({ repository });
    const nextAvatar = {
      assetId: "33333333-3333-4333-8333-333333333333",
      profileId: ownerRecord.defaultHumanProfileId,
      url: "https://gateway.openmeld.ai/v1/profile-avatars/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.webp",
    };

    await expect(
      service.commit({
        actorUserId: "user-owner",
        expectedAvatar: currentAvatar,
        expectedDefaultHumanProfileId: ownerRecord.defaultHumanProfileId,
        nextAvatar,
      })
    ).resolves.toEqual({
      avatar: nextAvatar.url,
      defaultHumanProfileId: ownerRecord.defaultHumanProfileId,
      ok: true,
    });
    expect(repository.compareAndSetAvatar).toHaveBeenCalledWith({
      actorUserId: "user-owner",
      expectedAvatar: currentAvatar,
      expectedDefaultHumanProfileId: ownerRecord.defaultHumanProfileId,
      nextAvatar: nextAvatar.url,
    });
  });

  it("rejects a managed URL for a different Human Profile", async () => {
    const repository = createRepository();
    const service = createAccountAvatarService({ repository });

    await expect(
      service.commit({
        actorUserId: "user-owner",
        expectedAvatar: currentAvatar,
        expectedDefaultHumanProfileId: ownerRecord.defaultHumanProfileId,
        nextAvatar: {
          assetId: "33333333-3333-4333-8333-333333333333",
          profileId: "44444444-4444-4444-8444-444444444444",
          url: "https://gateway.openmeld.ai/v1/profile-avatars/44444444-4444-4444-8444-444444444444/33333333-3333-4333-8333-333333333333.webp",
        },
      })
    ).resolves.toMatchObject({
      code: "account.avatar.invalid_reference",
      ok: false,
    });
    expect(repository.compareAndSetAvatar).not.toHaveBeenCalled();
  });

  it("reports a conflict when the avatar or default Human Profile changed", async () => {
    const repository = createRepository({ compareAndSetResult: false });
    const service = createAccountAvatarService({ repository });

    await expect(
      service.commit({
        actorUserId: "user-owner",
        expectedAvatar: currentAvatar,
        expectedDefaultHumanProfileId: ownerRecord.defaultHumanProfileId,
        nextAvatar: null,
      })
    ).resolves.toMatchObject({
      code: "account.avatar.conflict",
      ok: false,
    });
  });
});
