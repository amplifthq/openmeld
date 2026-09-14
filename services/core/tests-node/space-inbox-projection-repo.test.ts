import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  insertSpaceInboxProjectionOutboxRecord,
  listDueSpaceInboxProjectionOutboxRecords,
  type SpaceInboxProjectionOutboxRecord,
} from "../src/space/infrastructure/sql/space-inbox-projection-outbox-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

describe("Space Inbox event persistence", () => {
  it("upgrades existing outboxes without losing publication and stores each reaction once", () => {
    const db = new DatabaseSync(":memory:");
    const sql = {
      exec: (query: string, ...params: (string | number | null)[]) => {
        const rows = db.prepare(query).all(...params);
        const iterator = rows[Symbol.iterator]();
        return {
          next: () => iterator.next(),
          toArray: () => rows,
          rowsWritten: Number(
            db.prepare("SELECT changes() AS n").get()?.n ?? 0
          ),
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      },
    } as unknown as SqlStorage;
    const record = (
      projectionId: string
    ): SpaceInboxProjectionOutboxRecord => ({
      projectionId,
      signalId: "message",
      spaceId: "space",
      candidates: [],
      status: "pending",
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAtMs: null,
      completedAtMs: null,
      createdAtMs: 100,
      updatedAtMs: 100,
    });
    try {
      ensureSpaceSqlSchema(sql);
      insertSpaceInboxProjectionOutboxRecord(sql, record("message"));
      db.exec("DELETE FROM schema_migrations WHERE version >= 40");
      db.exec(
        "CREATE UNIQUE INDEX idx_space_inbox_projection_outbox_signal_id ON space_inbox_projection_outbox (signal_id)"
      );
      ensureSpaceSqlSchema(sql);
      expect(
        insertSpaceInboxProjectionOutboxRecord(
          sql,
          record("reaction:message:1")
        )
      ).toBe(true);
      expect(
        insertSpaceInboxProjectionOutboxRecord(
          sql,
          record("reaction:message:1")
        )
      ).toBe(false);
      expect(
        insertSpaceInboxProjectionOutboxRecord(
          sql,
          record("reaction:message:2")
        )
      ).toBe(true);
      expect(
        listDueSpaceInboxProjectionOutboxRecords(sql, {
          limit: 10,
          nowMs: 100,
        }).map((item) => item.projectionId)
      ).toEqual(["message", "reaction:message:1", "reaction:message:2"]);
      ensureSpaceSqlSchema(sql);
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM space_inbox_projection_outbox")
          .get()?.n
      ).toBe(3);
    } finally {
      db.close();
    }
  });
});
