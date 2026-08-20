import type {
  AgentActivitySessionInventoryQuery,
  SubmitAgentActivitySessionReconciliationBody,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptAgentActivitySessionReconciliation,
  canResumeAgentActivitySessionSelection,
  readAgentActivitySessionInventory,
} from "../src/agent-activity/activity-session-inventory-repository";
import { isSessionReconciliationFingerprintCompatible } from "../src/agent-activity/activity-session-inventory-rpc";
import {
  applyDrizzleMigrationsForTables,
  createBeforeMatchingBatchD1Database,
  createDuplicateMatchingBatchD1Database,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const NOW_MS = 1_787_200_000_000;
const LOCAL_CONNECTION_ID =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const AUTHORITY = {
  connectedComputerId: "computer-public-1",
  deviceId: "internal-device-never-public",
  organizationId: "org-1",
  ownerUserId: "user-1",
};
const harnesses: ReturnType<typeof createSqliteD1Harness>[] = [];

describe("Agent Activity Session Inventory repository", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
  });

  it("publishes only a complete reconciliation and provides stable keyset pages", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      pageIndex: 0,
      sessions: [observedSession("native-3", 3000)],
      terminal: false,
    });
    expect((await read(harness.db)).sessions).toEqual([]);

    await reconcile(harness.db, {
      pageIndex: 1,
      sessions: [
        observedSession("native-2", 2000),
        observedSession("native-1", 1000),
      ],
      terminal: true,
    });

    const firstPage = await read(harness.db, { limit: 2 });
    expect(
      firstPage.sessions.map((session) => session.nativeSessionId)
    ).toEqual(["native-1", "native-2"]);
    expect(firstPage.nextCursor).toBeTypeOf("string");
    const secondPage = await read(harness.db, {
      cursor: firstPage.nextCursor ?? undefined,
      limit: 2,
    });
    expect(
      secondPage.sessions.map((session) => session.nativeSessionId)
    ).toEqual(["native-3"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("rejects a pagination cursor issued for another Organization", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [
        observedSession("native-2", 2000),
        observedSession("native-1", 1000),
      ],
    });
    const firstPage = await read(harness.db, { limit: 1 });

    await expect(
      readAgentActivitySessionInventory({
        db: harness.db,
        nowMs: NOW_MS,
        organizationId: "org-2",
        query: { cursor: firstPage.nextCursor ?? undefined, limit: 1 },
      })
    ).rejects.toThrow("Agent Activity Session cursor is invalid.");
  });

  it("allows an existing source to disconnect after the Project fingerprint changes", () => {
    expect(
      isSessionReconciliationFingerprintCompatible({
        projectRepositoryFingerprint: "sha256:new-project-fingerprint",
        reportedRepositoryFingerprint: "sha256:old-project-fingerprint",
        result: "disconnected",
      })
    ).toBe(true);
    expect(
      isSessionReconciliationFingerprintCompatible({
        projectRepositoryFingerprint: "sha256:new-project-fingerprint",
        reportedRepositoryFingerprint: "sha256:old-project-fingerprint",
        result: "sessions",
      })
    ).toBe(false);
  });

  it("does not let a racing reconciliation move a current Session identity between sources", async () => {
    const harness = createInventoryHarness();
    const racingDb = createBeforeMatchingBatchD1Database({
      beforeBatch: () => insertRacingSessionIdentity(harness),
      db: harness.db,
      matches: (sql) =>
        sql.includes("INSERT INTO agent_activity_session_inventory ("),
    });

    await expect(
      reconcile(racingDb, {
        sessions: [observedSession("native-race", 1000)],
      })
    ).rejects.toThrow(
      "Agent Activity Session identity is already claimed by another current source."
    );

    expect(
      harness.queryFirst<{
        source_scope_key: string;
      }>({
        params: ["native-race"],
        sql: `SELECT source_scope_key
          FROM agent_activity_session_inventory
          WHERE native_session_id = ?`,
      })
    ).toEqual({ source_scope_key: "source-race-winner" });
    expect(
      harness.queryFirst<{ problem_code: string; state: string }>({
        sql: `SELECT problem_code, state
          FROM agent_activity_session_inventory_sources
          WHERE source_scope_key <> 'source-race-winner'`,
      })
    ).toEqual({
      problem_code: "session_identity_conflict",
      state: "error",
    });
  });

  it("keeps terminal publication idempotent when the same batch races twice", async () => {
    const harness = createInventoryHarness();
    const duplicatedDb = createDuplicateMatchingBatchD1Database({
      db: harness.db,
      matches: (sql) =>
        sql.includes("INSERT INTO agent_activity_session_inventory ("),
    });

    const response = await reconcile(duplicatedDb, {
      sessions: [observedSession("native-idempotent", 1000)],
    });

    expect(response.publishedSessionCount).toBe(1);
    expect((await read(harness.db)).sessions).toMatchObject([
      { nativeSessionId: "native-idempotent" },
    ]);
    expect(inventoryRowCount(harness)).toBe(1);
  });

  it("derives Binding live and never returns internal device or local path content", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-bound", 3000)],
    });
    harness.run({
      params: [
        "agt_11111111-1111-4111-8111-111111111111",
        "Agent",
        "agent",
        "org-1",
        "user-1",
        "active",
      ],
      sql: `INSERT INTO openmeld_profiles
        (profile_id, profile_name, profile_kind, organization_id, owner_user_id, status)
        VALUES (?, ?, ?, ?, ?, ?)`,
    });
    harness.run({
      params: [
        "binding-1",
        "user-1",
        "agt_11111111-1111-4111-8111-111111111111",
        "builtin:codex",
        "native-bound",
        "enabled_primary",
      ],
      sql: `INSERT INTO openMeldDaemon_agent_profile_bindings
        (binding_id, owner_kind, owner_id, agent_profile_id,
         agent_controller_ref, agent_controller_conversation_id, binding_state)
        VALUES (?, 'owner_account', ?, ?, ?, ?, ?)`,
    });

    const bound = (await read(harness.db)).sessions[0];
    expect(bound).toMatchObject({
      bindingState: "bound",
      boundAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      computer: { id: "computer-public-1" },
      nativeSessionId: "native-bound",
    });
    const serialized = JSON.stringify(bound);
    expect(serialized).not.toContain(AUTHORITY.deviceId);
    expect(serialized).not.toContain("/Users/");

    harness.run({
      sql: "UPDATE openMeldDaemon_agent_profile_bindings SET binding_state = 'disabled_historical'",
    });
    expect((await read(harness.db)).sessions[0]).toMatchObject({
      bindingState: "unbound",
      boundAgentProfileId: null,
    });
  });

  it("authorizes Resume only from a fresh matching unbound Session fact", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-resume", 1000)],
    });
    const validate = (overrides: Record<string, unknown> = {}) =>
      canResumeAgentActivitySessionSelection({
        activeOrganizationId: "org-1",
        agentControllerRef: "builtin:codex",
        agentProfileId: "agt_new",
        db: harness.db,
        deviceId: AUTHORITY.deviceId,
        nowMs: NOW_MS,
        ownerUserId: "user-1",
        selection: {
          computerId: AUTHORITY.connectedComputerId,
          nativeSessionId: "native-resume",
          organizationId: "org-1",
          ownerUserId: "user-1",
          projectId: "project-1",
          provider: "codex",
        },
        ...overrides,
      });

    await expect(validate()).resolves.toBe(true);
    await expect(
      validate({ activeOrganizationId: "another-organization" })
    ).resolves.toBe(false);
    await expect(validate({ deviceId: "another-device" })).resolves.toBe(false);

    harness.run({
      params: ["agt_existing", "Existing Agent", "org-1", "user-1", "active"],
      sql: `INSERT INTO openmeld_profiles
        (profile_id, profile_name, profile_kind, organization_id, owner_user_id, status)
        VALUES (?, ?, 'agent', ?, ?, ?)`,
    });
    harness.run({
      params: [
        "binding-existing",
        "user-1",
        "agt_existing",
        "builtin:codex",
        "native-resume",
        "enabled_primary",
      ],
      sql: `INSERT INTO openMeldDaemon_agent_profile_bindings
        (binding_id, owner_kind, owner_id, agent_profile_id,
         agent_controller_ref, agent_controller_conversation_id, binding_state)
        VALUES (?, 'owner_account', ?, ?, ?, ?, ?)`,
    });
    await expect(validate()).resolves.toBe(false);
  });

  it("keeps the last complete rows stale after an error and removes them after disconnect", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-1", 1000)],
    });
    await reconcile(harness.db, {
      problemCode: "provider_read_failed",
      reconciliationId: "reconciliation-error",
      result: "error",
      sessions: [],
    });
    const stale = await read(harness.db);
    expect(stale.sessions).toHaveLength(1);
    expect(stale.sessions[0]?.dataState).toBe("stale");
    expect(stale.coverage).toMatchObject([
      { problemCode: "provider_read_failed", state: "error" },
    ]);

    await reconcile(harness.db, {
      reconciliationId: "reconciliation-disconnected",
      result: "disconnected",
      sessions: [],
    });
    const disconnected = await read(harness.db);
    expect(disconnected.sessions).toEqual([]);
    expect(disconnected.coverage).toMatchObject([
      { problemCode: null, state: "disconnected" },
    ]);
    expect(inventoryRowCount(harness)).toBe(0);
  });

  it("deletes Session metadata proven absent by a complete reconciliation", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-removed", 1000)],
    });

    await reconcile(harness.db, {
      reconciliationId: "reconciliation-without-removed-session",
      sessions: [observedSession("native-current", 500)],
    });

    expect(
      harness.queryFirst<{ count: number }>({
        params: ["native-removed"],
        sql: `SELECT count(*) AS count
          FROM agent_activity_session_inventory
          WHERE native_session_id = ?`,
      })
    ).toEqual({ count: 0 });
    expect((await read(harness.db)).sessions).toMatchObject([
      { nativeSessionId: "native-current" },
    ]);
  });

  it("keeps the last complete inventory visible while its replacement is syncing", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-published", 1000)],
    });

    await reconcile(harness.db, {
      reconciliationId: "reconciliation-in-progress",
      sessions: [observedSession("native-candidate", 500)],
      terminal: false,
    });

    const duringSync = await read(harness.db);
    expect(
      duringSync.sessions.map((session) => session.nativeSessionId)
    ).toEqual(["native-published"]);
    expect(duringSync.sessions[0]?.dataState).toBe("stale");
    expect(duringSync.coverage).toMatchObject([{ state: "syncing" }]);
  });

  it("retires a disconnected source generation after its replacement publishes", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-old", 1000)],
    });
    await reconcile(harness.db, {
      reconciliationId: "reconciliation-disconnected",
      result: "disconnected",
      sessions: [],
    });

    await reconcile(harness.db, {
      localConnectionId: `sha256:${"f".repeat(64)}`,
      reconciliationId: "reconciliation-replacement",
      sessions: [observedSession("native-replacement", 500)],
    });

    expect(
      harness.queryFirst<{ disconnected_count: number; source_count: number }>({
        sql: `SELECT
          sum(CASE WHEN state = 'disconnected' THEN 1 ELSE 0 END) AS disconnected_count,
          count(*) AS source_count
        FROM agent_activity_session_inventory_sources`,
      })
    ).toEqual({ disconnected_count: 0, source_count: 1 });
    expect((await read(harness.db)).coverage).toMatchObject([
      { state: "current" },
    ]);
  });

  it("removes Sessions from the current inventory when the Project disconnects", async () => {
    const harness = createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-1", 1000)],
    });
    harness.run({
      params: [NOW_MS],
      sql: "UPDATE projects SET archived_at_ms = ? WHERE id = 'project-1'",
    });
    expect((await read(harness.db)).sessions).toEqual([]);
    expect((await read(harness.db)).coverage).toEqual([]);
  });
});

