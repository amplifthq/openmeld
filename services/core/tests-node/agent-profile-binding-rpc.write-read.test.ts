import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { acceptAgentActivitySessionReconciliation } from "../src/agent-activity/activity-session-inventory-repository";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcDisableAgentProfilePrimaryBinding,
  rpcEnsureAgentProfilePrimaryBinding,
  rpcGetAgentProfilePrimaryBinding,
  rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode,
  rpcUpdateAgentProfilePrimaryBindingModelSelection,
  rpcUpdateAgentProfilePrimaryBindingOpenCodePermission,
} from "../src/rpc/methods";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import { readAvailableModelIds } from "../tests/test-support/model-catalog.test-support";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const OTHER_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const DEFAULT_CONTEXT: OpenMeldRequestContext = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human",
    profileName: "Mira",
    requestId: "req-agent-profile-binding",
  },
};
const SESSION_RESUME_CONTEXT: OpenMeldRequestContext = {
  ...DEFAULT_CONTEXT,
  activeOrganizationId: "org-personal-owner-1",
};
const CODEX_AVAILABLE_MODEL_IDS = readAvailableModelIds("codex");
const UNKNOWN_MODEL_SUPPORT_MESSAGE = `Model "gpt-99-nonexistent" is not supported for Agent Controller "builtin:codex". Supported models: ${CODEX_AVAILABLE_MODEL_IDS.join(", ")}.`;
const UNSUPPORTED_REASONING_MESSAGE =
  'Reasoning level "ultra" is not supported for model "gpt-5.5". Supported reasoning levels: low, medium, high, xhigh.';

