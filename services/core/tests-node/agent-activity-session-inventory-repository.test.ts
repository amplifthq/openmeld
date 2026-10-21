import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX } from "@openmeld/schemas";
import type {
  AgentActivitySessionInventoryQuery,
  SubmitAgentActivitySessionReconciliationBody,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptAgentActivitySessionInventoryMemberCleanup,
  retryAgentActivitySessionInventoryMemberCleanups,
} from "../src/agent-activity/activity-session-inventory-member-cleanup-service";
import {
  acceptAgentActivitySessionReconciliation,
  canResumeAgentActivitySessionSelection,
  readAgentActivitySessionInventory,
  requestAgentActivitySessionInventoryMemberCleanup,
  resolveAgentActivitySessionInventorySelection,
} from "../src/agent-activity/activity-session-inventory-repository";
import { isSessionReconciliationFingerprintCompatible } from "../src/agent-activity/activity-session-inventory-rpc";
import { forgetComputerRecordAtomically } from "../src/start/infrastructure/postgresql/current-device-forget-repo";
import {
  createBeforeMatchingPostgresTransaction,
  createDuplicateMatchingPostgresTransaction,
  createPostgresHarness,
} from "./helpers/postgresql-harness.test-support";

const NOW_MS = 1_787_200_000_000;
const LOCAL_CONNECTION_ID =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const AUTHORITY = {
  connectedComputerId: "computer-public-1",
  deviceId: "internal-device-never-public",
  organizationId: "org-1",
  ownerUserId: "user-1",
};
const harnesses: Awaited<ReturnType<typeof createPostgresHarness>>[] = [];

