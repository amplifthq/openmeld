import {
  inboxItemKindSchema,
  TEAMMATE_AGENT_REQUESTS_ENABLED,
} from "@openmeld/schemas";
import { personalAgentOwnerAccessSql } from "./inbox-agent-owner-access";
import { currentInboxRecipientRelationshipSql } from "./inbox-current-source-facts";

type InboxItemSqlAlias = "inbox_items" | "items";

// Missing legacy Agent identity cannot grant derived owner access. Current
// Human membership is checked independently; never infer identity from the roster.
export function buildCurrentInboxSourceAccessSql(
  itemAlias: InboxItemSqlAlias,
  canManageOrganization = false,
  useFeedAgentScope = false
): string {
  return `
    (
      ${itemAlias}.kind IN (${inboxItemKindSchema.options.map((kind) => `'${kind}'`).join(", ")})
      AND ${currentInboxRecipientRelationshipSql(itemAlias, useFeedAgentScope)}
      AND NOT EXISTS (SELECT 1 FROM "openmeld"."conversation_history_deletions" AS history_deletion
        WHERE history_deletion.user_id = ${itemAlias}.recipient_user_id
          AND history_deletion.space_id = ((${itemAlias}.source_target_json)::jsonb #>> '{spaceId}')
          AND ${itemAlias}.occurred_at_ms <= history_deletion.deleted_at_ms)
      AND (${itemAlias}.kind != 'computer_connection' OR EXISTS (
        SELECT 1 FROM "openmeld"."openMeldDaemon_owned_devices" AS inbox_device
        WHERE inbox_device.owner_user_id = ${itemAlias}.recipient_user_id
          AND inbox_device.device_id = ((${itemAlias}.source_target_json)::jsonb #>> '{deviceId}')
          AND inbox_device.connected_computer_id = ((${itemAlias}.source_target_json)::jsonb #>> '{computerId}')
          AND NOT EXISTS (SELECT 1 FROM "openmeld"."openMeldDaemon_forgotten_devices" AS forgotten
            WHERE forgotten.owner_user_id = inbox_device.owner_user_id AND forgotten.device_id = inbox_device.device_id)
      ))
      AND (${canManageOrganization ? "TRUE" : `NOT (${itemAlias}.source_kind = 'system_attention_event' AND ${itemAlias}.source_key LIKE 'authorization-update:%')`})
      ${TEAMMATE_AGENT_REQUESTS_ENABLED ? "" : `AND ${itemAlias}.source_target_json::jsonb ->> 'kind' != 'agent_profile_creation_request'`}
      AND (${canManageOrganization ? "TRUE" : `${itemAlias}.source_target_json::jsonb ->> 'kind' != 'organization_join_request'`})
      AND (
          NOT (
            ((${itemAlias}.source_target_json)::jsonb #>> '{kind}') IN (
              'space',
              'agent_interaction'
            )
            OR (
              ((${itemAlias}.source_target_json)::jsonb #>> '{kind}') =
                'center_agent'
              AND ((${itemAlias}.source_target_json)::jsonb #>> '{spaceId}') IS NOT NULL
            )
            OR (
              ((${itemAlias}.source_target_json)::jsonb #>> '{kind}') = 'plugin_action_request'
              AND ((${itemAlias}.source_target_json)::jsonb #>> '{spaceId}') IS NOT NULL
            )
          )
          OR EXISTS (
            SELECT 1
            FROM "openmeld"."space_index_memberships" AS inbox_space_membership
            INNER JOIN "openmeld"."space_index_spaces" AS inbox_space
              ON inbox_space.space_id = inbox_space_membership.space_id
            WHERE inbox_space_membership.space_id =
                ((${itemAlias}.source_target_json)::jsonb #>> '{spaceId}')
              AND inbox_space.organization_id = ${itemAlias}.organization_id
              AND inbox_space.status = 'active'
              AND inbox_space_membership.owner_user_id_snapshot =
                ${itemAlias}.recipient_user_id
              AND (inbox_space_membership.profile_kind_snapshot = 'human'
                OR (${itemAlias}.source_target_json::jsonb -> 'agentOwnerActivity' = 'true'::jsonb AND ${personalAgentOwnerAccessSql(`${itemAlias}.source_target_json::jsonb ->> 'spaceId'`, `${itemAlias}.recipient_user_id`, `${itemAlias}.source_facts_json::jsonb -> 'personalAgentProfileIds'`)}))
              AND inbox_space_membership.status = 'active'
          )
      )
    )
  `;
}
