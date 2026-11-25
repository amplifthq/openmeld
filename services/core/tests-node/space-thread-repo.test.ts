import { DatabaseSync, type StatementSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  listSpaceRequestRootSignalIds,
  listSpaceThreadPreviewEntries,
  listSpaceThreadSignalPlacementsAfter,
  listSpaceThreadSignalPlacementsBefore,
  readLatestExplicitThreadWake,
  readThreadParticipants,
} from "../src/space/infrastructure/sql/space-thread-repo";

describe("space-thread-repo", () => {
  it("bounds rollover evidence to the root and its Thread without treating quotations as membership", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE space_signals (id TEXT PRIMARY KEY, type TEXT, payload_json TEXT);
        CREATE TABLE space_threads (thread_id TEXT PRIMARY KEY, root_signal_id TEXT);
        CREATE TABLE space_thread_signal_placements (signal_id TEXT PRIMARY KEY, thread_id TEXT);`);
      const add = (
        id: string,
        data: Record<string, unknown> = {},
        type = "signal.text"
      ) => {
        db.prepare("INSERT INTO space_signals VALUES (?, ?, ?)").run(
          id,
          type,
          JSON.stringify({ data })
        );
      };
      add("unrelated-before");
      add("walkthrough");
      add("circle");
      add("walkthrough-main", {
        messageEnvelope: { replyToSignalId: "walkthrough" },
      });
      add("circle-reply", { messageEnvelope: { replyToSignalId: "circle" } });
      add("walkthrough-legacy", { replyTo: { signalId: "walkthrough" } });
      add("walkthrough-thread");
      add("noise", {}, "signal.status");
      db.prepare("INSERT INTO space_threads VALUES (?, ?)").run(
        "thread-walkthrough",
        "walkthrough"
      );
      db.prepare(
        "INSERT INTO space_thread_signal_placements VALUES (?, ?)"
      ).run("walkthrough-thread", "thread-walkthrough");
      const sql = new SqliteSqlStorage(db) as unknown as SqlStorage;
      const selection = {
        rootSignalId: "walkthrough",
        limit: 20,
        signalTypes: ["signal.text"],
      };
      expect(listSpaceRequestRootSignalIds(sql, selection)).toEqual([
        "walkthrough",
        "walkthrough-thread",
      ]);
      expect(
        listSpaceRequestRootSignalIds(sql, { ...selection, limit: 2 })
      ).toEqual(["walkthrough", "walkthrough-thread"]);
    } finally {
      db.close();
    }
  });
  it("finds the last human selection across pages without following Agent replies or automatic continuations", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "CREATE TABLE space_signals (id TEXT PRIMARY KEY, payload_json TEXT); CREATE TABLE space_thread_signal_placements (signal_id TEXT PRIMARY KEY, thread_id TEXT);"
      );
      const add = (
        id: string,
        kind: string,
        targets: string[],
        automatic = false,
        thread = "thread"
      ) => {
        db.prepare("INSERT INTO space_signals VALUES (?, ?)").run(
          id,
          JSON.stringify({
            id,
            type: "signal.text",
            profile: { kind, profileId: kind === "agent" ? "A" : "H" },
            data: {
              messageEnvelope: { activationTargets: targets },
              meta: { threadWakeContinuation: automatic },
            },
          })
        );
        db.prepare(
          "INSERT INTO space_thread_signal_placements VALUES (?, ?)"
        ).run(id, thread);
      };
      add("first", "human", ["A"]);
      add("switch", "human", ["B"]);
      add("agent", "agent", ["C"]);
      add("automatic", "human", ["A"], true);
      add("other", "human", ["C"], false, "other-thread");
      const sql = new SqliteSqlStorage(db) as unknown as SqlStorage;
      expect(readThreadParticipants(sql, "thread")).toEqual([
        { profileId: "H", kind: "human" },
        { profileId: "A", kind: "agent" },
      ]);
      expect(
        JSON.parse(readLatestExplicitThreadWake(sql, "thread") ?? "null").id
      ).toBe("switch");
      add("multi", "human", ["A", "B"]);
      expect(
        JSON.parse(readLatestExplicitThreadWake(sql, "thread") ?? "null").id
      ).toBe("multi");
    } finally {
      db.close();
    }
  });
  it("retains reply placements but reads only the latest two preview bodies per thread, excluding edit notices", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "CREATE TABLE space_signals (id TEXT PRIMARY KEY, payload_json TEXT); CREATE TABLE space_thread_signal_placements (signal_id TEXT PRIMARY KEY, thread_id TEXT, placement TEXT, created_at_ms INTEGER);"
      );
      for (let i = 0; i < 100; i++) {
        const id = `sig-${i}`;
        db.prepare("INSERT INTO space_signals VALUES (?, ?)").run(
          id,
          JSON.stringify({
            id,
            type: "signal.text",
            profile: { kind: i === 0 ? "system" : "human" },
            data: {
              text: "x".repeat(4096),
              ...(i === 0
                ? { meta: { purpose: "space_message_changed" } }
                : {}),
            },
          })
        );
        db.prepare(
          "INSERT INTO space_thread_signal_placements VALUES (?, ?, 'thread', ?)"
        ).run(id, i < 50 ? "thread-a" : "thread-b", i);
      }
      const entries = listSpaceThreadPreviewEntries(
        new SqliteSqlStorage(db) as unknown as SqlStorage
      );
      expect(entries).toHaveLength(99);
      expect(
        entries
          .filter((entry) => entry.payloadJson !== null)
          .map((entry) => entry.placement.signalId)
      ).toEqual(["sig-48", "sig-49", "sig-98", "sig-99"]);
      expect(entries.at(-1)?.placement.signalId).toBe("sig-99");
    } finally {
      db.close();
    }
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
        signalTypes: ["signal.text"],
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
          signalTypes: ["signal.text"],
          threadId: "thread-1",
        })
      ).toBeNull();
    } finally {
      harness.close();
    }
  });

  it("applies signal type filters before bounding thread history", () => {
    const harness = createSqlStorageHarness();
    try {
      harness.insertPlacement("text-1", "thread-1", 1);
      harness.insertPlacement("status", "thread-1", 2, "signal.status");
      harness.insertPlacement("text-2", "thread-1", 3);
      harness.insertPlacement("source", "thread-1", 4);

      const placements = listSpaceThreadSignalPlacementsBefore(harness.sql, {
        beforeSignalId: "source",
        limit: 2,
        signalTypes: ["signal.text"],
        threadId: "thread-1",
      });

      expect(placements?.map((placement) => placement.signalId)).toEqual([
        "text-1",
        "text-2",
      ]);
    } finally {
      harness.close();
    }
  });
});

function createSqlStorageHarness(): {
  close(): void;
  insertPlacement(
    signalId: string,
    threadId: string,
    ts: number,
    signalType?: string
  ): void;
  sql: SqlStorage;
} {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE space_signals (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL
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
    insertPlacement: (signalId, threadId, ts, signalType = "signal.text") => {
      database
        .prepare("INSERT INTO space_signals (id, ts, type) VALUES (?, ?, ?)")
        .run(signalId, ts, signalType);
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
