import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { acceptAgentActivitySessionReconciliation } from "../src/agent-activity/activity-session-inventory-repository";
import {
  readPrimaryAgentProfileBindingRecord,
  reconnectPrimaryAgentProfileBindingRecord,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import {
  reconcileAgentModelInbox,
  reconcileRuntimeAgentModelInboxes,
} from "../src/config/agent-model-inbox-reconciliation";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import { createInboxService } from "../src/inbox/application/inbox-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcDisableAgentProfilePrimaryBinding,
  rpcEnsureAgentProfilePrimaryBinding,
  rpcGetAgentProfileControllerChangeEligibility,
  rpcGetAgentProfilePrimaryBinding,
  rpcGetCurrentAgentProfileSession,
  rpcSetCurrentAgentProfileWorkspace,
  rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode,
  rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode,
  rpcUpdateAgentProfilePrimaryBindingModelSelection,
  rpcUpdateAgentProfilePrimaryBindingOpenCodePermission,
} from "../src/rpc/methods";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { readAvailableModelIds } from "../tests/test-support/model-catalog.test-support";
import {
  createBeforeMatchingPostgresTransaction,
  createPostgresHarness,
  observeNativePostgresQueries,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const OTHER_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const DEFAULT_CONTEXT: OpenMeldRequestContext = {
  activeOrganizationId: "org-personal-owner-1",
  actorContext: {
    callerPrincipalId: "owner-1",
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
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);

    try {
      for (const sql of []) {
        await harness.query({ text: sql });
      }
      await harness.query({
        values: [
          "project-1",
          "org-personal-owner-1",
          "OpenMeld",
          "openmeld",
          "owner-1",
        ],
        text: `INSERT INTO "openmeld"."projects"
          (id, organization_id, name, slug, archived_at_ms, created_by_user_id, created_at_ms, updated_at_ms)
          VALUES ($1, $2, $3, $4, NULL, $5, 1000, 1000)`,
      });
      await harness.query({
        values: ["owner-1", "device-1", "computer-1", Date.now(), Date.now()],
        text: `INSERT INTO "openmeld"."openMeldDaemon_owned_devices"
          (owner_user_id, device_id, connected_computer_id,
           first_seen_at_ms, updated_at_ms)
          VALUES ($1, $2, $3, $4, $5)`,
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
      await harness.query({
        text: 'UPDATE "openmeld"."agent_activity_session_inventory_sources" SET state = \'error\'',
      });
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), input)
      ).resolves.toMatchObject({
        reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
        status: "rejected",
      });
      await harness.query({
        text: 'DELETE FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
      });
      await harness.query({
        text: 'UPDATE "openmeld"."agent_activity_session_inventory_sources" SET state = \'current\'',
      });
      const authWorker = {
        resolveProfileById: vi.fn(async () => {
          await Promise.resolve();
          await harness.query({
            text: 'UPDATE "openmeld"."agent_activity_session_inventory_sources" SET state = \'error\'',
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 0 });
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
          ...input,
          agentControllerConversationId: "native-session-old",
          sessionInventorySelection: undefined,
        })
      ).resolves.toMatchObject({ status: "accepted" });
      await harness.query({
        text: 'UPDATE "openmeld"."agent_activity_session_inventory_sources" SET state = \'current\'',
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
        await harness.queryFirst<{
          agent_controller_conversation_id: string;
          binding_state: string;
          count: number;
        }>({
          text: `SELECT agent_controller_conversation_id, binding_state,
            count(*) AS count
            FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
            WHERE binding_state = 'enabled_primary' GROUP BY agent_controller_conversation_id, binding_state`,
        })
      ).toEqual({
        agent_controller_conversation_id: "native-session-old",
        binding_state: "enabled_primary",
        count: 1,
      });
    } finally {
      await harness.close();
    }
  });
  it("creates and reads primary Binding truth from authenticated owner, Profile owner, Runtime, and Agent Controller Report evidence", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 1 });
    } finally {
      await harness.close();
    }
  });
  it("finds the exact owner-scoped Agent Profile for a controller Session", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);
      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "codex-thread-current",
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: registeredRuntimeId,
      });
      await expect(
        rpcGetCurrentAgentProfileSession(env, {
          agentControllerConversationId: "codex-thread-current",
          agentControllerRef: "builtin:codex",
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        currentOrganizationId: "org-personal-owner-1",
        profile: {
          profileId: AGENT_PROFILE_ID,
          profileName: "Agent One",
          profileOrganizationId: "org-personal-owner-1",
        },
        sameOrganization: true,
        status: "found",
      });
      const now = Date.now();
      await harness.query({
        values: ["org-work-owner-1", "Mira Work", "mira-work", now, "{}"],
        text: `INSERT INTO "openmeld"."organizations"
          (id, name, slug, created_at, metadata)
          VALUES ($1, $2, $3, $4, $5)`,
      });
      await harness.query({
        values: [
          "member-work-owner-1",
          "org-work-owner-1",
          "owner-1",
          "member",
          now,
        ],
        text: `INSERT INTO "openmeld"."members"
          (id, organization_id, user_id, role, created_at)
          VALUES ($1, $2, $3, $4, $5)`,
      });
      await expect(
        rpcGetCurrentAgentProfileSession(env, {
          agentControllerConversationId: "codex-thread-current",
          agentControllerRef: "builtin:codex",
          context: {
            ...DEFAULT_CONTEXT,
            activeOrganizationId: "org-work-owner-1",
          },
        })
      ).resolves.toMatchObject({
        currentOrganizationId: "org-work-owner-1",
        profile: {
          profileId: AGENT_PROFILE_ID,
          profileOrganizationId: "org-personal-owner-1",
        },
        sameOrganization: false,
        status: "found",
      });
      await expect(
        rpcGetCurrentAgentProfileSession(env, {
          agentControllerConversationId: "not-this-thread",
          agentControllerRef: "builtin:codex",
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        currentOrganizationId: "org-personal-owner-1",
        status: "not_found",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects an unknown model with the supported model list before writing Binding truth", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 0 });
    } finally {
      await harness.close();
    }
  });
  it("creates an OpenCode Agent Profile Binding with Qwen3.8 Flash", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId = await seedRuntimeAgentControllerReport(
        harness,
        { agentControllerRef: "builtin:opencode" }
      );
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
          agentControllerRef: "builtin:opencode",
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          modelId: "opencode-go/qwen3.8-flash",
          openMeldServiceRuntimeId: registeredRuntimeId,
          reasoningLevel: "xhigh",
        })
      ).resolves.toMatchObject({
        binding: {
          agentProfileId: AGENT_PROFILE_ID,
          executionTarget: {
            agentControllerRef: "builtin:opencode",
          },
          modelSelection: {
            modelId: "opencode-go/qwen3.8-flash",
            reasoningLevel: "xhigh",
          },
        },
        outcome: "created",
        status: "accepted",
      });
      expect(
        await harness.queryFirst<{
          agent_controller_ref: string;
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          text: 'SELECT agent_controller_ref, model_id, reasoning_level FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({
        agent_controller_ref: "builtin:opencode",
        model_id: "opencode-go/qwen3.8-flash",
        reasoning_level: "xhigh",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects an unsupported reasoning level with the model's supported values", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 0 });
    } finally {
      await harness.close();
    }
  });
  it("rejects an unknown model update without changing the existing Binding selection", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          text: 'SELECT model_id, reasoning_level FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({
        model_id: "gpt-5.5",
        reasoning_level: "high",
      });
    } finally {
      await harness.close();
    }
  });
  it("updates Agent Controller Permission Mode without changing Binding target", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          agent_controller_permission_mode: string | null;
          agent_controller_ref: string;
          configuration_revision: number;
        }>({
          text: 'SELECT agent_controller_permission_mode, agent_controller_ref, configuration_revision FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({
        agent_controller_permission_mode: "codex:fullAccess",
        agent_controller_ref: "builtin:codex",
        configuration_revision: 2,
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects a Controller reconnect while the Agent has an active execution without blocking runtime setting edits", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      await seedRuntimeAgentControllerReport(harness, {
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeIdValue: registeredRuntimeId.value,
      });
      const inactiveEnv = coreEnv(harness.db, {
        agentProfileExecutionState: "inactive",
      });
      await rpcEnsureAgentProfilePrimaryBinding(inactiveEnv, {
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });
      const activeEnv = coreEnv(harness.db, {
        agentProfileExecutionState: "active",
      });
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(activeEnv, {
          agentControllerRef: "builtin:claude-code",
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: registeredRuntimeId.value,
          },
          writeMode: "reconnect",
        })
      ).resolves.toMatchObject({
        reasonCodes: [
          "agent_profile_binding.controller_change_blocked_active_execution",
        ],
        status: "rejected",
      });
      const unavailableEnv = coreEnv(harness.db, {
        agentProfileExecutionState: "unavailable",
      });
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(unavailableEnv, {
          agentControllerRef: "builtin:claude-code",
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: registeredRuntimeId.value,
          },
          writeMode: "reconnect",
        })
      ).resolves.toMatchObject({
        reasonCodes: [
          "agent_profile_binding.controller_change_eligibility_unavailable",
        ],
        status: "rejected",
      });
      await expect(
        rpcUpdateAgentProfilePrimaryBindingModelSelection(activeEnv, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          modelId: "gpt-5.5",
          reasoningLevel: "high",
        })
      ).resolves.toMatchObject({
        binding: {
          executionTarget: { agentControllerRef: "builtin:codex" },
          modelSelection: { modelId: "gpt-5.5", reasoningLevel: "high" },
        },
        status: "accepted",
      });
      const settingsUnavailableEnv = coreEnv(harness.db, {
        controllerMutationAcquireStatus: "unavailable",
      });
      await expect(
        rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
          settingsUnavailableEnv,
          {
            agentControllerPermissionMode: "codex:fullAccess",
            agentProfileId: AGENT_PROFILE_ID,
            context: DEFAULT_CONTEXT,
          }
        )
      ).resolves.toMatchObject({
        reasonCodes: [
          "agent_profile_binding.controller_change_eligibility_unavailable",
        ],
        status: "rejected",
      });
      expect(
        await harness.queryFirst<{
          agent_controller_permission_mode: string | null;
          agent_controller_ref: string;
          configuration_revision: number;
        }>({
          text: 'SELECT agent_controller_permission_mode, agent_controller_ref, configuration_revision FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE binding_state = \'enabled_primary\'',
        })
      ).toEqual({
        agent_controller_permission_mode: null,
        agent_controller_ref: "builtin:codex",
        configuration_revision: 2,
      });
    } finally {
      await harness.close();
    }
  });
  it("rechecks Controller mutation admission atomically after the read-only eligibility result", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      await rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });
      const racingEnv = coreEnv(harness.db, {
        agentProfileExecutionState: "inactive",
        controllerMutationAcquireStatus: "blocked",
      });
      await expect(
        rpcDisableAgentProfilePrimaryBinding(racingEnv, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        agentProfileId: AGENT_PROFILE_ID,
        disabled: false,
        reasonCodes: [
          "agent_profile_binding.controller_change_blocked_active_execution",
        ],
        status: "unavailable",
      });
      expect(
        await harness.queryFirst<{
          agent_controller_ref: string;
        }>({
          text: 'SELECT agent_controller_ref FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE binding_state = \'enabled_primary\'',
        })
      ).toEqual({ agent_controller_ref: "builtin:codex" });
    } finally {
      await harness.close();
    }
  });
  it("preserves settings saved while an execution-target reconnect is being prepared", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);
      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentControllerConversationId: "conversation-before-reconnect",
        agentControllerPermissionMode: "codex:fullAccess",
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        modelId: "gpt-5.5",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
        reasoningLevel: "high",
      });
      const staleBinding = await readPrimaryAgentProfileBindingRecord({
        agentProfileId: AGENT_PROFILE_ID,
        db: harness.db,
        owner: { id: "owner-1", kind: "owner_account" },
      });
      expect(staleBinding).not.toBeNull();
      await rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
        env,
        {
          agentControllerPermissionMode: "codex:approveForMe",
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        }
      );
      await rpcUpdateAgentProfilePrimaryBindingModelSelection(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        modelId: "gpt-5.5",
        reasoningLevel: "xhigh",
      });
      const result = await reconnectPrimaryAgentProfileBindingRecord({
        acquireExecutionTargetMutationAdmission: async () => undefined,
        db: harness.db,
        record: {
          ...(staleBinding as NonNullable<typeof staleBinding>),
          agentControllerConversationId: "conversation-after-reconnect",
          bindingId: "binding-after-reconnect",
          updatedAtMs: Date.now(),
        },
      });
      expect(result).toMatchObject({
        binding: {
          agentControllerPermissionMode: "codex:approveForMe",
          modelId: "gpt-5.5",
          reasoningLevel: "xhigh",
        },
        outcome: "reconnected",
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("retries an execution-target reconnect when settings win the PostgreSQL write race", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);
      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentControllerConversationId: "conversation-before-race",
        agentControllerPermissionMode: "codex:fullAccess",
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });
      const staleBinding = await readPrimaryAgentProfileBindingRecord({
        agentProfileId: AGENT_PROFILE_ID,
        db: harness.db,
        owner: { id: "owner-1", kind: "owner_account" },
      });
      expect(staleBinding).not.toBeNull();
      let settingsRaceApplied = false;
      const racingDb = createBeforeMatchingPostgresTransaction({
        db: harness.db,
        matches: (sql) =>
          sql.includes(
            'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"'
          ) && sql.includes("configuration_revision ="),
        beforeTransaction: async () => {
          settingsRaceApplied = true;
          await harness.query({
            text: `UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
              SET agent_controller_permission_mode = $1, configuration_revision = configuration_revision + 1
              WHERE agent_profile_id = $2 AND binding_state = 'enabled_primary'`,
            values: ["codex:approveForMe", AGENT_PROFILE_ID],
          });
        },
      });
      const transactions = vi.spyOn(racingDb, "transaction");
      const result = await reconnectPrimaryAgentProfileBindingRecord({
        acquireExecutionTargetMutationAdmission: async () => undefined,
        db: racingDb,
        record: {
          ...(staleBinding as NonNullable<typeof staleBinding>),
          agentControllerConversationId: "conversation-after-race",
          bindingId: "binding-after-race",
          updatedAtMs: Date.now(),
        },
      });
      expect(settingsRaceApplied).toBe(true);
      expect(transactions).toHaveBeenCalledTimes(2);
      transactions.mockRestore();
      expect(result).toMatchObject({
        binding: {
          agentControllerPermissionMode: "codex:approveForMe",
        },
        outcome: "reconnected",
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects a permission update when a reconnect replaces the Binding before the settings write", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      await rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
        agentControllerConversationId: "conversation-before-settings-race",
        agentControllerPermissionMode: "codex:approveForMe",
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });
      const staleBinding = await readPrimaryAgentProfileBindingRecord({
        agentProfileId: AGENT_PROFILE_ID,
        db: harness.db,
        owner: { id: "owner-1", kind: "owner_account" },
      });
      expect(staleBinding).not.toBeNull();
      let bindingReplaced = false;
      const race = observeNativePostgresQueries(async ({ text }) => {
        if (
          !bindingReplaced &&
          text.includes(
            'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"'
          ) &&
          text.includes("agent_controller_permission_mode =")
        ) {
          bindingReplaced = true;
          await reconnectPrimaryAgentProfileBindingRecord({
            acquireExecutionTargetMutationAdmission: async () => undefined,
            db: harness.db,
            record: {
              ...(staleBinding as NonNullable<typeof staleBinding>),
              agentControllerConversationId: "conversation-after-settings-race",
              bindingId: "binding-after-settings-race",
              updatedAtMs: Date.now(),
            },
          });
        }
      });
      onTestFinished(() => race.mockRestore());
      const result =
        await rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(
          coreEnv(harness.db),
          {
            agentControllerPermissionMode: "codex:fullAccess",
            agentProfileId: AGENT_PROFILE_ID,
            context: DEFAULT_CONTEXT,
          }
        );
      const current = await readPrimaryAgentProfileBindingRecord({
        agentProfileId: AGENT_PROFILE_ID,
        db: harness.db,
        owner: { id: "owner-1", kind: "owner_account" },
      });
      expect(bindingReplaced).toBe(true);
      expect(result).toEqual({
        grantsClaimSuccess: false,
        reasonCodes: ["agent_profile_binding.settings_conflict"],
        routable: false,
        status: "rejected",
      });
      expect(current).toMatchObject({
        agentControllerPermissionMode: "codex:approveForMe",
        bindingId: "binding-after-settings-race",
      });
    } finally {
      await harness.close();
    }
  });
  it("takes mutation admission before unbinding even when the first Binding read is empty", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const racingEnv = coreEnv(harness.db, {
        controllerMutationAcquireStatus: "blocked",
      });
      await expect(
        rpcDisableAgentProfilePrimaryBinding(racingEnv, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        agentProfileId: AGENT_PROFILE_ID,
        disabled: false,
        reasonCodes: [
          "agent_profile_binding.controller_change_blocked_active_execution",
        ],
        status: "unavailable",
      });
    } finally {
      await harness.close();
    }
  });
  it("rechecks the current Binding before deciding whether a reconnect needs admission", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      await seedRuntimeAgentControllerReport(harness, {
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeIdValue: registeredRuntimeId.value,
      });
      await rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: registeredRuntimeId.value,
        },
      });
      let primaryBindingReadCount = 0;
      let bindingChangedBetweenApplicationAndRepoReads = false;
      const race = observeNativePostgresQueries(async ({ text }) => {
        if (
          text.includes(
            'FROM "openmeld"."openMeldDaemon_agent_profile_bindings"'
          ) &&
          text.includes("binding_state = 'enabled_primary'")
        ) {
          primaryBindingReadCount += 1;
          if (primaryBindingReadCount === 2) {
            bindingChangedBetweenApplicationAndRepoReads = true;
            await harness.query({
              text: `UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
                SET agent_controller_ref = $1 WHERE agent_profile_id = $2 AND binding_state = 'enabled_primary'`,
              values: ["builtin:claude-code", AGENT_PROFILE_ID],
            });
          }
        }
      });
      onTestFinished(() => race.mockRestore());
      const activeEnv = coreEnv(harness.db, {
        agentProfileExecutionState: "active",
      });
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(activeEnv, {
          agentControllerRef: "builtin:codex",
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: registeredRuntimeId.value,
          },
          writeMode: "reconnect",
        })
      ).resolves.toMatchObject({
        reasonCodes: [
          "agent_profile_binding.controller_change_blocked_active_execution",
        ],
        status: "rejected",
      });
      expect(bindingChangedBetweenApplicationAndRepoReads).toBe(true);
      expect(
        await harness.queryFirst<{
          agent_controller_ref: string;
        }>({
          text: 'SELECT agent_controller_ref FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE binding_state = \'enabled_primary\'',
        })
      ).toEqual({ agent_controller_ref: "builtin:claude-code" });
    } finally {
      await harness.close();
    }
  });
  it("returns saved OpenCode permissions after a fresh primary Binding read", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          configuration_revision: number;
          opencode_permission: string | null;
        }>({
          text: 'SELECT configuration_revision, opencode_permission FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({
        configuration_revision: 2,
        opencode_permission: JSON.stringify(openCodePermission),
      });
    } finally {
      await harness.close();
    }
  });
  it("increments the configuration revision when model selection changes", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          configuration_revision: number;
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          text: 'SELECT configuration_revision, model_id, reasoning_level FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({
        configuration_revision: 2,
        model_id: "gpt-5.5",
        reasoning_level: "high",
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    false,
    true,
  ])("disables the Binding and ends only its model notice without deleting identity (retry cleanup: %s)", async (failCleanupOnce) => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
      // Represent a saved model that later disappeared from the catalog.
      await harness.query({
        text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET model_id = \'removed-historical-model\' WHERE agent_profile_id = $1',
        values: [AGENT_PROFILE_ID],
      });
      const reconcileInput = {
        env,
        ownerUserId: "owner-1",
        agentProfileId: AGENT_PROFILE_ID,
        nowMs: Date.now(),
      };
      await reconcileAgentModelInbox(reconcileInput);
      const inbox = createInboxService({ db: harness.db, nowMs: () => 2100 });
      const reader = {
        organizationId: "org-personal-owner-1",
        recipientUserId: "owner-1",
      };
      const { items } = await inbox.list({ ...reader, view: "needs_action" });
      expect(items).toHaveLength(1);
      const notice = items[0];
      if (!notice) {
        throw new Error("Expected model recovery notice");
      }
      await inbox.markRead({ ...reader, itemId: notice.id, read: true });
      const unrelated = await ensureInboxItem({
        db: harness.db,
        nowMs: 2000,
        candidate: {
          ...reader,
          attention: "action_required",
          importance: "normal",
          kind: "system_issue",
          occurredAtMs: 1000,
          contextLabel: "Agent One",
          title: "Review unrelated work",
          preview: "Keep this request open.",
          sourceKind: "system_attention_event",
          sourceKey: "unrelated-work",
          sourceTarget: { kind: "agent_profile", profileId: AGENT_PROFILE_ID },
        },
      });
      await expect(
        rpcDisableAgentProfilePrimaryBinding(
          coreEnv(harness.db, { controllerMutationAcquireStatus: "blocked" }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            context: DEFAULT_CONTEXT,
          }
        )
      ).resolves.toMatchObject({ disabled: false, status: "unavailable" });
      expect(await inbox.summary(reader)).toMatchObject({
        unresolvedActionCount: 2,
      });
      let remainingFailure = failCleanupOnce;
      const prepareSpy = observeNativePostgresQueries(({ text }) => {
        if (remainingFailure && text.includes('source_key AS "sourceKey"')) {
          remainingFailure = false;
          throw new Error("injected model Inbox read failure");
        }
      });
      onTestFinished(() => prepareSpy.mockRestore());
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
      prepareSpy.mockRestore();
      expect(await inbox.summary(reader)).toMatchObject({
        unresolvedActionCount: failCleanupOnce ? 2 : 1,
      });
      // A retried unbind must reconcile even though the write itself is now a no-op.
      await rpcDisableAgentProfilePrimaryBinding(env, {
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
      });
      expect(await inbox.summary(reader)).toMatchObject({
        unresolvedActionCount: 1,
        totalUnreadCount: 1,
      });
      expect(
        (await inbox.list({ ...reader, view: "needs_action" })).items.map(
          (item) => item.id
        )
      ).toEqual([unrelated.itemId]);
      expect(
        (await inbox.get({ ...reader, itemId: notice.id })).item
      ).toMatchObject({
        resolutionStatus: "resolved",
        readAt: new Date(2100).toISOString(),
      });
      // A late report for the old runtime must not recreate the ended issue.
      await reconcileRuntimeAgentModelInboxes({
        env,
        ownerUserId: "owner-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: registeredRuntimeId,
        nowMs: Date.now(),
      });
      expect(await inbox.summary(reader)).toMatchObject({
        unresolvedActionCount: 1,
      });
      expect(
        await harness.queryFirst({
          text: 'SELECT status FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1',
          values: [AGENT_PROFILE_ID],
        })
      ).toEqual({ status: "active" });
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
        await harness.queryAll<{
          binding_id: string;
          binding_state: string;
          reason_code: string | null;
        }>({
          text: 'SELECT binding_id, binding_state, reason_code FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual([
        {
          binding_id: created.binding?.bindingId,
          binding_state: "disabled_historical",
          reason_code: "agent_profile_binding.primary_binding_disabled",
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("rejects unbinding a Controller while the Agent has an active execution", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      await rpcEnsureAgentProfilePrimaryBinding(coreEnv(harness.db), {
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
      const env = coreEnv(harness.db, {
        agentProfileExecutionState: "active",
      });
      await expect(
        rpcDisableAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toEqual({
        agentProfileId: AGENT_PROFILE_ID,
        disabled: false,
        reasonCodes: [
          "agent_profile_binding.controller_change_blocked_active_execution",
        ],
        status: "unavailable",
      });
      await expect(
        rpcGetAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: DEFAULT_CONTEXT,
        })
      ).resolves.toMatchObject({
        binding: {
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
          },
        },
        status: "found",
      });
    } finally {
      await harness.close();
    }
  });
  it("returns missing when disabling a profile without an enabled primary Binding", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
      await harness.close();
    }
  });
  it("rejects primary Binding disable requests from a non-owner without changing Binding truth", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          binding_state: string;
          disabled_at_ms: number | null;
          reason_code: string | null;
        }>({
          text: 'SELECT binding_state, disabled_at_ms, reason_code FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({
        binding_state: "enabled_primary",
        disabled_at_ms: null,
        reason_code: "agent_profile_binding.command_eligible",
      });
    } finally {
      await harness.close();
    }
  });
  it("omits invalid stored Agent Controller Permission Mode", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
      await harness.query({
        values: ["unsupported"],
        text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET agent_controller_permission_mode = $1',
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
      await harness.close();
    }
  });
  it("reuses an identical Binding command retry without creating a duplicate row", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 1 });
    } finally {
      await harness.close();
    }
  });
  it("rejects forged openMeldServiceRuntimeId and Profile owner mismatch without writing Binding truth", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 0 });
    } finally {
      await harness.close();
    }
  });
  it("rejects Profile owner evidence for a different Agent Profile without writing Binding truth", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 0 });
    } finally {
      await harness.close();
    }
  });
  it("rejects non-runnable Runtime Agent Controller Report evidence without writing Binding truth", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({ count: 0 });
    } finally {
      await harness.close();
    }
  });
  it("rejects every per-Profile Binding read and mutation outside the Profile workspace", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
    try {
      const registeredRuntimeId =
        await seedRuntimeAgentControllerReport(harness);
      const env = coreEnv(harness.db);
      await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentControllerConversationId: "codex-thread-1",
        agentControllerRef: "builtin:codex",
        agentProfileId: AGENT_PROFILE_ID,
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        modelId: "gpt-5.5",
        openMeldServiceRuntimeId: registeredRuntimeId,
        reasoningLevel: "high",
      });
      const wrongWorkspaceContext: OpenMeldRequestContext = {
        ...DEFAULT_CONTEXT,
        activeOrganizationId: "org-another-workspace",
      };
      const workspaceMismatch = {
        cause: {
          code: "agent_profile.organization_mismatch",
          status: 403,
        },
      };
      await expect(
        rpcGetAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: { actorContext: DEFAULT_CONTEXT.actorContext },
        })
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile.organization_context_missing",
          status: 403,
        },
      });
      await expect(
        rpcGetAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
        })
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcGetAgentProfileControllerChangeEligibility(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
        })
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcEnsureAgentProfilePrimaryBinding(env, {
          agentControllerConversationId: "cross-workspace-thread",
          agentControllerRef: "builtin:codex",
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
          deviceId: "device-1",
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: registeredRuntimeId,
          writeMode: "reconnect",
        })
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode(env, {
          agentControllerPermissionMode: "codex:fullAccess",
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
        })
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcUpdateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
          env,
          {
            agentControllerCollaborationMode: "codex:default",
            agentProfileId: AGENT_PROFILE_ID,
            context: wrongWorkspaceContext,
          }
        )
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcUpdateAgentProfilePrimaryBindingModelSelection(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
          modelId: "gpt-5.4-mini",
          reasoningLevel: "medium",
        })
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcUpdateAgentProfilePrimaryBindingOpenCodePermission(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
          openCodePermission: null,
        })
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcDisableAgentProfilePrimaryBinding(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
        })
      ).rejects.toMatchObject(workspaceMismatch);
      await expect(
        rpcSetCurrentAgentProfileWorkspace(env, {
          agentProfileId: AGENT_PROFILE_ID,
          context: wrongWorkspaceContext,
          workspaceMode: "custom",
          workspacePath: "/Users/mira/another-workspace",
        })
      ).rejects.toMatchObject(workspaceMismatch);
      expect(
        await harness.queryFirst<{
          agent_controller_collaboration_mode: string | null;
          agent_controller_conversation_id: string | null;
          agent_controller_permission_mode: string | null;
          binding_state: string;
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          text: `SELECT
            agent_controller_collaboration_mode,
            agent_controller_conversation_id,
            agent_controller_permission_mode,
            binding_state,
            model_id,
            reasoning_level
          FROM "openmeld"."openMeldDaemon_agent_profile_bindings"`,
        })
      ).toEqual({
        agent_controller_collaboration_mode: null,
        agent_controller_conversation_id: "codex-thread-1",
        agent_controller_permission_mode: null,
        binding_state: "enabled_primary",
        model_id: "gpt-5.5",
        reasoning_level: "high",
      });
      expect(env.OPENMELD_RUNTIME_TRANSPORT?.get).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it("rejects a different enabled target as primary conflict without silent replace", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRpcMigrations(harness);
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
        await harness.queryFirst<{
          agent_controller_ref: string;
          count: number;
        }>({
          text: 'SELECT agent_controller_ref, count(*) AS count FROM "openmeld"."openMeldDaemon_agent_profile_bindings" GROUP BY agent_controller_ref',
        })
      ).toEqual({ agent_controller_ref: "builtin:codex", count: 1 });
    } finally {
      await harness.close();
    }
  });
});
function coreEnv(
  db: PostgresDatabase,
  input?: {
    agentProfileExecutionState?: "active" | "inactive" | "unavailable";
    controllerMutationAcquireStatus?: "acquired" | "blocked" | "unavailable";
    authWorker?: CoreBindings["OPENMELD_AUTH_WORKER"];
  }
): CoreBindings {
  const runtimeTransportStub = {
    rpcAgentProfileExecutionMode: vi.fn(async () => ({
      agentProfileId: AGENT_PROFILE_ID,
      mode: "parallel" as const,
      migration: "legacy" as const,
      revision: 0,
    })),
    rpcReadAgentProfileExecutionState: vi.fn(() => {
      if (input?.agentProfileExecutionState === "unavailable") {
        return Promise.resolve({
          reasonCode: "runtime_coordinator.execution_state_unavailable",
          status: "unavailable" as const,
        });
      }
      return Promise.resolve({
        status: input?.agentProfileExecutionState ?? ("inactive" as const),
      });
    }),
    rpcAcquireAgentProfileControllerMutation: vi.fn(() => {
      let status = input?.controllerMutationAcquireStatus ?? "acquired";
      if (!input?.controllerMutationAcquireStatus) {
        if (input?.agentProfileExecutionState === "active") {
          status = "blocked";
        } else if (input?.agentProfileExecutionState === "unavailable") {
          status = "unavailable";
        }
      }
      if (status === "acquired") {
        return Promise.resolve({
          expiresAtMs: Date.now() + 300_000,
          operationId: "controller-mutation-test",
          status,
        });
      }
      return Promise.resolve({
        reasonCode:
          status === "blocked"
            ? "runtime_coordinator.agent_profile_execution_active"
            : "runtime_coordinator.execution_state_unavailable",
        status,
      });
    }),
    rpcAcquireAgentProfileFutureWorkSettingsMutation: vi.fn(() => {
      const status =
        input?.agentProfileExecutionState === "unavailable"
          ? "unavailable"
          : (input?.controllerMutationAcquireStatus ?? "acquired");
      if (status === "acquired") {
        return Promise.resolve({
          expiresAtMs: Date.now() + 300_000,
          operationId: "future-work-settings-mutation-test",
          status,
        });
      }
      return Promise.resolve({
        reasonCode: "runtime_coordinator.execution_state_unavailable",
        status,
      });
    }),
    rpcReleaseAgentProfileControllerMutation: vi.fn(() =>
      Promise.resolve({ status: "released" as const })
    ),
  };
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
    OPENMELD_POSTGRESQL: postgresTestBinding(db),
    OPENMELD_RUNTIME_TRANSPORT: {
      get: vi.fn(() => runtimeTransportStub),
      idFromName: vi.fn(() => "owner-1-shard"),
    } as unknown as CoreBindings["OPENMELD_RUNTIME_TRANSPORT"],
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
}
async function applyAgentProfileBindingRpcMigrations(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await seedPersonalOrganizationForOwner(harness);
  await seedAgentProfileForOwner(harness);
}
async function seedPersonalOrganizationForOwner(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  const now = Date.now();
  await harness.query({
    values: ["owner-1", "Mira", "mira@example.com", 1, now, now],
    text: `
      INSERT INTO "openmeld"."users" (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
  });
  await harness.query({
    values: [
      "org-personal-owner-1",
      "Mira",
      "mira",
      now,
      JSON.stringify({ personal: true }),
    ],
    text: `
      INSERT INTO "openmeld"."organizations" (
        id,
        name,
        slug,
        created_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
  await harness.query({
    values: [
      "member-personal-owner-1",
      "org-personal-owner-1",
      "owner-1",
      "owner",
      now,
    ],
    text: `
      INSERT INTO "openmeld"."members" (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
}
async function seedAgentProfileForOwner(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  const now = Date.now();
  await harness.query({
    values: [
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
    text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
  });
}
async function seedRuntimeAgentControllerReport(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
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
