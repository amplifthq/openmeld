import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { ensureInboxItem } from "../inbox/application/inbox-item-service";
import type { SpaceMemberRecord } from "../space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../space/infrastructure/sql/space-meta-repo";

/**
 * The accepted membership generation owns this event; visits and retries do
 * not. Only a membership someone else added notifies.
 */
export async function projectSpaceMembershipInbox(input: {
  db: PostgresDatabase;
  meta: SpaceMetaRecord;
  members: readonly SpaceMemberRecord[];
}) {
  if (input.meta.deletedAt) {
    return;
  }
  for (const member of input.members) {
    if (
      member.status !== "active" ||
      member.profileKindSnapshot !== "human" ||
      !member.ownerUserIdSnapshot ||
      // A member who added themselves, such as the creator of a Space or of
      // a Direct Message with their own Agent, already knows about it.
      member.addedByOwnerUserId === member.ownerUserIdSnapshot
    ) {
      continue;
    }
    const occurredAtMs = Date.parse(member.addedAt);
    await ensureInboxItem({
      db: input.db,
      nowMs: Date.now(),
      candidate: {
        attention: "update",
        importance: "normal",
        kind: "space_joined",
        occurredAtMs,
        organizationId: input.meta.organizationId,
        recipientUserId: member.ownerUserIdSnapshot,
        sourceKey: `space-joined:${member.spaceId}:${member.profileId}:${occurredAtMs}`,
        sourceKind: "system_attention_event",
        sourceFacts: { version: 1, recipientReasons: ["space_member"] },
        sourceTarget: { kind: "space", spaceId: member.spaceId },
        title: "You joined a Space",
        preview: "Open this Space to view its members and conversation.",
        contextLabel: (input.meta.name?.trim() || "Space").slice(0, 160),
      },
      sourceGuard: {
        bindings: [
          member.spaceId,
          member.profileId,
          member.ownerUserIdSnapshot,
          occurredAtMs,
        ],
        sql: (
          offset
        ) => `EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" AS member
          JOIN "openmeld"."space_index_spaces" AS space ON space.space_id = member.space_id
          JOIN "openmeld"."organizations" AS organization ON organization.id = space.organization_id
          JOIN "openmeld"."users" AS recipient ON recipient.id = member.owner_user_id_snapshot AND recipient.deleted_at IS NULL
          WHERE member.space_id = $${offset + 1} AND member.profile_id = $${offset + 2}
          AND member.owner_user_id_snapshot = $${offset + 3} AND member.added_at_ms = $${offset + 4}
          AND member.status = 'active' AND space.status = 'active')`,
      },
    });
  }
}
