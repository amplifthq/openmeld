import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { SpaceProfileLineageCache } from "../src/space/application/space-profile-lineage-cache";
import {
  type SpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import {
  readSpaceProfileLineage,
  writeSpaceProfileLineage,
} from "../src/space/infrastructure/sql/space-profile-lineage-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import {
  type CreatorProfileIdsByProfileId,
  classifyCachedProfileLineage,
  PROFILE_LINEAGE_CACHE_MAX_AGE_MS,
  PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS,
} from "../src/space/rules/privacy/profile-lineage";

const OWNER = "owner-1";
const NOW_MS = Date.parse("2026-10-20T00:00:00.000Z");

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) {
    db.close();
  }
});

describe("cached Profile lineage freshness", () => {
  const cached = {
    creatorProfileIdByProfileId: { "human-1": null, "agent-1": "human-1" },
    coveredProfileIds: ["human-1", "agent-1"],
    fetchedAtMs: NOW_MS,
  };

  it("serves a young copy and refreshes it before it expires", () => {
    const classify = (ageMs: number) =>
      classifyCachedProfileLineage({
        cached,
        nowMs: NOW_MS + ageMs,
        requiredProfileIds: ["human-1", "agent-1"],
      });
    expect(classify(0)).toBe("fresh");
    expect(classify(PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS - 1)).toBe("fresh");
    expect(classify(PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS)).toBe("refresh");
    expect(classify(PROFILE_LINEAGE_CACHE_MAX_AGE_MS)).toBe("reload");
    // A copy from the future (clock skew or a bad row) is never trusted.
    expect(classify(-1)).toBe("reload");
  });

  it("reloads when a Profile the Space needs was not covered by the read", () => {
    expect(
      classifyCachedProfileLineage({
        cached,
        nowMs: NOW_MS,
        requiredProfileIds: ["human-1", "agent-2"],
      })
    ).toBe("reload");
    expect(
      classifyCachedProfileLineage({
        cached: null,
        nowMs: NOW_MS,
        requiredProfileIds: [],
      })
    ).toBe("reload");
  });
});

