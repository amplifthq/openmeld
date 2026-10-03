/** Historical recipient facts never substitute for present ownership. */
export function currentPersonalAgentFactIdsSql(
  alias: "inbox_items" | "items",
  field = "personalAgentProfileIds"
): string {
  return `SELECT claimed_agent.value
    FROM jsonb_array_elements_text(${alias}.source_facts_json::jsonb -> '${field}') AS claimed_agent(value)
    INNER JOIN "openmeld"."openmeld_profiles" AS current_agent ON current_agent.profile_id = claimed_agent.value
    LEFT JOIN "openmeld"."center_agent_designations" AS current_designation
      ON current_designation.organization_id = current_agent.organization_id
      AND current_designation.agent_profile_id = current_agent.profile_id
    WHERE current_agent.profile_kind = 'agent' AND current_agent.managed_role IS NULL
      AND current_designation.agent_profile_id IS NULL
      AND current_agent.organization_id = ${alias}.organization_id
      AND current_agent.owner_user_id = ${alias}.recipient_user_id
      AND current_agent.profile_id IN (SELECT value FROM jsonb_array_elements_text(${alias}.source_facts_json::jsonb -> 'personalAgentProfileIds') AS personal_agents(value))
      AND (((${alias}.source_target_json)::jsonb #>> '{spaceId}') IS NULL OR EXISTS (
        SELECT 1 FROM "openmeld"."space_index_memberships" AS current_member
        WHERE current_member.space_id = ((${alias}.source_target_json)::jsonb #>> '{spaceId}')
          AND current_member.profile_id = current_agent.profile_id AND current_member.status = 'active'
          AND current_member.profile_kind_snapshot = 'agent'
      ))`;
}

export function currentInboxSourceFactsSql(
  alias: "inbox_items" | "items"
): string {
  const ids = (field: string) =>
    `(SELECT coalesce(jsonb_agg(value), '[]'::jsonb) FROM (${currentPersonalAgentFactIdsSql(alias, field)}) AS current_agents)`;
  return `CASE WHEN coalesce(jsonb_array_length((${alias}.source_facts_json)::jsonb #> '{personalAgentProfileIds}'), 0) = 0
    THEN ${alias}.source_facts_json ELSE (${alias}.source_facts_json::jsonb || jsonb_build_object(
      'personalAgentProfileIds', ${ids("personalAgentProfileIds")},
      'mentionedAgentProfileIds', ${ids("mentionedAgentProfileIds")},
      'firstContactAgentProfileIds', ${ids("firstContactAgentProfileIds")}))::text END`;
}

/** Independent Human reasons survive a personal-Agent transfer; owner-only rows do not. */
export function currentInboxRecipientRelationshipSql(
  alias: "inbox_items" | "items"
): string {
  return `(${alias}.source_facts_json IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(${alias}.source_facts_json::jsonb -> 'recipientReasons') AS reasons(value) WHERE value != 'agent_owner'
  ) OR EXISTS (${currentPersonalAgentFactIdsSql(alias)}))`;
}
