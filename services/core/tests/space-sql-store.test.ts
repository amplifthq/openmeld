import type { SignalEnvelope } from "@openmeld/protocol";
import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { buildSpacePasswordProof } from "../src/lib/space-password-proof";
import { readSpaceCursorRecordFromSql } from "../src/space/infrastructure/sql/space-cursor-repo";
import {
  initializeSpaceMetaRecordIfAbsent,
  readSpaceMetaRecordFromSql,
  upsertSpaceMetaRecord,
} from "../src/space/infrastructure/sql/space-meta-repo";
import {
  deleteAllSqlSpaceData,
  deleteOldestSignalRows,
  insertSignalRecord,
  listRecentSignalEntries,
  listSignalEntriesPageWindow,
} from "../src/space/infrastructure/sql/space-signal-repo";

const SPACE_META_QUERY_REGEX = /FROM\s+space_meta/i;
const SPACE_CURSORS_QUERY_REGEX = /FROM\s+space_cursors/i;
const SPACE_SIGNALS_RECENT_QUERY_REGEX =
  /FROM\s+space_signals[\s\S]*ORDER BY ts DESC, id DESC/i;
const SPACE_SIGNALS_CURSOR_QUERY_REGEX =
  /FROM\s+space_signals[\s\S]*WHERE\s+\(ts > \?/i;
const DELETE_SPACE_SIGNALS_QUERY_REGEX = /DELETE FROM space_signals/i;
const DELETE_SPACE_DISPATCH_RULES_QUERY_REGEX =
  /DELETE FROM space_dispatch_rules/i;
const DELETE_SPACE_MEMBERS_QUERY_REGEX = /DELETE FROM space_members/i;
const INSERT_SPACE_FINAL_REPLY_CLAIMS_QUERY_REGEX =
  /INSERT OR IGNORE INTO space_final_reply_claims/i;
const INSERT_SPACE_SIGNALS_QUERY_REGEX = /INSERT OR IGNORE INTO space_signals/i;

type QueryMatcher = {
  pattern: RegExp;
  rows?: Record<string, unknown>[];
  rowsWritten?: number;
};

class FakeSqlCursor<T extends Record<string, unknown>> {
  private readonly rows: T[];
  private index = 0;
  readonly rowsWritten: number;

  constructor(rows: T[], rowsWritten = 0) {
    this.rows = rows;
    this.rowsWritten = rowsWritten;
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
  private readonly matchers: QueryMatcher[];

  constructor(matchers: QueryMatcher[]) {
    this.matchers = matchers;
  }

  exec<T extends Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): FakeSqlCursor<T> {
    this.calls.push({ sql, params });

    for (const matcher of this.matchers) {
      if (!matcher.pattern.test(sql)) {
        continue;
      }
      return new FakeSqlCursor<T>(
        (matcher.rows ?? []) as T[],
        matcher.rowsWritten ?? 0
      );
    }

    return new FakeSqlCursor<T>([]);
  }
}

describe("space-sql-store", () => {
  it("maps space_meta row to external shape and keeps nullable semantics", async () => {
    const createdAtMs = Date.parse("2026-02-24T10:00:00.000Z");
    const updatedAtMs = Date.parse("2026-02-24T11:00:00.000Z");
    const passwordProof = await buildSpacePasswordProof("Store#Password");
    const sql = new FakeSqlStorage([
      {
        pattern: SPACE_META_QUERY_REGEX,
        rows: [
          {
            space_id: "space-1",
            name: null,
            purpose: null,
            direct_message_json: null,
            creator_json: JSON.stringify({
              profileId: "p-1",
              profileName: "Felix",
              kind: "human",
              profile: "p-1",
            }),
            organization_id: "org-1",
            organization_visibility: "private",
            guide: null,
            access_mode: "protected",
            password_proof_json: JSON.stringify(passwordProof),
            created_at: createdAtMs,
            updated_at: updatedAtMs,
          },
        ],
      },
    ]);

    const meta = readSpaceMetaRecordFromSql(
      sql as unknown as SqlStorage,
      "space-1"
    );

    expect(meta).toEqual({
      v: 1,
      spaceId: "space-1",
      organizationId: "org-1",
      visibility: "private",
      creator: {
        profileId: "p-1",
        profileName: "Felix",
        kind: "human",
        profile: "p-1",
      },
      accessMode: "protected",
      passwordProof,
      createdAt: new Date(createdAtMs).toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
    });
  });

  it("throws when password proof json is malformed", () => {
    const createdAtMs = Date.parse("2026-02-24T10:00:00.000Z");
    const updatedAtMs = Date.parse("2026-02-24T11:00:00.000Z");
    const sql = new FakeSqlStorage([
      {
        pattern: SPACE_META_QUERY_REGEX,
        rows: [
          {
            space_id: "space-1",
            name: "ops-room",
            purpose: null,
            direct_message_json: null,
            creator_json: null,
            organization_id: "org-1",
            organization_visibility: "private",
            guide: null,
            access_mode: "protected",
            password_proof_json: "{invalid-json",
            created_at: createdAtMs,
            updated_at: updatedAtMs,
          },
        ],
      },
    ]);

    expect(() =>
      readSpaceMetaRecordFromSql(sql as unknown as SqlStorage, "space-1")
    ).toThrow("space_meta.password_proof_json invalid");
  });

  it("returns null cursor when last_seen_ts is invalid", () => {
    const createdAtMs = Date.parse("2026-02-24T10:00:00.000Z");
    const updatedAtMs = Date.parse("2026-02-24T11:00:00.000Z");
    const sql = new FakeSqlStorage([
      {
        pattern: SPACE_CURSORS_QUERY_REGEX,
        rows: [
          {
            profile_id: "profile-1",
            last_seen_ts: -1,
            role: "reviewer",
            mention_alias: null,
            created_at: createdAtMs,
            updated_at: updatedAtMs,
          },
        ],
      },
    ]);

    const cursor = readSpaceCursorRecordFromSql(
      sql as unknown as SqlStorage,
      "profile-1",
      "space-1"
    );

    expect(cursor).toBeNull();
  });

  it("maps cursor createdAt and updatedAt from SQL timestamp fields", () => {
    const createdAtMs = Date.parse("2026-02-24T10:00:00.000Z");
    const updatedAtMs = Date.parse("2026-02-24T11:00:00.000Z");
    const sql = new FakeSqlStorage([
      {
        pattern: SPACE_CURSORS_QUERY_REGEX,
        rows: [
          {
            profile_id: "profile-1",
            last_seen_ts: 123,
            role: "reviewer",
            mention_alias: "ops_bot",
            created_at: createdAtMs,
            updated_at: updatedAtMs,
          },
        ],
      },
    ]);

    const cursor = readSpaceCursorRecordFromSql(
      sql as unknown as SqlStorage,
      "profile-1",
      "space-1"
    );

    expect(cursor).toEqual({
      v: 1,
      spaceId: "space-1",
      profileId: "profile-1",
      lastSeenTs: 123,
      role: "reviewer",
      mentionAlias: "ops_bot",
      createdAt: new Date(createdAtMs).toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
    });
  });

  it("writes password proof json when initializing meta", async () => {
    const createdAt = "2026-02-24T10:00:00.000Z";
    const updatedAt = "2026-02-24T11:00:00.000Z";
    const passwordProof = await buildSpacePasswordProof("Init#Password");
    const sql = new FakeSqlStorage([
      {
        pattern: SPACE_META_QUERY_REGEX,
        rows: [
          {
            space_id: "space-1",
            name: "room-a",
            purpose: null,
            direct_message_json: null,
            creator_json: null,
            organization_id: "org-1",
            organization_visibility: "private",
            guide: null,
            access_mode: "protected",
            password_proof_json: JSON.stringify(passwordProof),
            created_at: Date.parse(createdAt),
            updated_at: Date.parse(updatedAt),
          },
        ],
      },
    ]);

    const result = initializeSpaceMetaRecordIfAbsent(
      sql as unknown as SqlStorage,
      {
        v: 1,
        spaceId: "space-1",
        organizationId: "org-1",
        visibility: "private",
        name: "room-a",
        accessMode: "protected",
        passwordProof,
        createdAt,
        updatedAt,
      }
    );

    const insertCall = sql.calls.find((call) =>
      call.sql.includes("INSERT OR IGNORE INTO space_meta")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.params[5]).toBe("org-1");
    expect(insertCall?.params[6]).toBe("private");
    expect(insertCall?.params[8]).toBe("protected");
    expect(insertCall?.params[9]).toBe(JSON.stringify(passwordProof));
    expect(result.passwordProof).toEqual(passwordProof);
  });

  it("writes and updates password proof json on upsert", async () => {
    const passwordProof = await buildSpacePasswordProof("Upsert#Password");
    const sql = new FakeSqlStorage([]);

    upsertSpaceMetaRecord(sql as unknown as SqlStorage, {
      v: 1,
      spaceId: "space-2",
      organizationId: "org-1",
      visibility: "private",
      name: "room-b",
      accessMode: "protected",
      passwordProof,
      createdAt: "2026-02-24T10:00:00.000Z",
      updatedAt: "2026-02-24T11:00:00.000Z",
    });

    const insertCall = sql.calls.find((call) =>
      call.sql.includes("INSERT INTO space_meta")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.sql).toContain("password_proof_json");
    expect(insertCall?.sql).toContain(
      "password_proof_json = excluded.password_proof_json"
    );
    expect(insertCall?.params[5]).toBe("org-1");
    expect(insertCall?.params[6]).toBe("private");
    expect(insertCall?.params[8]).toBe("protected");
    expect(insertCall?.params[9]).toBe(JSON.stringify(passwordProof));
  });

  it("requires signal id when inserting signal record", () => {
    const sql = new FakeSqlStorage([]);
    const signal = {
      v: 1,
      id: "  ",
      spaceId: "space-1",
      ts: 100,
      profile: { kind: "human", profileId: "p-1", profileName: "Felix" },
      type: "signal.text",
      data: { text: "hello" },
    } as SignalEnvelope;

    expect(() => {
      insertSignalRecord(sql as unknown as SqlStorage, signal);
    }).toThrow(
      expect.objectContaining({
        name: "ZodError",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["id"], code: "too_small" }),
        ]),
      })
    );
    expect(sql.calls).toHaveLength(0);
  });

  it("reads recent signals in chronological order", () => {
    const sql = new FakeSqlStorage([
      {
        pattern: SPACE_SIGNALS_RECENT_QUERY_REGEX,
        rows: [
          { id: "signal-3", ts: 300, payload_json: '{"id":"signal-3"}' },
          { id: "signal-2", ts: 200, payload_json: '{"id":"signal-2"}' },
        ],
      },
    ]);

    const entries = listRecentSignalEntries(sql as unknown as SqlStorage, 2);

    expect(entries).toEqual([
      [`${new Date(200).toISOString()}|signal-2`, '{"id":"signal-2"}'],
      [`${new Date(300).toISOString()}|signal-3`, '{"id":"signal-3"}'],
    ]);
    expect(sql.calls[0]?.sql).not.toContain("type NOT IN (?, ?)");
  });

  it("builds paging window with cursor mode read limit and full-window marker", () => {
    const cursorKey = `${new Date(100).toISOString()}|signal-1`;
    const sql = new FakeSqlStorage([
      {
        pattern: SPACE_SIGNALS_CURSOR_QUERY_REGEX,
        rows: [
          { id: "signal-1", ts: 100, payload_json: '{"id":"signal-1"}' },
          { id: "signal-2", ts: 101, payload_json: '{"id":"signal-2"}' },
          { id: "signal-3", ts: 102, payload_json: '{"id":"signal-3"}' },
          { id: "signal-4", ts: 103, payload_json: '{"id":"signal-4"}' },
        ],
      },
    ]);

    const page = listSignalEntriesPageWindow(sql as unknown as SqlStorage, {
      afterTs: null,
      cursor: cursorKey,
      limit: 2,
    });

    expect(page.readWindowFull).toBe(true);
    expect(page.entries).toHaveLength(4);
    expect(sql.calls[0]?.params.at(-1)).toBe(4);
    expect(sql.calls[0]?.sql).not.toContain("type NOT IN (?, ?)");
  });

  it("returns deleted row count from fifo delete helper", () => {
    const sql = new FakeSqlStorage([
      {
        pattern: DELETE_SPACE_SIGNALS_QUERY_REGEX,
        rowsWritten: 7,
      },
    ]);

    const deleted = deleteOldestSignalRows(sql as unknown as SqlStorage, 100);

    expect(deleted).toBe(7);
    const cleanupSql = sql.calls.map((call) => call.sql).join("\n");
    expect(cleanupSql).toContain("DELETE FROM space_inbox_projection_outbox");
    expect(cleanupSql).toContain("WHERE status = 'completed'");
    expect(cleanupSql).toContain(
      "space_signals.id = space_inbox_projection_outbox.signal_id"
    );
  });

  it("cleans dispatch rules alongside other space tables", () => {
    const sql = new FakeSqlStorage([
      {
        pattern: DELETE_SPACE_DISPATCH_RULES_QUERY_REGEX,
        rowsWritten: 1,
      },
      {
        pattern: DELETE_SPACE_MEMBERS_QUERY_REGEX,
        rowsWritten: 1,
      },
    ]);

    deleteAllSqlSpaceData(sql as unknown as SqlStorage);

    const allSql = sql.calls.map((call) => call.sql).join("\n");
    expect(allSql).toContain("DELETE FROM space_meta");
    expect(allSql).toContain("DELETE FROM space_cursors");
    expect(allSql).toContain("DELETE FROM space_signals");
    expect(allSql).toContain("DELETE FROM space_final_reply_claims");
    expect(allSql).toContain("DELETE FROM space_members");
    expect(allSql).toContain("DELETE FROM openMeldDaemon_outbox");
    expect(allSql).toContain("DELETE FROM space_index_projection_outbox");
    expect(allSql).toContain("DELETE FROM space_inbox_projection_outbox");
    expect(allSql).toContain("DELETE FROM space_dispatch_rules");
    expect(allSql).not.toContain("space_dispatch_policies");
  });

  it("blocks duplicate final reply persistence for the same dispatch and profile", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "signal-1",
      spaceId: "space-1",
      ts: Date.parse("2026-03-10T12:00:00.000Z"),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Codex",
      },
      type: "signal.text",
      data: {
        text: "Today is Tuesday, March 10, 2026.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    };
    const sql = new FakeSqlStorage([
      {
        pattern: INSERT_SPACE_FINAL_REPLY_CLAIMS_QUERY_REGEX,
        rowsWritten: 0,
      },
    ]);

    const result = insertSignalRecord(sql as unknown as SqlStorage, signal);

    expect(result).toEqual({
      duplicateFinalReplyBlocked: true,
      persistedSignal: false,
    });
    const allSql = sql.calls.map((call) => call.sql).join("\n");
    expect(allSql).toContain("INSERT OR IGNORE INTO space_final_reply_claims");
    expect(allSql).not.toContain("INSERT OR IGNORE INTO space_signals");
  });

  it("persists the first final reply after claiming the dispatch/profile slot", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "signal-1",
      spaceId: "space-1",
      ts: Date.parse("2026-03-10T12:00:00.000Z"),
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Codex",
      },
      type: "signal.text",
      data: {
        text: "Today is Tuesday, March 10, 2026.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
        },
      },
    };
    const sql = new FakeSqlStorage([
      {
        pattern: INSERT_SPACE_FINAL_REPLY_CLAIMS_QUERY_REGEX,
        rowsWritten: 1,
      },
      {
        pattern: INSERT_SPACE_SIGNALS_QUERY_REGEX,
        rowsWritten: 1,
      },
    ]);

    const result = insertSignalRecord(sql as unknown as SqlStorage, signal);

    expect(result).toEqual({
      duplicateFinalReplyBlocked: false,
      persistedSignal: true,
    });
    const allSql = sql.calls.map((call) => call.sql).join("\n");
    expect(allSql).toContain("INSERT OR IGNORE INTO space_final_reply_claims");
    expect(allSql).toContain("INSERT OR IGNORE INTO space_signals");
  });
});
