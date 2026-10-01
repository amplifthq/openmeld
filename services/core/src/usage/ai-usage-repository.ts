import {
  aiUsageQueryResponseSchema,
  aiUsageQuerySchema,
  aiUsageRecordSchema,
} from "@openmeld/schemas";
import type {
  AiUsageQuery,
  AiUsageQueryResponse,
  AiUsageRecord,
} from "@openmeld/schemas/types";

// A provider event is immutable. Replayed transport deliveries are harmless;
// conflicting facts surface an error instead of silently changing spend.
export async function recordAiUsage(
  db: D1Database,
  input: AiUsageRecord
): Promise<void> {
  const record = aiUsageRecordSchema.parse(input);
  const json = JSON.stringify(record);
  await db
    .prepare(`
    INSERT INTO ai_usage_records (
      organization_id, event_id, runtime, provider, model, purpose,
      agent_profile_id, space_id, task_id, attempt_id, computer_id, controller,
      occurred_at_ms, input_tokens, output_tokens, total_tokens,
      cost_nano_usd, cost_kind, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (organization_id, runtime, event_id) DO NOTHING
  `)
    .bind(
      record.organizationId,
      record.eventId,
      record.runtime,
      record.provider,
      record.model,
      record.purpose,
      record.agentProfileId,
      record.spaceId,
      record.taskId,
      record.attemptId,
      record.computerId,
      record.controller,
      record.occurredAtMs,
      record.tokens?.input ?? null,
      record.tokens?.output ?? null,
      record.tokens?.total ?? null,
      record.cost?.nanoUsd ?? null,
      record.cost?.kind ?? null,
      json
    )
    .run();
  const stored = await db
    .prepare(
      "SELECT record_json FROM ai_usage_records WHERE organization_id = ? AND runtime = ? AND event_id = ?"
    )
    .bind(record.organizationId, record.runtime, record.eventId)
    .first<{ record_json: string }>();
  if (stored?.record_json !== json) {
    throw new Error(
      "AI usage event identity conflicts with an existing record."
    );
  }
}

export async function queryAiUsage(input: {
  db: D1Database;
  organizationId: string;
  query: AiUsageQuery;
}): Promise<AiUsageQueryResponse> {
  const query = aiUsageQuerySchema.parse(input.query);
  const predicates = [
    "organization_id = ?",
    "occurred_at_ms >= ?",
    "occurred_at_ms < ?",
  ];
  const values: (string | number)[] = [
    input.organizationId,
    query.fromMs,
    query.toMs,
  ];
  const filters = {
    runtime: "runtime",
    model: "model",
    agentProfileId: "agent_profile_id",
    spaceId: "space_id",
    taskId: "task_id",
    computerId: "computer_id",
  } as const;
  for (const [key, column] of Object.entries(filters)) {
    const value = query[key as keyof typeof filters];
    if (value !== undefined) {
      predicates.push(`${column} = ?`);
      values.push(value);
    }
  }
  const result = await input.db
    .prepare(`
    SELECT runtime, provider, model, COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(CASE WHEN cost_kind = 'provider_reported' THEN cost_nano_usd ELSE 0 END), 0) AS reportedCostNanoUsd,
      COALESCE(SUM(CASE WHEN cost_kind = 'provider_estimate' THEN cost_nano_usd ELSE 0 END), 0) AS estimatedCostNanoUsd,
      SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) AS missingTokenRequests,
      SUM(CASE WHEN cost_nano_usd IS NULL THEN 1 ELSE 0 END) AS missingCostRequests
    FROM ai_usage_records WHERE ${predicates.join(" AND ")}
    GROUP BY runtime, provider, model ORDER BY runtime, provider, model
  `)
    .bind(...values)
    .all();
  return aiUsageQueryResponseSchema.parse({
    fromMs: query.fromMs,
    toMs: query.toMs,
    models: result.results,
  });
}
