import type {
  AgentControllerInterfaceSnapshot,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcSubmitRuntimeAgentControllerReports,
  rpcSubmitRuntimeProviderConversationProofs,
  rpcSubmitRuntimeRegistration,
} from "../src/rpc/methods";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const DEFAULT_CONTEXT: OpenMeldRequestContext = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human",
    profileName: "Mira",
    requestId: "req-runtime-reporting",
  },
};

describe("runtime reporting Core RPC write", () => {
  it("creates and reuses Runtime registration for the authenticated owner context", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReportingMigrations(harness);
    try {
      const env = coreEnv(harness.db);

      const created = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      const reused = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });

      expect(created.status).toBe("created");
      expect(reused.status).toBe("reused");
      expect(reused.openMeldServiceRuntimeId).toEqual(
        created.openMeldServiceRuntimeId
      );
      expect(
        harness.queryFirst<{
          owner_id: string;
          owner_kind: string;
        }>({
          sql: `
            SELECT owner_kind, owner_id
            FROM openMeldDaemon_runtime_registry_records
            WHERE openmeld_service_runtime_id = ?
          `,
          params: [created.openMeldServiceRuntimeId?.value ?? ""],
        })
      ).toEqual({
        owner_id: "owner-1",
        owner_kind: "owner_account",
      });
    } finally {
      harness.close();
    }
  });

  it("accepts a Runtime Agent Controller Report and reuses an identical retry", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReportingMigrations(harness);
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      const expiresAtMs = observedAtMs + 60_000;

      const first = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs,
            observedAtMs,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });
      const retry = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs,
            observedAtMs,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(first).toMatchObject({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            outcome: "created",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
      expect(retry).toMatchObject({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            outcome: "reused",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("does not read recovery for 50 Profiles without a recovery gate", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReportingMigrations(harness);
    try {
      const markUsageAvailable = vi.fn().mockResolvedValue({
        changedProfileIds: [],
        continuationProfileIds: [],
        status: "updated",
      });
      const readRecovery = vi.fn().mockResolvedValue({
        status: "not_pending",
      });
      const ownerShard = {
        rpcMarkAgentProfileWorkUsageAvailable: markUsageAvailable,
        rpcReadAgentProfileWorkRecovery: readRecovery,
      };
      const spaceGet = vi.fn();
      const env = {
        ...coreEnv(harness.db),
        OPENMELD_RUNTIME_TRANSPORT: {
          get: vi.fn(() => ownerShard),
          idFromName: vi.fn((name: string) => name),
        },
        OPENMELD_SPACES: {
          get: spaceGet,
          idFromString: vi.fn((value: string) => value),
        },
      } as unknown as CoreBindings;
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      const profileIds = Array.from({ length: 50 }, (_, index) =>
        buildTestAgentProfileId(index + 1)
      );
      for (const [index, agentProfileId] of profileIds.entries()) {
        insertPrimaryAgentProfileBinding(harness, {
          agentControllerConversationId: `conversation-usage-recovery-${index}`,
          agentControllerRef: "builtin:codex",
          agentProfileId,
          bindingId: `binding-usage-recovery-${index}`,
          nowMs: observedAtMs,
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
          ownerId: "owner-1",
        });
      }
      const report = {
        agentControllerInterface: createAvailableUsageInterface(),
        agentControllerRef: "builtin:codex",
        expiresAtMs: observedAtMs + 60_000,
        observedAtMs,
        reasonCodes: ["runtime.agent_controller_report.ready"],
        status: "ready" as const,
      };

      const first = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [report],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });
      const retry = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [report],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(first.reports[0]).toMatchObject({ outcome: "created" });
      expect(retry.reports[0]).toMatchObject({ outcome: "reused" });
      expect(markUsageAvailable).toHaveBeenCalledTimes(2);
      expect(markUsageAvailable).toHaveBeenNthCalledWith(1, {
        ownerUserId: "owner-1",
        targetProfileIds: profileIds,
      });
      expect(markUsageAvailable).toHaveBeenNthCalledWith(2, {
        ownerUserId: "owner-1",
        targetProfileIds: profileIds,
      });
      expect(readRecovery).not.toHaveBeenCalled();
      expect(spaceGet).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("rejects stale, out-of-order, conflicting, and lookup-derived Runtime Agent Controller Reports", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReportingMigrations(harness);
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();

      await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs: observedAtMs + 60_000,
            observedAtMs,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs - 1,
              observedAtMs: observedAtMs - 2,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            reason: "stale",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs: observedAtMs - 1,
              status: "unavailable",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            reason: "out_of_order",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs,
              status: "disabled",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            reason: "conflict",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs: observedAtMs + 1,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "owner_account:owner-1:device-1:openmeld-dev",
          },
        })
      ).resolves.toEqual({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            reason: "openmeld_service_runtime_id_invalid",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs: observedAtMs + 1,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_attacker",
          },
        })
      ).resolves.toEqual({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            reason: "openmeld_service_runtime_id_mismatch",
            status: "rejected",
          },
        ],
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects invalid Agent Controller refs without accepting a Runtime Agent Controller Report", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReportingMigrations(harness);
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:bad id",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            agentControllerRef: "builtin:bad id",
            reason: "agent_controller_ref_invalid",
            status: "rejected",
          },
        ],
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("accepts a Provider Conversation Proof and reuses an identical retry", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReportingMigrations(harness);
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      const expiresAtMs = observedAtMs + 60_000;
      insertPrimaryAgentProfileBinding(harness, {
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
        agentControllerRef: "builtin:codex",
        agentProfileId: "agt_1",
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        bindingId: "binding_1",
        nowMs: observedAtMs,
        ownerId: "owner-1",
      });

      const first = await rpcSubmitRuntimeProviderConversationProofs(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        proofs: [
          {
            agentProfileId: "agt_1",
            bindingId: "binding_1",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId:
              "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
            transportMode: "codex-app-server",
            provider: "codex",
            method: "codex_app_server_thread_resume",
            intrusive: false,
            observedAtMs,
            expiresAtMs,
            status: "passed",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });
      const retry = await rpcSubmitRuntimeProviderConversationProofs(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        proofs: [
          {
            agentProfileId: "agt_1",
            bindingId: "binding_1",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId:
              "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
            transportMode: "codex-app-server",
            provider: "codex",
            method: "codex_app_server_thread_resume",
            intrusive: false,
            observedAtMs,
            expiresAtMs,
            status: "passed",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(first).toMatchObject({
        proofs: [
          {
            agentProfileId: "agt_1",
            bindingId: "binding_1",
            outcome: "created",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
      expect(retry).toMatchObject({
        proofs: [
          {
            outcome: "reused",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
      expect(
        harness.queryFirst<{
          status: string;
          intrusive: number;
        }>({
          sql: `
            SELECT status, intrusive
            FROM openMeldDaemon_provider_conversation_proofs
            WHERE agent_profile_id = ?
              AND binding_id = ?
          `,
          params: ["agt_1", "binding_1"],
        })
      ).toEqual({
        status: "passed",
        intrusive: 0,
      });
    } finally {
      harness.close();
    }
  });

  it("rejects Provider Conversation Proofs that do not match the primary binding", async () => {
    const harness = createSqliteD1Harness();
    applyRuntimeReportingMigrations(harness);
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      insertPrimaryAgentProfileBinding(harness, {
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
        agentControllerRef: "builtin:codex",
        agentProfileId: "agt_1",
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        bindingId: "binding_1",
        nowMs: observedAtMs,
        ownerId: "owner-1",
      });

      await expect(
        rpcSubmitRuntimeProviderConversationProofs(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          proofs: [
            {
              agentProfileId: "agt_1",
              bindingId: "binding_1",
              agentControllerRef: "builtin:codex",
              agentControllerConversationId: "different-thread",
              transportMode: "codex-app-server",
              provider: "codex",
              method: "codex_app_server_thread_resume",
              intrusive: false,
              observedAtMs,
              expiresAtMs: observedAtMs + 60_000,
              status: "passed",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        proofs: [
          {
            reason: "agent_profile_binding_mismatch",
            status: "rejected",
          },
        ],
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });
});

function coreEnv(db: D1Database): CoreBindings {
  return {
    OPENMELD_DB: db,
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
}

function buildTestAgentProfileId(index: number): string {
  return `agt_00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function applyRuntimeReportingMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
  applyMigrationForTable(
    harness,
    "openMeldDaemon_runtime_agent_controller_reports"
  );
  applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
  applyMigrationForTable(
    harness,
    "openMeldDaemon_provider_conversation_proofs"
  );
}

function insertPrimaryAgentProfileBinding(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    agentControllerConversationId: string;
    agentControllerRef: string;
    agentProfileId: string;
    openMeldServiceRuntimeId: string;
    bindingId: string;
    nowMs: number;
    ownerId: string;
  }
): void {
  harness.run({
    sql: `
      INSERT INTO openMeldDaemon_agent_profile_bindings (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        agent_controller_ref,
        agent_controller_conversation_id,
        binding_state,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, 'owner_account', ?, ?, ?, ?, ?, 'enabled_primary', ?, ?)
    `,
    params: [
      input.bindingId,
      input.ownerId,
      input.agentProfileId,
      input.openMeldServiceRuntimeId,
      input.agentControllerRef,
      input.agentControllerConversationId,
      input.nowMs,
      input.nowMs,
    ],
  });
}

function createAvailableUsageInterface() {
  const observedAt = new Date().toISOString();
  return {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated" as const },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: true,
    },
    checkedAt: observedAt,
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready" as const,
    },
    message: null,
    models: [],
    nativeInterface: "codex-app-server" as const,
    schemaVersion: 1 as const,
    skills: [],
    status: "ready" as const,
    usageLimits: [
      {
        key: "five_hour",
        label: "5-hour Usage Limit",
        observedAt,
        resetsAt: new Date(Date.now() + 60_000).toISOString(),
        status: "available" as const,
        usedPercent: 42,
      },
    ],
    version: "1.0.0",
  } satisfies AgentControllerInterfaceSnapshot;
}
