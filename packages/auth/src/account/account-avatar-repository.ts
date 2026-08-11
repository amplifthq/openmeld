import { type createD1Db, openMeldProfiles, users } from "@openmeld/db/auth";
import { and, eq, exists, isNull } from "drizzle-orm";

export type AccountAvatarMutationRecord = {
  avatar: string | null;
  defaultHumanProfileId: string;
  ownerUserId: string;
};

export type AccountAvatarMutationRepository = {
  compareAndSetAvatar(input: {
    actorUserId: string;
    expectedAvatar: string | null;
    expectedDefaultHumanProfileId: string;
    nextAvatar: string | null;
  }): Promise<boolean>;
  readForActor(input: {
    actorUserId: string;
  }): Promise<AccountAvatarMutationRecord | null>;
};

type AccountAvatarDatabase = ReturnType<typeof createD1Db>;

export function createDrizzleAccountAvatarMutationRepository(
  db: AccountAvatarDatabase
): AccountAvatarMutationRepository {
  return {
    async compareAndSetAvatar(input) {
      const expectedProfile = db
        .select({ profileId: openMeldProfiles.profileId })
        .from(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, input.actorUserId),
            eq(openMeldProfiles.profileId, input.expectedDefaultHumanProfileId),
            eq(openMeldProfiles.profileKind, "human"),
            eq(openMeldProfiles.isDefault, true),
            eq(openMeldProfiles.status, "active")
          )
        );
      const updated = await db
        .update(users)
        .set({
          image: input.nextAvatar,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.id, input.actorUserId),
            input.expectedAvatar === null
              ? isNull(users.image)
              : eq(users.image, input.expectedAvatar),
            exists(expectedProfile)
          )
        )
        .returning({ id: users.id });
      return updated.length === 1;
    },
    async readForActor(input) {
      const rows = await db
        .select({
          avatar: users.image,
          defaultHumanProfileId: openMeldProfiles.profileId,
          ownerUserId: users.id,
        })
        .from(users)
        .innerJoin(
          openMeldProfiles,
          and(
            eq(openMeldProfiles.ownerUserId, users.id),
            eq(openMeldProfiles.profileKind, "human"),
            eq(openMeldProfiles.isDefault, true),
            eq(openMeldProfiles.status, "active")
          )
        )
        .where(eq(users.id, input.actorUserId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
