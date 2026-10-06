import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
    db: PostgresDatabase;
    prefix?: string;
  }
): Promise<AgentModelInboxRecord[]> {
  const result = await input.db.query<AgentModelInboxRecord>({
    text: `
    SELECT source_key AS "sourceKey", occurred_at_ms AS "occurredAtMs",
      resolved_at_ms AS "resolvedAtMs"
    FROM "openmeld"."inbox_items"
    WHERE organization_id = $1 AND recipient_user_id = $2
      AND source_kind = 'system_attention_event'
      AND ((source_target_json)::jsonb #>> '{kind}') = 'agent_profile'
      AND ((source_target_json)::jsonb #>> '{profileId}') = $3
      AND substr(source_key, 1, length($4)) = $5
      ${input.prefix ? "" : "AND resolution_status = 'open'"}
    ORDER BY created_at_ms DESC NULLS LAST, id DESC NULLS LAST
    LIMIT ${input.prefix ? "1" : "101"}
  `,
    values: [
      input.organizationId,
      input.ownerUserId,
      input.profileId,
      input.prefix ?? "agent-model:",
      input.prefix ?? "agent-model:",
    ],
  });
  if (result.rows.length > 100) {
    throw new Error("Too many open model notices for one Agent");
  }
  return result.rows;
}
