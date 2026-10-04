import {
  type createAuthDatabase,
  openMeldProfiles,
  users,
} from "@openmeld/db/auth";
import { and, eq, exists, type InferSelectModel } from "@openmeld/db/query";
import { AccountDisplayNameInvariantError } from "./account-display-name-errors";
export type DefaultHumanProfileRecord = InferSelectModel<
  typeof openMeldProfiles
>;
export type AccountDisplayNameRepository = {
  findDefaultHumanProfile: (
    ownerUserId: string
  ) => Promise<DefaultHumanProfileRecord | null>;
  listProfileHandles: (
    ownerUserId: string,
    excludedProfileId: string
  ) => Promise<string[]>;
  updateDisplayNamePair: (input: {
    displayName: string;
    ownerUserId: string;
    profileHandle: string;
    profileId: string;
  }) => Promise<DefaultHumanProfileRecord>;
};
type AccountDisplayNameDatabase = ReturnType<typeof createAuthDatabase>;
export function createDrizzleAccountDisplayNameRepository(
  db: AccountDisplayNameDatabase
): AccountDisplayNameRepository {
  return {
    async findDefaultHumanProfile(ownerUserId) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(defaultHumanProfilePredicate(ownerUserId))
        .limit(1);
      return rows[0] ?? null;
    },
    async listProfileHandles(ownerUserId, excludedProfileId) {
      const rows = await db
        .select({
          profileHandle: openMeldProfiles.profileHandle,
          profileId: openMeldProfiles.profileId,
        })
        .from(openMeldProfiles)
        .where(eq(openMeldProfiles.ownerUserId, ownerUserId));
      return rows
        .filter((profile) => profile.profileId !== excludedProfileId)
        .map((profile) => profile.profileHandle);
    },
    async updateDisplayNamePair(input) {
      const now = new Date();
      const expectedProfilePredicate = and(
        defaultHumanProfilePredicate(input.ownerUserId),
        eq(openMeldProfiles.profileId, input.profileId)
      );
      const expectedProfile = db
        .select({ profileId: openMeldProfiles.profileId })
        .from(openMeldProfiles)
        .where(expectedProfilePredicate);
      const expectedAccount = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.ownerUserId));
      return await db.transaction(async (tx) => {
        const updatedUsers = await tx
          .update(users)
          .set({
            name: input.displayName,
            updatedAt: now,
          })
          .where(and(eq(users.id, input.ownerUserId), exists(expectedProfile)))
          .returning({ id: users.id });
        if (updatedUsers.length !== 1) {
          throw new AccountDisplayNameInvariantError(
            "authenticated account or default profile was not found"
          );
        }
        const updatedProfiles = await tx
          .update(openMeldProfiles)
          .set({
            profileHandle: input.profileHandle,
            profileName: input.displayName,
            updatedAt: now,
          })
          .where(and(expectedProfilePredicate, exists(expectedAccount)))
          .returning();
        const updatedProfile = updatedProfiles[0];
        if (!updatedProfile || updatedProfiles.length !== 1) {
          throw new AccountDisplayNameInvariantError(
            "default profile or authenticated account was not found"
          );
        }
        return updatedProfile;
      });
    },
  };
}
function defaultHumanProfilePredicate(ownerUserId: string) {
  return and(
    eq(openMeldProfiles.ownerUserId, ownerUserId),
    eq(openMeldProfiles.profileKind, "human"),
    eq(openMeldProfiles.isDefault, true),
    eq(openMeldProfiles.status, "active")
  );
}
