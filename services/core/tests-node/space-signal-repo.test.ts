import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  listLatestFormalSignalCandidateEntriesPage,
  readAgentReplyObservationState,
  runAgentReplyObservationGuardedTransaction,
} from "../src/space/infrastructure/sql/space-signal-repo";

describe("space-signal-repo", () => {
  it("reads latest formal-update candidates through a bounded cursor page", () => {
    const exec = vi.fn((_sql: string, ..._params: SqlStorageValue[]) => ({
      toArray: () => [
        {
          id: "sig-2",
          payload_json: '{"id":"sig-2"}',
          ts: 200,
        },
        {
          id: "sig-1",
          payload_json: '{"id":"sig-1"}',
          ts: 100,
        },
      ],
    }));

    const page = listLatestFormalSignalCandidateEntriesPage(
      { exec } as unknown as SqlStorage,
      {
        before: { id: "sig-3", ts: 300 },
        limit: 2,
      }
    );

    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0]?.[0]).toContain("LIMIT ?");
    expect(exec.mock.calls[0]?.slice(1)).toEqual([300, 300, "sig-3", 2]);
    expect(page).toEqual({
      entries: [
        ["1970-01-01T00:00:00.200Z|sig-2", '{"id":"sig-2"}'],
        ["1970-01-01T00:00:00.100Z|sig-1", '{"id":"sig-1"}'],
      ],
      nextCursor: { id: "sig-1", ts: 100 },
    });
  });

  it("fails closed when the observation anchor belongs to another scope", () => {
    const harness = createObservationSqlHarness();
    try {
      harness.insertSignal("source-main", 1);
      harness.insertSignal("source-thread-1", 2, "thread-1");
      harness.insertSignal("source-thread-2", 3, "thread-2");

      expect(
        readAgentReplyObservationState(harness.sql, {
          observedThroughSignalId: "source-thread-2",
          threadId: "thread-1",
        })
      ).toBe("anchor_missing");
      expect(
        readAgentReplyObservationState(harness.sql, {
          observedThroughSignalId: "source-thread-1",
          threadId: null,
        })
      ).toBe("anchor_missing");
      expect(
        readAgentReplyObservationState(harness.sql, {
          observedThroughSignalId: "source-main",
          threadId: "thread-1",
        })
      ).toBe("anchor_missing");
    } finally {
      harness.close();
    }
  });

  it("detects newer collaboration messages only in the anchor's scope", () => {
    const harness = createObservationSqlHarness();
    try {
      harness.insertSignal("source-main", 1);
      harness.insertSignal("other-thread", 2, "thread-2");
      expect(
        readAgentReplyObservationState(harness.sql, {
          observedThroughSignalId: "source-main",
          threadId: null,
        })
      ).toBe("current");

      harness.insertSignal("later-main", 3);
      expect(
        readAgentReplyObservationState(harness.sql, {
          observedThroughSignalId: "source-main",
          threadId: null,
        })
      ).toBe("changed");

      harness.insertSignal("source-thread", 4, "thread-1");
      harness.insertSignal("later-other-thread", 5, "thread-2");
      expect(
        readAgentReplyObservationState(harness.sql, {
          observedThroughSignalId: "source-thread",
          threadId: "thread-1",
        })
      ).toBe("current");

      harness.insertSignal("later-same-thread", 6, "thread-1");
      expect(
        readAgentReplyObservationState(harness.sql, {
          observedThroughSignalId: "source-thread",
          threadId: "thread-1",
        })
      ).toBe("changed");
    } finally {
      harness.close();
    }
  });

  it.each([
    10, 20,
  ])("lets only one of %i same-cursor replies pass the real SQLite observation guard", (agentCount) => {
    const harness = createObservationSqlHarness();
    try {
      harness.insertSignal("source-main", 1);
      const outcomes = Array.from({ length: agentCount }, (_, index) => {
        const result = runAgentReplyObservationGuardedTransaction({
          observation: {
            observedThroughSignalId: "source-main",
            threadId: null,
          },
          operation: () => {
            harness.insertSignal(`agent-reply-${index + 1}`, index + 2);
          },
          storage: harness.storage,
        });
        return result.status;
      });

      expect(outcomes.filter((state) => state === "committed")).toHaveLength(1);
      expect(outcomes.filter((state) => state === "changed")).toHaveLength(
        agentCount - 1
      );
    } finally {
      harness.close();
    }
  });

  it("fails closed without the synchronous transaction owner", () => {
    const harness = createObservationSqlHarness();
    let writeCount = 0;
    try {
      expect(() =>
        runAgentReplyObservationGuardedTransaction({
          observation: {
            observedThroughSignalId: "source-main",
            threadId: null,
          },
          operation: () => {
            writeCount += 1;
          },
          storage: { sql: harness.sql } as never,
        })
      ).toThrow("agent reply publication requires transactionSync");
      expect(writeCount).toBe(0);
    } finally {
      harness.close();
    }
  });
});

