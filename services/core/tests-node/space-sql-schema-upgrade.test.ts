import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readSpaceMetaRecordFromSql } from "../src/space/infrastructure/sql/space-meta-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

describe("Existing Space schema upgrades", () => {
  it("upgrades an intact v51 Space without losing its metadata or messages", () => {
    const db = new DatabaseSync(":memory:");
    const sql = {
      exec(query: string, ...params: (string | number | null)[]) {
        const statement = db.prepare(query);
        if (!statement.columns().length) {
          statement.run(...params);
          return { toArray: () => [], next: () => ({ done: true }) };
        }
        const rows = statement.all(...params);
        const iterator = rows[Symbol.iterator]();
        return { toArray: () => rows, next: () => iterator.next() };
      },
    } as unknown as SqlStorage;
    try {
      // This is the persisted v51 shape from before Space deletion support.
      // Its valid migration marker must not bypass the new column upgrade.
      db.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
        );
        INSERT INTO schema_migrations VALUES (51, 'space-sql-schema-v51', 1700000000000);
        CREATE TABLE space_meta (
          space_id TEXT PRIMARY KEY, name TEXT, purpose TEXT,
          direct_message_json TEXT, creator_json TEXT,
          organization_id TEXT NOT NULL, organization_visibility TEXT NOT NULL,
          guide TEXT, access_mode TEXT, link_join_policy TEXT,
          password_proof_json TEXT, archive_cursor_ts INTEGER,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          owner_user_ids_json TEXT NOT NULL DEFAULT '[]',
          allow_guests INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO space_meta (space_id, name, organization_id, organization_visibility,
          guide, access_mode, link_join_policy, created_at, updated_at)
        VALUES ('legacy-space', 'Release check', 'organization', 'private',
          'Keep original history', 'members_only', 'invite_only', 1700000000000, 1700000000000);
        CREATE TABLE space_signals (
          id TEXT PRIMARY KEY, ts INTEGER NOT NULL, type TEXT NOT NULL,
          profile_id TEXT, profile_kind TEXT, client_message_id TEXT, payload_json TEXT NOT NULL
        );
        INSERT INTO space_signals VALUES ('original-message', 1700000000000,
          'signal.text', 'human', 'human', NULL, '{"text":"Original history"}');
      `);
      expect(() => readSpaceMetaRecordFromSql(sql, "legacy-space")).toThrow(
        "no such column: deleted_at"
      );
      const messagesBefore = db.prepare("SELECT * FROM space_signals").all();

      ensureSpaceSqlSchema(sql);
      expect(readSpaceMetaRecordFromSql(sql, "legacy-space")).toMatchObject({
        name: "Release check",
        guide: "Keep original history",
        visibility: "private",
        accessMode: "members_only",
      });
      expect(
        db.prepare("SELECT deleted_at FROM space_meta").get()?.deleted_at
      ).toBeNull();
      expect(db.prepare("SELECT * FROM space_signals").all()).toEqual(
        messagesBefore
      );
      expect(
        db
          .prepare("SELECT checksum FROM schema_migrations WHERE version = 51")
          .get()
      ).toEqual({ checksum: "space-sql-schema-v51" });

      db.exec("UPDATE space_meta SET deleted_at = 1700000001000");
      const migrations = db
        .prepare("SELECT * FROM schema_migrations ORDER BY version")
        .all();
      ensureSpaceSqlSchema(sql);
      expect(readSpaceMetaRecordFromSql(sql, "legacy-space")?.deletedAt).toBe(
        "2023-11-14T22:13:21.000Z"
      );
      expect(
        db.prepare("SELECT * FROM schema_migrations ORDER BY version").all()
      ).toEqual(migrations);
      expect(db.prepare("SELECT * FROM space_signals").all()).toEqual(
        messagesBefore
      );
    } finally {
      db.close();
    }
  });
});
