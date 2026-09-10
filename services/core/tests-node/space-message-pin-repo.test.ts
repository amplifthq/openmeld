import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  listSpaceMessagePins,
  mutateSpaceMessagePin,
} from "../src/space/infrastructure/sql/space-message-pin-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

describe("Space message pin ownership", () => {
  it.each([
    33, 34, 35,
  ])("upgrades a v%s Space with all batch tables and preserves existing pins", (version) => {
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
      db.exec("DROP TABLE space_recalled_message_drafts");
      db.exec("DROP TABLE space_message_reactions");
      db.exec("DROP TABLE space_message_reaction_versions");
      db.exec(
        "INSERT INTO space_file_pins VALUES ('existing-file', 'alice', '2026-09-10')"
      );
      db.exec("DELETE FROM schema_migrations WHERE version >= 34");
      db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, 0)"
      ).run(version, `space-sql-schema-v${version}`);
      // The prior migration marker must not skip creation of the new table.
      ensureSpaceSqlSchema(sql);
      ensureSpaceSqlSchema(sql);
      for (const table of [
        "space_message_pins",
        "space_file_pins",
        "space_recalled_message_drafts",
        "space_message_reactions",
        "space_message_reaction_versions",
      ]) {
        expect(
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
            )
            .get(table)
        ).toBeDefined();
      }
      expect(db.prepare("SELECT signal_id FROM space_file_pins").all()).toEqual(
        [{ signal_id: "existing-file" }]
      );
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
