import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

const executionContext = {
  exports: {},
  props: {},
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;
let harness: SqliteD1Harness;
let rpc: AuthRpcEntrypoint;
const profileId = (i: number) =>
  `agt_00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

beforeEach(() => {
  harness = createSqliteD1Harness();
  applyDrizzleMigrations(harness.database);
  harness.run({
    sql: "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@example.com', 1, 1, 1)",
  });
  harness.run({
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('org', 'Organization', 'organization', 1)",
  });
  for (let i = 0; i < 65; i++) {
    harness.run({
      sql: `INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, source, default_project_id, created_at, updated_at)
        VALUES (?, ?, ?, 'agent', 0, ?, 'org', 'owner', 'web_create', 'project-1', 1, 1)`,
      params: [
        profileId(i),
        `Agent ${i}`,
        `agent-${i}`,
        i === 1 ? "disabled" : "active",
      ],
    });
  }
  rpc = new AuthRpcEntrypoint(executionContext, {
    OPENMELD_DB: harness.db,
    AUTH_WORKER_NODE_ENV: "test",
  } as unknown as CloudflareBindings);
});

afterEach(() => {
  vi.restoreAllMocks();
  harness.close();
});

describe("Auth Profile fact RPC with real SQLite and Drizzle", () => {
  it("reads a bounded set in one indexed SQL query and reports absence explicitly", async () => {
    const prepare = vi.spyOn(harness.db, "prepare");
    const requested = [
      ...Array.from({ length: 63 }, (_, i) => profileId(i)),
      profileId(99),
    ];
    const result = await rpc.resolveProfilesByIds({ profileIds: requested });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(Object.keys(result.profiles)).toEqual(requested);
    expect(result.profiles[profileId(99)]).toBeNull();
    expect(result.profiles[profileId(1)]).toMatchObject({
      status: "disabled",
      ownerUserId: "owner",
      organizationId: "org",
      defaultProjectId: "project-1",
    });
    expect(result.profiles[profileId(64)]).toBeUndefined();
    const queries = prepare.mock.calls.filter(([sql]) =>
      sql.startsWith("select")
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.[0]).not.toContain("created_at");
    const plan = harness.queryAll({
      sql: "EXPLAIN QUERY PLAN SELECT profile_id FROM openmeld_profiles WHERE profile_id IN (?, ?)",
      params: [profileId(0), profileId(1)],
    });
    expect(plan.some((row) => String(row.detail).includes("SEARCH"))).toBe(
      true
    );
  });

  it("keeps scalar and batch facts equivalent, including managed profiles", async () => {
    harness.run({
      sql: "UPDATE openmeld_profiles SET managed_role = 'center_agent', owner_user_id = NULL, default_project_id = NULL WHERE profile_id = ?",
      params: [profileId(2)],
    });
    const humanId = "00000000-0000-4000-8000-000000000100";
    const systemId = "00000000-0000-4000-8000-000000000101";
    for (const { id, kind } of [
      { id: humanId, kind: "human" },
      { id: systemId, kind: "system" },
    ]) {
      harness.run({
        sql: `INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, source, created_at, updated_at)
          VALUES (?, 'Member', ?, ?, 0, 'active', 'owner', 'auth_bootstrap', 1, 1)`,
        params: [id, `member-${kind}`, kind],
      });
    }
    const ids = [profileId(0), profileId(1), profileId(2), humanId, systemId];
    const result = await rpc.resolveProfilesByIds({ profileIds: ids });
    if (!result.ok) {
      throw new Error(result.message);
    }
    for (const id of ids) {
      const scalar = await rpc.resolveProfileById({ openMeldProfileId: id });
      if (!scalar.ok) {
        throw new Error(scalar.message);
      }
      expect(result.profiles[id]).toEqual(scalar.profile);
    }
    expect(result.profiles[profileId(2)]).not.toHaveProperty(
      "defaultProjectId"
    );
  });

  it("rejects oversized input before touching storage and never turns a database failure into missing profiles", async () => {
    const prepare = vi.spyOn(harness.db, "prepare");
    expect(
      await rpc.resolveProfilesByIds({
        profileIds: Array.from({ length: 65 }, (_, i) => profileId(i)),
      })
    ).toMatchObject({ ok: false, code: "profile.invalid" });
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockImplementation(() => {
      throw new Error("D1 overloaded");
    });
    const result = await rpc.resolveProfilesByIds({
      profileIds: [profileId(0)],
    });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("profiles");
  });
});