describe("Space Profile lineage cache", () => {
  it("reuses one Auth read across calls and Space object restarts", async () => {
    const harness = createHarness();
    vi.useFakeTimers({ now: NOW_MS });

    expect(await harness.cache().resolve(OWNER)).toEqual({
      "human-1": null,
      "agent-1": "human-1",
    });
    expect(await harness.cache().resolve(OWNER)).toEqual({
      "human-1": null,
      "agent-1": "human-1",
    });
    expect(harness.listProfileLineage).toHaveBeenCalledTimes(1);
    expect(harness.resolvedByOwnerUserId.get(OWNER)).toEqual({
      "human-1": null,
      "agent-1": "human-1",
    });
  });

  it("shares one in-flight Auth read between concurrent callers", async () => {
    const harness = createHarness();
    const cache = harness.cache();

    const [first, second] = await Promise.all([
      cache.resolve(OWNER),
      cache.resolve(OWNER),
    ]);

    expect(first).toEqual(second);
    expect(harness.listProfileLineage).toHaveBeenCalledTimes(1);
  });

  it("serves an aging copy while one background read refreshes it", async () => {
    const harness = createHarness();
    vi.useFakeTimers({ now: NOW_MS });
    await harness.cache().resolve(OWNER);
    harness.listProfileLineage.mockResolvedValueOnce(
      lineageResult({ "human-1": null, "agent-1": null })
    );
    vi.setSystemTime(NOW_MS + PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS);

    expect(await harness.cache().resolve(OWNER)).toEqual({
      "human-1": null,
      "agent-1": "human-1",
    });
    expect(harness.waitUntil).toHaveBeenCalledTimes(1);
    await harness.waitUntil.mock.calls[0]?.[0];

    expect(harness.listProfileLineage).toHaveBeenCalledTimes(2);
    expect(readSpaceProfileLineage(harness.sql, OWNER)).toMatchObject({
      creatorProfileIdByProfileId: { "human-1": null, "agent-1": null },
      fetchedAtMs: NOW_MS + PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS,
    });
  });

  it("fails closed when an expired copy cannot be reloaded", async () => {
    const harness = createHarness();
    vi.useFakeTimers({ now: NOW_MS });
    await harness.cache().resolve(OWNER);
    harness.listProfileLineage.mockResolvedValueOnce({ ok: false });
    vi.setSystemTime(NOW_MS + PROFILE_LINEAGE_CACHE_MAX_AGE_MS);

    expect(await harness.cache().resolve(OWNER)).toBeUndefined();
    // Synchronous readers must not keep using the expired lineage either.
    expect(harness.resolvedByOwnerUserId.has(OWNER)).toBe(false);
  });

  it("reloads when an owner's new member joined after the cached read", async () => {
    const harness = createHarness();
    vi.useFakeTimers({ now: NOW_MS });
    await harness.cache().resolve(OWNER);
    upsertSpaceMemberRecord(harness.sql, member("agent-2", "agent"));
    harness.listProfileLineage.mockResolvedValueOnce(
      lineageResult({
        "human-1": null,
        "agent-1": "human-1",
        "agent-2": "agent-1",
      })
    );

    expect(await harness.cache().resolve(OWNER)).toMatchObject({
      "agent-2": "agent-1",
    });
    expect(harness.listProfileLineage).toHaveBeenCalledTimes(2);
  });

  it("serves live fan-out only a copy under the maximum age", async () => {
    const harness = createHarness();
    vi.useFakeTimers({ now: NOW_MS });
    const cache = harness.cache();
    await cache.resolve(OWNER);

    expect(cache.peek(OWNER)).toMatchObject({ "agent-1": "human-1" });
    expect(harness.waitUntil).not.toHaveBeenCalled();

    vi.setSystemTime(NOW_MS + PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS);
    expect(cache.peek(OWNER)).toMatchObject({ "agent-1": "human-1" });
    expect(harness.waitUntil).toHaveBeenCalledTimes(1);

    await harness.waitUntil.mock.calls[0]?.[0];
  });

  it("rate limits aging-copy refreshes and reports their failures", async () => {
    const harness = createHarness();
    vi.useFakeTimers({ now: NOW_MS });
    const cache = harness.cache();
    await cache.resolve(OWNER);
    harness.listProfileLineage.mockRejectedValue(new Error("auth down"));
    vi.setSystemTime(NOW_MS + PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS);

    expect(cache.peek(OWNER)).toMatchObject({ "agent-1": "human-1" });
    expect(cache.peek(OWNER)).toMatchObject({ "agent-1": "human-1" });
    expect(harness.waitUntil).toHaveBeenCalledTimes(1);
    await expect(harness.waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();

    expect(cache.peek(OWNER)).toMatchObject({ "agent-1": "human-1" });
    expect(harness.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("stops serving live fan-out an expired copy and rate limits restores", async () => {
    // A session opened before an intermediate Profile was deleted must not
    // keep that chain once the copy expires and Auth is unavailable.
    const harness = createHarness();
    vi.useFakeTimers({ now: NOW_MS });
    const cache = harness.cache();
    await cache.resolve(OWNER);
    harness.listProfileLineage.mockResolvedValue({ ok: false });
    vi.setSystemTime(NOW_MS + PROFILE_LINEAGE_CACHE_MAX_AGE_MS);

    expect(cache.peek(OWNER)).toBeUndefined();
    expect(harness.resolvedByOwnerUserId.has(OWNER)).toBe(false);
    expect(harness.waitUntil).toHaveBeenCalledTimes(1);
    await harness.waitUntil.mock.calls[0]?.[0];
    expect(harness.listProfileLineage).toHaveBeenCalledTimes(2);

    expect(cache.peek(OWNER)).toBeUndefined();
    expect(harness.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer stored read when an older read finishes later", () => {
    const harness = createHarness();
    writeSpaceProfileLineage(harness.sql, OWNER, {
      creatorProfileIdByProfileId: { "human-1": null },
      coveredProfileIds: ["human-1"],
      fetchedAtMs: NOW_MS + 10,
    });
    writeSpaceProfileLineage(harness.sql, OWNER, {
      creatorProfileIdByProfileId: { "human-1": "stale" },
      coveredProfileIds: ["human-1"],
      fetchedAtMs: NOW_MS,
    });

    expect(readSpaceProfileLineage(harness.sql, OWNER)).toMatchObject({
      creatorProfileIdByProfileId: { "human-1": null },
      fetchedAtMs: NOW_MS + 10,
    });
  });

  it("treats an unreadable stored row as missing", async () => {
    const harness = createHarness();
    harness.sql.exec(
      "INSERT INTO space_profile_lineage VALUES (?, ?, ?, ?)",
      OWNER,
      "{not-json",
      "[]",
      Date.now()
    );

    expect(readSpaceProfileLineage(harness.sql, OWNER)).toBeNull();
    await harness.cache().resolve(OWNER);
    expect(harness.listProfileLineage).toHaveBeenCalledTimes(1);
  });
});

function createHarness() {
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
  upsertSpaceMemberRecord(sql, member("human-1", "human"));
  upsertSpaceMemberRecord(sql, member("agent-1", "agent"));
  const listProfileLineage = vi
    .fn()
    .mockResolvedValue(
      lineageResult({ "human-1": null, "agent-1": "human-1" })
    );
  const resolvedByOwnerUserId = new Map<string, CreatorProfileIdsByProfileId>();
  const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
  // Each call builds a new cache over the same storage, as a restarted
  // Space object would.
  const cache = () =>
    new SpaceProfileLineageCache({
      authRpc: () =>
        ({
          listProfileLineage,
        }) as unknown as CoreBindings["OPENMELD_AUTH_WORKER"],
      onLoadError: () => undefined,
      resolvedByOwnerUserId,
      sql: () => sql,
      waitUntil,
    });
  return { cache, listProfileLineage, resolvedByOwnerUserId, sql, waitUntil };
}

function lineageResult(creatorByProfileId: Record<string, string | null>) {
  return {
    ok: true,
    profiles: Object.entries(creatorByProfileId).map(
      ([profileId, creatorProfileId]) => ({ profileId, creatorProfileId })
    ),
  };
}

function member(
  profileId: string,
  kind: SpaceMemberRecord["profileKindSnapshot"]
): SpaceMemberRecord {
  const at = new Date(NOW_MS).toISOString();
  return {
    spaceId: "space-1",
    profileId,
    profileKindSnapshot: kind,
    profileNameSnapshot: profileId,
    ownerUserIdSnapshot: OWNER,
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
