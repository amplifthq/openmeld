import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  createActiveSpaceIndexProjectionOutboxRecord,
  insertSpaceIndexProjectionOutboxRecord,
  listDueSpaceIndexProjectionOutboxRecords,
  readNextSpaceIndexProjectionOutboxAlarmAtMs,
  readSpaceIndexProjectionOutboxRecord,
} from "../src/space/infrastructure/sql/space-index-projection-outbox-repo";
import type { SpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import { readAgentReplyObservationState } from "../src/space/infrastructure/sql/space-signal-repo";
import { parseStoredSignal } from "../src/space/rules/parsers/stored-signal";
import { attemptSpaceIndexProjectionOutboxRecord } from "../src/space-index/space-index-projection-outbox-service";
import { projectActiveSpaceIndexSnapshot } from "../src/space-index/space-index-projection-service";
import { listAccountSpacesFromSpaceIndex } from "../src/space-index/space-index-repository";
import {
  captureSpaceMessagePreview,
  projectSpaceMessagePreview,
} from "../src/space-index/space-message-preview";
import {
  createFaultInjectingPostgresDatabase,
  createPostgresHarness,
} from "./helpers/postgresql-harness.test-support";

function previewSignal(id: string, ts: number, text: string) {
  return {
    v: 1,
    id,
    ts,
    spaceId: "space-alpha",
    type: "signal.text",
    profile: { kind: "human", profileId: "human-1", profileName: "Mira" },
    data: { text },
  };
}
describe("space index projection outbox", () => {
  it("recovers the same historical reply for preview, history and the next Agent observation", async () => {
    const storage = createSqlStorageHarness();
    try {
      ensureSpaceSqlSchema(storage.sql);
      const profileId = "agt_11111111-1111-4111-8111-111111111111";
      const source = previewSignal("source", 1, "Please reply");
      const historical = {
        ...previewSignal("old-final", 2, "First Agent finished"),
        profile: { kind: "agent", profileId },
        data: {
          text: "First Agent finished",
          meta: {
            purpose: AGENT_REPLY_FINAL_PURPOSE,
            dispatchId: "first-dispatch",
            targetProfileId: profileId,
            targetProfileName: "Codex (1)",
            targetMentionLabel: "Codex (1)",
          },
        },
      };
      for (const signal of [source, historical]) {
        storage.sql.exec(
          "INSERT INTO space_signals (id, ts, type, profile_id, profile_kind, payload_json) VALUES (?, ?, 'signal.text', ?, ?, ?)",
          signal.id,
          signal.ts,
          signal.profile.profileId,
          signal.profile.kind,
          JSON.stringify(signal)
        );
      }
      const observe = (cursor: string) =>
        readAgentReplyObservationState(storage.sql, {
          observedThroughSignalId: cursor,
          sourceSignalId: "source",
          threadId: null,
        });
      expect(observe("source")).toBe("changed");
      const raw = storage.sql
        .exec<{
          payload_json: string;
        }>("SELECT payload_json FROM space_signals WHERE id = 'old-final'")
        .toArray()[0]?.payload_json;
      if (!raw) {
        throw new Error("Missing historical reply fixture");
      }
      const readable = parseStoredSignal(raw);
      if (!readable) {
        throw new Error("Historical reply remains unreadable");
      }
      expect(readable?.id).toBe("old-final");
      expect(captureSpaceMessagePreview(storage.sql).preview).toMatchObject({
        signalId: readable?.id,
        text: "First Agent finished",
      });
      expect(observe(readable.id)).toBe("current");
      expect(JSON.parse(raw).data.meta.targetMentionLabel).toBe("Codex (1)");
    } finally {
      await storage.close();
    }
  });
  it("does not advertise a message that conversation history cannot read", async () => {
    const storage = createSqlStorageHarness();
    try {
      ensureSpaceSqlSchema(storage.sql);
      storage.sql.exec(
        "INSERT INTO space_signals (id, ts, type, profile_id, payload_json) VALUES ('broken', 1, 'signal.text', 'human-1', ?)",
        JSON.stringify({ data: { text: "Invisible reply" } })
      );
      expect(captureSpaceMessagePreview(storage.sql).preview).toBeNull();
    } finally {
      await storage.close();
    }
  });
  it("upgrades an existing v32 Space before capturing a message preview", async () => {
    const spaceSql = createSqlStorageHarness();
    try {
      ensureSpaceSqlSchema(spaceSql.sql);
      spaceSql.sql.exec("DROP TABLE space_message_preview_revision");
      spaceSql.sql.exec("DELETE FROM schema_migrations");
      spaceSql.sql.exec(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (32, 'space-sql-schema-v32', 1)"
      );
      spaceSql.sql.exec(
        "INSERT INTO space_signals (id, ts, type, profile_id, payload_json) VALUES ('existing', 1, 'signal.text', 'human', ?)",
        JSON.stringify(previewSignal("existing", 1, "Keep this message"))
      );
      ensureSpaceSqlSchema(spaceSql.sql);
      expect(captureSpaceMessagePreview(spaceSql.sql)).toMatchObject({
        revision: 1,
        preview: { signalId: "existing", text: "Keep this message" },
      });
      ensureSpaceSqlSchema(spaceSql.sql);
      expect(captureSpaceMessagePreview(spaceSql.sql).revision).toBe(2);
    } finally {
      await spaceSql.close();
    }
  });
  it("keeps previews ordered through delayed writes and complete message retention", async () => {
    const d1 = await createSpaceIndexHarness();
    const spaceSql = createSqlStorageHarness();
    try {
      ensureSpaceSqlSchema(spaceSql.sql);
      await projectActiveSpaceIndexSnapshot({
        db: d1.db,
        eventType: "space.created",
        metaRecord: createMeta({
          name: "Preview",
          spaceId: "space-alpha",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }),
        memberRecords: [
          createMember({
            addedAt: "2026-04-10T00:00:00.000Z",
            profileId: "human-1",
            profileKindSnapshot: "human",
            profileNameSnapshot: "Mira",
            spaceId: "space-alpha",
          }),
        ],
      });
      const empty = captureSpaceMessagePreview(spaceSql.sql);
      expect(empty.preview).toBeNull();
      spaceSql.sql.exec(
        "INSERT INTO space_signals (id, ts, type, profile_id, payload_json) VALUES (?, ?, ?, ?, ?)",
        "message-1",
        100,
        "signal.text",
        "human-1",
        JSON.stringify(previewSignal("message-1", 100, "Ready for review"))
      );
      const populated = captureSpaceMessagePreview(spaceSql.sql);
      expect(populated.preview?.text).toBe("Ready for review");
      for (const [id, timestamp, text] of [
        ["message-2", 200, "**Second** message"],
        ["message-3", 300, "[Latest](https://example.com) message"],
      ] as const) {
        spaceSql.sql.exec(
          "INSERT INTO space_signals (id, ts, type, profile_id, payload_json) VALUES (?, ?, 'signal.text', 'human-1', ?)",
          id,
          timestamp,
          JSON.stringify(previewSignal(id, timestamp, text))
        );
      }
      const recent = captureSpaceMessagePreview(spaceSql.sql);
      expect(recent.recentPreviews.map((message) => message.text)).toEqual([
        "Latest message",
        "Second message",
      ]);
      await projectSpaceMessagePreview({
        db: d1.db,
        spaceId: "space-alpha",
        ...populated,
      });
      await projectSpaceMessagePreview({
        db: d1.db,
        spaceId: "space-alpha",
        ...empty,
      });
      const input = {
        db: d1.db,
        gatewayHost: "gateway.testing.example",
        limit: 500,
        ownerUserId: "owner-1",
        scope: "account" as const,
        selectedProfileId: "human-1",
      };
      const legacy = await listAccountSpacesFromSpaceIndex(input);
      expect(legacy.spaceItems[0]).not.toHaveProperty("messagePreview");
      const current = await listAccountSpacesFromSpaceIndex({
        ...input,
        includeMessagePreviews: true,
      });
      expect(current.spaceItems[0]?.messagePreview?.text).toBe(
        "Ready for review"
      );
      expect(current.spaceItems[0]).not.toHaveProperty("recentMessagePreviews");
      await projectSpaceMessagePreview({
        db: d1.db,
        spaceId: "space-alpha",
        ...recent,
      });
      const directory = await listAccountSpacesFromSpaceIndex({
        ...input,
        includeDirectoryPreviews: true,
      });
      expect(
        directory.spaceItems[0]?.recentMessagePreviews?.map(
          (message) => message.text
        )
      ).toEqual(["Latest message", "Second message"]);
      const unauthorized = await listAccountSpacesFromSpaceIndex({
        ...input,
        ownerUserId: "another-owner",
        includeMessagePreviews: true,
        includeDirectoryPreviews: true,
      });
      expect(unauthorized.spaceItems).toEqual([]);
      spaceSql.sql.exec("DELETE FROM space_signals");
      const retained = captureSpaceMessagePreview(spaceSql.sql);
      expect(retained.revision).toBeGreaterThan(populated.revision);
      await projectSpaceMessagePreview({
        db: d1.db,
        spaceId: "space-alpha",
        ...retained,
      });
      await projectSpaceMessagePreview({
        db: d1.db,
        spaceId: "space-alpha",
        ...populated,
      });
      expect(
        (
          await listAccountSpacesFromSpaceIndex({
            ...input,
            includeMessagePreviews: true,
          })
        ).spaceItems[0]?.messagePreview
      ).toBeNull();
    } finally {
      await spaceSql.close();
      await d1.close();
    }
  });
  it("keeps failed evidence and retries until AccountSpaces catches up to Space truth", async () => {
    const d1 = await createSpaceIndexHarness();
    const spaceSql = createSqlStorageHarness();
    try {
      ensureSpaceSqlSchema(spaceSql.sql);
      const oldMeta = createMeta({
        name: "Old Alpha",
        spaceId: "space-alpha",
        updatedAt: "2026-04-10T00:00:00.000Z",
      });
      const humanMember = createMember({
        addedAt: "2026-04-10T00:01:00.000Z",
        profileId: "human-1",
        profileKindSnapshot: "human",
        profileNameSnapshot: "Mira",
        spaceId: "space-alpha",
      });
      await projectActiveSpaceIndexSnapshot({
        db: d1.db,
        eventType: "space.created",
        metaRecord: oldMeta,
        memberRecords: [humanMember],
      });
      const latestRecord = createActiveSpaceIndexProjectionOutboxRecord({
        eventType: "space.meta_updated",
        memberRecords: [
          humanMember,
          createMember({
            addedAt: "2026-04-10T00:11:00.000Z",
            profileId: "agent-1",
            profileKindSnapshot: "agent",
            profileNameSnapshot: "Codex",
            spaceId: "space-alpha",
          }),
        ],
        metaRecord: createMeta({
          name: "Renamed Alpha",
          spaceId: "space-alpha",
          updatedAt: "2026-04-10T00:10:00.000Z",
        }),
        nowMs: Date.parse("2026-04-10T00:12:00.000Z"),
        projectionId: "spidx_projection_test_retry",
      });
      expect(
        insertSpaceIndexProjectionOutboxRecord(spaceSql.sql, latestRecord)
      ).toBe(true);
      const failed = await attemptSpaceIndexProjectionOutboxRecord({
        db: createProjectionFailureDb({
          db: d1.db,
          failOnSql: 'INSERT INTO "openmeld"."space_index_spaces"',
        }),
        nowMs: Date.parse("2026-04-10T00:12:01.000Z"),
        record: latestRecord,
        sql: spaceSql.sql,
      });
      const failedRecord = readSpaceIndexProjectionOutboxRecord(
        spaceSql.sql,
        latestRecord.projectionId
      );
      const staleAccountSpaces = await listAccountSpacesFromSpaceIndex({
        db: d1.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      expect(failed.status).toBe("failed");
      expect(failedRecord).toMatchObject({
        attemptCount: 1,
        lastError: "injected PostgreSQL query failure",
        projectionId: latestRecord.projectionId,
        status: "failed",
      });
      expect(failedRecord?.nextRetryAtMs).toBeGreaterThan(
        Date.parse("2026-04-10T00:12:01.000Z")
      );
      expect(staleAccountSpaces.spaceItems[0]).toMatchObject({
        joinedProfiles: [
          expect.objectContaining({
            profileId: "human-1",
          }),
        ],
        spaceId: "space-alpha",
        spaceName: "Old Alpha",
      });
      const retryAtMs = failedRecord?.nextRetryAtMs;
      expect(retryAtMs).toBeTypeOf("number");
      expect(
        readNextSpaceIndexProjectionOutboxAlarmAtMs(spaceSql.sql, {
          nowMs: Date.parse("2026-04-10T00:12:01.000Z"),
        })
      ).toBe(retryAtMs);
      const dueRecords = listDueSpaceIndexProjectionOutboxRecords(
        spaceSql.sql,
        {
          limit: 10,
          nowMs: retryAtMs as number,
        }
      );
      const dueRecord = dueRecords[0];
      if (!dueRecord) {
        throw new Error("expected one due SpaceIndex projection outbox record");
      }
      const retried = await attemptSpaceIndexProjectionOutboxRecord({
        db: d1.db,
        nowMs: (retryAtMs as number) + 1,
        record: dueRecord,
        sql: spaceSql.sql,
      });
      const completedRecord = readSpaceIndexProjectionOutboxRecord(
        spaceSql.sql,
        latestRecord.projectionId
      );
      const caughtUpAccountSpaces = await listAccountSpacesFromSpaceIndex({
        db: d1.db,
        gatewayHost: "gateway.testing.example",
        limit: 10,
        ownerUserId: "owner-1",
        scope: "account",
        selectedProfileId: "human-1",
      });
      expect(retried.status).toBe("completed");
      expect(completedRecord).toMatchObject({
        attemptCount: 1,
        completedAtMs: (retryAtMs as number) + 1,
        lastError: null,
        nextRetryAtMs: null,
        status: "completed",
      });
      expect(caughtUpAccountSpaces.spaceItems[0]).toMatchObject({
        joinedProfiles: [
          expect.objectContaining({
            profileId: "agent-1",
          }),
          expect.objectContaining({
            profileId: "human-1",
          }),
        ],
        spaceId: "space-alpha",
        spaceName: "Renamed Alpha",
      });
    } finally {
      await d1.close();
      await spaceSql.close();
    }
  });
});
function createSqlStorageHarness(): {
  close(): void;
  sql: SqlStorage;
} {
  const database = new DatabaseSync(":memory:");
  return {
    close: async () => {
      await database.close();
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
class SqliteSqlStorage {
  private readonly database: DatabaseSync;
  constructor(database: DatabaseSync) {
    this.database = database;
  }
  exec<T extends Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): SqliteSqlCursor<T> {
    const statement = this.database.prepare(sql);
    if (isReadStatement(sql)) {
      return new SqliteSqlCursor<T>(
        statement.all(...toSqliteParams(params)) as T[]
      );
    }
    const result = (statement as StatementSync).run(...toSqliteParams(params));
    return new SqliteSqlCursor<T>([], Number(result.changes));
  }
}
function isReadStatement(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return (
    normalized.startsWith("SELECT") ||
    normalized.startsWith("WITH") ||
    normalized.startsWith("PRAGMA") ||
    normalized.includes(" RETURNING ")
  );
}
function toSqliteParams(
  params: readonly unknown[]
): (string | number | null)[] {
  return params.map((param) => {
    if (
      typeof param === "string" ||
      typeof param === "number" ||
      param === null
    ) {
      return param;
    }
    throw new Error("unsupported sqlite test parameter");
  });
}
async function createSpaceIndexHarness() {
  const harness = await createPostgresHarness();
  for (const sql of SPACE_INDEX_AUXILIARY_TABLES_SQL) {
    await harness.query({ text: sql });
  }
  return harness;
}
function createMeta(input: {
  name: string;
  spaceId: string;
  updatedAt: string;
}): SpaceMetaRecord {
  return {
    v: 1,
    accessMode: "public",
    createdAt: "2026-04-09T00:00:00.000Z",
    creator: {
      kind: "human",
      ownerUserId: "owner-1",
      profileId: "human-1",
      profileName: "Mira",
    },
    name: input.name,
    organizationId: "org-1",
    spaceId: input.spaceId,
    updatedAt: input.updatedAt,
    visibility: "private",
  };
}
function createMember(input: {
  addedAt: string;
  profileId: string;
  profileKindSnapshot: "human" | "agent";
  profileNameSnapshot: string;
  spaceId: string;
}): SpaceMemberRecord {
  return {
    addedAt: input.addedAt,
    addedByDisplayNameSnapshot: "Mira",
    addedByOwnerUserId: "owner-1",
    addedByProfileId: "human-1",
    controllerRefSnapshot: null,
    createdAt: input.addedAt,
    firstEnteredAt: null,
    lastEnteredAt: null,
    memberSource:
      input.profileKindSnapshot === "human"
        ? "space_creator"
        : "added_by_member",
    ownerNameSnapshot: "Mira",
    ownerUserIdSnapshot: "owner-1",
    profileId: input.profileId,
    profileKindSnapshot: input.profileKindSnapshot,
    profileNameSnapshot: input.profileNameSnapshot,
    removalReason: null,
    removedAt: null,
    removedByOwnerUserId: null,
    removedByProfileId: null,
    spaceId: input.spaceId,
    status: "active",
    updatedAt: input.addedAt,
  };
}
function createProjectionFailureDb(input: {
  db: PostgresDatabase;
  failOnSql: string;
}): PostgresDatabase {
  return createFaultInjectingPostgresDatabase({
    db: input.db,
    matches: (sql) => sql.includes(input.failOnSql),
  });
}

const SPACE_INDEX_AUXILIARY_TABLES_SQL = [
  "\n    CREATE TABLE ats_profile_space_history (\n      profile_id TEXT NOT NULL,\n      gateway_host TEXT NOT NULL,\n      space_id TEXT NOT NULL,\n      space_name TEXT,\n      creator_profile_id TEXT,\n      creator_kind TEXT,\n      space_created_at INTEGER,\n      space_updated_at INTEGER,\n      last_joined_at INTEGER NOT NULL,\n      last_seen_ts INTEGER,\n      pinned_at INTEGER,\n      status TEXT NOT NULL DEFAULT 'active',\n      created_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL,\n      UNIQUE(profile_id, gateway_host, space_id)\n    )\n  ",
] as const;
