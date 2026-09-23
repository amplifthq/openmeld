export type AgentModelInboxScope = {
  organizationId: string;
  ownerUserId: string;
  profileId: string;
};
export type AgentModelInboxRecord = {
  sourceKey: string;
  occurredAtMs: number;
  resolvedAtMs: number | null;
};

export async function readAgentModelInboxRecords(
  input: AgentModelInboxScope & {
    db: D1Database;
    prefix?: string;
  }
): Promise<AgentModelInboxRecord[]> {
  const result = await input.db
    .prepare(`
    SELECT source_key AS sourceKey, occurred_at_ms AS occurredAtMs,
      resolved_at_ms AS resolvedAtMs
    FROM inbox_items
    WHERE organization_id = ? AND recipient_user_id = ?
      AND source_kind = 'system_attention_event'
      AND json_extract(source_target_json, '$.kind') = 'agent_profile'
      AND json_extract(source_target_json, '$.profileId') = ?
      AND substr(source_key, 1, length(?)) = ?
      ${input.prefix ? "" : "AND resolution_status = 'open'"}
    ORDER BY created_at_ms DESC, id DESC
    LIMIT ${input.prefix ? "1" : "101"}
  `)
    .bind(
      input.organizationId,
      input.ownerUserId,
      input.profileId,
      input.prefix ?? "agent-model:",
      input.prefix ?? "agent-model:"
    )
    .all<AgentModelInboxRecord>();
  if (result.results.length > 100) {
    throw new Error("Too many open model notices for one Agent");
  }
  return result.results;
}