function createInventoryHarness(): ReturnType<typeof createSqliteD1Harness> {
  const harness = createSqliteD1Harness();
  harnesses.push(harness);
  createReadAuthorityTables(harness);
  applyDrizzleMigrationsForTables(harness, [
    "agent_activity_session_inventory",
    "agent_activity_session_inventory_candidates",
    "agent_activity_session_inventory_sources",
  ]);
  for (const sql of [
    "INSERT INTO organizations (id, name) VALUES ('org-1', 'Amplift')",
    "INSERT INTO users (id, name) VALUES ('user-1', 'Felix')",
    "INSERT INTO members (organization_id, user_id) VALUES ('org-1', 'user-1')",
    `INSERT INTO projects (id, organization_id, name, slug, archived_at_ms)
      VALUES ('project-1', 'org-1', 'OpenMeld', 'openmeld', NULL)`,
  ]) {
    harness.run({ sql });
  }
  harness.run({
    params: [
      AUTHORITY.ownerUserId,
      AUTHORITY.deviceId,
      AUTHORITY.connectedComputerId,
      "Felix's MacBook Pro",
      NOW_MS,
      NOW_MS,
      NOW_MS,
    ],
    sql: `INSERT INTO openMeldDaemon_owned_devices
      (owner_user_id, device_id, connected_computer_id, user_display_name,
       first_seen_at_ms, last_observed_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
  });
  return harness;
}

function createReadAuthorityTables(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  for (const sql of [
    "CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
    "CREATE TABLE members (organization_id TEXT NOT NULL, user_id TEXT NOT NULL)",
    `CREATE TABLE projects (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL,
        slug TEXT NOT NULL, archived_at_ms INTEGER
      )`,
    `CREATE TABLE openmeld_profiles (
        profile_id TEXT PRIMARY KEY, profile_name TEXT NOT NULL,
        profile_kind TEXT NOT NULL, organization_id TEXT, owner_user_id TEXT NOT NULL,
        status TEXT NOT NULL
      )`,
    `CREATE TABLE openMeldDaemon_agent_profile_bindings (
        binding_id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
        agent_profile_id TEXT NOT NULL, agent_controller_ref TEXT NOT NULL,
        agent_controller_conversation_id TEXT, binding_state TEXT NOT NULL
      )`,
    `CREATE TABLE openMeldDaemon_runtime_registry_records (
        openmeld_service_runtime_id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL,
        owner_id TEXT NOT NULL, device_id TEXT NOT NULL
      )`,
    `CREATE TABLE openMeldDaemon_runtime_agent_controller_reports (
        openmeld_service_runtime_id TEXT NOT NULL, agent_controller_ref TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL
      )`,
  ]) {
    harness.run({ sql });
  }
}

function observedSession(nativeSessionId: string, offsetMs: number) {
  return {
    canFork: false,
    canResume: true,
    lastActiveAtMs: NOW_MS - offsetMs,
    nativeSessionId,
    nativeSessionTitle: `Native ${nativeSessionId}`,
    origin: "local" as const,
    startedAtMs: NOW_MS - offsetMs - 1000,
    status: "idle" as const,
  };
}

function inventoryRowCount(
  harness: ReturnType<typeof createSqliteD1Harness>
): number {
  return (
    harness.queryFirst<{ count: number }>({
      sql: "SELECT count(*) AS count FROM agent_activity_session_inventory",
    })?.count ?? -1
  );
}

function insertRacingSessionIdentity(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  const competingConnectionId = `sha256:${"f".repeat(64)}`;
  harness.run({
    params: [
      "source-race-winner",
      AUTHORITY.organizationId,
      AUTHORITY.ownerUserId,
      "project-1",
      AUTHORITY.deviceId,
      AUTHORITY.connectedComputerId,
      competingConnectionId,
      "builtin:codex",
      "codex",
      "reconciliation-race-winner",
      NOW_MS,
      NOW_MS,
      NOW_MS,
    ],
    sql: `INSERT INTO agent_activity_session_inventory_sources (
      source_scope_key, organization_id, owner_user_id, project_id,
      device_id, connected_computer_id, local_connection_id,
      agent_controller_ref, provider, state, current_reconciliation_id,
      next_page_index, problem_code, last_attempt_at_ms,
      last_complete_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, 1, NULL, ?, ?, ?)`,
  });
  harness.run({
    params: [
      "inventory-race-winner",
      AUTHORITY.organizationId,
      AUTHORITY.ownerUserId,
      "builtin:codex",
      "native-race",
      "project-1",
      AUTHORITY.deviceId,
      AUTHORITY.connectedComputerId,
      competingConnectionId,
      "source-race-winner",
      "codex",
      "Native native-race",
      NOW_MS - 1000,
      "reconciliation-race-winner",
      NOW_MS,
      NOW_MS,
      NOW_MS,
    ],
    sql: `INSERT INTO agent_activity_session_inventory (
      id, organization_id, owner_user_id, agent_controller_ref,
      native_session_id, project_id, device_id, connected_computer_id,
      local_connection_id, source_scope_key, provider, native_session_title,
      status, last_active_at_ms, started_at_ms, origin, can_resume, can_fork,
      visible, source_reconciliation_id, observed_at_ms, published_at_ms,
      updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, NULL, 'local',
      1, 0, 1, ?, ?, ?, ?)`,
  });
}

async function reconcile(
  db: D1Database,
  overrides: Partial<SubmitAgentActivitySessionReconciliationBody> & {
    sessions: SubmitAgentActivitySessionReconciliationBody["sessions"];
  }
) {
  return await acceptAgentActivitySessionReconciliation({
    authority: AUTHORITY,
    db,
    nowMs: NOW_MS,
    reconciliation: {
      agentControllerRef: "builtin:codex",
      lane: "dev",
      localConnectionId: LOCAL_CONNECTION_ID,
      observedAtMs: NOW_MS,
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-1",
      },
      organizationId: "org-1",
      pageIndex: 0,
      projectId: "project-1",
      provider: "codex",
      reconciliationId: "reconciliation-current",
      repositoryFingerprint: null,
      result: "sessions",
      terminal: true,
      ...overrides,
    },
  });
}

async function read(
  db: D1Database,
  query: Partial<AgentActivitySessionInventoryQuery> = {}
) {
  return await readAgentActivitySessionInventory({
    db,
    nowMs: NOW_MS,
    organizationId: "org-1",
    query: { limit: 50, ...query },
  });
}