describe("agent profile binding Core RPC", () => {
  it("revalidates a resumed Session against the current Core inventory before writing Binding truth", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    for (const tableName of [
      "agent_activity_session_inventory",
      "agent_activity_session_inventory_candidates",
      "agent_activity_session_inventory_sources",
    ]) {
      applyMigrationForTable(harness, tableName);
    }
    try {
      for (const sql of [
        "ALTER TABLE projects ADD COLUMN organization_id text",
        "ALTER TABLE projects ADD COLUMN name text",
        "ALTER TABLE projects ADD COLUMN slug text",
        "ALTER TABLE projects ADD COLUMN archived_at_ms integer",
      ]) {
        harness.run({ sql });
      }
      harness.run({
        params: ["project-1", "org-personal-owner-1", "OpenMeld", "openmeld"],
        sql: `INSERT INTO projects
          (id, organization_id, name, slug, archived_at_ms)
          VALUES (?, ?, ?, ?, NULL)`,
      });
      harness.run({
        params: ["owner-1", "device-1", "computer-1", Date.now(), Date.now()],
        sql: `INSERT INTO openMeldDaemon_owned_devices
          (owner_user_id, device_id, connected_computer_id,
           first_seen_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, ?)`,
      });
      const observedAtMs = Date.now();
      await acceptAgentActivitySessionReconciliation({
        authority: {
          connectedComputerId: "computer-1",
          deviceId: "device-1",
          organizationId: "org-personal-owner-1",
          ownerUserId: "owner-1",
        },
        db: harness.db,
        nowMs: observedAtMs,
        reconciliation: {
          agentControllerRef: "builtin:codex",
          lane: "openmeld-dev",
          localConnectionId: `sha256:${"a".repeat(64)}`,
          observedAtMs,
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
          organizationId: "org-personal-owner-1",
          pageIndex: 0,
          projectId: "project-1",
          provider: "codex",
          reconciliationId: "reconciliation-resume",
          repositoryFingerprint: null,
          result: "sessions",
          sessions: [
            {
              canFork: false,
              canResume: true,
              lastActiveAtMs: observedAtMs,
              nativeSessionId: "native-session-1",
              nativeSessionTitle: "Native Session",
              origin: "local",
              startedAtMs: observedAtMs - 1000,
              status: "idle",
            },
          ],
          terminal: true,
        },
      });
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const input = {
        agentControllerConversationId: "native-session-1",
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: SESSION_RESUME_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: registeredRuntimeId,
        sessionInventorySelection: {
          computerId: "computer-1",
          nativeSessionId: "native-session-1",
          organizationId: "org-personal-owner-1",
          ownerUserId: "owner-1",
          projectId: "project-1",
          provider: "codex" as const,
        },
      };

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), input)
      ).resolves.toMatchObject({ status: "accepted" });

      harness.run({
        sql: "UPDATE agent_activity_session_inventory_sources SET state = 'error'",
      });
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), input)
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
        status: "rejected",
      });

      harness.run({
        sql: "DELETE FROM openMeldDaemon_agent_profile_bindings",
      });
      harness.run({
        sql: "UPDATE agent_activity_session_inventory_sources SET state = 'current'",
      });
      const authWorker = {
        resolveProfileById: vi.fn(async () => {
          await Promise.resolve();
          harness.run({
            sql: "UPDATE agent_activity_session_inventory_sources SET state = 'error'",
          });
          return {
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "agent-one",
              profileId: AGENT_PROFILE_ID,
              profileKind: "agent" as const,
              profileName: "Agent One",
              status: "active" as const,
            },
          };
        }),
      } satisfies CoreBindings["OPENMELD_AUTH_WORKER"];

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(
          coreEnv(harness.db, { authWorker }),
          input
        )
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
        status: "rejected",
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 0 });

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
          ...input,
          agentControllerConversationId: "native-session-old",
          sessionInventorySelection: undefined,
        })
      ).resolves.toMatchObject({ status: "accepted" });
      harness.run({
        sql: "UPDATE agent_activity_session_inventory_sources SET state = 'current'",
      });

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(
          coreEnv(harness.db, { authWorker }),
          { ...input, writeMode: "reconnect" }
        )
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
        status: "rejected",
      });
      expect(
        harness.queryFirst<{
          agent_controller_conversation_id: string;
          binding_state: string;
          count: number;
        }>({
          sql: `SELECT agent_controller_conversation_id, binding_state,
            count(*) AS count
            FROM openMeldDaemon_agent_profile_bindings
            WHERE binding_state = 'enabled_primary'`,
        })
      ).toEqual({
        agent_controller_conversation_id: "native-session-old",
        binding_state: "enabled_primary",
        count: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("creates and reads primary Binding truth from authenticated owner, Profile owner, Runtime, and Agent Controller Report evidence", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);

      const created = await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "codex-thread-1",
        agentControllerCollaborationMode: "codex:plan",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        agentControllerPermissionMode: "codex:approveForMe",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });
      const read = await rpcGetAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
      });

      expect(created).toMatchObject({
        binding: {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerCollaborationMode: "codex:plan",
          agentControllerPermissionMode: "codex:approveForMe",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerConversationId: "codex-thread-1",
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          },
        },
        grantsClaimSuccess: false,
        outcome: "created",
        routable: true,
        status: "accepted",
      });
      expect(read).toMatchObject({
        binding: {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerCollaborationMode: "codex:plan",
          agentControllerPermissionMode: "codex:approveForMe",
          bindingId: created.binding?.bindingId,
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerConversationId: "codex-thread-1",
            agentControllerRef: "builtin:codex",
          },
          routable: true,
        },
        grantsClaimSuccess: false,
        status: "found",
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 1 });
    } finally {
      harness.close();
    }
  });

  it("rejects an unknown model with the supported model list before writing Binding truth", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:codex",
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          modelId: "gpt-99-nonexistent",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: registeredRuntimeId.value,
          },
        })
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile_binding.model_not_supported",
          message: UNKNOWN_MODEL_SUPPORT_MESSAGE,
          status: 400,
        },
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 0 });
    } finally {
      harness.close();
    }
  });

  it("rejects an unsupported reasoning level with the model's supported values", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:codex",
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          modelId: "gpt-5.5",
          reasoningLevel: "ultra",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: registeredRuntimeId.value,
          },
        })
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile_binding.reasoning_level_not_supported",
          message: UNSUPPORTED_REASONING_MESSAGE,
          status: 400,
        },
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 0 });
    } finally {
      harness.close();
    }
  });

  it("rejects an unknown model update without changing the existing Binding selection", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);
      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        modelId: "gpt-5.5",
        reasoningLevel: "high",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });

      await expect(
        rpcUpdateAgentProfilePrimaryBindingModelSelection(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          modelId: "gpt-99-nonexistent",
        })
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile_binding.model_not_supported",
          message: UNKNOWN_MODEL_SUPPORT_MESSAGE,
          status: 400,
        },
      });
      expect(
        harness.queryFirst<{
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          sql: "SELECT model_id, reasoning_level FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({
        model_id: "gpt-5.5",
        reasoning_level: "high",
      });
    } finally {
      harness.close();
    }
  });

  it("updates Agent Controller Permission Mode without changing Binding target", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);

      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });

      await expect(
        rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(env, {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerPermissionMode: "codex:fullAccess",
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toMatchObject({
        binding: {
          agentControllerPermissionMode: "codex:fullAccess",
          agentProfileId: AGENT_PROFILE_ID,
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
          },
        },
        outcome: "reused",
        routable: true,
        status: "accepted",
      });

      expect(
        harness.queryFirst<{
          agent_controller_permission_mode: string | null;
          agent_controller_ref: string;
          configuration_revision: number;
        }>({
          sql: "SELECT agent_controller_permission_mode, agent_controller_ref, configuration_revision FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({
        agent_controller_permission_mode: "codex:fullAccess",
        agent_controller_ref: "builtin:codex",
        configuration_revision: 2,
      });
    } finally {
      harness.close();
    }
  });

  it("returns saved OpenCode permissions after a fresh primary Binding read", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId = await seedRuntimeAgentControllerReport(
        harness,
        {
          agentControllerRef: "builtin:opencode",
        }
      );
      const env = coreEnv(harness.db);
      const openCodePermission = {
        bash: {
          "*": "ask" as const,
          "git status *": "allow" as const,
        },
        edit: "allow" as const,
      };

      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:opencode",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });

      const saved = await rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(
        env,
        {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          openCodePermission,
        }
      );
      const reopened = await rpcGetAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
      });

      expect(saved).toMatchObject({
        binding: {
          agentProfileId: AGENT_PROFILE_ID,
          executionTarget: {
            agentControllerRef: "builtin:opencode",
          },
          openCodePermission,
        },
        status: "accepted",
      });
      expect(reopened).toMatchObject({
        binding: {
          agentProfileId: AGENT_PROFILE_ID,
          openCodePermission,
        },
        status: "found",
      });
      expect(
        harness.queryFirst<{
          configuration_revision: number;
          opencode_permission: string | null;
        }>({
          sql: "SELECT configuration_revision, opencode_permission FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({
        configuration_revision: 2,
        opencode_permission: JSON.stringify(openCodePermission),
      });
    } finally {
      harness.close();
    }
  });

  it("increments the configuration revision when model selection changes", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);
      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });

      await expect(
        rpcUpdateAgentProfilePrimaryBindingModelSelection(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          modelId: "gpt-5.5",
          reasoningLevel: "high",
        })
      ).resolves.toMatchObject({
        binding: {
          modelSelection: {
            modelId: "gpt-5.5",
            reasoningLevel: "high",
          },
        },
        status: "accepted",
      });

      expect(
        harness.queryFirst<{
          configuration_revision: number;
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          sql: "SELECT configuration_revision, model_id, reasoning_level FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({
        configuration_revision: 2,
        model_id: "gpt-5.5",
        reasoning_level: "high",
      });
    } finally {
      harness.close();
    }
  });

  it("disables the enabled primary Binding without deleting Agent Profile identity", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);

      const created = await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });

      await expect(
        rpcDisableAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        agentProfileId: AGENT_PROFILE_ID,
        disabled: true,
        reasonCodes: ["agent_profile_binding.primary_binding_disabled"],
        status: "disabled",
      });

      await expect(
        rpcGetAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toMatchObject({
        binding: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingState: "missing",
          executionTarget: null,
          routable: false,
        },
        status: "missing",
      });
      expect(
        harness.queryAll<{
          binding_id: string;
          binding_state: string;
          reason_code: string | null;
        }>({
          sql: "SELECT binding_id, binding_state, reason_code FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([
        {
          binding_id: created.binding?.bindingId,
          binding_state: "disabled_historical",
          reason_code: "agent_profile_binding.primary_binding_disabled",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("returns missing when disabling a profile without an enabled primary Binding", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const env = coreEnv(harness.db);

      await expect(
        rpcDisableAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        agentProfileId: AGENT_PROFILE_ID,
        disabled: false,
        reasonCodes: ["agent_profile_binding.missing"],
        status: "missing",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects primary Binding disable requests from a non-owner without changing Binding truth", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const ownerEnv = coreEnv(harness.db);
      await rpcEnsureAgentProfilePrimaryBinding(ownerEnv, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });

      const nonOwnerEnv = coreEnv(harness.db, {
        authWorker: {
          resolveProfileById: vi.fn(async () => ({
            ok: true as const,
            profile: {
              ownerUserId: "owner-2",
              profileHandle: "agent-two",
              profileId: AGENT_PROFILE_ID,
              profileKind: "agent" as const,
              profileName: "Agent Two",
              status: "active" as const,
            },
          })),
        },
      });

      await expect(
        rpcDisableAgentProfilePrimaryBinding(nonOwnerEnv, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        agentProfileId: AGENT_PROFILE_ID,
        disabled: false,
        reasonCodes: ["agent_profile_binding.owner_mismatch"],
        status: "unavailable",
      });
      expect(
        harness.queryFirst<{
          binding_state: string;
          disabled_at_ms: number | null;
          reason_code: string | null;
        }>({
          sql: "SELECT binding_state, disabled_at_ms, reason_code FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({
        binding_state: "enabled_primary",
        disabled_at_ms: null,
        reason_code: "agent_profile_binding.command_eligible",
      });
    } finally {
      harness.close();
    }
  });

  it("omits invalid stored Agent Controller Permission Mode", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);

      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });
      harness.run({
        params: ["unsupported"],
        sql: "UPDATE openMeldDaemon_agent_profile_bindings SET agent_controller_permission_mode = ?",
      });

      const response = await rpcGetAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
      });
      expect(response).toMatchObject({
        binding: {
          bindingState: "enabled_primary",
        },
        status: "found",
      });
      expect(response.binding).not.toHaveProperty(
        "agentControllerPermissionMode"
      );
    } finally {
      harness.close();
    }
  });

  it("reuses an identical Binding command retry without creating a duplicate row", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);
      const input = {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority" as const,
          value: registeredRuntimeId.value,
        },
      };

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(env, input)
      ).resolves.toMatchObject({
        outcome: "created",
        status: "accepted",
      });
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(env, input)
      ).resolves.toMatchObject({
        outcome: "reused",
        status: "accepted",
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 1 });
    } finally {
      harness.close();
    }
  });

  it("rejects forged openMeldServiceRuntimeId and Profile owner mismatch without writing Binding truth", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      await seedRuntimeAgentControllerReport(harness);

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:codex",
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "owner_account:owner-1:device-1:openmeld-dev",
          },
        })
      ).resolves.toEqual({
        grantsClaimSuccess: false,
        reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
        routable: false,
        status: "rejected",
      });

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(
          coreEnv(harness.db, {
            authWorker: {
              resolveProfileById: vi.fn(async () => ({
                ok: true as const,
                profile: {
                  ownerUserId: "owner-2",
                  profileHandle: "agent-two",
                  profileId: AGENT_PROFILE_ID,
                  profileKind: "agent" as const,
                  profileName: "Agent Two",
                  status: "active" as const,
                },
              })),
            },
          }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            agentControllerRef: "builtin:codex",
            context: DEFAULT_CONTEXT,
            deviceId: "device-1",
            lane: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }
        )
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.owner_mismatch"],
        routable: false,
        status: "rejected",
      });

      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 0 });
    } finally {
      harness.close();
    }
  });

  it("rejects Profile owner evidence for a different Agent Profile without writing Binding truth", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      await seedRuntimeAgentControllerReport(harness);

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(
          coreEnv(harness.db, {
            authWorker: {
              resolveProfileById: vi.fn(async () => ({
                ok: true as const,
                profile: {
                  ownerUserId: "owner-1",
                  profileHandle: "other-agent",
                  profileId: OTHER_AGENT_PROFILE_ID,
                  profileKind: "agent" as const,
                  profileName: "Other Agent",
                  status: "active" as const,
                },
              })),
            },
          }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            agentControllerRef: "builtin:codex",
            context: DEFAULT_CONTEXT,
            deviceId: "device-1",
            lane: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }
        )
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.profile_owner_invalid"],
        routable: false,
        status: "rejected",
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 0 });
    } finally {
      harness.close();
    }
  });

  it("rejects non-runnable Runtime Agent Controller Report evidence without writing Binding truth", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId = await seedRuntimeAgentControllerReport(
        harness,
        {
          status: "disabled",
        }
      );

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:codex",
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: registeredRuntimeId.value,
          },
        })
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.agent_controller_report_disabled"],
        routable: false,
        status: "rejected",
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ count: 0 });
    } finally {
      harness.close();
    }
  });

  it("rejects a different enabled target as primary conflict without silent replace", async () => {
    const harness = createSqliteD1Harness();
    applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      await seedRuntimeAgentControllerReport(harness, {
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeIdValue: registeredRuntimeId.value,
      });
      const env = coreEnv(harness.db);

      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });

      await expect(
        rpcEnsureAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:claude-code",
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: registeredRuntimeId.value,
          },
        })
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.primary_conflict"],
        routable: false,
        status: "rejected",
      });
      expect(
        harness.queryFirst<{ agent_controller_ref: string; count: number }>({
          sql: "SELECT agent_controller_ref, count(*) AS count FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({ agent_controller_ref: "builtin:codex", count: 1 });
    } finally {
      harness.close();
    }
  });
});

