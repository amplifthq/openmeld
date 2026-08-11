// Wake-evidence 30-day retention (physical-db-split.md ③ / D4). The
// openmeld-wake-evidence domain is the time-decaying EVIDENCE domain: append-only
// observability of the wake chain (dispatch/RC/ops), the only growth risk, and
// the reason openmeld-db reached 587 MB. None of it is business/authoritative state —
// identity, spaces, members and the user-visible conversation live in the
// identity / projections / local-state domains and Space DO storage, never here.
// This sweep deletes rows older than 30 days from every wake-evidence table, in
// batches. SAFETY: the caller MUST guarantee `db` is the real openmeld-wake-evidence
// DB (post-cutover) and never the frozen old openmeld-db — see the scheduled handler.

import type { CoreBindings } from "../../../lib/bindings";

export const WAKE_EVIDENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RETENTION_BATCH_SIZE = 1000;
const MAX_BATCHES_PER_TABLE = 10_000;

// Every openmeld-wake-evidence table paired with its creation/observation timestamp
// column (verbatim from packages/db/split/openmeld-wake-evidence/0000_baseline.sql).
// All names are constants — never interpolate caller input into the SQL.
const WAKE_EVIDENCE_RETENTION_TABLES = [
  {
    table: "openMeldDaemon_dispatch_ledger",
    timestampColumn: "first_seen_at_ms",
  },
  {
    table: "openMeldDaemon_dispatch_attempts",
    timestampColumn: "created_at_ms",
  },
  { table: "openMeldDaemon_dlq", timestampColumn: "failed_at_ms" },
  {
    table: "openMeldDaemon_dispatch_result_inbox",
    timestampColumn: "accepted_at_ms",
  },
  {
    table: "openMeldDaemon_dispatch_results",
    timestampColumn: "created_at_ms",
  },
  {
    table: "openMeldDaemon_runtime_coordinator_executions",
    timestampColumn: "created_at_ms",
  },
  {
    table: "openMeldDaemon_runtime_coordinator_execution_events",
    timestampColumn: "observed_at_ms",
  },
  {
    table: "openMeldDaemon_runtime_coordinator_creation_diagnostics",
    timestampColumn: "observed_at_ms",
  },
  { table: "openMeldDaemon_ops_decisions", timestampColumn: "decided_at_ms" },
] as const;

export type WakeEvidenceRetentionResult = {
  table: string;
  deleted: number;
};

export async function sweepWakeEvidenceRetention(input: {
  db: D1Database;
  nowMs: number;
  retentionMs?: number;
  batchSize?: number;
  maxBatchesPerTable?: number;
}): Promise<WakeEvidenceRetentionResult[]> {
  const retentionMs = input.retentionMs ?? WAKE_EVIDENCE_RETENTION_MS;
  const batchSize = input.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = input.maxBatchesPerTable ?? MAX_BATCHES_PER_TABLE;
  const cutoffMs = input.nowMs - retentionMs;
  const results: WakeEvidenceRetentionResult[] = [];

  for (const { table, timestampColumn } of WAKE_EVIDENCE_RETENTION_TABLES) {
    let deleted = 0;
    for (let batch = 0; batch < maxBatches; batch++) {
      // rowid subquery so the batched DELETE works without DELETE…LIMIT support.
      const result = await input.db
        .prepare(
          `DELETE FROM ${table}
             WHERE rowid IN (
               SELECT rowid FROM ${table}
               WHERE ${timestampColumn} < ?
               LIMIT ?
             )`
        )
        .bind(cutoffMs, batchSize)
        .run();
      const changes = Number(result.meta?.changes ?? 0);
      deleted += changes;
      if (changes < batchSize) {
        break;
      }
    }
    results.push({ table, deleted });
  }

  return results;
}

// Scheduled-handler entry. SAFETY: the sweep runs ONLY when OPENMELD_SPLIT_ACTIVE ===
// "true" (set only in the Knife-1 cutover deploy), AND it resolves the target by
// reading OPENMELD_WAKE_EVIDENCE_DB DIRECTLY — note this env pick deliberately omits
// OPENMELD_DB, so there is NO `?? OPENMELD_DB` fallback: the retention DELETE is
// structurally unable to address the frozen old openmeld-db even if the binding is
// absent (it fails closed instead). (Second guard: the cron itself is only added
// to wrangler in that same Knife-1 deploy.)
export async function runWakeEvidenceRetentionIfSplitActive(input: {
  env: Pick<
    CoreBindings,
    "OPENMELD_SPLIT_ACTIVE" | "OPENMELD_WAKE_EVIDENCE_DB"
  >;
  cron: string | null;
  nowMs: number;
}): Promise<{ ran: boolean; results: WakeEvidenceRetentionResult[] }> {
  if (input.env.OPENMELD_SPLIT_ACTIVE !== "true") {
    console.warn("[core.wake_evidence_retention.skipped_not_split_active]", {
      event: "core.wake_evidence_retention.skipped_not_split_active",
      cron: input.cron,
    });
    return { ran: false, results: [] };
  }
  // Direct read, NO accessor / NO ?? OPENMELD_DB fallback — see the SAFETY note above.
  const db = input.env.OPENMELD_WAKE_EVIDENCE_DB;
  if (!db) {
    console.error("[core.wake_evidence_retention.no_binding]", {
      event: "core.wake_evidence_retention.no_binding",
      cron: input.cron,
    });
    return { ran: false, results: [] };
  }
  const results = await sweepWakeEvidenceRetention({ db, nowMs: input.nowMs });
  console.info("[core.wake_evidence_retention.swept]", {
    event: "core.wake_evidence_retention.swept",
    cron: input.cron,
    results,
  });
  return { ran: true, results };
}
