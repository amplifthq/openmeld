import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import type { CoreBindings } from "../../../lib/bindings";

export const WAKE_EVIDENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RETENTION_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_TABLE = 5;

// Only historical descriptions of successfully published executions expire.
// Cancellation requests remain a late-finalization fence. Unknown/new types,
// token evidence, failed executions and recovery records are not eligible.
const COMPLETED_EXECUTION_EVIDENCE = `
  event_type IN ('execution_created', 'delivery_accepted',
    'lifecycle_accepted_local', 'lifecycle_running', 'lifecycle_completed_local',
    'result_received', 'result_accepted', 'result_duplicate', 'reply_published')
  AND EXISTS (
    SELECT 1 FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS execution
    WHERE execution.runtime_coordinator_execution_id = events.runtime_coordinator_execution_id
      AND execution.status = 'reply_published' AND execution.updated_at_ms < $1
      AND EXISTS (
        SELECT 1 FROM "openmeld"."openMeldDaemon_dispatch_result_inbox" AS result
        WHERE result.runtime_coordinator_execution_id = execution.runtime_coordinator_execution_id
          AND result.publish_state = 'reply_published' AND result.updated_at_ms < $1
      )
      AND NOT EXISTS (
        SELECT 1 FROM "openmeld"."openMeldDaemon_dispatch_result_inbox" AS result
        WHERE result.runtime_coordinator_execution_id = execution.runtime_coordinator_execution_id
          AND (result.publish_state != 'reply_published' OR result.updated_at_ms >= $1)
      )
  )`;

export type WakeEvidenceRetentionResult = {
  table: string;
  deleted: number;
  budgetExhausted: boolean;
};

export async function sweepWakeEvidenceRetention(input: {
  db: PostgresDatabase;
  nowMs: number;
  batchSize?: number;
  maxBatchesPerTable?: number;
}): Promise<WakeEvidenceRetentionResult[]> {
  const batchSize = boundedLimit(input.batchSize, RETENTION_BATCH_SIZE);
  const maxBatches = boundedLimit(
    input.maxBatchesPerTable,
    MAX_BATCHES_PER_TABLE
  );
  const cutoff = input.nowMs - WAKE_EVIDENCE_RETENTION_MS;
  const policies = [
    {
      table: "openMeldDaemon_runtime_coordinator_execution_events",
      sql: `DELETE FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events"
        WHERE event_id IN (
          SELECT events.event_id FROM "openmeld"."openMeldDaemon_runtime_coordinator_execution_events" AS events
          WHERE observed_at_ms < $1 AND ${COMPLETED_EXECUTION_EVIDENCE}
          ORDER BY observed_at_ms, events.event_id LIMIT $2
        )`,
      bindings: [cutoff, batchSize],
    },
    {
      table: "openMeldDaemon_runtime_coordinator_creation_diagnostics",
      sql: `DELETE FROM "openmeld"."openMeldDaemon_runtime_coordinator_creation_diagnostics"
        WHERE diagnostic_id IN (
          SELECT diagnostic_id FROM "openmeld"."openMeldDaemon_runtime_coordinator_creation_diagnostics"
          WHERE observed_at_ms < $1 ORDER BY observed_at_ms, diagnostic_id LIMIT $2
        )`,
      bindings: [cutoff, batchSize],
    },
  ];
  const results: WakeEvidenceRetentionResult[] = [];
  for (const policy of policies) {
    let deleted = 0;
    let budgetExhausted = false;
    for (let batch = 0; batch < maxBatches; batch++) {
      // Eligibility and deletion share one statement, never a stale ID list.
      const result = await input.db.query({
        text: policy.sql,
        values: policy.bindings,
      });
      const changes = Number(result.rowCount);
      deleted += changes;
      budgetExhausted = changes === batchSize;
      if (!budgetExhausted) {
        break;
      }
    }
    results.push({ table: policy.table, deleted, budgetExhausted });
  }
  return results;
}

export async function runWakeEvidenceRetention(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  cron: string | null;
  nowMs: number;
}): Promise<{ ran: boolean; results: WakeEvidenceRetentionResult[] }> {
  const db = getPostgresDatabase(input.env);
  const results = await sweepWakeEvidenceRetention({ db, nowMs: input.nowMs });
  console.info("[core.wake_evidence_retention.swept]", {
    cron: input.cron,
    results,
  });
  return { ran: true, results };
}

function boundedLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) {
    return maximum;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Retention budget must be a positive integer.");
  }
  return Math.min(value, maximum);
}
