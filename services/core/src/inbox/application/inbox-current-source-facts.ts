/** Historical recipient facts never substitute for present ownership. */
export function currentPersonalAgentFactIdsSql(
  alias: "inbox_items" | "items",
  field = "personalAgentProfileIds"
): string {
  return `SELECT claimed_agent.value
    FROM json_each(${alias}.source_facts_json, '$.${field}') AS claimed_agent
    INNER JOIN openmeld_profiles AS current_agent ON current_agent.profile_id = claimed_agent.value
    LEFT JOIN center_agent_designations AS current_designation
      ON current_designation.organization_id = current_agent.organization_id
      AND current_designation.agent_profile_id = current_agent.profile_id
    WHERE current_agent.profile_kind = 'agent' AND current_agent.managed_role IS NULL
      AND current_designation.agent_profile_id IS NULL
      AND current_agent.organization_id = ${alias}.organization_id
      AND current_agent.owner_user_id = ${alias}.recipient_user_id
      AND current_agent.profile_id IN (SELECT value FROM json_each(${alias}.source_facts_json, '$.personalAgentProfileIds'))
      AND (json_extract(${alias}.source_target_json, '$.spaceId') IS NULL OR EXISTS (
        SELECT 1 FROM space_index_memberships AS current_member
        WHERE current_member.space_id = json_extract(${alias}.source_target_json, '$.spaceId')
          AND current_member.profile_id = current_agent.profile_id AND current_member.status = 'active'
          AND current_member.profile_kind_snapshot = 'agent'
      ))`;
}

export function currentInboxSourceFactsSql(
  alias: "inbox_items" | "items"
): string {
  const ids = (field: string) =>
    `(SELECT json_group_array(value) FROM (${currentPersonalAgentFactIdsSql(alias, field)}))`;
  return `CASE WHEN coalesce(json_array_length(${alias}.source_facts_json, '$.personalAgentProfileIds'), 0) = 0
    THEN ${alias}.source_facts_json ELSE json_set(${alias}.source_facts_json,
      '$.personalAgentProfileIds', json(${ids("personalAgentProfileIds")}),
      '$.mentionedAgentProfileIds', json(${ids("mentionedAgentProfileIds")}),
      '$.firstContactAgentProfileIds', json(${ids("firstContactAgentProfileIds")})) END`;
}

/** Independent Human reasons survive a personal-Agent transfer; owner-only rows do not. */
export function currentInboxRecipientRelationshipSql(
  alias: "inbox_items" | "items"
): string {
  return `(${alias}.source_facts_json IS NULL OR EXISTS (
    SELECT 1 FROM json_each(${alias}.source_facts_json, '$.recipientReasons') WHERE value != 'agent_owner'
  ) OR EXISTS (${currentPersonalAgentFactIdsSql(alias)}))`;
}
