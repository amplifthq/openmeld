import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupExpiredRemoteAgentSubmissionReceipts,
  REMOTE_AGENT_SUBMISSION_RECEIPT_CLEANUP_BATCH_SIZE,
} from "../agent-core/submission";
import { createRemoteAgentSqlStorage } from "../flue-adapter/storage";

const TABLE_NAME = "openmeld_remote_agent_adapter_kv";
const RECEIPT_PREFIX = "openmeld:remote-agent:submission-receipt:";
const ROW_RETURNING_SQL_PATTERN = /^\s*(?:EXPLAIN|PRAGMA|SELECT)\b/iu;

describe("Remote Agent SQLite adapter storage", () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close();
    }
  });

  it("migrates the legacy table and deletes expired receipts through the partial index in bounded batches", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    database.exec(`
      CREATE TABLE ${TABLE_NAME} (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )
    `);
    database
      .prepare(
        `INSERT INTO ${TABLE_NAME} (key, value_json, updated_at_ms) VALUES (?, ?, ?)`
      )
      .run("legacy", JSON.stringify({ retained: true }), 1);

    const storage = createRemoteAgentSqlStorage(
      createCloudflareSqlHarness(database)
    );
    const columns = database
      .prepare(`PRAGMA table_info(${TABLE_NAME})`)
      .all() as { name: string }[];
    const indexes = database
      .prepare(`PRAGMA index_list(${TABLE_NAME})`)
      .all() as { name: string; partial: number }[];

    expect(columns.map((column) => column.name)).toContain("expires_at_ms");
    expect(indexes).toContainEqual(
      expect.objectContaining({
        name: "openmeld_remote_agent_adapter_kv_expiry_idx",
        partial: 1,
      })
    );
    await expect(storage.get("legacy")).resolves.toEqual({ retained: true });

    const expiresAtMs = 10_000;
    for (
      let index = 0;
      index < REMOTE_AGENT_SUBMISSION_RECEIPT_CLEANUP_BATCH_SIZE + 1;
      index += 1
    ) {
      await storage.putExpiring(
        `${RECEIPT_PREFIX}${index.toString().padStart(3, "0")}`,
        { requestDigest: `digest_${index}` },
        expiresAtMs
      );
    }
    const queryPlan = database
      .prepare(
        `
          EXPLAIN QUERY PLAN
          SELECT key
          FROM ${TABLE_NAME}
          WHERE key >= ?
            AND key < ?
            AND expires_at_ms IS NOT NULL
            AND expires_at_ms <= ?
          ORDER BY expires_at_ms ASC, key ASC
          LIMIT ?
        `
      )
      .all(
        RECEIPT_PREFIX,
        `${RECEIPT_PREFIX}\uffff`,
        expiresAtMs,
        REMOTE_AGENT_SUBMISSION_RECEIPT_CLEANUP_BATCH_SIZE
      ) as { detail: string }[];
    expect(queryPlan.map((row) => row.detail).join("\n")).toContain(
      "openmeld_remote_agent_adapter_kv_expiry_idx"
    );

    await expect(
      cleanupExpiredRemoteAgentSubmissionReceipts({
        nowMs: expiresAtMs,
        storage,
      })
    ).resolves.toEqual({
      deleted: REMOTE_AGENT_SUBMISSION_RECEIPT_CLEANUP_BATCH_SIZE,
      nextCleanupAtMs: expiresAtMs,
    });
    await expect(
      cleanupExpiredRemoteAgentSubmissionReceipts({
        nowMs: expiresAtMs,
        storage,
      })
    ).resolves.toEqual({ deleted: 1, nextCleanupAtMs: null });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM ${TABLE_NAME} WHERE key >= ? AND key < ?`
        )
        .get(RECEIPT_PREFIX, `${RECEIPT_PREFIX}\uffff`)
    ).toEqual({ count: 0 });
  });

  it("atomically takes one unexpired record and rejects expired records", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const storage = createRemoteAgentSqlStorage(
      createCloudflareSqlHarness(database)
    );

    await storage.putExpiring("live", { approved: true }, 20_000);
    await expect(storage.takeUnexpired("live", 10_000)).resolves.toEqual({
      approved: true,
    });
    await expect(
      storage.takeUnexpired("live", 10_000)
    ).resolves.toBeUndefined();

    await storage.putExpiring("expired", { approved: true }, 10_000);
    await expect(
      storage.takeUnexpired("expired", 10_000)
    ).resolves.toBeUndefined();
    await expect(storage.get("expired")).resolves.toBeUndefined();
  });

  it("atomically replaces a record only while its expected value is current", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const storage = createRemoteAgentSqlStorage(
      createCloudflareSqlHarness(database)
    );
    const pending = { status: "pending" };
    const cancelled = { status: "cancellation_requested" };

    await storage.put("execution", pending);

    await expect(
      storage.compareAndSet("execution", pending, cancelled)
    ).resolves.toBe(true);
    await expect(
      storage.compareAndSet("execution", pending, { status: "completed" })
    ).resolves.toBe(false);
    await expect(storage.get("execution")).resolves.toEqual(cancelled);
  });

  it("atomically replaces an expiring record without dropping its retention", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const storage = createRemoteAgentSqlStorage(
      createCloudflareSqlHarness(database)
    );
    const first = { callCount: 1 };
    const second = { callCount: 2 };

    await storage.putExpiring("tool-progress", first, 20_000);
    await expect(
      storage.compareAndSetExpiring("tool-progress", first, second, 30_000)
    ).resolves.toBe(true);
    expect(
      database
        .prepare(
          `SELECT expires_at_ms FROM ${TABLE_NAME} WHERE key = ? LIMIT 1`
        )
        .get("tool-progress")
    ).toEqual({ expires_at_ms: 30_000 });
    await expect(
      storage.compareAndSetExpiring(
        "tool-progress",
        first,
        { callCount: 3 },
        40_000
      )
    ).resolves.toBe(false);
    await expect(storage.get("tool-progress")).resolves.toEqual(second);
  });
});

function createCloudflareSqlHarness(database: DatabaseSync) {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = database.prepare(query);
      if (returnsRows(statement, query)) {
        const rows = statement.all(...(bindings as never[])) as Record<
          string,
          unknown
        >[];
        return { rowsWritten: 0, toArray: () => rows };
      }
      const result = statement.run(...(bindings as never[]));
      return {
        rowsWritten: Number(result.changes),
        toArray: () => [] as Record<string, unknown>[],
      };
    },
  };
}

function returnsRows(_statement: StatementSync, query: string): boolean {
  return ROW_RETURNING_SQL_PATTERN.test(query);
}
