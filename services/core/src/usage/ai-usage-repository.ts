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
    ON CONFLICT (organization_id, runtime, event_id) DO UPDATE SET
      model = excluded.model,
      input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens, cost_nano_usd = excluded.cost_nano_usd,
      cost_kind = excluded.cost_kind, record_json = excluded.record_json
    WHERE json_extract(ai_usage_records.record_json, '$.status') = 'pending'
      AND json_extract(excluded.record_json, '$.status') <> 'pending'
      AND ai_usage_records.provider = excluded.provider
      AND ai_usage_records.purpose = excluded.purpose
      AND ai_usage_records.agent_profile_id IS excluded.agent_profile_id
      AND ai_usage_records.space_id IS excluded.space_id
      AND ai_usage_records.task_id IS excluded.task_id
      AND ai_usage_records.attempt_id IS excluded.attempt_id
      AND ai_usage_records.computer_id IS excluded.computer_id
      AND ai_usage_records.controller IS excluded.controller
      AND ai_usage_records.occurred_at_ms = excluded.occurred_at_ms
      AND json_extract(ai_usage_records.record_json, '$.dispatchId') IS json_extract(excluded.record_json, '$.dispatchId')
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
  nowMs?: number;
}): Promise<AiUsageQueryResponse> {
  const query = aiUsageQuerySchema.parse(input.query);
  const { where, values } = usageScope(input.organizationId, query);
  const aggregate = `COUNT(*) AS requests,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      COALESCE(SUM(CASE WHEN cost_kind = 'provider_reported' THEN cost_nano_usd ELSE 0 END), 0) AS reportedCostNanoUsd,
      COALESCE(SUM(CASE WHEN cost_kind = 'provider_estimate' THEN cost_nano_usd ELSE 0 END), 0) AS estimatedCostNanoUsd,
      COALESCE(SUM(total_tokens IS NULL), 0) AS missingTokenRequests,
      COALESCE(SUM(cost_nano_usd IS NULL), 0) AS missingCostRequests`;
  const state = "json_extract(record_json, '$.status')";
  const dispatch = "json_extract(record_json, '$.dispatchId')";
  const staleAfterMs = 60 * 60 * 1000;
  const modelsStatement = input.db
    .prepare(`
    SELECT runtime, provider, model, ${aggregate}
    FROM ai_usage_records WHERE ${where}
    GROUP BY runtime, provider, model ORDER BY runtime, provider, model
  `)
    .bind(...values);
  const coverageStatement = input.db
    .prepare(`
    SELECT COALESCE(SUM(${state} = 'reported'), 0) AS reportedRequests,
      COALESCE(SUM(${state} = 'pending'), 0) AS pendingRequests,
      COALESCE(SUM(${state} = 'pending' AND occurred_at_ms < ?), 0) AS stalePendingRequests,
      COALESCE(SUM(${state} = 'unavailable'), 0) AS unavailableRequests,
      COALESCE(SUM(${state} = 'collection_failed'), 0) AS collectionFailedRequests,
      COALESCE(SUM(total_tokens IS NULL), 0) AS missingTokenRequests,
      COALESCE(SUM(cost_nano_usd IS NULL), 0) AS missingCostRequests,
      COALESCE(SUM(task_id IS NULL), 0) AS unassignedTaskRequests,
      MIN(CASE WHEN ${state} = 'pending' THEN occurred_at_ms END) AS oldestPendingAtMs
    FROM ai_usage_records WHERE ${where}
  `)
    .bind((input.nowMs ?? Date.now()) - staleAfterMs, ...values);
  const statements = [modelsStatement, coverageStatement];
  const groupBy = query.groupBy ?? "model";
  const sortBy =
    query.sortBy ?? (query.runtime === "local" ? "tokens" : "cost");
  const limit = query.limit ?? 20;
  if (groupBy !== "model") {
    statements.push(
      input.db
        .prepare(
          buildUsageGroupSql({
            groupBy,
            sortBy,
            aggregate,
            where,
            state,
            dispatch,
          })
        )
        .bind(...values, limit + 1)
    );
  }
  // D1 batch provides one consistent snapshot across totals and ranking.
  const issuesIndex = statements.length;
  if (query.includeIssues) {
    statements.push(
      input.db
        .prepare(`
      SELECT record_json FROM ai_usage_records WHERE ${where}
        AND (${state} <> 'reported' OR total_tokens IS NULL OR cost_nano_usd IS NULL)
      ORDER BY occurred_at_ms, event_id LIMIT ?
    `)
        .bind(...values, limit + 1)
    );
  }
  const seriesIndex = statements.length;
  const edges = query.bucketBoundariesMs;
  const seriesGrouping = query.groupTimeSeriesBy;
  if (edges) {
    statements.push(
      input.db
        .prepare(buildUsageTimeSeriesSql(edges, where, seriesGrouping))
        .bind(...edges.slice(1), ...values)
    );
  }
  const results = await input.db.batch<Record<string, unknown>>(statements);
  const [models, coverage] = results;
  if (!(models && coverage?.results[0])) {
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
    models: models.results,
    ...(edges
      ? {
          timeSeries: projectUsageTimeSeries(
            edges,
            results[seriesIndex]?.results ?? [],
            seriesGrouping
          ),
        }
      : {}),
    ...(issues
      ? {
          issues: {
            records: issues.results
              .slice(0, limit)
              .map((row) => JSON.parse(String(row.record_json))),
            hasMore: issues.results.length > limit,
          },
        }
      : {}),
    coverage: {
      ...coverage.results[0],
      scope: "observed_requests",
      staleAfterMs,
    },
    ...(groups
      ? {
          breakdown: {
            groupBy,
            sortBy,
            limit,
            hasMore: groups.results.length > limit,
            groups: groups.results.slice(0, limit).map(projectUsageGroup),
          },
        }
      : {}),
  });
}