function coreEnv(
  db: D1Database,
  input?: {
    authWorker?: CoreBindings["OPENMELD_AUTH_WORKER"];
  }
): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER:
      input?.authWorker ??
      ({
        resolveProfileById: vi.fn(async () => ({
          ok: true as const,
          profile: {
            ownerUserId: "owner-1",
            profileHandle: "agent-one",
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent" as const,
            profileName: "Agent One",
            status: "active" as const,
          },
        })),
      } satisfies CoreBindings["OPENMELD_AUTH_WORKER"]),
    OPENMELD_DB: db,
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
}

function applyAgentProfileBindingRpcMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  for (const tableName of [
    "openMeldDaemon_runtime_registry_records",
    "openMeldDaemon_runtime_agent_controller_reports",
    "openMeldDaemon_agent_profile_bindings",
  ]) {
    applyMigrationForTable(harness, tableName);
  }
  applyOrganizationAuthorizationFixtureTables(harness);
  applyMigrationForTable(harness, "openmeld_profiles");
  seedPersonalOrganizationForOwner(harness);
  seedAgentProfileForOwner(harness);
}

function applyOrganizationAuthorizationFixtureTables(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        email text NOT NULL,
        email_verified integer DEFAULT false NOT NULL,
        image text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE IF NOT EXISTS organizations (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        slug text NOT NULL,
        logo text,
        created_at integer NOT NULL,
        metadata text
      )
    `,
  });
  harness.run({
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique
        ON organizations (slug)
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE IF NOT EXISTS members (
        id text PRIMARY KEY NOT NULL,
        organization_id text NOT NULL,
        user_id text NOT NULL,
        role text DEFAULT 'member' NOT NULL,
        created_at integer NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id text PRIMARY KEY NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS organization_binding_authorizations_org_binding_uq_idx
        ON organization_binding_authorizations (organization_id, binding_id)
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE IF NOT EXISTS organization_binding_authorization_preferences (
        id text PRIMARY KEY NOT NULL,
        organization_id text NOT NULL,
        user_id text NOT NULL,
        auto_authorize_agent_profile_bindings integer DEFAULT false NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS organization_binding_auth_prefs_org_user_uq_idx
        ON organization_binding_authorization_preferences (organization_id, user_id)
    `,
  });
}

