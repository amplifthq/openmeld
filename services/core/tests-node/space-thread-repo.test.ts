import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  listSpaceThreadPreviewEntries,
  listSpaceThreadSignalPlacementsAfter,
  listSpaceThreadSignalPlacementsBefore,
} from "../src/space/infrastructure/sql/space-thread-repo";

const JOIN_SPACE_SIGNALS_SQL_REGEX = /JOIN\s+space_signals/i;

describe("space-thread-repo", () => {
  it("loads every thread preview entry with one joined query", () => {
    const createdAtMs = Date.parse("2026-07-16T03:15:00.000Z");
    const exec = vi.fn((_sql: string, ..._params: SqlStorageValue[]) => ({
      toArray: () => [
        {
          created_at_ms: createdAtMs,
          payload_json: '{"id":"sig-1"}',
          placement: "thread",
          signal_id: "sig-1",
          thread_id: "thr-1",
        },
        {
          created_at_ms: createdAtMs + 1,
          payload_json: '{"id":"sig-2"}',
          placement: "thread",
          signal_id: "sig-2",
          thread_id: "thr-2",
        },
      ],
    }));

    const entries = listSpaceThreadPreviewEntries({
      exec,
    } as unknown as SqlStorage);

    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0]?.[0]).toMatch(JOIN_SPACE_SIGNALS_SQL_REGEX);
    expect(entries).toEqual([
      {
        payloadJson: '{"id":"sig-1"}',
        placement: {
          createdAt: "2026-07-16T03:15:00.000Z",
          placement: "thread",
          signalId: "sig-1",
          threadId: "thr-1",
        },
      },
      {
        payloadJson: '{"id":"sig-2"}',
        placement: {
          createdAt: "2026-07-16T03:15:00.001Z",
          placement: "thread",
          signalId: "sig-2",
          threadId: "thr-2",
        },
      },
    ]);
  });

  it("reads only a bounded same-thread page after the source signal", () => {
    const harness = createSqlStorageHarness();
    try {
      harness.insertPlacement("source", "thread-1", 1);
      harness.insertPlacement("same-1", "thread-1", 2);
      harness.insertPlacement("other", "thread-2", 3);
      harness.insertPlacement("same-2", "thread-1", 4);
      harness.insertPlacement("same-3", "thread-1", 5);

      const placements = listSpaceThreadSignalPlacementsAfter(harness.sql, {
        afterSignalId: "source",
        limit: 2,
        threadId: "thread-1",
      });
      expect(placements?.map((placement) => placement.signalId)).toEqual([
        "same-1",
        "same-2",
      ]);
      expect(
        listSpaceThreadSignalPlacementsAfter(harness.sql, {
          afterSignalId: "other",
          limit: 2,
          threadId: "thread-1",
        })
      ).toBeNull();
    } finally {
      harness.close();
    }
  });

  it("reads only the bounded same-thread history before the source signal", () => {
    const harness = createSqlStorageHarness();
    try {
      harness.insertPlacement("same-1", "thread-1", 1);
      harness.insertPlacement("other", "thread-2", 2);
      harness.insertPlacement("same-2", "thread-1", 3);
      harness.insertPlacement("source", "thread-1", 4);
      harness.insertPlacement("later", "thread-1", 5);

      const placements = listSpaceThreadSignalPlacementsBefore(harness.sql, {
        beforeSignalId: "source",
        limit: 2,
        threadId: "thread-1",
      });

      expect(placements?.map((placement) => placement.signalId)).toEqual([
        "same-1",
        "same-2",
      ]);
      expect(
        listSpaceThreadSignalPlacementsBefore(harness.sql, {
          beforeSignalId: "other",
          limit: 2,
          threadId: "thread-1",
        })
      ).toBeNull();
    } finally {
      harness.close();
    }
  });
});

function createSqlStorageHarness(): {
  close(): void;
  insertPlacement(signalId: string, threadId: string, ts: number): void;
  sql: SqlStorage;
} {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE space_signals (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
    CREATE TABLE space_thread_signal_placements (
      signal_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      placement TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
  `);
  return {
    close: () => database.close(),
    insertPlacement: (signalId, threadId, ts) => {
      database
        .prepare("INSERT INTO space_signals (id, ts) VALUES (?, ?)")
        .run(signalId, ts);
      database
        .prepare(
          `INSERT INTO space_thread_signal_placements (
            signal_id, thread_id, placement, created_at_ms
          ) VALUES (?, ?, 'thread', ?)`
        )
        .run(signalId, threadId, ts);
    },
    sql: new SqliteSqlStorage(database) as unknown as SqlStorage,
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
    if (
      ["SELECT", "WITH", "PRAGMA"].some((prefix) =>
        sql.trimStart().toUpperCase().startsWith(prefix)
      )
    ) {
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