describe("Agent Activity Session Inventory repository", () => {
  afterEach(async () => {
    for (const harness of harnesses.splice(0)) {
      await harness.close();
    }
  });

  it("publishes only a complete reconciliation and provides stable keyset pages", async () => {
    const harness = await createInventoryHarness();
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
    const computerPage = await read(harness.db, {
      computerId: AUTHORITY.connectedComputerId,
      limit: 2,
    });
    expect(computerPage.sessions).toEqual(firstPage.sessions);
    expect(computerPage.coverage).toEqual(firstPage.coverage);
    const otherComputer = await read(harness.db, {
      computerId: "computer-other",
    });
    expect(otherComputer.sessions).toEqual([]);
    expect(otherComputer.coverage).toEqual([]);
    await expect(
      read(harness.db, {
        computerId: "computer-other",
        limit: 2,
        cursor: computerPage.nextCursor ?? undefined,
      })
    ).rejects.toThrow("Agent Activity Session cursor is invalid.");
  });

  it("stages a full reconciliation page in one candidate insert and publishes every row", async () => {
    const harness = await createInventoryHarness();
    const sessions = Array.from(
      { length: AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX },
      (_, index) =>
        observedSession(`native-${String(index).padStart(3, "0")}`, index)
    );
    const executed: string[] = [];
    const db = recordQueryTexts(harness.db, executed);

    await reconcile(db, { sessions, terminal: true });

    expect(
      executed.filter((text) =>
        text.includes(
          'INSERT INTO "openmeld"."agent_activity_session_inventory_candidates"'
        )
      )
    ).toHaveLength(1);
    expect(await inventoryRowCount(harness)).toBe(sessions.length);
    const firstPage = await read(harness.db, { limit: 1 });
    expect(firstPage.sessions[0]).toMatchObject({
      nativeSessionId: "native-000",
      nativeSessionTitle: "Native native-000",
    });
  });

  it("rejects a page that repeats a native Session without staging any of it", async () => {
    const harness = await createInventoryHarness();

    await expect(
      reconcile(harness.db, {
        sessions: [
          observedSession("native-dup", 1000),
          observedSession("native-dup", 2000),
        ],
        terminal: true,
      })
    ).rejects.toThrow();
    const staged = await harness.queryFirst<{ count: number }>({
      text: 'SELECT count(*) AS count FROM "openmeld"."agent_activity_session_inventory_candidates"',
    });
    expect(Number(staged?.count)).toBe(0);
  });

  it("enumerates several live inventory pages and rejects a changed filter", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: Array.from({ length: 7 }, (_, index) =>
        observedSession(`native-${index + 1}`, (index + 1) * 1000)
      ),
    });
    const first = await read(harness.db, { limit: 2 });
    await expect(
      read(harness.db, {
        cursor: first.nextCursor ?? undefined,
        limit: 2,
        provider: "claude-code",
      })
    ).rejects.toThrow("Agent Activity Session cursor is invalid.");
    const ids = first.sessions.map((session) => session.nativeSessionId);
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor) {
      const page = await read(harness.db, { cursor, limit: 2 });
      ids.push(...page.sessions.map((session) => session.nativeSessionId));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(4);
    }
    expect(ids).toEqual(
      Array.from({ length: 7 }, (_, index) => `native-${index + 1}`)
    );
    expect(pages).toBe(4);
  });

  it("keeps cursors live rather than claiming a frozen snapshot across source changes", async () => {
    const harness = await createInventoryHarness();
    const original = Array.from({ length: 4 }, (_, index) =>
      observedSession(`native-${index + 1}`, (index + 1) * 1000)
    );
    await reconcile(harness.db, { sessions: original });
    const first = await read(harness.db, { limit: 2 });
    await reconcile(harness.db, {
      reconciliationId: "reconciliation-new",
      sessions: [observedSession("newer-session", 0), ...original],
    });
    const remainder = await read(harness.db, {
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(
      remainder.sessions.map((session) => session.nativeSessionId)
    ).toEqual(["native-3", "native-4"]);
    expect((await read(harness.db)).sessions[0]?.nativeSessionId).toBe(
      "newer-session"
    );
  });

  it("rejects a pagination cursor issued for another Organization", async () => {
    const harness = await createInventoryHarness();
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
        projectRepositoryFingerprints: ["sha256:new-project-fingerprint"],
        reportedRepositoryFingerprint: "sha256:old-project-fingerprint",
        result: "disconnected",
      })
    ).toBe(true);
    expect(
      isSessionReconciliationFingerprintCompatible({
        projectRepositoryFingerprints: ["sha256:new-project-fingerprint"],
        reportedRepositoryFingerprint: "sha256:old-project-fingerprint",
        result: "sessions",
      })
    ).toBe(false);
    expect(
      isSessionReconciliationFingerprintCompatible({
        projectRepositoryFingerprints: [
          "sha256:new-project-fingerprint",
          "sha256:old-project-fingerprint",
        ],
        reportedRepositoryFingerprint: "sha256:old-project-fingerprint",
        result: "partial",
      })
    ).toBe(true);
  });

  it("does not let a racing reconciliation move a current Session identity between sources", async () => {
    const harness = await createInventoryHarness();
    const racingDb = createBeforeMatchingPostgresTransaction({
      beforeTransaction: async () => await insertRacingSessionIdentity(harness),
      db: harness.db,
      matches: (sql) =>
        sql.includes(
          'INSERT INTO "openmeld"."agent_activity_session_inventory" ('
        ),
    });

    await expect(
      reconcile(racingDb, {
        sessions: [observedSession("native-race", 1000)],
      })
    ).rejects.toThrow(
      "Agent Activity Session identity is already claimed by another current source."
    );

    expect(
      await harness.queryFirst<{
        source_scope_key: string;
      }>({
        values: ["native-race"],
        text: `SELECT source_scope_key
          FROM "openmeld"."agent_activity_session_inventory"
          WHERE native_session_id = $1`,
      })
    ).toEqual({ source_scope_key: "source-race-winner" });
    expect(
      await harness.queryFirst<{ problem_code: string; state: string }>({
        text: `SELECT problem_code, state
          FROM "openmeld"."agent_activity_session_inventory_sources"
          WHERE source_scope_key <> 'source-race-winner'`,
      })
    ).toEqual({
      problem_code: "session_identity_conflict",
      state: "error",
    });
  });

  it("keeps terminal publication idempotent when the same batch races twice", async () => {
    const harness = await createInventoryHarness();
    const duplicatedDb = createDuplicateMatchingPostgresTransaction({
      db: harness.db,
      matches: (sql) =>
        sql.includes(
          'INSERT INTO "openmeld"."agent_activity_session_inventory" ('
        ),
    });

    const response = await reconcile(duplicatedDb, {
      sessions: [observedSession("native-idempotent", 1000)],
    });

    expect(response.publishedSessionCount).toBe(1);
    expect((await read(harness.db)).sessions).toMatchObject([
      { nativeSessionId: "native-idempotent" },
    ]);
    expect(await inventoryRowCount(harness)).toBe(1);
  });

  it("derives Binding live and never returns internal device or local path content", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-bound", 3000)],
    });
    await harness.query({
      values: [
        "agt_11111111-1111-4111-8111-111111111111",
        "Agent",
        "agent",
        "org-1",
        "user-1",
        "active",
      ],
      text: `INSERT INTO "openmeld"."openmeld_profiles"
        (profile_id, profile_name, profile_kind, organization_id, owner_user_id, status, profile_handle, source)
        VALUES ($1, $2, $3, $4, $5, $6, 'inventory-agent', 'web_create')`,
    });
    await harness.query({
      values: [
        "binding-1",
        "user-1",
        "agt_11111111-1111-4111-8111-111111111111",
        "builtin:codex",
        "native-bound",
        "enabled_primary",
      ],
      text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
        (binding_id, owner_kind, owner_id, agent_profile_id,
         agent_controller_ref, agent_controller_conversation_id, binding_state, openmeld_service_runtime_id, created_at_ms, updated_at_ms)
        VALUES ($1, 'owner_account', $2, $3, $4, $5, $6, 'runtime-test', 1, 1)`,
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

    await harness.query({
      text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET binding_state = \'disabled_historical\', disabled_at_ms = 2',
    });
    expect((await read(harness.db)).sessions[0]).toMatchObject({
      bindingState: "unbound",
      boundAgentProfileId: null,
    });
  });

  it("authorizes Resume only from a fresh matching unbound Session fact", async () => {
    const harness = await createInventoryHarness();
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

    await harness.query({
      values: [
        "agt_22222222-2222-4222-8222-222222222222",
        "Existing Agent",
        "org-1",
        "user-1",
        "active",
      ],
      text: `INSERT INTO "openmeld"."openmeld_profiles"
        (profile_id, profile_name, profile_kind, organization_id, owner_user_id, status, profile_handle, source)
        VALUES ($1, $2, 'agent', $3, $4, $5, 'inventory-agent', 'web_create')`,
    });
    await harness.query({
      values: [
        "binding-existing",
        "user-1",
        "agt_22222222-2222-4222-8222-222222222222",
        "builtin:codex",
        "native-resume",
        "enabled_primary",
      ],
      text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
        (binding_id, owner_kind, owner_id, agent_profile_id,
         agent_controller_ref, agent_controller_conversation_id, binding_state, openmeld_service_runtime_id, created_at_ms, updated_at_ms)
        VALUES ($1, 'owner_account', $2, $3, $4, $5, $6, 'runtime-test', 1, 1)`,
    });
    await expect(validate()).resolves.toBe(false);
  });

  it("resolves Resume and Fork selections from the same current Session fact", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [
        {
          ...observedSession("native-selectable", 1000),
          canFork: true,
        },
      ],
    });
    const resolve = (
      capability: "fork" | "resume",
      overrides: Record<string, unknown> = {}
    ) =>
      resolveAgentActivitySessionInventorySelection({
        agentControllerRef: "builtin:codex",
        capability,
        computerId: AUTHORITY.connectedComputerId,
        db: harness.db,
        nativeSessionId: "native-selectable",
        nowMs: NOW_MS,
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "project-1",
        ...overrides,
      });

    const expectedSelection = {
      computerId: AUTHORITY.connectedComputerId,
      nativeSessionId: "native-selectable",
      organizationId: "org-1",
      ownerUserId: "user-1",
      projectId: "project-1",
      provider: "codex",
    };
    await expect(resolve("resume")).resolves.toEqual(expectedSelection);
    await expect(resolve("fork")).resolves.toEqual(expectedSelection);
    await expect(
      resolve("resume", { computerId: "another-computer" })
    ).resolves.toBeNull();

    await harness.query({
      values: [
        "agt_22222222-2222-4222-8222-222222222222",
        "Existing Agent",
        "org-1",
        "user-1",
        "active",
      ],
      text: `INSERT INTO "openmeld"."openmeld_profiles"
        (profile_id, profile_name, profile_kind, organization_id, owner_user_id, status, profile_handle, source)
        VALUES ($1, $2, 'agent', $3, $4, $5, 'inventory-agent', 'web_create')`,
    });
    await harness.query({
      values: [
        "binding-existing-selectable",
        "user-1",
        "agt_22222222-2222-4222-8222-222222222222",
        "builtin:codex",
        "native-selectable",
        "enabled_primary",
      ],
      text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
        (binding_id, owner_kind, owner_id, agent_profile_id,
         agent_controller_ref, agent_controller_conversation_id, binding_state, openmeld_service_runtime_id, created_at_ms, updated_at_ms)
        VALUES ($1, 'owner_account', $2, $3, $4, $5, $6, 'runtime-test', 1, 1)`,
    });
    await expect(resolve("resume")).resolves.toBeNull();
    await expect(resolve("fork")).resolves.toEqual(expectedSelection);
  });

  it("keeps the last complete rows stale after an error and removes them after disconnect", async () => {
    const harness = await createInventoryHarness();
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
    expect(await inventoryRowCount(harness)).toBe(0);
  });

  it("shows exactly attributed shared-folder Sessions while coverage stays incomplete", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      problemCode: "project_attribution_ambiguous",
      result: "partial",
      sessions: [observedSession("native-selected-project", 1000)],
    });
    const inventory = await read(harness.db);
    expect(
      inventory.sessions.map((session) => ({
        dataState: session.dataState,
        nativeSessionId: session.nativeSessionId,
      }))
    ).toEqual([
      { dataState: "stale", nativeSessionId: "native-selected-project" },
    ]);
    expect(inventory.coverage).toMatchObject([
      { problemCode: "project_attribution_ambiguous", state: "error" },
    ]);
  });

  it.each([
    "disconnected",
    "unsupported",
  ] as const)("does not let delayed %s coverage replace a newer reconciliation", async (result) => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-newer", 1000)],
    });
    const racingDb = createBeforeMatchingPostgresTransaction({
      beforeTransaction: async () => {
        await harness.query({
          values: [NOW_MS + 1, NOW_MS + 1],
          text: `UPDATE "openmeld"."agent_activity_session_inventory_sources"
            SET current_reconciliation_id = 'reconciliation-newer',
                state = 'current', last_complete_at_ms = $1, updated_at_ms = $2`,
        });
      },
      db: harness.db,
      matches: (sql) =>
        sql.includes(
          'INSERT INTO "openmeld"."agent_activity_session_inventory_sources"'
        ),
    });

    await expect(
      reconcile(racingDb, {
        reconciliationId: `reconciliation-delayed-${result}`,
        result,
        sessions: [],
      })
    ).rejects.toThrow(
      "Agent Activity Session reconciliation did not publish terminal coverage."
    );

    expect((await read(harness.db)).sessions).toMatchObject([
      { nativeSessionId: "native-newer" },
    ]);
    expect(
      await harness.queryFirst<{
        current_reconciliation_id: string;
        state: string;
      }>({
        text: `SELECT current_reconciliation_id, state
          FROM "openmeld"."agent_activity_session_inventory_sources"`,
      })
    ).toEqual({
      current_reconciliation_id: "reconciliation-newer",
      state: "current",
    });
  });

  it("returns every source coverage fact instead of a fixed snapshot", async () => {
    const harness = await createInventoryHarness();
    await harness.query({
      values: [NOW_MS, NOW_MS, NOW_MS],
      text: `WITH RECURSIVE source_number(value) AS (
          SELECT 0
          UNION ALL
          SELECT value + 1 FROM source_number WHERE value < 2500
        )
        INSERT INTO "openmeld"."agent_activity_session_inventory_sources" (
          source_scope_key, organization_id, owner_user_id, project_id,
          device_id, connected_computer_id, local_connection_id,
          agent_controller_ref, provider, state, current_reconciliation_id,
          next_page_index, problem_code, last_attempt_at_ms,
          last_complete_at_ms, updated_at_ms
        )
        SELECT
          'coverage-source-' || lpad(value::text, 4, '0'),
          'org-1', 'user-1', 'project-1',
          'coverage-device-' || value, 'coverage-computer-' || value,
          'sha256:' || lpad(to_hex(value), 64, '0'),
          'builtin:codex', 'codex', 'current', NULL,
          0, NULL, $1, $2, $3
        FROM source_number`,
    });

    const inventory = await read(harness.db);
    expect(inventory.coverage).toHaveLength(2501);
    expect(inventory.coverage.at(-1)).toMatchObject({
      computerId: "coverage-computer-999",
      state: "current",
    });
  });

  it("deletes Session metadata proven absent by a complete reconciliation", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-removed", 1000)],
    });

    await reconcile(harness.db, {
      reconciliationId: "reconciliation-without-removed-session",
      sessions: [observedSession("native-current", 500)],
    });

    expect(
      await harness.queryFirst<{ count: number }>({
        values: ["native-removed"],
        text: `SELECT count(*) AS count
          FROM "openmeld"."agent_activity_session_inventory"
          WHERE native_session_id = $1`,
      })
    ).toEqual({ count: 0 });
    expect((await read(harness.db)).sessions).toMatchObject([
      { nativeSessionId: "native-current" },
    ]);
  });

  it("keeps the last complete inventory visible while its replacement is syncing", async () => {
    const harness = await createInventoryHarness();
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
    const harness = await createInventoryHarness();
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
      await harness.queryFirst<{
        disconnected_count: number;
        source_count: number;
      }>({
        text: `SELECT
          sum(CASE WHEN state = 'disconnected' THEN 1 ELSE 0 END) AS disconnected_count,
          count(*) AS source_count
        FROM "openmeld"."agent_activity_session_inventory_sources"`,
      })
    ).toEqual({ disconnected_count: 0, source_count: 1 });
    expect((await read(harness.db)).coverage).toMatchObject([
      { state: "current" },
    ]);
  });

  it("removes Sessions from the current inventory when the Project disconnects", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-1", 1000)],
    });
    await harness.query({
      values: [NOW_MS],
      text: 'UPDATE "openmeld"."projects" SET archived_at_ms = $1 WHERE id = \'project-1\'',
    });
    expect((await read(harness.db)).sessions).toEqual([]);
    expect((await read(harness.db)).coverage).toEqual([]);
  });

  it("removes every current and staged Session projection when its Computer is forgotten", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-published", 1000)],
    });
    await reconcile(harness.db, {
      reconciliationId: "reconciliation-staged",
      sessions: [observedSession("native-staged", 500)],
      terminal: false,
    });

    await expect(
      forgetComputerRecordAtomically({
        db: harness.db,
        deviceId: AUTHORITY.deviceId,
        forgottenAtMs: NOW_MS,
        userId: AUTHORITY.ownerUserId,
      })
    ).resolves.toEqual({
      forgottenDeviceId: AUTHORITY.deviceId,
      status: "forgotten",
    });

    for (const table of [
      "agent_activity_session_inventory_candidates",
      "agent_activity_session_inventory",
      "agent_activity_session_inventory_sources",
      "openMeldDaemon_owned_devices",
    ]) {
      expect(
        await harness.queryFirst<{ count: number }>({
          values: [AUTHORITY.ownerUserId, AUTHORITY.deviceId],
          text: `SELECT count(*) AS count FROM "openmeld"."${table}"
            WHERE owner_user_id = $1 AND device_id = $2`,
        })
      ).toEqual({ count: 0 });
    }
    expect(
      await harness.queryFirst<{ count: number }>({
        values: [AUTHORITY.ownerUserId, AUTHORITY.deviceId],
        text: `SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_forgotten_devices"
          WHERE owner_user_id = $1 AND device_id = $2`,
      })
    ).toEqual({ count: 1 });
  });

  it("purges every current and staged Session projection when its Organization member is removed", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-published", 1000)],
    });
    await reconcile(harness.db, {
      reconciliationId: "reconciliation-staged",
      sessions: [observedSession("native-staged", 500)],
      terminal: false,
    });

    await expect(
      requestAgentActivitySessionInventoryMemberCleanup({
        db: harness.db,
        finalize: false,
        nowMs: NOW_MS,
        organizationId: AUTHORITY.organizationId,
        ownerUserId: AUTHORITY.ownerUserId,
      })
    ).resolves.toEqual({
      candidateCount: 1,
      inventoryCount: 1,
      sourceCount: 1,
    });

    for (const table of [
      "agent_activity_session_inventory_candidates",
      "agent_activity_session_inventory",
      "agent_activity_session_inventory_sources",
    ]) {
      expect(
        await harness.queryFirst<{ count: number }>({
          values: [AUTHORITY.organizationId, AUTHORITY.ownerUserId],
          text: `SELECT count(*) AS count FROM "openmeld"."${table}"
            WHERE organization_id = $1 AND owner_user_id = $2`,
        })
      ).toEqual({ count: 0 });
    }
    expect(
      await harness.queryFirst<{ count: number }>({
        values: [AUTHORITY.organizationId, AUTHORITY.ownerUserId],
        text: `SELECT count(*) AS count
          FROM "openmeld"."agent_activity_session_inventory_member_cleanup_requests"
          WHERE organization_id = $1 AND owner_user_id = $2`,
      })
    ).toEqual({ count: 1 });

    await reconcile(harness.db, {
      reconciliationId: "reconciliation-raced-after-cleanup-request",
      sessions: [observedSession("native-raced", 1500)],
    });
    expect(
      await harness.queryFirst<{ count: number }>({
        values: [AUTHORITY.organizationId, AUTHORITY.ownerUserId],
        text: `SELECT count(*) AS count
          FROM "openmeld"."agent_activity_session_inventory"
          WHERE organization_id = $1 AND owner_user_id = $2`,
      })
    ).toEqual({ count: 1 });

    await expect(
      requestAgentActivitySessionInventoryMemberCleanup({
        db: harness.db,
        finalize: true,
        nowMs: NOW_MS + 1,
        organizationId: AUTHORITY.organizationId,
        ownerUserId: AUTHORITY.ownerUserId,
      })
    ).resolves.toEqual({
      candidateCount: 0,
      inventoryCount: 1,
      sourceCount: 1,
    });

    for (const table of [
      "agent_activity_session_inventory_candidates",
      "agent_activity_session_inventory",
      "agent_activity_session_inventory_sources",
      "agent_activity_session_inventory_member_cleanup_requests",
    ]) {
      expect(
        await harness.queryFirst<{ count: number }>({
          values: [AUTHORITY.organizationId, AUTHORITY.ownerUserId],
          text: `SELECT count(*) AS count FROM "openmeld"."${table}"
            WHERE organization_id = $1 AND owner_user_id = $2`,
        })
      ).toEqual({ count: 0 });
    }
  });

  it("retries an accepted cleanup and removes projections that raced with member removal", async () => {
    const harness = await createInventoryHarness();
    await reconcile(harness.db, {
      sessions: [observedSession("native-before-removal", 1000)],
    });

    await expect(
      acceptAgentActivitySessionInventoryMemberCleanup({
        db: harness.db,
        nowMs: NOW_MS,
        organizationId: AUTHORITY.organizationId,
        ownerUserId: AUTHORITY.ownerUserId,
        resolveMembershipState: async () => "active",
      })
    ).resolves.toMatchObject({ pending: true });

    await reconcile(harness.db, {
      reconciliationId: "reconciliation-before-removal-commits",
      sessions: [observedSession("native-raced-before-removal", 1500)],
    });

    await expect(
      retryAgentActivitySessionInventoryMemberCleanups({
        db: harness.db,
        nowMs: NOW_MS + 1,
        resolveMembershipState: async () => "removed",
      })
    ).resolves.toEqual({
      errors: 0,
      finalized: 1,
      scanned: 1,
      waitingForRemoval: 0,
    });

    for (const table of [
      "agent_activity_session_inventory_candidates",
      "agent_activity_session_inventory",
      "agent_activity_session_inventory_sources",
      "agent_activity_session_inventory_member_cleanup_requests",
    ]) {
      expect(
        await harness.queryFirst<{ count: number }>({
          values: [AUTHORITY.organizationId, AUTHORITY.ownerUserId],
          text: `SELECT count(*) AS count FROM "openmeld"."${table}"
            WHERE organization_id = $1 AND owner_user_id = $2`,
        })
      ).toEqual({ count: 0 });
    }
  });
});

async function createInventoryHarness(): Promise<
  Awaited<ReturnType<typeof createPostgresHarness>>
> {
  const harness = await createPostgresHarness();
  harnesses.push(harness);

  for (const sql of [
    "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org-1', 'Amplift', 'amplift', 0)",
    "INSERT INTO \"openmeld\".\"users\" (id, name, email) VALUES ('user-1', 'Felix', 'felix@example.test')",
    "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, created_at) VALUES ('member-1', 'org-1', 'user-1', 0)",
    `INSERT INTO "openmeld"."projects" (id, organization_id, name, slug, archived_at_ms, created_by_user_id, created_at_ms, updated_at_ms)
      VALUES ('project-1', 'org-1', 'OpenMeld', 'openmeld', NULL, 'user-1', 0, 0)`,
  ]) {
    await harness.query({ text: sql });
  }
  await harness.query({
    values: [
      AUTHORITY.ownerUserId,
      AUTHORITY.deviceId,
      AUTHORITY.connectedComputerId,
      "Felix's MacBook Pro",
      NOW_MS,
      NOW_MS,
      NOW_MS,
    ],
    text: `INSERT INTO "openmeld"."openMeldDaemon_owned_devices"
      (owner_user_id, device_id, connected_computer_id, user_display_name,
       first_seen_at_ms, last_observed_at_ms, updated_at_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  });
  return harness;
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

function recordQueryTexts(
  db: PostgresDatabase,
  executed: string[]
): PostgresDatabase {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "transaction") {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (
        run: (client: {
          query: (query: { text: string }) => unknown;
        }) => unknown
      ) =>
        target.transaction(
          (client) =>
            run(
              new Proxy(client, {
                get(clientTarget, clientProperty, clientReceiver) {
                  const value = Reflect.get(
                    clientTarget,
                    clientProperty,
                    clientReceiver
                  );
                  if (
                    clientProperty !== "query" ||
                    typeof value !== "function"
                  ) {
                    return typeof value === "function"
                      ? value.bind(clientTarget)
                      : value;
                  }
                  return (query: { text: string }, ...rest: unknown[]) => {
                    executed.push(query.text);
                    return value.call(clientTarget, query, ...rest);
                  };
                },
              })
            ) as never
        );
    },
  });
}

