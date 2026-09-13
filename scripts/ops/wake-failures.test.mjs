import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  buildWakeFailureSql,
  parseWakeFailureArgs,
  projectWakeFailureList,
} from "./wake-failures.mjs";

test("failed attempts survive recovery, dedupe callbacks, exclude Stop, and paginate tied timestamps", () => {
  const db = new DatabaseSync(":memory:");
  try {
    // Run the actual repository schema, not a mock of the query's assumptions.
    const migration = readFileSync(
      new URL(
        "../../packages/db/drizzle/0000_openmeld_initial_schema.sql",
        import.meta.url
      ),
      "utf8"
    );
    for (const rawStatement of migration.split("--> statement-breakpoint")) {
      const statement = rawStatement.trim();
      if (
        (statement.startsWith("CREATE TABLE") ||
          statement.startsWith("CREATE INDEX") ||
          statement.startsWith("CREATE UNIQUE INDEX")) &&
        (statement.includes("`openMeldDaemon_dispatch_attempts`") ||
          statement.includes("`openMeldDaemon_dispatch_ledger`") ||
          statement.includes(
            "`openMeldDaemon_runtime_coordinator_executions`"
          ) ||
          statement.includes(
            "`openMeldDaemon_runtime_coordinator_execution_events`"
          ))
      ) {
        db.exec(statement);
      }
    }
    db.prepare(`INSERT INTO openMeldDaemon_dispatch_ledger
      (idempotency_key, dispatch_id, space_id, source_event_id, target_profile_id, status, first_seen_at_ms, last_attempt_at_ms, attempt_count)
      VALUES ('wake', 'dispatch', 'space', 'signal', 'agent', 'succeeded', 1, 30, 2)`).run();
    const insert = db.prepare(`INSERT INTO openMeldDaemon_dispatch_attempts
      (attempt_id, dispatch_id, idempotency_key, attempt_no, status, created_at_ms, finished_at_ms, error_code, error_message)
      VALUES (?, ?, ?, 1, ?, 1, ?, 'failure.example', 'private message must not be selected')`);
    insert.run("a", "dispatch", "wake", "failed_retryable", 20);
    insert.run("b", "dispatch", "wake", "failed_terminal", 20);
    insert.run("c", "other", "orphan", "blocked", 20);
    insert.run("stop", "other", "orphan", "cancelled", 20);
    insert.run("ok", "dispatch", "wake", "succeeded", 30);
    insert.run("running", "other", "orphan", "running", null);
    insert.run("old", "other", "orphan", "failed_terminal", 2);
    insert.run("future", "other", "orphan", "failed_terminal", 40);
    insert.run("waiting", "other", "orphan", "failed_retryable", 20);
    insert.run("busy", "other", "orphan", "failed_retryable", 20);
    db.exec(
      "UPDATE openMeldDaemon_dispatch_attempts SET error_code = 'runtime_coordinator.device_waiting' WHERE attempt_id = 'waiting'"
    );
    db.exec(
      "UPDATE openMeldDaemon_dispatch_attempts SET error_code = 'runtime_coordinator.agent_profile_execution_active' WHERE attempt_id = 'busy'"
    );
    // A second lifecycle callback changes the same row, not failure volume.
    db.exec(
      "UPDATE openMeldDaemon_dispatch_attempts SET error_code = 'failure.updated' WHERE attempt_id = 'b'"
    );
    const options = { since: 10, until: 30, limit: 2 };
    const first = projectWakeFailureList(
      options,
      db.prepare(buildWakeFailureSql(options)).all()
    );
    assert.deepEqual(
      first.failures.map((row) => row.attemptId),
      ["c", "b"]
    );
    assert.equal(first.failures[0].spaceId, null);
    assert.equal(first.failures[1].currentDispatchStatus, "succeeded");
    assert.equal(first.failures[1].reasonCode, "failure.updated");
    assert.equal(JSON.stringify(first).includes("private message"), false);
    const next = parseWakeFailureArgs(
      [
        "--since",
        first.since,
        "--until",
        first.until,
        "--cursor",
        first.nextCursor,
      ],
      100
    );
    const second = projectWakeFailureList(
      next,
      db.prepare(buildWakeFailureSql(next)).all()
    );
    assert.deepEqual(
      second.failures.map((row) => row.attemptId),
      ["a"]
    );
    assert.equal(second.nextCursor, null);
    const all = projectWakeFailureList(
      { ...options, limit: 200 },
      db.prepare(buildWakeFailureSql({ ...options, limit: 200 })).all()
    );
    assert.equal(all.failures.length, 3);
    db.exec(`INSERT INTO openMeldDaemon_runtime_coordinator_execution_events
      (event_id, runtime_coordinator_execution_id, event_type, status_after, reason_code, observed_at_ms, idempotency_key, payload_json)
      VALUES ('publication', 'execution', 'reply_publication_failed', 'failed_retryable', 'space.publish_failed', 25, 'publication-once', '{"private":"payload"}')`);
    // Orphaned correlation must not silently erase publication failure evidence.
    const publicationPage = projectWakeFailureList(
      { ...options, limit: 200 },
      db.prepare(buildWakeFailureSql({ ...options, limit: 200 })).all()
    );
    assert.equal(publicationPage.failures.length, 4);
    assert.equal(
      publicationPage.failures[0].recordId,
      "publication:publication"
    );
    assert.equal(
      publicationPage.failures[0].runtimeCoordinatorExecutionId,
      "execution"
    );
    assert.equal(publicationPage.failures[0].failureKind, "publication");
    assert.equal(JSON.stringify(publicationPage).includes("payload"), false);
    db.exec(`INSERT INTO openMeldDaemon_runtime_coordinator_executions
      (runtime_coordinator_execution_id, model_version, space_id, dispatch_id, target_profile_id, source_client_message_id, openmeld_service_runtime_id_source, openmeld_service_runtime_id, binding_id, agent_controller_ref, status, created_at_ms, updated_at_ms)
      VALUES ('execution', 'v1', 'space', 'dispatch', 'agent', 'client-message', 'reported', 'runtime', 'binding', 'controller', 'reply_published', 1, 30)`);
    const recovered = projectWakeFailureList(
      { ...options, limit: 200 },
      db.prepare(buildWakeFailureSql({ ...options, limit: 200 })).all()
    );
    assert.equal(recovered.failures[0].dispatchId, "dispatch");
    assert.equal(recovered.failures[0].clientMessageId, "client-message");
    // Later publication success does not erase the earlier failure event.
    assert.equal(recovered.failures[0].reasonCode, "space.publish_failed");
    db.exec(
      "UPDATE openMeldDaemon_dispatch_attempts SET status = 'failed_terminal' WHERE attempt_id = 'waiting'"
    );
    const terminalWait = projectWakeFailureList(
      { ...options, limit: 200 },
      db.prepare(buildWakeFailureSql({ ...options, limit: 200 })).all()
    );
    assert.equal(
      terminalWait.failures.some((row) => row.attemptId === "waiting"),
      true
    );
  } finally {
    db.close();
  }
});

test("bounds lookups and rejects cursor reuse across windows", () => {
  assert.throws(() => parseWakeFailureArgs(["--limit", "201"]));
  assert.throws(() => parseWakeFailureArgs(["--since", "invalid"]));
  assert.throws(() => parseWakeFailureArgs(["--env", "unexpected"]));
  assert.throws(() =>
    parseWakeFailureArgs(["--since", "2020-01-01", "--until", "2021-01-01"])
  );
  assert.throws(() =>
    parseWakeFailureArgs([
      "--cursor",
      Buffer.from(
        JSON.stringify({ since: 0, until: 1, observedAtMs: 1, attemptId: "a" })
      ).toString("base64url"),
    ])
  );
});
