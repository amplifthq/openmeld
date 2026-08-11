import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  buildAgentActivityDurationBackfillSql,
  buildAgentActivityDurationBackfillWranglerInvocation,
  parseAgentActivityDurationBackfillArgs,
} from "./agent-activity-duration-backfill.mjs";

const ACTIVE_EVIDENCE_PATTERN =
  /'heartbeat', 'session_active', 'session_started'/u;
const ACTIVE_WINDOW_PATTERN = /<= 120000/u;
const ADDITIVE_DURATION_PATTERN = /active_duration_ms\s*\+/u;
const PARTITION_SESSION_PATTERN = /PARTITION BY[\s\S]*provider_session_id/u;
const PRODUCTION_CONFIRMATION_PATTERN = /requires --confirm-production/u;
const SET_DURATION_PATTERN = /SET active_duration_ms = coalesce/u;

test("Agent Activity duration backfill defaults to the local D1 lane", () => {
  assert.deepEqual(parseAgentActivityDurationBackfillArgs([]), {
    confirmProduction: false,
    dryRun: false,
    environment: "local",
  });

  const invocation = buildAgentActivityDurationBackfillWranglerInvocation({
    environment: "local",
    sql: "SELECT 1;",
  });
  assert.equal(invocation.command, "pnpm");
  assert.deepEqual(invocation.args.slice(-6), [
    "--local",
    "--persist-to",
    "../../.wrangler-dev-state",
    "--command",
    "SELECT 1;",
    "--json",
  ]);
});

test("Agent Activity duration backfill requires explicit production confirmation", () => {
  assert.throws(
    () => parseAgentActivityDurationBackfillArgs(["--env", "prod"]),
    PRODUCTION_CONFIRMATION_PATTERN
  );
  assert.deepEqual(
    parseAgentActivityDurationBackfillArgs([
      "--env",
      "prod",
      "--confirm-production",
      "--dry-run",
    ]),
    {
      confirmProduction: true,
      dryRun: true,
      environment: "prod",
    }
  );
});

test("Agent Activity duration backfill fully replaces durations from active evidence", () => {
  const sql = buildAgentActivityDurationBackfillSql();

  assert.match(sql, SET_DURATION_PATTERN);
  assert.doesNotMatch(sql, ADDITIVE_DURATION_PATTERN);
  assert.match(sql, ACTIVE_WINDOW_PATTERN);
  assert.match(sql, ACTIVE_EVIDENCE_PATTERN);
  assert.match(sql, PARTITION_SESSION_PATTERN);
});

test("Agent Activity duration backfill leaves unaggregated evidence for the daily job", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE agent_activity_events (
        accepted_sequence INTEGER PRIMARY KEY,
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        member_user_id TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        daily_aggregated_at_ms INTEGER
      );
      CREATE TABLE agent_activity_daily_aggregates (
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        member_user_id TEXT NOT NULL,
        utc_date TEXT NOT NULL,
        active_duration_ms INTEGER NOT NULL,
        session_count INTEGER NOT NULL
      );
      INSERT INTO agent_activity_daily_aggregates VALUES (
        'org-1', 'project-1', 'user-1', '2026-07-10', 999999, 1
      );
      INSERT INTO agent_activity_events VALUES
        (1, 'org-1', 'project-1', 'user-1', 'session-1', 'session_active', 1783641600000, 1),
        (2, 'org-1', 'project-1', 'user-1', 'session-1', 'heartbeat',      1783641660000, 1),
        (3, 'org-1', 'project-1', 'user-1', 'session-1', 'heartbeat',      1783641690000, NULL),
        (4, 'org-1', 'project-1', 'user-1', 'session-1', 'heartbeat',      1783641720000, NULL);
    `);

    database.exec(buildAgentActivityDurationBackfillSql());
    const afterBackfill = database
      .prepare("SELECT active_duration_ms FROM agent_activity_daily_aggregates")
      .get();
    assert.equal(afterBackfill.active_duration_ms, 60_000);

    database.exec(`
      UPDATE agent_activity_daily_aggregates
      SET active_duration_ms = active_duration_ms + 30000;
    `);
    const afterDailyIncrement = database
      .prepare("SELECT active_duration_ms FROM agent_activity_daily_aggregates")
      .get();
    assert.equal(afterDailyIncrement.active_duration_ms, 90_000);
  } finally {
    database.close();
  }
});