function usageScope(organizationId: string, query: AiUsageQuery) {
  const predicates = [
    "organization_id = ?",
    "occurred_at_ms >= ?",
    "occurred_at_ms < ?",
  ];
  const values: (string | number)[] = [
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
    dispatchId: "json_extract(record_json, '$.dispatchId')",
    computerId: "computer_id",
    controller: "controller",
  } as const;
  for (const [key, column] of Object.entries(filters)) {
    const value = query[key as keyof typeof filters];
    if (value !== undefined) {
      predicates.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (query.agentProfileIds !== undefined) {
    predicates.push("agent_profile_id IN (SELECT value FROM json_each(?))");
    values.push(JSON.stringify(query.agentProfileIds));
  }
  return { where: predicates.join(" AND "), values };
}

function buildUsageTimeSeriesSql(
  edges: number[],
  where: string,
  groupBy: AiUsageQuery["groupTimeSeriesBy"]
) {
  // Bound edges precede the shared scope predicates. No client SQL enters this query.
  const buckets = edges
    .slice(1)
    .map((_, index) => `WHEN occurred_at_ms < ? THEN ${index}`)
    .join(" ");
  const grouping = usageTimeSeriesGrouping(groupBy);
  return `SELECT CASE ${buckets} END AS bucketIndex${grouping},
    COUNT(*) AS requests,
    COALESCE(SUM(input_tokens), 0) AS inputTokens,
    COALESCE(SUM(output_tokens), 0) AS outputTokens,
    COALESCE(SUM(total_tokens), 0) AS totalTokens,
    COALESCE(SUM(total_tokens IS NULL), 0) AS missingTokenRequests,
    COALESCE(SUM(CASE WHEN cost_kind = 'provider_reported' THEN cost_nano_usd ELSE 0 END), 0) AS reportedCostNanoUsd,
    COALESCE(SUM(CASE WHEN cost_kind = 'provider_estimate' THEN cost_nano_usd ELSE 0 END), 0) AS estimatedCostNanoUsd,
    COALESCE(SUM(cost_nano_usd IS NULL), 0) AS missingCostRequests
    FROM ai_usage_records WHERE ${where}
    GROUP BY bucketIndex${grouping} ORDER BY bucketIndex${grouping}`;
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
      reportedCostNanoUsd: sum("reportedCostNanoUsd"),
      estimatedCostNanoUsd: sum("estimatedCostNanoUsd"),
      missingCostRequests: sum("missingCostRequests"),
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
}) {
  const { aggregate, where, state, dispatch, sortBy } = input;
  const task = input.groupBy === "task";
  return `
      SELECT runtime, ${task ? "task_id" : "NULL"} AS taskId,
        agent_profile_id AS agentProfileId, ${task ? "space_id" : "NULL"} AS spaceId,
        ${aggregate},
        SUM(${state} = 'pending') AS pendingRequests,
        SUM(${state} = 'collection_failed') AS collectionFailedRequests,
        SUM(${state} = 'unavailable') AS unavailableRequests,
        COUNT(DISTINCT attempt_id) AS observedExecutionAttempts,
        ${task ? "MAX(0, COUNT(DISTINCT attempt_id) - 1)" : "NULL"} AS observedExecutionRetries,
        SUM(attempt_id IS NULL) AS requestsWithoutAttemptId,
        MIN(occurred_at_ms) AS firstObservedAtMs,
        MAX(occurred_at_ms) AS lastObservedAtMs,
        json_group_array(DISTINCT model) AS modelsJson,
        json_group_array(DISTINCT purpose) AS purposesJson,
        ${task ? `json_group_array(DISTINCT ${dispatch})` : "'[]'"} AS dispatchIdsJson
      FROM ai_usage_records WHERE ${where}
        AND ${task ? `(task_id IS NOT NULL OR ${dispatch} IS NOT NULL)` : "agent_profile_id IS NOT NULL"}
      GROUP BY runtime, agent_profile_id${task ? `, space_id, COALESCE(task_id, ${dispatch})` : ""}
      ORDER BY ${sortBy === "tokens" ? "totalTokens" : "reportedCostNanoUsd"} DESC,
        runtime, agentProfileId, spaceId, taskId, firstObservedAtMs
      LIMIT ?
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