async function inventoryRowCount(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<number> {
  return (
    (await (
      await harness.queryFirst<{ count: number }>({
        text: 'SELECT count(*) AS count FROM "openmeld"."agent_activity_session_inventory"',
      })
    )?.count) ?? -1
  );
}

async function insertRacingSessionIdentity(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  const competingConnectionId = `sha256:${"f".repeat(64)}`;
  await harness.query({
    values: [
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
    text: `INSERT INTO "openmeld"."agent_activity_session_inventory_sources" (
      source_scope_key, organization_id, owner_user_id, project_id,
      device_id, connected_computer_id, local_connection_id,
      agent_controller_ref, provider, state, current_reconciliation_id,
      next_page_index, problem_code, last_attempt_at_ms,
      last_complete_at_ms, updated_at_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'current', $10, 1, NULL, $11, $12, $13)`,
  });
  await harness.query({
    values: [
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
    text: `INSERT INTO "openmeld"."agent_activity_session_inventory" (
      id, organization_id, owner_user_id, agent_controller_ref,
      native_session_id, project_id, device_id, connected_computer_id,
      local_connection_id, source_scope_key, provider, native_session_title,
      status, last_active_at_ms, started_at_ms, origin, can_resume, can_fork,
      visible, source_reconciliation_id, observed_at_ms, published_at_ms,
      updated_at_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'idle', $13, NULL, 'local',
      1, 0, 1, $14, $15, $16, $17)`,
  });
}

async function reconcile(
  db: PostgresDatabase,
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
  db: PostgresDatabase,
  query: Partial<AgentActivitySessionInventoryQuery> = {}
) {
  return await readAgentActivitySessionInventory({
    db,
    nowMs: NOW_MS,
    organizationId: "org-1",
    query: { limit: 50, ...query },
  });
}
