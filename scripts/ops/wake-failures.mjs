#!/usr/bin/env node
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { wakeFailureListSchema } from "../../packages/schemas/src/schemas/http/wake-failure-list.ts";

const DAY_MS = 86_400_000;
const execFileAsync = promisify(execFile);

export function parseWakeFailureArgs(args, nowMs = Date.now()) {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      help: { type: "boolean", short: "h" },
      local: { type: "boolean", default: false },
      since: { type: "string" },
      until: { type: "string" },
      limit: { type: "string", default: "100" },
      env: { type: "string", default: "prod" },
      cursor: { type: "string" },
    },
  });
  if (values.help) {
    return { help: true };
  }
  const options = {
    since: values.since ? Date.parse(values.since) : nowMs - DAY_MS,
    until: values.until ? Date.parse(values.until) : nowMs,
    limit: Number(values.limit),
    env: values.env,
    local: values.local,
    cursor: values.cursor,
  };
  if (
    ![options.since, options.until].every(Number.isSafeInteger) ||
    options.since < 0 ||
    options.until > nowMs ||
    options.since >= options.until ||
    options.until - options.since > 30 * DAY_MS
  ) {
    throw new Error("Use a past UTC interval of at most 30 days.");
  }
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 200
  ) {
    throw new Error("--limit must be between 1 and 200.");
  }
  if (!["prod", "stg"].includes(options.env)) {
    throw new Error("--env must be prod or stg.");
  }
  if (options.cursor) {
    const cursor = JSON.parse(
      Buffer.from(options.cursor, "base64url").toString()
    );
    if (
      !Number.isSafeInteger(cursor.observedAtMs) ||
      typeof cursor.recordId !== "string" ||
      cursor.recordId.length > 1024 ||
      cursor.since !== options.since ||
      cursor.until !== options.until
    ) {
      throw new Error(
        "Invalid cursor; reuse the exact --since and --until from the previous page."
      );
    }
    options.after = cursor;
  }
  return options;
}

const quote = (value) => `'${value.replaceAll("'", "''")}'`;

// Discovery only: attempts remain the durable evidence owner. Replayed lifecycle
// callbacks update the same primary key; recovery never erases a failed attempt.
export function buildWakeFailureSql(options) {
  const time = "COALESCE(a.finished_at_ms, a.created_at_ms)";
  const cursor = options.after
    ? `WHERE (observedAtMs < ${options.after.observedAtMs} OR (observedAtMs = ${options.after.observedAtMs} AND recordId < ${quote(options.after.recordId)}))`
    : "";
  return `WITH failures AS (
  SELECT 'attempt:' || a.attempt_id AS recordId, 'attempt' AS failureKind,
    NULL AS runtimeCoordinatorExecutionId,
    a.attempt_id AS attemptId, a.dispatch_id AS dispatchId,
    a.attempt_no AS attemptNo, a.status AS status,
    a.error_code AS reasonCode, ${time} AS observedAtMs,
    l.space_id AS spaceId, l.source_event_id AS sourceSignalId,
    l.source_client_message_id AS clientMessageId,
    COALESCE(a.target_profile_id, l.target_profile_id) AS targetProfileId,
    l.status AS currentDispatchStatus
  FROM openMeldDaemon_dispatch_attempts a
  LEFT JOIN openMeldDaemon_dispatch_ledger l ON l.idempotency_key = a.idempotency_key
  WHERE a.status IN ('failed_terminal', 'failed_retryable', 'blocked')
    AND (a.status != 'failed_retryable' OR a.error_code IS NULL OR a.error_code NOT IN (
      'runtime_coordinator.device_waiting',
      'runtime_coordinator.agent_profile_execution_active'
    ))
    AND ${time} >= ${options.since} AND ${time} <= ${options.until}
  UNION ALL
  SELECT 'publication:' || e.event_id, 'publication', e.runtime_coordinator_execution_id,
    NULL, x.dispatch_id, NULL, e.status_after, e.reason_code, e.observed_at_ms,
    x.space_id, NULL, x.source_client_message_id, x.target_profile_id, NULL
  FROM openMeldDaemon_runtime_coordinator_execution_events e
  LEFT JOIN openMeldDaemon_runtime_coordinator_executions x
    ON x.runtime_coordinator_execution_id = e.runtime_coordinator_execution_id
  WHERE e.event_type = 'reply_publication_failed'
    AND e.observed_at_ms >= ${options.since} AND e.observed_at_ms <= ${options.until}
  )
  SELECT * FROM failures ${cursor}
  ORDER BY observedAtMs DESC, recordId DESC
  LIMIT ${options.limit + 1};`;
}

export function projectWakeFailureList(options, rows) {
  const page = rows.slice(0, options.limit);
  const groups = new Map();
  for (const row of page) {
    const key = JSON.stringify([row.failureKind, row.status, row.reasonCode]);
    const group = groups.get(key) ?? {
      failureKind: row.failureKind,
      status: row.status,
      reasonCode: row.reasonCode,
      failureCount: 0,
      dispatches: new Set(),
    };
    group.failureCount += 1;
    group.dispatches.add(row.dispatchId ?? row.runtimeCoordinatorExecutionId);
    groups.set(key, group);
  }
  const last = page.at(-1);
  return wakeFailureListSchema.parse({
    v: 1,
    since: new Date(options.since).toISOString(),
    until: new Date(options.until).toISOString(),
    summaryScope: "page",
    groups: [...groups.values()].map(({ dispatches, ...group }) => ({
      ...group,
      affectedWakes: dispatches.size,
    })),
    failures: page,
    nextCursor:
      rows.length > options.limit && last
        ? Buffer.from(
            JSON.stringify({
              since: options.since,
              until: options.until,
              observedAtMs: last.observedAtMs,
              recordId: last.recordId,
            })
          ).toString("base64url")
        : null,
  });
}

async function main(args) {
  const options = parseWakeFailureArgs(args);
  if (options.help) {
    console.log(`Usage: pnpm ops:wake-failures [--since ISO] [--until ISO] [--limit 1..200] [--cursor TOKEN] [--env prod|stg] [--local]
Read automatically recorded Wake failures: execution attempts, admission blocks, and reply publication.
Expected device waiting and busy-Agent admission are excluded; user Stop is not failure.
Defaults to the last 24 hours. Reuse returned since/until for subsequent pages.
Groups summarize this page only; follow nextCursor to audit every retained attempt.
No messages, prompts, credentials, user reports, notifications, or execution changes.
Use Space/clientMessageId/targetProfileId with openmeld service trace; normal Space permissions still apply.`);
    return;
  }
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "-C",
      fileURLToPath(new URL("../../services/core", import.meta.url)),
      "exec",
      "wrangler",
      "d1",
      "execute",
      "OPENMELD_DB",
      "--env",
      options.env,
      options.local ? "--local" : "--remote",
      "--json",
      "--command",
      buildWakeFailureSql(options),
    ],
    { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 }
  );
  const result = JSON.parse(stdout);
  if (
    !Array.isArray(result) ||
    result.some(
      (entry) => entry.success !== true || !Array.isArray(entry.results)
    )
  ) {
    throw new Error("D1 failure lookup did not return a successful result.");
  }
  console.log(
    JSON.stringify(
      projectWakeFailureList(
        options,
        result.flatMap((entry) => entry.results)
      ),
      null,
      2
    )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
