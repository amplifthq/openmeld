import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  listSpaceMessagePins,
  mutateSpaceMessagePin,
} from "../src/space/infrastructure/sql/space-message-pin-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

describe("Space message pin ownership", () => {
  it("upgrades a v33 Space and preserves the pinner across retries and other members", () => {
    const db = new DatabaseSync(":memory:");
    const sql = {
      exec: (query: string, ...params: (string | number | null)[]) => {
        const rows = db.prepare(query).all(...params);
        const iterator = rows[Symbol.iterator]();
        return {
          ...iterator,
          next: () => iterator.next(),
          toArray: () => rows,
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      },
    } as unknown as SqlStorage;
    try {
      ensureSpaceSqlSchema(sql);
      db.exec("DROP TABLE space_message_pins");
      db.exec("DELETE FROM schema_migrations WHERE version >= 34");
      db.exec(
        "INSERT OR IGNORE INTO schema_migrations (version, checksum, applied_at) VALUES (33, 'space-sql-schema-v33', 0)"
      );
      // The prior migration marker must not skip creation of the new table.
      ensureSpaceSqlSchema(sql);
      const original = {
        signalId: "message-a",
        pinnedByProfileId: "alice",
        pinnedAt: "2026-09-10T00:00:00.000Z",
        action: "pin" as const,
      };
      expect(mutateSpaceMessagePin(sql, original)).toBe("ok");
      mutateSpaceMessagePin(sql, {
        ...original,
        pinnedByProfileId: "bob",
        pinnedAt: "2026-09-11T00:00:00.000Z",
      });
      expect(listSpaceMessagePins(sql)).toEqual([
        {
          signalId: original.signalId,
          pinnedByProfileId: "alice",
          pinnedAt: original.pinnedAt,
        },
      ]);
      expect(
        mutateSpaceMessagePin(sql, {
          ...original,
          action: "unpin",
          pinnedByProfileId: "bob",
        })
      ).toBe("forbidden");
      expect(listSpaceMessagePins(sql)).toHaveLength(1);
      expect(mutateSpaceMessagePin(sql, { ...original, action: "unpin" })).toBe(
        "ok"
      );
      expect(listSpaceMessagePins(sql)).toEqual([]);
      expect(mutateSpaceMessagePin(sql, { ...original, action: "unpin" })).toBe(
        "ok"
      );
    } finally {
      db.close();
    }
  });
});
