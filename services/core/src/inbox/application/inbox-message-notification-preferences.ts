import { inboxMessageNotificationPreferencesResponseSchema } from "@openmeld/schemas";
import type {
  InboxMessageNotificationPreferencesResponse,
  UpdateInboxMessageNotificationPreferencesBody,
} from "@openmeld/schemas/types";
import { personalAgentOwnerAccessSql } from "./inbox-agent-owner-access";
import { InboxServiceError } from "./inbox-service";

type PreferenceIdentity = { organizationId: string; userId: string };

export function createInboxMessageNotificationPreferencesService(
  db: D1Database
) {
  // Use Core's indexed membership/current personal ownership, never a client
  // supplied recipient or a private Auth table, to authorize a conversation.
  async function requireConversationAccess(
    input: PreferenceIdentity & { spaceId: string }
  ) {
    const accessible = await db
      .prepare(`
      SELECT 1 AS allowed FROM space_index_spaces AS space
      WHERE space.space_id = ?1 AND space.organization_id = ?2 AND space.status = 'active'
        AND (
          EXISTS (SELECT 1 FROM space_index_memberships AS member
            WHERE member.space_id = space.space_id AND member.status = 'active'
              AND member.owner_user_id_snapshot = ?3 AND member.profile_kind_snapshot = 'human')
          OR ${personalAgentOwnerAccessSql("space.space_id", "?3")}
        )
      LIMIT 1
    `)
      .bind(input.spaceId, input.organizationId, input.userId)
      .first();
    if (!accessible) {
      throw new InboxServiceError({
        code: "inbox.conversation_not_found",
        message: "Conversation notification settings are not available.",
        status: 404,
      });
    }
  }

  async function get(
    input: PreferenceIdentity & { spaceId?: string }
  ): Promise<InboxMessageNotificationPreferencesResponse> {
    if (input.spaceId) {
      await requireConversationAccess({ ...input, spaceId: input.spaceId });
    }
    const row = await db
      .prepare(`
      SELECT
        (SELECT mode FROM inbox_message_notification_defaults WHERE user_id = ?1) AS default_mode,
        (SELECT mode FROM inbox_conversation_notification_preferences
          WHERE user_id = ?1 AND organization_id = ?2 AND space_id = ?3) AS override_mode
    `)
      .bind(input.userId, input.organizationId, input.spaceId ?? null)
      .first<{ default_mode: string | null; override_mode: string | null }>();
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
      await db
        .prepare(`INSERT INTO inbox_message_notification_defaults (user_id, mode) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode`)
        .bind(input.userId, preference.mode)
        .run();
      return await get(input);
    }
    await requireConversationAccess({ ...input, spaceId: preference.spaceId });
    if (preference.mode === null) {
      await db
        .prepare(`DELETE FROM inbox_conversation_notification_preferences
        WHERE user_id = ? AND organization_id = ? AND space_id = ?`)
        .bind(input.userId, input.organizationId, preference.spaceId)
        .run();
    } else {
      await db
        .prepare(`INSERT INTO inbox_conversation_notification_preferences
        (user_id, organization_id, space_id, mode) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, organization_id, space_id) DO UPDATE SET mode = excluded.mode`)
        .bind(
          input.userId,
          input.organizationId,
          preference.spaceId,
          preference.mode
        )
        .run();
    }
    return await get({ ...input, spaceId: preference.spaceId });
  }
  return { get, update };
}
