import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCachedSpaceMemberDisplay,
  resolveCachedSpaceMemberDisplay,
  SPACE_MEMBER_DISPLAY_CACHE_MAX_AGE_MS,
  SPACE_MEMBER_DISPLAY_CACHE_REFRESH_AGE_MS,
  writeConfirmedSpaceMemberProfileDisplay,
} from "../src/space/application/space-members-service";
import {
  readSpaceMemberDisplayCache,
  writeSpaceMemberOwnerAvatars,
  writeSpaceMemberProfileDisplay,
} from "../src/space/infrastructure/sql/space-member-display-cache-repo";
import {
  listSpaceMemberRecords,
  type SpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

const NOW_MS = Date.parse("2026-10-20T00:00:00.000Z");
const AVATAR_OPTIONS = { color: "sage" as const };

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) {
    db.close();
  }
});

describe("Space member display cache", () => {
  it("serves cached names and avatars only when every active member is covered", () => {
    const sql = createSql();
    writeDisplay(sql, NOW_MS);

    const cached = resolve(sql, NOW_MS);
    expect(cached.ownerAvatars).toEqual({
      needsRefresh: false,
      values: new Map([["owner-1", "https://example.com/a.png"]]),
    });
    expect(cached.profileDisplay?.needsRefresh).toBe(false);
    expect(cached.profileDisplay?.values.get("agent-1")).toEqual({
      avatarStyle: "fluid",
      avatarOptions: AVATAR_OPTIONS,
    });

    upsertSpaceMemberRecord(sql, member("human-2", "human", "owner-2"));
    const missing = resolve(sql, NOW_MS);
    expect(missing.ownerAvatars).toBeNull();
    expect(missing.profileDisplay).toBeNull();
  });

  it("marks aging copies for refresh and drops expired ones", () => {
    const sql = createSql();
    writeDisplay(sql, NOW_MS);

    const aging = resolve(
      sql,
      NOW_MS + SPACE_MEMBER_DISPLAY_CACHE_REFRESH_AGE_MS
    );
    expect(aging.ownerAvatars?.needsRefresh).toBe(true);
    expect(aging.profileDisplay?.needsRefresh).toBe(true);

    const expired = resolve(
      sql,
      NOW_MS + SPACE_MEMBER_DISPLAY_CACHE_MAX_AGE_MS
    );
    expect(expired.ownerAvatars).toBeNull();
    expect(expired.profileDisplay).toBeNull();
  });

  it("keeps a confirmed absence apart from an unreadable row", () => {
    const sql = createSql();
    writeSpaceMemberOwnerAvatars(sql, {
      avatarUrlByOwnerUserId: new Map([["owner-1", null]]),
      refreshedAtMs: NOW_MS,
    });
    writeSpaceMemberProfileDisplay(sql, {
      displayByProfileId: new Map([
        ["human-1", { avatarStyle: null, avatarOptions: null }],
      ]),
      refreshedAtMs: NOW_MS,
    });
    sql.exec(
      "INSERT INTO space_member_profile_display_cache VALUES (?, ?, ?, ?)",
      "agent-1",
      "fluid",
      "{not-json",
      NOW_MS
    );

    const cache = readSpaceMemberDisplayCache(sql);
    expect(cache.ownerAvatarByOwnerUserId.get("owner-1")?.avatarUrl).toBeNull();
    expect(cache.profileDisplayByProfileId.get("human-1")).toMatchObject({
      avatarStyle: null,
      avatarOptions: null,
    });
    expect(cache.profileDisplayByProfileId.has("agent-1")).toBe(false);
    expect(resolve(sql, NOW_MS).profileDisplay).toBeNull();
  });

  it("reports changes and never replaces a newer value with an older read", () => {
    const sql = createSql();
    const avatars = (url: string, refreshedAtMs: number) =>
      writeSpaceMemberOwnerAvatars(sql, {
        avatarUrlByOwnerUserId: new Map([["owner-1", url]]),
        refreshedAtMs,
      });

    expect(avatars("https://example.com/a.png", NOW_MS)).toBe(false);
    expect(avatars("https://example.com/a.png", NOW_MS + 1)).toBe(false);
    expect(avatars("https://example.com/b.png", NOW_MS + 2)).toBe(true);
    expect(avatars("https://example.com/old.png", NOW_MS)).toBe(false);
    expect(
      readSpaceMemberDisplayCache(sql).ownerAvatarByOwnerUserId.get("owner-1")
    ).toEqual({
      avatarUrl: "https://example.com/b.png",
      refreshedAtMs: NOW_MS + 2,
    });
  });

  it("stores only Profile display facts an Auth read confirmed", () => {
    const sql = createSql();
    expect(
      writeConfirmedSpaceMemberProfileDisplay({
        sql,
        profileFacts: null,
        refreshedAtMs: NOW_MS,
      })
    ).toBe(false);
    expect(
      readSpaceMemberDisplayCache(sql).profileDisplayByProfileId.size
    ).toBe(0);

    writeConfirmedSpaceMemberProfileDisplay({
      sql,
      profileFacts: new Map([
        [
          "agent-1",
          {
            avatarStyle: "fluid",
            avatarOptions: AVATAR_OPTIONS,
          },
        ],
      ]) as unknown as Parameters<
        typeof writeConfirmedSpaceMemberProfileDisplay
      >[0]["profileFacts"],
      refreshedAtMs: NOW_MS,
    });
    const stored = readSpaceMemberDisplayCache(sql).profileDisplayByProfileId;
    expect([...stored.keys()]).toEqual(["agent-1"]);
  });

  it("never serves cached Profile display to readiness snapshots", () => {
    const sql = createSql();
    writeDisplay(sql, Date.now());

    expect(
      readCachedSpaceMemberDisplay({ includeAgentReadiness: false, sql })
        .profileDisplay
    ).not.toBeNull();
    for (const includeAgentReadiness of [true, undefined]) {
      const cached = readCachedSpaceMemberDisplay({
        includeAgentReadiness,
        sql,
      });
      expect(cached.profileDisplay).toBeNull();
      expect(cached.ownerAvatars).not.toBeNull();
    }
  });
});

