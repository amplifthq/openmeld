import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import type { CoreBindings } from "../../../lib/bindings";
import {
  isTerminalDispatchState,
  OPENMELD_DAEMON_DISPATCH_STATE,
} from "../../rules/dispatch-lifecycle-contract";

export const WAKE_EVIDENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RETENTION_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_TABLE = 10_000;

// This retention policy only permits deleting old, settled evidence. It never
// decides an execution outcome or expires an unfinished RuntimeCoordinator head.
const RETENTION_SETTLED_STATUSES = [
  "reply_published",
  "cancelled",
  "failed_terminal",
];
const RETENTION_TERMINAL_DISPATCH_STATES = Object.values(
  OPENMELD_DAEMON_DISPATCH_STATE
).filter(isTerminalDispatchState);
const TABLES = [
  {
    table: "openMeldDaemon_dispatch_ledger",
    key: "id",
    time: "first_seen_at_ms",
    relation: "dispatch",
  },
  {
    table: "openMeldDaemon_dispatch_attempts",
    key: "attempt_id",
    time: "created_at_ms",
    relation: "dispatch",
  },
  {
    table: "openMeldDaemon_dlq",
    key: "id",
    time: "failed_at_ms",
    relation: "dispatch",
  },
  {
    table: "openMeldDaemon_dispatch_result_inbox",
    key: "result_key",
    time: "accepted_at_ms",
    relation: "dispatch",
  },
  {
    table: "openMeldDaemon_dispatch_results",
    key: "result_ref",
    time: "created_at_ms",
    relation: "dispatch",
  },
  {
    table: "openMeldDaemon_runtime_coordinator_execution_events",
    key: "event_id",
    time: "observed_at_ms",
    relation: "execution",
  },
  {
    table: "openMeldDaemon_runtime_coordinator_creation_diagnostics",
    key: "diagnostic_id",
    time: "observed_at_ms",
    relation: "dispatch",
  },
  {
    table: "openMeldDaemon_ops_decisions",
    key: "id",
    time: "decided_at_ms",
    relation: "correlation",
  },
  {
    table: "openMeldDaemon_runtime_coordinator_executions",
    key: "runtime_coordinator_execution_id",
    time: "created_at_ms",
    relation: "head",
  },
] as const;

export type WakeEvidenceRetentionResult = { table: string; deleted: number };

const DISPATCH_CORRELATIONS = [
  "active.dispatch_id = evidence.dispatch_id",
  "pending.dispatch_id = evidence.dispatch_id",
] as const;
const RETENTION_CORRELATIONS = {
  dispatch: DISPATCH_CORRELATIONS,
  head: DISPATCH_CORRELATIONS,
  execution: [
    "active.runtime_coordinator_execution_id = evidence.runtime_coordinator_execution_id",
    `pending.dispatch_id IN (SELECT head.dispatch_id FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS head WHERE head.runtime_coordinator_execution_id = evidence.runtime_coordinator_execution_id)`,
  ],
  correlation: [
    "(active.dispatch_id = evidence.correlation_id OR active.runtime_coordinator_execution_id = evidence.correlation_id)",
    `(pending.dispatch_id = evidence.correlation_id OR pending.dispatch_id IN (SELECT head.dispatch_id FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS head WHERE head.runtime_coordinator_execution_id = evidence.correlation_id))`,
  ],
} as const;

export async function sweepWakeEvidenceRetention(input: {
  db: PostgresDatabase;
  nowMs: number;
  retentionMs?: number;
  batchSize?: number;
  maxBatchesPerTable?: number;
}): Promise<WakeEvidenceRetentionResult[]> {
  const cutoffMs =
    input.nowMs - (input.retentionMs ?? WAKE_EVIDENCE_RETENTION_MS);
  const batchSize = input.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = input.maxBatchesPerTable ?? MAX_BATCHES_PER_TABLE;
  if (
    !(Number.isSafeInteger(cutoffMs) && Number.isSafeInteger(batchSize)) ||
    batchSize < 1 ||
    !Number.isSafeInteger(maxBatches) ||
    maxBatches < 1
  ) {
    throw new Error("Wake evidence retention requires safe integer bounds");
  }
  const results: WakeEvidenceRetentionResult[] = [];
  for (const { table, key, time, relation } of TABLES) {
    const [correlation, ledgerCorrelation] = RETENTION_CORRELATIONS[relation];
    const settledHead =
      relation === "head"
        ? "evidence.status = ANY($3::text[]) AND evidence.updated_at_ms < $1"
        : `NOT EXISTS (
          SELECT 1 FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS active
          WHERE (active.status <> ALL($3::text[]) OR active.updated_at_ms >= $1)
            AND ${correlation}
        )`;
    const protection = `${settledHead} AND NOT EXISTS (
      SELECT 1 FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS pending
      WHERE (pending.status <> ALL($4::text[]) OR pending.last_attempt_at_ms >= $1)
        AND ${ledgerCorrelation}
    )`;
    let deleted = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const result = await input.db.query({
        text: `DELETE FROM "openmeld"."${table}" WHERE "${key}" IN (
          SELECT evidence."${key}" FROM "openmeld"."${table}" AS evidence
          WHERE evidence."${time}" < $1 AND ${protection}
          ORDER BY evidence."${time}", evidence."${key}" LIMIT $2
        )`,
        values: [
          cutoffMs,
          batchSize,
          RETENTION_SETTLED_STATUSES,
          RETENTION_TERMINAL_DISPATCH_STATES,
        ],
      });
      const count = result.rowCount ?? 0;
      deleted += count;
      if (count < batchSize) {
        break;
      }
    }
    results.push({ table, deleted });
  }
  return results;
}

export async function runWakeEvidenceRetention(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  cron: string | null;
  nowMs: number;
}): Promise<{ ran: boolean; results: WakeEvidenceRetentionResult[] }> {
  const results = await sweepWakeEvidenceRetention({
    db: getPostgresDatabase(input.env),
    nowMs: input.nowMs,
  });
  console.info("[core.wake_evidence_retention.swept]", {
    cron: input.cron,
    results,
  });
  return { ran: true, results };
}
