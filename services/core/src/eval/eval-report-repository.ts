import { organizationWeeklyEvalMetricsSchema } from "@openmeld/schemas";
import type {
  EvalSpaceSignalMetrics,
  OrganizationWeeklyEvalMetrics,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { projectionsDb } from "../lib/bindings";

// Leave headroom below the paid Workers default of 10,000 subrequests for the
// D1 reads and Quality Space publication performed by the same invocation.
const MAX_EVAL_SPACE_RPC_CALLS = 9900;
const EVAL_SPACE_RPC_CONCURRENCY = 6;
const EXPLICIT_CLOSURE_STATUSES_SQL =
  "'reply_published', 'failed_terminal', 'cancelled'";

export type OrganizationExecutionEvalMetrics = {
  closureCount: number;
  closureRate: number;
  concurrencyOverlap: number;
  failureCount: number;
  failureRate: number;
  wakeTotal: number;
};

export async function readOrganizationWeeklyEvalReport(input: {
  db: D1Database;
  organizationId: string;
  periodEndMs: number;
  periodStartMs: number;
}): Promise<OrganizationWeeklyEvalMetrics | null> {
  const row = await input.db
    .prepare(
      `
        SELECT metrics_json
        FROM eval_reports
        WHERE organization_id = ?
          AND period_start = ?
          AND period_end = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.periodStartMs, input.periodEndMs)
    .first<{ metrics_json: string }>();
  if (!row) {
    return null;
  }

  try {
    return organizationWeeklyEvalMetricsSchema.parse(
      JSON.parse(row.metrics_json)
    );
  } catch (error) {
    throw new Error(
      `Weekly eval report metrics are invalid for Organization ${input.organizationId} period ${input.periodStartMs}-${input.periodEndMs}`,
      { cause: error }
    );
  }
}

export async function createOrganizationWeeklyEvalReport(input: {
  createdAtMs: number;
  db: D1Database;
  metrics: OrganizationWeeklyEvalMetrics;
  organizationId: string;
  periodEndMs: number;
  periodStartMs: number;
}): Promise<OrganizationWeeklyEvalMetrics> {
  const organizationId = input.organizationId.trim();
  if (!organizationId) {
    throw new Error("Weekly eval report requires an Organization id");
  }
  if (input.periodEndMs <= input.periodStartMs) {
    throw new Error("Weekly eval report period end must be after its start");
  }
  if (!Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0) {
    throw new Error(
      "Weekly eval report createdAtMs must be a nonnegative integer"
    );
  }
  const metrics = organizationWeeklyEvalMetricsSchema.parse(input.metrics);

  await input.db
    .prepare(
      `
        INSERT INTO eval_reports (
          organization_id,
          period_start,
          period_end,
          metrics_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (organization_id, period_start, period_end)
        DO NOTHING
      `
    )
    .bind(
      organizationId,
      input.periodStartMs,
      input.periodEndMs,
      JSON.stringify(metrics),
      input.createdAtMs
    )
    .run();

  const storedMetrics = await readOrganizationWeeklyEvalReport({
    db: input.db,
    organizationId,
    periodEndMs: input.periodEndMs,
    periodStartMs: input.periodStartMs,
  });
  if (!storedMetrics) {
    throw new Error(
      `Weekly eval report was not stored for Organization ${organizationId} period ${input.periodStartMs}-${input.periodEndMs}`
    );
  }
  return storedMetrics;
}

export async function collectOrganizationWeeklyEvalMetrics(input: {
  env: CoreBindings;
  organizationId: string;
  periodEndMs: number;
  periodStartMs: number;
}): Promise<OrganizationWeeklyEvalMetrics> {
  const db = projectionsDb(input.env);
  if (!db) {
    throw new Error("Weekly eval aggregation requires a projections database");
  }

  const executionMetrics = await readOrganizationExecutionEvalMetrics({
    db,
    organizationId: input.organizationId,
    periodEndMs: input.periodEndMs,
    periodStartMs: input.periodStartMs,
  });
  const spaces = await db
    .prepare(
      `
        SELECT space_id
        FROM space_index_spaces
        WHERE organization_id = ?
      `
    )
    .bind(input.organizationId)
    .all<{ space_id: string }>();
  const organizationSpaces = spaces.results ?? [];
  if (organizationSpaces.length > MAX_EVAL_SPACE_RPC_CALLS) {
    throw new Error(
      `Weekly eval signal aggregation found ${organizationSpaces.length} Spaces for Organization ${input.organizationId}; the per-invocation limit is ${MAX_EVAL_SPACE_RPC_CALLS}`
    );
  }

  const signalMetrics = await mapWithConcurrency(
    organizationSpaces,
    EVAL_SPACE_RPC_CONCURRENCY,
    async ({ space_id: spaceId }) => {
      try {
        const id = input.env.OPENMELD_SPACES.idFromString(spaceId);
        return await input.env.OPENMELD_SPACES.get(id).rpcReadEvalSignalMetrics(
          {
            spaceId,
            periodEndMs: input.periodEndMs,
            periodStartMs: input.periodStartMs,
          }
        );
      } catch (error) {
        throw new Error(
          `Weekly eval signal aggregation failed for Organization ${input.organizationId} Space ${spaceId}`,
          { cause: error }
        );
      }
    }
  );
  const signalTotals = sumSignalMetrics(signalMetrics);

  return organizationWeeklyEvalMetricsSchema.parse({
    schemaVersion: 1,
    ...executionMetrics,
    ...signalTotals,
    silentRate: toRate(signalTotals.silentCount, executionMetrics.wakeTotal),
    stalenessRate: toRate(
      signalTotals.staleReplyCount,
      signalTotals.replyCount
    ),
  });
}

export async function readOrganizationExecutionEvalMetrics(input: {
  db: D1Database;
  organizationId: string;
  periodEndMs: number;
  periodStartMs: number;
}): Promise<OrganizationExecutionEvalMetrics> {
  const row = await input.db
    .prepare(
      `
        SELECT
          COUNT(*) AS wake_total,
          COALESCE(
            SUM(
              CASE
                WHEN execution.status IN (
                  ${EXPLICIT_CLOSURE_STATUSES_SQL}
                ) THEN 1
                ELSE 0
              END
            ),
            0
          ) AS closure_count,
          COALESCE(
            SUM(
              CASE
                WHEN execution.status = 'failed_terminal' THEN 1
                ELSE 0
              END
            ),
            0
          ) AS failure_count
        FROM openMeldDaemon_runtime_coordinator_executions AS execution
        INNER JOIN space_index_spaces AS space
          ON space.space_id = execution.space_id
        WHERE space.organization_id = ?
          AND execution.created_at_ms >= ?
          AND execution.created_at_ms < ?
      `
    )
    .bind(input.organizationId, input.periodStartMs, input.periodEndMs)
    .first<{
      closure_count?: unknown;
      failure_count?: unknown;
      wake_total?: unknown;
    }>();

  const wakeTotal = toNonnegativeInteger(row?.wake_total);
  const closureCount = toNonnegativeInteger(row?.closure_count);
  const failureCount = toNonnegativeInteger(row?.failure_count);
  const concurrencyOverlap = await readConcurrencyOverlap(input);
  return {
    closureCount,
    closureRate: toRate(closureCount, wakeTotal),
    concurrencyOverlap,
    failureCount,
    failureRate: toRate(failureCount, wakeTotal),
    wakeTotal,
  };
}

async function readConcurrencyOverlap(input: {
  db: D1Database;
  organizationId: string;
  periodEndMs: number;
  periodStartMs: number;
}): Promise<number> {
  const row = await input.db
    .prepare(
      `
        WITH execution_intervals AS (
          SELECT
            runtime_coordinator_execution_id,
            space_id,
            target_profile_id,
            created_at_ms,
            CASE
              WHEN status IN (${EXPLICIT_CLOSURE_STATUSES_SQL})
                THEN updated_at_ms
              ELSE ?
            END AS ended_at_ms
          FROM openMeldDaemon_runtime_coordinator_executions
          WHERE created_at_ms < ?
        )
        SELECT COUNT(*) AS concurrency_overlap
        FROM execution_intervals AS left_execution
        INNER JOIN execution_intervals AS right_execution
          ON right_execution.space_id = left_execution.space_id
        INNER JOIN space_index_spaces AS space
          ON space.space_id = left_execution.space_id
        WHERE space.organization_id = ?
          AND left_execution.runtime_coordinator_execution_id
            < right_execution.runtime_coordinator_execution_id
          AND left_execution.target_profile_id
            <> right_execution.target_profile_id
          AND MAX(
            left_execution.created_at_ms,
            right_execution.created_at_ms,
            ?
          ) < MIN(
            left_execution.ended_at_ms,
            right_execution.ended_at_ms,
            ?
          )
      `
    )
    .bind(
      input.periodEndMs,
      input.periodEndMs,
      input.organizationId,
      input.periodStartMs,
      input.periodEndMs
    )
    .first<{ concurrency_overlap?: unknown }>();

  return toNonnegativeInteger(row?.concurrency_overlap);
}

function toNonnegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function toRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function sumSignalMetrics(metrics: EvalSpaceSignalMetrics[]): {
  replyCount: number;
  silentCount: number;
  staleReplyCount: number;
} {
  return metrics.reduce(
    (total, metric) => ({
      replyCount: total.replyCount + metric.replyCount,
      silentCount: total.silentCount + metric.silentCount,
      staleReplyCount: total.staleReplyCount + metric.staleReplyCount,
    }),
    { replyCount: 0, silentCount: 0, staleReplyCount: 0 }
  );
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  map: (input: Input) => Promise<Output>
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = inputs[index];
      if (value !== undefined) {
        results[index] = await map(value);
      }
    }
  }

  const workerCount = Math.min(concurrency, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
