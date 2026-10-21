import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "@openmeld/db/postgresql";
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
/** The database or the client of an open transaction. */
export type AiUsageQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    query: QueryConfig
  ): Promise<QueryResult<T>>;
};

export type AiCreditHold = { nanoUsd: number; admittedAtMs: number };

// A provider event is immutable. Replayed transport deliveries are harmless;
// conflicting facts surface an error instead of silently changing spend.
// A credit hold is written once at admission; settlement keeps it so an
// unknown final cost continues to count until the hold expires.
export async function recordAiUsage(
  db: AiUsageQueryable,
  input: AiUsageRecord,
  creditHold?: AiCreditHold
): Promise<void> {
  const record = aiUsageRecordSchema.parse(input);
  const json = JSON.stringify(record);
  await db.query({
    text: `
    INSERT INTO "openmeld"."ai_usage_records" (
      organization_id, event_id, runtime, provider, model, purpose,
      agent_profile_id, space_id, task_id, attempt_id, computer_id, controller,
      occurred_at_ms, input_tokens, output_tokens, total_tokens,
      cost_nano_usd, cost_kind, record_json, funding_source,
      credit_hold_nano_usd, credit_hold_admitted_at_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    ON CONFLICT (organization_id, runtime, event_id) DO UPDATE SET
      model = excluded.model,
      input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens, cost_nano_usd = excluded.cost_nano_usd,
      cost_kind = excluded.cost_kind, record_json = excluded.record_json
    WHERE ((ai_usage_records.record_json)::jsonb #>> '{status}') = 'pending'
      AND ((excluded.record_json)::jsonb #>> '{status}') <> 'pending'
      AND ai_usage_records.provider = excluded.provider
      AND ai_usage_records.purpose = excluded.purpose
      AND ai_usage_records.agent_profile_id IS NOT DISTINCT FROM excluded.agent_profile_id
      AND ai_usage_records.space_id IS NOT DISTINCT FROM excluded.space_id
      AND ai_usage_records.task_id IS NOT DISTINCT FROM excluded.task_id
      AND ai_usage_records.attempt_id IS NOT DISTINCT FROM excluded.attempt_id
      AND ai_usage_records.computer_id IS NOT DISTINCT FROM excluded.computer_id
      AND ai_usage_records.controller IS NOT DISTINCT FROM excluded.controller
      AND ai_usage_records.occurred_at_ms = excluded.occurred_at_ms
      AND ((ai_usage_records.record_json)::jsonb #>> '{dispatchId}') IS NOT DISTINCT FROM ((excluded.record_json)::jsonb #>> '{dispatchId}')
      AND ((ai_usage_records.record_json)::jsonb #>> '{fundingSource}') IS NOT DISTINCT FROM ((excluded.record_json)::jsonb #>> '{fundingSource}')
  `,
    values: [
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
      json,
      record.fundingSource ?? null,
      creditHold?.nanoUsd ?? null,
      creditHold?.admittedAtMs ?? null,
    ],
  });
  const stored = await db
    .query<{
      record_json: string;
    }>({
      text: 'SELECT record_json FROM "openmeld"."ai_usage_records" WHERE organization_id = $1 AND runtime = $2 AND event_id = $3',
      values: [record.organizationId, record.runtime, record.eventId],
    })
    .then((result) => result.rows[0] ?? null);
  if (stored?.record_json !== json) {
    throw new Error(
      "AI usage event identity conflicts with an existing record."
    );
  }
}
export async function queryAiUsage(input: {
  db: PostgresDatabase;
  organizationId: string;
  query: AiUsageQuery;
  nowMs?: number;
}): Promise<AiUsageQueryResponse> {
  const query = aiUsageQuerySchema.parse(input.query);
  const { where, values } = usageScope(input.organizationId, query);
  // PostgreSQL SUM(bigint) returns numeric. These public token and nano-dollar
  // totals remain integers; bigint uses the driver's checked safe-integer parser.
  const aggregate = `COUNT(*) AS requests,
      COALESCE(SUM(input_tokens)::bigint, 0) AS "inputTokens",
      COALESCE(SUM(output_tokens)::bigint, 0) AS "outputTokens",
      COALESCE(SUM(total_tokens)::bigint, 0) AS "totalTokens",
      COALESCE(SUM(CASE WHEN cost_kind = 'provider_reported' THEN cost_nano_usd ELSE 0 END)::bigint, 0) AS "reportedCostNanoUsd",
      COALESCE(SUM(CASE WHEN cost_kind = 'provider_estimate' THEN cost_nano_usd ELSE 0 END)::bigint, 0) AS "estimatedCostNanoUsd",
      COUNT(*) FILTER (WHERE total_tokens IS NULL) AS "missingTokenRequests",
      COUNT(*) FILTER (WHERE cost_nano_usd IS NULL) AS "missingCostRequests"`;
  const state = "((record_json)::jsonb #>> '{status}')";
  const dispatch = "((record_json)::jsonb #>> '{dispatchId}')";
  const staleAfterMs = 60 * 60 * 1000;
  const modelsStatement = {
    text: `
    SELECT runtime, provider, model, ${aggregate}
    FROM "openmeld"."ai_usage_records" WHERE ${where}
    GROUP BY runtime, provider, model ORDER BY runtime, provider, model
  `,
    values: [...values],
  };
  const coverageStatement = {
    text: `
    WITH coverage AS MATERIALIZED (
      SELECT ${state} AS status, occurred_at_ms, total_tokens, cost_nano_usd, task_id
      FROM "openmeld"."ai_usage_records" WHERE ${where}
    )
    SELECT COUNT(*) FILTER (WHERE status = 'reported') AS "reportedRequests",
      COUNT(*) FILTER (WHERE status = 'pending') AS "pendingRequests",
      COUNT(*) FILTER (WHERE status = 'pending' AND occurred_at_ms < $${values.length + 1}) AS "stalePendingRequests",
      COUNT(*) FILTER (WHERE status = 'unavailable') AS "unavailableRequests",
      COUNT(*) FILTER (WHERE status = 'collection_failed') AS "collectionFailedRequests",
      COUNT(*) FILTER (WHERE total_tokens IS NULL) AS "missingTokenRequests",
      COUNT(*) FILTER (WHERE cost_nano_usd IS NULL) AS "missingCostRequests",
      COUNT(*) FILTER (WHERE task_id IS NULL) AS "unassignedTaskRequests",
      MIN(CASE WHEN status = 'pending' THEN occurred_at_ms END) AS "oldestPendingAtMs"
    FROM coverage
  `,
    values: [...values, (input.nowMs ?? Date.now()) - staleAfterMs],
  };
  const statements = [modelsStatement, coverageStatement];
  const groupBy = query.groupBy ?? "model";
  const sortBy =
    query.sortBy ?? (query.runtime === "local" ? "tokens" : "cost");
  const limit = query.limit ?? 20;
  if (groupBy !== "model") {
    statements.push({
      text: buildUsageGroupSql({
        groupBy,
        sortBy,
        aggregate,
        where,
        state,
        dispatch,
        limitParameter: values.length + 1,
      }),
      values: [...values, limit + 1],
    });
  }
  // One repeatable-read transaction keeps totals, ranking and series consistent.
  const issuesIndex = statements.length;
  if (query.includeIssues) {
    statements.push({
      text: `
      SELECT record_json FROM "openmeld"."ai_usage_records" WHERE ${where}
        AND (${state} <> 'reported' OR total_tokens IS NULL OR cost_nano_usd IS NULL)
      ORDER BY occurred_at_ms, event_id LIMIT $${values.length + 1}
    `,
      values: [...values, limit + 1],
    });
  }
  const seriesIndex = statements.length;
  const edges = query.bucketBoundariesMs;
  const seriesGrouping = query.groupTimeSeriesBy;
  if (edges) {
    statements.push({
      text: buildUsageTimeSeriesSql(
        edges,
        where,
        seriesGrouping,
        values.length
      ),
      values: [...values, ...edges.slice(1)],
    });
  }
  const results = await input.db.transaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  const [models, coverage] = results;
  if (!(models && coverage?.rows[0])) {
    throw new Error("AI usage query returned an incomplete snapshot.");
  }
  if (edges && !results[seriesIndex]) {
    throw new Error("AI usage query returned an incomplete time series.");
  }
  const groups = groupBy === "model" ? undefined : results[2];
  const issues = query.includeIssues ? results[issuesIndex] : undefined;
  return aiUsageQueryResponseSchema.parse({
    fromMs: query.fromMs,
    toMs: query.toMs,
    models: models.rows,
    ...(edges
      ? {
          timeSeries: projectUsageTimeSeries(
            edges,
            results[seriesIndex]?.rows ?? [],
            seriesGrouping
          ),
        }
      : {}),
    ...(issues
      ? {
          issues: {
            records: issues.rows.slice(0, limit).map((row) => {
              const record = aiUsageRecordSchema.parse(
                JSON.parse(String(row.record_json))
              );
              return {
                ...record,
                purpose:
                  record.purpose === "compaction" ||
                  record.purpose === "compaction_prefix"
                    ? "agent"
                    : record.purpose,
              };
            }),
            hasMore: issues.rows.length > limit,
          },
        }
      : {}),
    coverage: {
      ...coverage.rows[0],
      scope: "observed_requests",
      staleAfterMs,
    },
    ...(groups
      ? {
          breakdown: {
            groupBy,
            sortBy,
            limit,
            hasMore: groups.rows.length > limit,
            groups: groups.rows.slice(0, limit).map(projectUsageGroup),
          },
        }
      : {}),
  });
}
function usageScope(organizationId: string, query: AiUsageQuery) {
  const predicates = [
    "organization_id = $1",
    "occurred_at_ms >= $2",
    "occurred_at_ms < $3",
  ];
  const values: (string | number | string[])[] = [
    organizationId,
    query.fromMs,
    query.toMs,
  ];
  const filters = {
    runtime: "runtime",
    model: "model",
    agentProfileId: "agent_profile_id",
    spaceId: "space_id",
    taskId: "task_id",
    dispatchId: "((record_json)::jsonb #>> '{dispatchId}')",
    computerId: "computer_id",
    controller: "controller",
  } as const;
  for (const [key, column] of Object.entries(filters)) {
    const value = query[key as keyof typeof filters];
    if (value !== undefined) {
      predicates.push(`${column} = $${values.length + 1}`);
      values.push(value);
    }
  }
  if (query.agentProfileIds !== undefined) {
    predicates.push(`agent_profile_id = ANY($${values.length + 1}::text[])`);
    values.push(query.agentProfileIds);
  }
  return { where: predicates.join(" AND "), values };
}
function buildUsageTimeSeriesSql(
  edges: number[],
  where: string,
  groupBy: AiUsageQuery["groupTimeSeriesBy"],
  parameterOffset: number
) {
  // Bound edges follow shared scope parameters. No client SQL enters this query.
  const buckets = edges
    .slice(1)
    .map(
      (_, index) =>
        `WHEN occurred_at_ms < $${parameterOffset + index + 1} THEN ${index}`
    )
    .join(" ");
  const grouping = usageTimeSeriesGrouping(groupBy);
  return `SELECT CASE ${buckets} END AS "bucketIndex"${grouping},
    COUNT(*) AS requests,
    COALESCE(SUM(input_tokens)::bigint, 0) AS "inputTokens",
    COALESCE(SUM(output_tokens)::bigint, 0) AS "outputTokens",
    COALESCE(SUM(total_tokens)::bigint, 0) AS "totalTokens",
    COUNT(*) FILTER (WHERE total_tokens IS NULL) AS "missingTokenRequests"${
      groupBy === "model"
        ? `,
    COALESCE(SUM(CASE WHEN cost_kind = 'provider_reported' THEN cost_nano_usd ELSE 0 END)::bigint, 0) AS "reportedCostNanoUsd",
    COALESCE(SUM(CASE WHEN cost_kind = 'provider_estimate' THEN cost_nano_usd ELSE 0 END)::bigint, 0) AS "estimatedCostNanoUsd",
    COUNT(*) FILTER (WHERE cost_nano_usd IS NULL) AS "missingCostRequests"`
        : ""
    }
    FROM "openmeld"."ai_usage_records" WHERE ${where}
    GROUP BY "bucketIndex"${grouping} ORDER BY "bucketIndex"${grouping}`;
}
function usageTimeSeriesGrouping(groupBy: AiUsageQuery["groupTimeSeriesBy"]) {
  if (groupBy === "controller") {
    return ", controller";
  }
  if (groupBy === "model") {
    return ", provider, model";
  }
  return "";
}
function projectUsageTimeSeries(
  edges: number[],
  rows: Record<string, unknown>[],
  groupBy: AiUsageQuery["groupTimeSeriesBy"]
) {
  return edges.slice(0, -1).map((fromMs, index) => {
    const bucketRows = rows.filter((entry) => entry.bucketIndex === index);
    const sum = (key: string) =>
      bucketRows.reduce((total, row) => total + Number(row[key]), 0);
    return {
      fromMs,
      toMs: edges[index + 1],
      requests: sum("requests"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      totalTokens: sum("totalTokens"),
      missingTokenRequests: sum("missingTokenRequests"),
      ...(groupBy === "model"
        ? {
            reportedCostNanoUsd: sum("reportedCostNanoUsd"),
            estimatedCostNanoUsd: sum("estimatedCostNanoUsd"),
            missingCostRequests: sum("missingCostRequests"),
          }
        : {}),
      ...(groupBy
        ? {
            [groupBy === "controller" ? "controllers" : "models"]:
              bucketRows.map(({ bucketIndex: _bucketIndex, ...row }) => row),
          }
        : {}),
    };
  });
}
function buildUsageGroupSql(input: {
  groupBy: "task" | "agent";
  sortBy: "cost" | "tokens";
  aggregate: string;
  where: string;
  state: string;
  dispatch: string;
  limitParameter: number;
}) {
  const { aggregate, where, state, dispatch, sortBy } = input;
  const task = input.groupBy === "task";
  return `
      SELECT runtime, ${task ? `COALESCE(task_id, ${dispatch})` : "NULL"} AS "taskId",
        agent_profile_id AS "agentProfileId", ${task ? "space_id" : "NULL"} AS "spaceId",
        ${aggregate},
        COUNT(*) FILTER (WHERE ${state} = 'pending') AS "pendingRequests",
        COUNT(*) FILTER (WHERE ${state} = 'collection_failed') AS "collectionFailedRequests",
        COUNT(*) FILTER (WHERE ${state} = 'unavailable') AS "unavailableRequests",
        COUNT(DISTINCT attempt_id) AS "observedExecutionAttempts",
        ${task ? "GREATEST(0, COUNT(DISTINCT attempt_id) - 1)" : "NULL"} AS "observedExecutionRetries",
        COUNT(*) FILTER (WHERE attempt_id IS NULL) AS "requestsWithoutAttemptId",
        MIN(occurred_at_ms) AS "firstObservedAtMs",
        MAX(occurred_at_ms) AS "lastObservedAtMs",
        jsonb_agg(DISTINCT model)::text AS "modelsJson",
        jsonb_agg(DISTINCT CASE
          WHEN purpose IN ('compaction', 'compaction_prefix') THEN 'agent'
          ELSE purpose END)::text AS "purposesJson",
        ${task ? `jsonb_agg(DISTINCT ${dispatch})::text` : "'[]'"} AS "dispatchIdsJson"
      FROM "openmeld"."ai_usage_records" WHERE ${where}
        AND ${task ? `(task_id IS NOT NULL OR ${dispatch} IS NOT NULL)` : "agent_profile_id IS NOT NULL"}
      GROUP BY runtime, agent_profile_id${task ? `, space_id, COALESCE(task_id, ${dispatch})` : ""}
      ORDER BY ${sortBy === "tokens" ? '"totalTokens"' : '"reportedCostNanoUsd"'} DESC NULLS LAST,
        runtime, "agentProfileId", "spaceId", "taskId", "firstObservedAtMs"
      LIMIT $${input.limitParameter}
    `;
}
function projectUsageGroup(row: Record<string, unknown>) {
  const { modelsJson, purposesJson, dispatchIdsJson, ...summary } = row;
  const dispatchIds = (JSON.parse(String(dispatchIdsJson)) as (string | null)[])
    .filter((id): id is string => id !== null)
    .sort();
  return {
    ...summary,
    models: JSON.parse(String(modelsJson)),
    purposes: JSON.parse(String(purposesJson)),
    dispatchIds: dispatchIds.slice(0, 20),
    dispatchIdsTruncated: dispatchIds.length > 20,
  };
}
