import {
  accountSidebarPreferences,
  type createD1Db,
  members,
} from "@openmeld/db/auth";
import {
  type AccountSidebarSnapshot,
  accountSidebarPreferencesSchema,
} from "@openmeld/schemas";
import { and, eq, exists, sql } from "drizzle-orm";

export function createAccountSidebarRepository(
  db: ReturnType<typeof createD1Db>
) {
  const membership = (userId: string, organizationId: string) =>
    db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.userId, userId),
          eq(members.organizationId, organizationId)
        )
      );
  const key = (userId: string, organizationId: string) =>
    and(
      eq(accountSidebarPreferences.userId, userId),
      eq(accountSidebarPreferences.organizationId, organizationId)
    );
  return {
    async isMember(userId: string, organizationId: string) {
      return (await membership(userId, organizationId).limit(1)).length === 1;
    },
    async read(
      userId: string,
      organizationId: string
    ): Promise<AccountSidebarSnapshot> {
      const [row] = await db
        .select()
        .from(accountSidebarPreferences)
        .where(
          and(
            key(userId, organizationId),
            exists(membership(userId, organizationId))
          )
        )
        .limit(1);
      return row
        ? {
            revision: row.revision,
            preferences: accountSidebarPreferencesSchema.parse(
              JSON.parse(row.preferences)
            ),
          }
        : {
            revision: 0,
            preferences: {
              pinned: { sort: "priority", spaceIds: [] },
              spaces: { sort: "recent", spaceIds: [] },
              groups: [],
            },
          };
    },
    async save(
      userId: string,
      organizationId: string,
      snapshot: AccountSidebarSnapshot
    ) {
      // Older clients save only Space preferences. Preserve the People namespace;
      // the revision check below still rejects any concurrent write.
      const previous =
        snapshot.preferences.people === undefined ||
        snapshot.preferences.agents === undefined ||
        snapshot.preferences.messages === undefined
          ? await this.read(userId, organizationId)
          : null;
      const values = {
        userId,
        organizationId,
        revision: snapshot.revision + 1,
        preferences: JSON.stringify({
          ...snapshot.preferences,
          ...(snapshot.preferences.messages === undefined &&
          previous?.preferences.messages
            ? { messages: previous.preferences.messages }
            : {}),
          ...(snapshot.preferences.people === undefined &&
          previous?.preferences.people
            ? { people: previous.preferences.people }
            : {}),
          ...(snapshot.preferences.agents === undefined &&
          previous?.preferences.agents
            ? { agents: previous.preferences.agents }
            : {}),
        }),
      };
      if (snapshot.revision === 0) {
        // First write is insert-only: two devices cannot both create revision 1.
        const inserted = await db.all<{ revision: number }>(sql`
          INSERT INTO account_sidebar_preferences (user_id, organization_id, revision, preferences)
          SELECT ${userId}, ${organizationId}, ${values.revision}, ${values.preferences}
          WHERE ${exists(membership(userId, organizationId))}
          ON CONFLICT DO NOTHING RETURNING revision
        `);
        return inserted.length === 1;
      }
      const updated = await db
        .update(accountSidebarPreferences)
        .set(values)
        .where(
          and(
            key(userId, organizationId),
            eq(accountSidebarPreferences.revision, snapshot.revision),
            exists(membership(userId, organizationId))
          )
        )
        .returning({ revision: accountSidebarPreferences.revision });
      return updated.length === 1;
    },
  };
}
