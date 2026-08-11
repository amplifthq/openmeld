#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const LOCAL_D1_PERSIST_PATH = "../../.wrangler-dev-state";
const AGENT_ACTIVITY_ACTIVE_WINDOW_MS = 2 * 60_000;

class AgentActivityDurationBackfillUsageError extends Error {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runAgentActivityDurationBackfillCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Run `pnpm ops:agent-activity-duration-backfill -- --help` for usage."
    );
    process.exit(1);
  }
}

export function parseAgentActivityDurationBackfillArgs(rawArgs) {
  const args = [...rawArgs];
  if (args[0] === "--") {
    args.shift();
  }
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  const parsed = {
    confirmProduction: false,
    dryRun: false,
    environment: "local",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm-production") {
      parsed.confirmProduction = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg !== "--env") {
      throw new AgentActivityDurationBackfillUsageError(
        `Unknown option "${arg}".`
      );
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new AgentActivityDurationBackfillUsageError(
        "Missing value for --env."
      );
    }
    parsed.environment = value;
    index += 1;
  }
  if (parsed.environment !== "local" && parsed.environment !== "prod") {
    throw new AgentActivityDurationBackfillUsageError(
      "--env must be local or prod."
    );
  }
  if (parsed.environment === "prod" && !parsed.confirmProduction) {
    throw new AgentActivityDurationBackfillUsageError(
      "Production Agent Activity duration backfill requires --confirm-production."
    );
  }
  return parsed;
}

export function buildAgentActivityDurationBackfillSql() {
  return `
WITH active_ordered AS (
  SELECT
    organization_id,
    project_id,
    member_user_id,
    provider_session_id,
    strftime('%Y-%m-%d', observed_at_ms / 1000, 'unixepoch') AS utc_date,
    observed_at_ms,
    lag(observed_at_ms) OVER (
      PARTITION BY
        organization_id,
        project_id,
        member_user_id,
        provider_session_id,
        strftime('%Y-%m-%d', observed_at_ms / 1000, 'unixepoch')
      ORDER BY observed_at_ms ASC, accepted_sequence ASC
    ) AS previous_observed_at_ms
  FROM agent_activity_events
  WHERE event_type IN ('heartbeat', 'session_active', 'session_started')
    AND daily_aggregated_at_ms IS NOT NULL
), active_durations AS (
  SELECT
    organization_id,
    project_id,
    member_user_id,
    utc_date,
    sum(
      CASE
        WHEN previous_observed_at_ms IS NOT NULL
          AND observed_at_ms - previous_observed_at_ms <= ${AGENT_ACTIVITY_ACTIVE_WINDOW_MS}
        THEN observed_at_ms - previous_observed_at_ms
        ELSE 0
      END
    ) AS active_duration_ms
  FROM active_ordered
  GROUP BY organization_id, project_id, member_user_id, utc_date
), event_scopes AS (
  SELECT DISTINCT
    organization_id,
    project_id,
    member_user_id,
    strftime('%Y-%m-%d', observed_at_ms / 1000, 'unixepoch') AS utc_date
  FROM agent_activity_events
  WHERE daily_aggregated_at_ms IS NOT NULL
)
UPDATE agent_activity_daily_aggregates AS daily
SET active_duration_ms = coalesce(
  (
    SELECT duration.active_duration_ms
    FROM active_durations AS duration
    WHERE duration.organization_id = daily.organization_id
      AND duration.project_id = daily.project_id
      AND duration.member_user_id = daily.member_user_id
      AND duration.utc_date = daily.utc_date
  ),
  0
)
WHERE EXISTS (
  SELECT 1
  FROM event_scopes AS scope
  WHERE scope.organization_id = daily.organization_id
    AND scope.project_id = daily.project_id
    AND scope.member_user_id = daily.member_user_id
    AND scope.utc_date = daily.utc_date
);
SELECT changes() AS updatedAggregateRows;
SELECT
  count(*) AS aggregateRowCount,
  coalesce(sum(active_duration_ms), 0) AS totalActiveDurationMs,
  coalesce(sum(session_count), 0) AS totalSessions
FROM agent_activity_daily_aggregates;
SELECT count(*) AS negativeActiveDurationRows
FROM agent_activity_daily_aggregates
WHERE active_duration_ms < 0;
`.trim();
}

export function buildAgentActivityDurationBackfillWranglerInvocation(input) {
  const args = [
    "-C",
    "services/core",
    "exec",
    "wrangler",
    "d1",
    "execute",
    "openmeld-db",
    "--config",
    "wrangler.jsonc",
  ];
  if (input.environment === "prod") {
    args.push("--env", "prod", "--remote");
  } else {
    args.push("--local", "--persist-to", LOCAL_D1_PERSIST_PATH);
  }
  args.push("--command", input.sql, "--json");
  return { args, command: "pnpm" };
}

function runAgentActivityDurationBackfillCli(rawArgs) {
  const parsed = parseAgentActivityDurationBackfillArgs(rawArgs);
  if (parsed.help) {
    printUsage();
    return;
  }
  const sql = buildAgentActivityDurationBackfillSql();
  const invocation = buildAgentActivityDurationBackfillWranglerInvocation({
    environment: parsed.environment,
    sql,
  });
  if (parsed.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          environment: parsed.environment,
          invocation,
        },
        null,
        2
      )
    );
    return;
  }

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `Agent Activity duration backfill failed${detail ? `: ${detail}` : "."}`
    );
  }
  process.stdout.write(result.stdout);
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm ops:agent-activity-duration-backfill -- [--env local|prod] [--confirm-production] [--dry-run]",
      "",
      "The default environment is local and uses .wrangler-dev-state.",
      "Production requires --env prod --confirm-production.",
    ].join("\n")
  );
}