function createObservationSqlHarness(): {
  close(): void;
  database: DatabaseSync;
  insertSignal(id: string, ts: number, threadId?: string): void;
  sql: SqlStorage;
  storage: {
    sql: SqlStorage;
    transactionSync<T>(closure: () => T): T;
  };
} {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE space_signals (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      profile_id TEXT NULL,
      profile_kind TEXT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE space_thread_signal_placements (
      signal_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      placement TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
  `);
  const sql = new SqliteSqlStorage(database) as unknown as SqlStorage;
  return {
    close: () => database.close(),
    database,
    insertSignal: (id, ts, threadId) => {
      database
        .prepare(
          `INSERT INTO space_signals (
            id, ts, type, profile_id, profile_kind, payload_json
          ) VALUES (?, ?, 'signal.text', ?, 'agent', ?)`
        )
        .run(
          id,
          ts,
          `profile-${id}`,
          JSON.stringify({ data: { text: id }, id, type: "signal.text" })
        );
      if (threadId) {
        database
          .prepare(
            `INSERT INTO space_thread_signal_placements (
              signal_id, thread_id, placement, created_at_ms
            ) VALUES (?, ?, 'thread', ?)`
          )
          .run(id, threadId, ts);
      }
    },
    sql,
    storage: {
      sql,
      transactionSync: <T>(closure: () => T): T => {
        database.exec("BEGIN IMMEDIATE");
        try {
          const result = closure();
          database.exec("COMMIT");
          return result;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

class SqliteSqlCursor<T extends Record<string, unknown>> {
  private index = 0;
  private readonly rows: T[];
  readonly rowsWritten: number;

  constructor(rows: T[], rowsWritten = 0) {
    this.rows = rows;
    this.rowsWritten = rowsWritten;
  }

  next(): IteratorResult<T> {
    const value = this.rows[this.index];
    if (!value) {
      return { done: true, value: undefined as never };
    }
    this.index += 1;
    return { done: false, value };
  }

  toArray(): T[] {
    return [...this.rows];
  }
}

class SqliteSqlStorage {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  exec<T extends Record<string, unknown>>(
    sql: string,
    ...params: SqlStorageValue[]
  ): SqliteSqlCursor<T> {
    const statement = this.database.prepare(sql);
    if (sql.trimStart().toUpperCase().startsWith("WITH")) {
      return new SqliteSqlCursor(
        statement.all(...toSqliteParams(params)) as T[]
      );
    }
    const result = (statement as StatementSync).run(...toSqliteParams(params));
    return new SqliteSqlCursor<T>([], Number(result.changes));
  }
}

function toSqliteParams(
  params: readonly SqlStorageValue[]
): (string | number | null)[] {
  return params.map((param) => {
    if (
      typeof param === "string" ||
      typeof param === "number" ||
      param === null
    ) {
      return param;
    }
    throw new Error("unsupported SQLite test parameter");
  });
}
