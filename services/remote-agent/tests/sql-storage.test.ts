import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { MessageReadPage } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { executeMessageRead } from "../agent-core/message-read-tools";
import {
  cleanupExpiredRemoteAgentSubmissionReceipts,
  REMOTE_AGENT_SUBMISSION_RECEIPT_CLEANUP_BATCH_SIZE,
} from "../agent-core/submission";
import {
  createRemoteAgentReadToolResultDefinition,
  prepareRemoteAgentToolResult,
} from "../flue-adapter/retained-tool-results";
import { createRemoteAgentSqlStorage } from "../flue-adapter/storage";
import { executionAccessFixture } from "./execution-access-fixture";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";

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

  it("creates and resumes a message-read checkpoint in real SQLite storage", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const storage = createRemoteAgentSqlStorage(
      createCloudflareSqlHarness(database)
    );
    const request = createSubmitTurnRequest();
    const submissionId = "sqlite-message-read";
    const context = createRemoteAgentCallbackContext({
      request,
      nowMs: TEST_NOW_MS,
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: submissionId,
        status: "pending",
        submissionId,
      },
    });
    await putRemoteAgentCallbackContext(storage, context);
    const input = {
      storage,
      submissionId,
      coreWorker: {
        authorizeRemoteAgentExecutionAccess: executionAccessFixture(context),
        remoteAgentReadMessages: async (): Promise<MessageReadPage> => ({
          matches: [],
          nextCursor: null,
          pageCursor: "saved-position",
          indexing: false,
          requestedCount: 200,
          returnedCount: 0,
          completeCount: 0,
          limitBytes: 4096,
          order: "space_then_newest",
          coverage: "complete",
        }),
      },
    };
    const first = await executeMessageRead(input, {
      spaceId: "space-1",
      limit: 200,
      maxBytes: 4096,
    });
    expect(first).toMatchObject({ replayed: false, coverage: "complete" });
    const resumed = await executeMessageRead(input, {
      resumeId: first.resumeId,
    });
    expect(resumed).toMatchObject({
      resumeId: first.resumeId,
      replayed: true,
      deliveredCount: 0,
    });
  });

  it("retains and searches the first large result in real SQLite storage", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const storage = createRemoteAgentSqlStorage(
      createCloudflareSqlHarness(database)
    );
    const request = createSubmitTurnRequest();
    const submissionId = "sqlite-retention";
    const context = createRemoteAgentCallbackContext({
      request,
      nowMs: TEST_NOW_MS,
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: submissionId,
        status: "pending",
        submissionId,
      },
    });
    await putRemoteAgentCallbackContext(storage, context);
    const input = {
      storage,
      submissionId,
      coreWorker: {
        authorizeRemoteAgentExecutionAccess: executionAccessFixture(context),
      },
    };
    const result = await prepareRemoteAgentToolResult({
      ...input,
      toolName: "computer_command",
      value: { stdout: `${"x".repeat(40_000)}SQLITE_RETAINED_MARKER` },
    });
    const reference = (
      result as { presentation: { continuation: { resultId: string } | null } }
    ).presentation.continuation;
    expect(reference).not.toBeNull();
    const read = await createRemoteAgentReadToolResultDefinition(input).execute(
      { resultId: reference?.resultId, query: "SQLITE_RETAINED_MARKER" }
    );
    expect(JSON.stringify(read)).toContain("SQLITE_RETAINED_MARKER");
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

  it("commits an owner and its metadata together, rejecting either stale value and rolling back SQL failures", async () => {
    const database = new DatabaseSync(":memory:");
    databases.push(database);
    const storage = createRemoteAgentSqlStorage(
      createCloudflareSqlHarness(database)
    );
    const owner = {
      key: "owner",
      expectedValue: { status: "running" },
      nextValue: { status: "completed" },
    };
    const metadata = {
      key: "callback",
      expectedValue: { modelId: null as string | null },
      nextValue: { modelId: "actual/model" },
    };
    await storage.put(owner.key, owner.expectedValue);
    await storage.put(metadata.key, metadata.expectedValue);
    expect(
      await storage.compareAndSetPair(owner, {
        ...metadata,
        expectedValue: { modelId: "stale" },
      })
    ).toBe(false);
    expect(await storage.get(owner.key)).toEqual(owner.expectedValue);
    expect(await storage.get(metadata.key)).toEqual(metadata.expectedValue);
    expect(await storage.compareAndSetPair(owner, metadata)).toBe(true);
    expect(await storage.compareAndSetPair(owner, metadata)).toBe(false);
    expect(await storage.get(owner.key)).toEqual(owner.nextValue);
    expect(await storage.get(metadata.key)).toEqual(metadata.nextValue);
    expect(() => storage.compareAndSetPair(owner, owner)).toThrow(
      "distinct keys"
    );

    await storage.put(owner.key, owner.expectedValue);
    await storage.put(metadata.key, metadata.expectedValue);
    database.exec(`CREATE TRIGGER reject_callback BEFORE UPDATE ON ${TABLE_NAME}
      WHEN NEW.key = 'callback' BEGIN SELECT RAISE(ABORT, 'controlled metadata write failure'); END`);
    expect(() => storage.compareAndSetPair(owner, metadata)).toThrow(
      "controlled metadata write failure"
    );
    expect(await storage.get(owner.key)).toEqual(owner.expectedValue);
    expect(await storage.get(metadata.key)).toEqual(metadata.expectedValue);
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