function seedPersonalOrganizationForOwner(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  const now = Date.now();
  harness.run({
    params: ["owner-1", "Mira", "mira@example.com", 1, now, now],
    sql: `
      INSERT INTO users (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
      "org-personal-owner-1",
      "Mira",
      "mira",
      now,
      JSON.stringify({ personal: true }),
    ],
    sql: `
      INSERT INTO organizations (
        id,
        name,
        slug,
        created_at,
        metadata
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
      "member-personal-owner-1",
      "org-personal-owner-1",
      "owner-1",
      "owner",
      now,
    ],
    sql: `
      INSERT INTO members (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
}

function seedAgentProfileForOwner(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  const now = Date.now();
  harness.run({
    params: [
      AGENT_PROFILE_ID,
      "Agent One",
      "agent-one",
      "agent",
      0,
      "active",
      "org-personal-owner-1",
      "owner-1",
      "cli_create",
      now,
      now,
    ],
    sql: `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        source,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

async function seedRuntimeAgentControllerReport(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input?: {
    agentControllerRef?: string;
    openMeldServiceRuntimeIdValue?: string;
    status?: "ready" | "disabled" | "unavailable" | "unknown";
  }
): Promise<AuthorityOpenMeldServiceRuntimeId> {
  const nowMs = Date.now();
  const runtimeLookupInput = lookupInput("owner-1", "device-1");
  const registeredRuntimeId = openMeldServiceRuntimeId(
    runtimeLookupInput,
    input?.openMeldServiceRuntimeIdValue ?? "runtime_opaque_1"
  );
  await registerRuntimeRegistryRecord({
    db: harness.db,
    record: {
      nowMs,
      openMeldServiceRuntimeId: registeredRuntimeId,
      runtimeLookupInput,
    },
  });
  await acceptRuntimeAgentControllerReportRecord({
    db: harness.db,
    nowMs,
    report: {
      agentControllerRef: input?.agentControllerRef ?? "builtin:codex",
      expiresAtMs: nowMs + 60_000,
      observedAtMs: nowMs,
      reasonCodes: ["runtime.agent_controller_report.ready"],
      openMeldServiceRuntimeId: registeredRuntimeId,
      status: input?.status ?? "ready",
    },
  });
  return registeredRuntimeId;
}

function lookupInput(ownerId: string, deviceId: string): RuntimeLookupInput {
  return createRuntimeLookupInput({
    deviceId,
    lane: "openmeld-dev",
    owner: {
      id: ownerId,
      kind: "owner_account",
    },
  });
}

function openMeldServiceRuntimeId(
  lookup: RuntimeLookupInput,
  value: string
): AuthorityOpenMeldServiceRuntimeId {
  return createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: lookup,
    openMeldServiceRuntimeId: value,
    source: "runtime_registry_authority",
  });
}
