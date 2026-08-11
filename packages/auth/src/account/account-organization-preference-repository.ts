import { type createD1Db, members, users } from "@openmeld/db/auth";
import { and, eq, exists } from "drizzle-orm";

export type SetLastSelectedOrganizationInput = {
  organizationId: string;
  userId: string;
};

export type AccountOrganizationPreferenceRepository = {
  getLastSelectedOrganizationId: (userId: string) => Promise<string | null>;
  setLastSelectedOrganization: (
    input: SetLastSelectedOrganizationInput
  ) => Promise<boolean>;
};

type AccountOrganizationPreferenceDatabase = ReturnType<typeof createD1Db>;

export function createDrizzleAccountOrganizationPreferenceRepository(
  db: AccountOrganizationPreferenceDatabase
): AccountOrganizationPreferenceRepository {
  return {
    async getLastSelectedOrganizationId(userId) {
      const [account] = await db
        .select({ organizationId: users.lastSelectedOrganizationId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return account?.organizationId ?? null;
    },
    async setLastSelectedOrganization(input) {
      const currentMembership = db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.userId, input.userId),
            eq(members.organizationId, input.organizationId)
          )
        );
      const updatedUsers = await db
        .update(users)
        .set({
          lastSelectedOrganizationId: input.organizationId,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, input.userId), exists(currentMembership)))
        .returning({ id: users.id });

      return updatedUsers.length === 1;
    },
  };
}
