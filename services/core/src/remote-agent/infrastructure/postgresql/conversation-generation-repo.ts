import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";
export type RemoteAgentConversationGeneration = {
  generation: number;
  startedAtMs: number | null;
};
type ConversationGenerationRow = {
  active_generation: number;
  started_at_ms: number | null;
};
export async function readRemoteAgentConversationGeneration(input: {
  db: PostgresDatabase;
  logicalConversationId: string;
  organizationId: string;
}): Promise<RemoteAgentConversationGeneration> {
  const row = await input.db
    .query<ConversationGenerationRow>({
      text: `
        SELECT active_generation, started_at_ms
        FROM "openmeld"."openMeldRemoteAgent_conversation_generations"
        WHERE organization_id = $1
          AND logical_conversation_id = $2
        LIMIT 1
      `,
      values: [input.organizationId, input.logicalConversationId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? parseConversationGeneration(row) : legacyGeneration();
}
export async function advanceRemoteAgentConversationGeneration(input: {
  db: PostgresDatabase;
  deliveryId: string;
  expectedGeneration: number;
  logicalConversationId: string;
  nowMs: number;
  organizationId: string;
}): Promise<RemoteAgentConversationGeneration> {
  const nextGeneration = input.expectedGeneration + 1;
  const advanced = await input.db
    .query<ConversationGenerationRow>({
      text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_conversation_generations" (
          organization_id,
          logical_conversation_id,
          active_generation,
          started_at_ms,
          rollover_delivery_id,
          created_at_ms,
          updated_at_ms
        ) VALUES ($1, $2, $3, NULL, $4, $5, $6)
        ON CONFLICT (organization_id, logical_conversation_id) DO UPDATE SET
          active_generation = excluded.active_generation,
          started_at_ms = NULL,
          rollover_delivery_id = excluded.rollover_delivery_id,
          updated_at_ms = excluded.updated_at_ms
        WHERE "openMeldRemoteAgent_conversation_generations".active_generation = $7
        RETURNING active_generation, started_at_ms
      `,
      values: [
        input.organizationId,
        input.logicalConversationId,
        nextGeneration,
        input.deliveryId,
        input.nowMs,
        input.nowMs,
        input.expectedGeneration,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (advanced) {
    return parseConversationGeneration(advanced);
  }
  const current = await readRemoteAgentConversationGeneration(input);
  if (current.generation < nextGeneration) {
    throw new Error(
      "Remote Agent conversation generation did not advance atomically."
    );
  }
  return current;
}
export async function markRemoteAgentConversationGenerationStarted(input: {
  db: PostgresDatabase;
  generation: number;
  logicalConversationId: string;
  nowMs: number;
  organizationId: string;
}): Promise<boolean> {
  if (input.generation === 0) {
    return false;
  }
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_conversation_generations"
        SET
          started_at_ms = COALESCE(started_at_ms, $1),
          updated_at_ms = GREATEST(updated_at_ms, $2)
        WHERE organization_id = $3
          AND logical_conversation_id = $4
          AND active_generation = $5
      `,
    values: [
      input.nowMs,
      input.nowMs,
      input.organizationId,
      input.logicalConversationId,
      input.generation,
    ],
  });
  return resolveChangedRowCount(result) > 0;
}
function parseConversationGeneration(
  row: ConversationGenerationRow
): RemoteAgentConversationGeneration {
  if (
    !(Number.isSafeInteger(row.active_generation) && row.active_generation > 0)
  ) {
    throw new Error("Remote Agent conversation generation is invalid.");
  }
  if (
    row.started_at_ms !== null &&
    !(Number.isSafeInteger(row.started_at_ms) && row.started_at_ms >= 0)
  ) {
    throw new Error(
      "Remote Agent conversation generation start time is invalid."
    );
  }
  return {
    generation: row.active_generation,
    startedAtMs: row.started_at_ms,
  };
}
function legacyGeneration(): RemoteAgentConversationGeneration {
  return { generation: 0, startedAtMs: null };
}
function resolveChangedRowCount(result: QueryResult): number {
  const changes = result.rowCount;
  return typeof changes === "number" ? changes : 0;
}
