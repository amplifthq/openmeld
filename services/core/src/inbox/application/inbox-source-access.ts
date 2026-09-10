import { inboxItemKindSchema } from "@openmeld/schemas";
import { personalAgentOwnerAccessSql } from "./inbox-agent-owner-access";

type InboxItemSqlAlias = "inbox_items" | "items";

export function buildCurrentInboxSourceAccessSql(
  itemAlias: InboxItemSqlAlias,
  canManageAuthorizationUpdates = false
): string {
  return `
    (
      ${itemAlias}.kind IN (${inboxItemKindSchema.options.map((kind) => `'${kind}'`).join(", ")})
      AND (${canManageAuthorizationUpdates ? "1" : `NOT (${itemAlias}.source_kind = 'system_attention_event' AND ${itemAlias}.source_key LIKE 'authorization-update:%')`})
      AND (
          NOT (
            json_extract(${itemAlias}.source_target_json, '$.kind') IN (
              'space',
              'agent_interaction'
            )
            OR (
              json_extract(${itemAlias}.source_target_json, '$.kind') =
                'center_agent'
              AND json_extract(
                ${itemAlias}.source_target_json,
                '$.spaceId'
              ) IS NOT NULL
            )
          )
          OR EXISTS (
            SELECT 1
            FROM space_index_memberships AS inbox_space_membership
            INNER JOIN space_index_spaces AS inbox_space
              ON inbox_space.space_id = inbox_space_membership.space_id
            WHERE inbox_space_membership.space_id =
                json_extract(${itemAlias}.source_target_json, '$.spaceId')
              AND inbox_space.organization_id = ${itemAlias}.organization_id
              AND inbox_space.status = 'active'
              AND inbox_space_membership.owner_user_id_snapshot =
                ${itemAlias}.recipient_user_id
              AND (inbox_space_membership.profile_kind_snapshot = 'human'
                OR (json_extract(${itemAlias}.source_target_json, '$.agentOwnerActivity') = 1 AND ${personalAgentOwnerAccessSql(`json_extract(${itemAlias}.source_target_json, '$.spaceId')`, `${itemAlias}.recipient_user_id`)}))
              AND inbox_space_membership.status = 'active'
          )
      )
    )
  `;
}
