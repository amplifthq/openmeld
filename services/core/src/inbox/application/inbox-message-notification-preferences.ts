import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { inboxMessageNotificationPreferencesResponseSchema } from "@openmeld/schemas";
import type {
  InboxMessageNotificationPreferencesResponse,
  UpdateInboxMessageNotificationPreferencesBody,
} from "@openmeld/schemas/types";
import { personalAgentOwnerAccessSql } from "./inbox-agent-owner-access";
import { InboxServiceError } from "./inbox-service";

type PreferenceIdentity = {
  organizationId: string;
  userId: string;
};
export function createInboxMessageNotificationPreferencesService(
  db: PostgresDatabase
) {
  // Use Core's indexed membership/current personal ownership, never a client
  // supplied recipient or a private Auth table, to authorize a conversation.
  async function requireConversationAccess(
    input: PreferenceIdentity & {
      spaceId: string;
    }
  ) {
    const accessible = await db
      .query({
        text: `
      SELECT 1 AS allowed FROM "openmeld"."space_index_spaces" AS space
      WHERE space.space_id = $1 AND space.organization_id = $2 AND space.status = 'active'
        AND (
          EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" AS member
            WHERE member.space_id = space.space_id AND member.status = 'active'
              AND member.owner_user_id_snapshot = $3 AND member.profile_kind_snapshot = 'human')
          OR ${personalAgentOwnerAccessSql("space.space_id", "$3")}
        )
      LIMIT 1
    `,
        values: [input.spaceId, input.organizationId, input.userId],
      })
      .then((result) => result.rows[0] ?? null);
    if (!accessible) {
      throw new InboxServiceError({
        code: "inbox.conversation_not_found",
        message: "Conversation notification settings are not available.",
        status: 404,
      });
    }
  }
  async function get(
    input: PreferenceIdentity & {
      spaceId?: string;
    }
  ): Promise<InboxMessageNotificationPreferencesResponse> {
    if (input.spaceId) {
      await requireConversationAccess({ ...input, spaceId: input.spaceId });
    }
    const row = await db
      .query<{
        default_mode: string | null;
        override_mode: string | null;
      }>({
        text: `
      SELECT
        (SELECT mode FROM "openmeld"."inbox_message_notification_defaults" WHERE user_id = $1) AS default_mode,
        (SELECT mode FROM "openmeld"."inbox_conversation_notification_preferences"
          WHERE user_id = $1 AND organization_id = $2 AND space_id = $3) AS override_mode
    `,
        values: [input.userId, input.organizationId, input.spaceId ?? null],
      })
      .then((result) => result.rows[0] ?? null);
    const defaultMode = row?.default_mode ?? "mentions_and_replies";
    const overrideMode = row?.override_mode ?? null;
    return inboxMessageNotificationPreferencesResponseSchema.parse({
      organizationId: input.organizationId,
      spaceId: input.spaceId ?? null,
      defaultMode,
      overrideMode,
      effectiveMode: overrideMode ?? defaultMode,
    });
  }
  async function update(
    input: PreferenceIdentity & {
      preference: UpdateInboxMessageNotificationPreferencesBody;
    }
  ) {
    const preference = input.preference;
    if (preference.scope === "account") {
      await db.query({
        text: `INSERT INTO "openmeld"."inbox_message_notification_defaults" (user_id, mode) VALUES ($1, $2)
        ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode`,
        values: [input.userId, preference.mode],
      });
      return await get(input);
    }
    await requireConversationAccess({ ...input, spaceId: preference.spaceId });
    if (preference.mode === null) {
      await db.query({
        text: `DELETE FROM "openmeld"."inbox_conversation_notification_preferences"
        WHERE user_id = $1 AND organization_id = $2 AND space_id = $3`,
        values: [input.userId, input.organizationId, preference.spaceId],
      });
    } else {
      await db.query({
        text: `INSERT INTO "openmeld"."inbox_conversation_notification_preferences"
        (user_id, organization_id, space_id, mode) VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id, organization_id, space_id) DO UPDATE SET mode = excluded.mode`,
        values: [
          input.userId,
          input.organizationId,
          preference.spaceId,
          preference.mode,
        ],
      });
    }
    return await get({ ...input, spaceId: preference.spaceId });
  }
  return { get, update };
}
