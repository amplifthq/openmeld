export type RemoteAgentConversationGeneration = {
  generation: number;
  startedAtMs: number | null;
};

type ConversationGenerationRow = {
  active_generation: number;
  started_at_ms: number | null;
};

export async function readRemoteAgentConversationGeneration(input: {
  db: D1Database;
  logicalConversationId: string;
  organizationId: string;
}): Promise<RemoteAgentConversationGeneration> {
  const row = await input.db
    .prepare(
      `
        SELECT active_generation, started_at_ms
        FROM openMeldRemoteAgent_conversation_generations
        WHERE organization_id = ?
          AND logical_conversation_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.logicalConversationId)
    .first<ConversationGenerationRow>();
  return row ? parseConversationGeneration(row) : legacyGeneration();
}

export async function advanceRemoteAgentConversationGeneration(input: {
  db: D1Database;
  deliveryId: string;
  expectedGeneration: number;
  logicalConversationId: string;
  nowMs: number;
  organizationId: string;
}): Promise<RemoteAgentConversationGeneration> {
  const nextGeneration = input.expectedGeneration + 1;
  const advanced = await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_conversation_generations (
          organization_id,
          logical_conversation_id,
          active_generation,
          started_at_ms,
          rollover_delivery_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, NULL, ?, ?, ?)
        ON CONFLICT (organization_id, logical_conversation_id) DO UPDATE SET
          active_generation = excluded.active_generation,
          started_at_ms = NULL,
          rollover_delivery_id = excluded.rollover_delivery_id,
          updated_at_ms = excluded.updated_at_ms
        WHERE active_generation = ?
        RETURNING active_generation, started_at_ms
      `
    )
    .bind(
      input.organizationId,
      input.logicalConversationId,
      nextGeneration,
      input.deliveryId,
      input.nowMs,
      input.nowMs,
      input.expectedGeneration
    )
    .first<ConversationGenerationRow>();
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
  db: D1Database;
  generation: number;
  logicalConversationId: string;
  nowMs: number;
  organizationId: string;
}): Promise<boolean> {
  if (input.generation === 0) {
    return false;
  }
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_conversation_generations
        SET
          started_at_ms = COALESCE(started_at_ms, ?),
          updated_at_ms = max(updated_at_ms, ?)
        WHERE organization_id = ?
          AND logical_conversation_id = ?
          AND active_generation = ?
      `
    )
    .bind(
      input.nowMs,
      input.nowMs,
      input.organizationId,
      input.logicalConversationId,
      input.generation
    )
    .run();
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

function resolveChangedRowCount(result: D1Result): number {
  const changes = result.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}