function resolve(sql: SqlStorage, nowMs: number) {
  return resolveCachedSpaceMemberDisplay({
    cache: readSpaceMemberDisplayCache(sql),
    nowMs,
    records: listSpaceMemberRecords(sql, { status: "active" }),
  });
}

function writeDisplay(sql: SqlStorage, refreshedAtMs: number): void {
  writeSpaceMemberOwnerAvatars(sql, {
    avatarUrlByOwnerUserId: new Map([["owner-1", "https://example.com/a.png"]]),
    refreshedAtMs,
  });
  writeSpaceMemberProfileDisplay(sql, {
    displayByProfileId: new Map([
      ["human-1", { avatarStyle: null, avatarOptions: null }],
      ["agent-1", { avatarStyle: "fluid", avatarOptions: AVATAR_OPTIONS }],
    ]),
    refreshedAtMs,
  });
}

function createSql(): SqlStorage {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
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
  ensureSpaceSqlSchema(sql);
  upsertSpaceMemberRecord(sql, member("human-1", "human", "owner-1"));
  upsertSpaceMemberRecord(sql, member("agent-1", "agent", "owner-1"));
  return sql;
}

function member(
  profileId: string,
  kind: SpaceMemberRecord["profileKindSnapshot"],
  ownerUserId: string
): SpaceMemberRecord {
  const at = new Date(NOW_MS).toISOString();
  return {
    spaceId: "space-1",
    profileId,
    profileKindSnapshot: kind,
    profileNameSnapshot: profileId,
    ownerUserIdSnapshot: ownerUserId,
    ownerNameSnapshot: "Owner",
    controllerRefSnapshot: null,
    status: "active",
    memberSource: "joined_directly",
    addedAt: at,
    removedAt: null,
    addedByProfileId: null,
    addedByOwnerUserId: null,
    addedByDisplayNameSnapshot: null,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: at,
    lastEnteredAt: at,
    createdAt: at,
    updatedAt: at,
  };
}
