type InboxItemSqlAlias = "inbox_items" | "items";

export function buildCurrentInboxSourceAccessSql(
  itemAlias: InboxItemSqlAlias
): string {
  return `
    (
      CASE
        WHEN json_extract(${itemAlias}.source_target_json, '$.kind') =
          'center_agent_task'
        THEN EXISTS (
          SELECT 1
          FROM center_agent_task_authorized_readers AS task_reader
          WHERE task_reader.task_id = json_extract(
              ${itemAlias}.source_target_json,
              '$.taskId'
            )
            AND task_reader.organization_id = ${itemAlias}.organization_id
            AND task_reader.user_id = ${itemAlias}.recipient_user_id
        )
        ELSE (
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
              AND inbox_space_membership.profile_kind_snapshot = 'human'
              AND inbox_space_membership.status = 'active'
          )
        )
      END
    )
  `;
}
