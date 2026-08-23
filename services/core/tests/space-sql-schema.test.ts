import { describe, expect, it } from "vitest";
import {
  ensureSpaceSqlSchema,
  SPACE_SQL_SCHEMA_CHECKSUM,
  SPACE_SQL_SCHEMA_VERSION,
} from "../src/space/infrastructure/sql/space-schema-repo";

class FakeSqlCursor<T extends Record<string, unknown>> {
  private readonly rows: T[];
  private index = 0;

  constructor(rows: T[] = []) {
    this.rows = rows;
  }

  next(): IteratorResult<T> {
    if (this.index >= this.rows.length) {
      return { done: true, value: undefined as never };
    }

    const value = this.rows[this.index] as T;
    this.index += 1;
    return { done: false, value };
  }

  toArray(): T[] {
    return [...this.rows];
  }
}

class FakeSqlStorage {
  readonly calls: { sql: string; params: unknown[] }[] = [];

  exec<T extends Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): FakeSqlCursor<T> {
    this.calls.push({ sql, params });
    return new FakeSqlCursor<T>();
  }
}

describe("space-sql-schema", () => {
  it("creates required tables/indexes and inserts migration marker", () => {
    const sql = new FakeSqlStorage();

    ensureSpaceSqlSchema(sql as unknown as SqlStorage);

    const allSql = sql.calls.map((call) => call.sql).join("\n");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_meta");
    expect(allSql).toContain(
      "CREATE TABLE IF NOT EXISTS space_client_message_rejections"
    );
    expect(allSql).toContain("organization_id TEXT NOT NULL");
    expect(allSql).toContain("organization_visibility TEXT NOT NULL");
    expect(allSql).toContain(
      "CHECK (organization_visibility IN ('public', 'private'))"
    );
    expect(allSql).toContain("purpose TEXT NULL");
    expect(allSql).toContain("password_proof_json TEXT NULL");
    expect(allSql).toContain("ALTER TABLE space_meta");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_cursors");
    expect(allSql).toContain("mention_alias TEXT NULL");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_signals");
    expect(allSql).toContain(
      "CREATE TABLE IF NOT EXISTS space_final_reply_claims"
    );
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_members");
    expect(allSql).toContain("member_source TEXT NOT NULL");
    expect(allSql).toContain(
      "CREATE TABLE IF NOT EXISTS openMeldDaemon_outbox"
    );
    expect(allSql).toContain("poison_failure_count INTEGER NOT NULL DEFAULT 0");
    expect(allSql).toContain("poisoned_at_ms INTEGER NULL");
    expect(allSql).toContain("poison_reason_code TEXT NULL");
    expect(allSql).toContain("ALTER TABLE openMeldDaemon_outbox");
    expect(allSql).toContain(
      "CREATE TABLE IF NOT EXISTS space_index_projection_outbox"
    );
    expect(allSql).toContain(
      "CREATE TABLE IF NOT EXISTS space_inbox_projection_outbox"
    );
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_dispatch_rules");
    expect(allSql).toContain(
      "CREATE TABLE IF NOT EXISTS space_dispatch_policies"
    );
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_file_entries");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_file_revisions");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS space_file_mutations");
    expect(allSql).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(allSql).toContain("idx_space_signals_ts_id");
    expect(allSql).toContain("idx_space_signals_profile_ts");
    expect(allSql).toContain("idx_space_signals_type_ts");
    expect(allSql).toContain("idx_space_final_reply_claims_created_at");
    expect(allSql).toContain("idx_space_members_status_added_at");
    expect(allSql).toContain("idx_space_members_updated_at");
    expect(allSql).toContain("idx_openMeldDaemon_outbox_status_created_at");
    expect(allSql).toContain("idx_openMeldDaemon_outbox_idempotency_key");
    expect(allSql).toContain("idx_space_index_projection_outbox_status_retry");
    expect(allSql).toContain("idx_space_index_projection_outbox_space_status");
    expect(allSql).toContain("idx_space_inbox_projection_outbox_status_retry");
    expect(allSql).toContain("idx_space_inbox_projection_outbox_signal_id");
    expect(allSql).toContain("idx_space_dispatch_rules_updated_at");
    expect(allSql).toContain("idx_space_dispatch_policies_updated_at");
    expect(allSql).toContain("idx_space_file_entries_active_parent_name");
    expect(allSql).toContain("idx_space_file_revisions_file_revision");
    expect(allSql).toContain("idx_space_file_mutations_created_at");

    const migrationCall = sql.calls.find((call) =>
      call.sql.includes("INSERT OR IGNORE INTO schema_migrations")
    );
    expect(migrationCall).toBeDefined();
    expect(migrationCall?.params[0]).toBe(SPACE_SQL_SCHEMA_VERSION);
    expect(migrationCall?.params[1]).toBe(SPACE_SQL_SCHEMA_CHECKSUM);
    expect(typeof migrationCall?.params[2]).toBe("number");
  });

  it("is safe to call repeatedly without schema drift", () => {
    const sql = new FakeSqlStorage();
    let migrationApplied = false;
    sql.exec = function exec<T extends Record<string, unknown>>(
      statement: string,
      ...params: unknown[]
    ): FakeSqlCursor<T> {
      this.calls.push({ sql: statement, params });
      if (statement.includes("SELECT checksum FROM schema_migrations")) {
        return new FakeSqlCursor<T>(
          migrationApplied
            ? ([{ checksum: SPACE_SQL_SCHEMA_CHECKSUM }] as unknown as T[])
            : []
        );
      }
      if (statement.includes("INSERT OR IGNORE INTO schema_migrations")) {
        migrationApplied = true;
      }
      return new FakeSqlCursor<T>();
    };

    expect(() => {
      ensureSpaceSqlSchema(sql as unknown as SqlStorage);
      ensureSpaceSqlSchema(sql as unknown as SqlStorage);
    }).not.toThrow();

    const migrationCalls = sql.calls.filter((call) =>
      call.sql.includes("INSERT OR IGNORE INTO schema_migrations")
    );
    expect(migrationCalls).toHaveLength(1);
    expect(
      sql.calls.filter((call) =>
        call.sql.includes("CREATE TABLE IF NOT EXISTS space_meta")
      )
    ).toHaveLength(1);
  });

  it("drops the removed per-space controller conversation table", () => {
    const sql = new FakeSqlStorage();

    ensureSpaceSqlSchema(sql as unknown as SqlStorage);

    const allSql = sql.calls.map((call) => call.sql).join("\n");
    expect(allSql).toContain(
      "DROP TABLE IF EXISTS space_conversation_bindings"
    );
  });

  it("makes legacy Direct Messages private and marks degraded conversations as converted", () => {
    const sql = new FakeSqlStorage();
    sql.exec = function exec<T extends Record<string, unknown>>(
      statement: string,
      ...params: unknown[]
    ): FakeSqlCursor<T> {
      this.calls.push({ sql: statement, params });
      if (
        statement.includes("SELECT space_id, direct_message_json, updated_at")
      ) {
        return new FakeSqlCursor<T>([
          {
            direct_message_json: JSON.stringify({ pairKey: "human:agent" }),
            space_id: "space-legacy-dm",
            updated_at: Date.parse("2026-08-07T12:00:00.000Z"),
          } as unknown as T,
        ]);
      }
      if (statement.includes("SELECT COUNT(*) AS count")) {
        return new FakeSqlCursor<T>([{ count: 3 } as unknown as T]);
      }
      return new FakeSqlCursor<T>();
    };

    ensureSpaceSqlSchema(sql as unknown as SqlStorage);

    const updateCall = sql.calls.find((call) =>
      call.sql.includes("SET access_mode = 'members_only'")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.params).toEqual([
      JSON.stringify({
        pairKey: "human:agent",
        convertedAt: "2026-08-07T12:00:00.000Z",
      }),
      "space-legacy-dm",
    ]);
  });

  it("fails migration when legacy Direct Message metadata is malformed", () => {
    const sql = new FakeSqlStorage();
    sql.exec = function exec<T extends Record<string, unknown>>(
      statement: string,
      ...params: unknown[]
    ): FakeSqlCursor<T> {
      this.calls.push({ sql: statement, params });
      if (
        statement.includes("SELECT space_id, direct_message_json, updated_at")
      ) {
        return new FakeSqlCursor<T>([
          {
            direct_message_json: "{not-json",
            space_id: "space-malformed-dm",
            updated_at: Date.parse("2026-08-07T12:00:00.000Z"),
          } as unknown as T,
        ]);
      }
      return new FakeSqlCursor<T>();
    };

    expect(() => ensureSpaceSqlSchema(sql as unknown as SqlStorage)).toThrow(
      "Cannot migrate Direct Message space-malformed-dm"
    );
    expect(
      sql.calls.some((call) =>
        call.sql.includes("SET access_mode = 'members_only'")
      )
    ).toBe(false);
  });

  it("fails fast when a recorded schema version has a different checksum", () => {
    const sql = new FakeSqlStorage();
    sql.exec = function exec<T extends Record<string, unknown>>(
      statement: string,
      ...params: unknown[]
    ): FakeSqlCursor<T> {
      this.calls.push({ sql: statement, params });
      if (statement.includes("SELECT checksum FROM schema_migrations")) {
        return new FakeSqlCursor<T>([
          { checksum: "unexpected-checksum" } as unknown as T,
        ]);
      }
      return new FakeSqlCursor<T>();
    };

    expect(() => ensureSpaceSqlSchema(sql as unknown as SqlStorage)).toThrow(
      `Space SQL schema checksum mismatch for version ${SPACE_SQL_SCHEMA_VERSION}`
    );
    expect(
      sql.calls.some((call) =>
        call.sql.includes("CREATE TABLE IF NOT EXISTS space_meta")
      )
    ).toBe(false);
  });

  it("adds guide column and backfills it from legacy guidelines", () => {
    const sql = new FakeSqlStorage();
    const createTableInfoRow = <T extends Record<string, unknown>>(
      name: string
    ) => ({ name }) as unknown as T;
    sql.exec = function exec<T extends Record<string, unknown>>(
      statement: string,
      ...params: unknown[]
    ): FakeSqlCursor<T> {
      this.calls.push({ sql: statement, params });
      if (statement === "PRAGMA table_info(space_meta)") {
        return new FakeSqlCursor<T>([
          createTableInfoRow<T>("space_id"),
          createTableInfoRow<T>("name"),
          createTableInfoRow<T>("guidelines"),
          createTableInfoRow<T>("created_at"),
          createTableInfoRow<T>("updated_at"),
        ]);
      }
      if (statement === "PRAGMA table_info(space_cursors)") {
        return new FakeSqlCursor<T>([createTableInfoRow<T>("profile_id")]);
      }
      if (statement.includes("FROM sqlite_master")) {
        return new FakeSqlCursor<T>([]);
      }
      return new FakeSqlCursor<T>([]);
    };

    ensureSpaceSqlSchema(sql as unknown as SqlStorage);

    const allSql = sql.calls.map((call) => call.sql).join("\n");
    expect(allSql).toContain("ALTER TABLE space_meta");
    expect(allSql).toContain("ADD COLUMN guide TEXT NULL");
    expect(allSql).toContain("ADD COLUMN organization_id TEXT NULL");
    expect(allSql).toContain("ADD COLUMN organization_visibility TEXT NULL");
    expect(allSql).toContain("SET guide = guidelines");
  });
});
