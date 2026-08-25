import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { ensurePrimaryAgentProfileBinding } from "../src/agent-profile-binding/application/agent-profile-binding-command-service";
import {
  compareAndSetPrimaryAgentProfileBindingModelSelectionRecord,
  createD1AgentProfileBindingCommandStore,
  disablePrimaryAgentProfileBindingRecord,
  ensurePrimaryAgentProfileBindingRecord,
  listEnabledPrimaryAgentProfileBindingRecordsForProfile,
  readPrimaryAgentProfileBindingRecord,
  reconnectPrimaryAgentProfileBindingRecord,
  updatePrimaryAgentProfileBindingAgentControllerCollaborationModeRecord,
  updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord,
} from "../src/agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { reconcileRemoteCenterAgentBindingRecord } from "../src/center-agent/infrastructure/d1/remote-center-agent-binding-repo";
import {
  acceptRuntimeAgentControllerReportRecord,
  readCurrentRuntimeAgentControllerReport,
} from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import {
  readRuntimeRegistryRecord,
  registerRuntimeRegistryRecord,
} from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import {
  applyDrizzleMigrationsForTables,
  applyDrizzleMigrationForTable as applySingleTableMigration,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const OTHER_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const FOREIGN_KEY_CONSTRAINT_ERROR_PATTERN = /FOREIGN KEY constraint failed/;
const OWNER = {
  id: "owner-1",
  kind: "owner_account",
} as const;

describe("Agent Profile Binding repo write-side", () => {
  it("leaves every Binding and authorization unchanged when a same-millisecond writer makes admitted inventory stale", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      harness.run({
        sql: `
          CREATE UNIQUE INDEX IF NOT EXISTS organization_binding_authorizations_org_binding_uq_idx
          ON organization_binding_authorizations (organization_id, binding_id)
        `,
      });
      harness.run({
        sql: "DROP TRIGGER openMeldDaemon_agent_profile_bindings_canonical_enabled_insert_check",
      });
      harness.run({
        sql: "DROP TRIGGER openMeldDaemon_agent_profile_bindings_canonical_enabled_update_check",
      });
      const canonical = createBindingRecord({
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        bindingId: "binding_hosted_current",
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        runtimeKind: "hosted_center_agent",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: canonical,
      });
      harness.run({
        params: [
          "binding_legacy_admin",
          "owner_account",
          "admin-1",
          AGENT_PROFILE_ID,
          HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          "hosted_center_agent",
          JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
          HOSTED_CENTER_AGENT_CONTROLLER_REF,
          1000,
          1000,
        ],
        sql: `
          INSERT INTO openMeldDaemon_agent_profile_bindings (
            binding_id, owner_kind, owner_id, agent_profile_id,
            openmeld_service_runtime_id, runtime_kind,
            hosted_runtime_identity_json, agent_controller_ref,
            binding_state, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled_primary', ?, ?)
        `,
      });
      const currentBindings =
        await listEnabledPrimaryAgentProfileBindingRecordsForProfile({
          agentProfileId: AGENT_PROFILE_ID,
          db: harness.db,
        });
      harness.run({
        params: [1000, 1000, "binding_legacy_admin"],
        sql: `
          UPDATE openMeldDaemon_agent_profile_bindings
          SET
            binding_state = 'disabled_historical',
            disabled_at_ms = ?,
            updated_at_ms = ?
          WHERE binding_id = ?
        `,
      });

      await expect(
        reconcileRemoteCenterAgentBindingRecord({
          authorization: {
            authorizedBy: OWNER.id,
            id: "authorization-hosted",
            organizationId: "org-1",
          },
          currentBindings,
          db: harness.db,
          noncanonicalDisabledReasonCode:
            "center_agent.binding_owner_reconciled",
          record: {
            ...canonical,
            bindingId: "binding_hosted_replacement",
          },
        })
      ).rejects.toThrow("stale admission evidence");

      expect(
        harness.queryAll<{
          binding_id: string;
          binding_state: string;
        }>({
          params: [AGENT_PROFILE_ID],
          sql: `
            SELECT binding_id, binding_state
            FROM openMeldDaemon_agent_profile_bindings
            WHERE agent_profile_id = ?
            ORDER BY binding_id
          `,
        })
      ).toEqual([
        {
          binding_id: "binding_hosted_current",
          binding_state: "enabled_primary",
        },
        {
          binding_id: "binding_legacy_admin",
          binding_state: "disabled_historical",
        },
      ]);
      expect(
        harness.queryAll({
          sql: "SELECT * FROM organization_binding_authorizations",
        })
      ).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("preserves settings from the newest compatible legacy hosted Binding", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      harness.run({
        sql: `
          CREATE UNIQUE INDEX IF NOT EXISTS organization_binding_authorizations_org_binding_uq_idx
          ON organization_binding_authorizations (organization_id, binding_id)
        `,
      });
      harness.run({
        sql: "DROP TRIGGER openMeldDaemon_agent_profile_bindings_canonical_enabled_insert_check",
      });
      harness.run({
        sql: "DROP TRIGGER openMeldDaemon_agent_profile_bindings_canonical_enabled_update_check",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: createBindingRecord({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding_hosted_old_canonical",
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          runtimeKind: "hosted_center_agent",
        }),
      });
      const openCodePermission = { bash: "deny", edit: "ask" } as const;
      harness.run({
        params: [
          "binding_legacy_hosted",
          "owner_account",
          "admin-1",
          AGENT_PROFILE_ID,
          HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          "hosted_center_agent",
          JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
          HOSTED_CENTER_AGENT_CONTROLLER_REF,
          "codex:plan",
          "codex:fullAccess",
          "gpt-5.6-sol",
          JSON.stringify(openCodePermission),
          "high",
          1000,
          2000,
        ],
        sql: `
          INSERT INTO openMeldDaemon_agent_profile_bindings (
            binding_id, owner_kind, owner_id, agent_profile_id,
            openmeld_service_runtime_id, runtime_kind,
            hosted_runtime_identity_json, agent_controller_ref,
            binding_state, agent_controller_collaboration_mode,
            agent_controller_permission_mode, model_id, opencode_permission,
            reasoning_level, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled_primary', ?, ?, ?, ?, ?, ?, ?)
        `,
      });
      const currentBindings =
        await listEnabledPrimaryAgentProfileBindingRecordsForProfile({
          agentProfileId: AGENT_PROFILE_ID,
          db: harness.db,
        });

      await reconcileRemoteCenterAgentBindingRecord({
        authorization: {
          authorizedBy: OWNER.id,
          id: "authorization-hosted",
          organizationId: "org-1",
        },
        currentBindings,
        db: harness.db,
        noncanonicalDisabledReasonCode: "center_agent.binding_owner_reconciled",
        record: createBindingRecord({
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          bindingId: "binding_hosted",
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          runtimeKind: "hosted_center_agent",
        }),
      });

      await expect(
        readPrimaryAgentProfileBindingRecord({
          agentProfileId: AGENT_PROFILE_ID,
          db: harness.db,
          owner: OWNER,
        })
      ).resolves.toMatchObject({
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:fullAccess",
        modelId: "gpt-5.6-sol",
        openCodePermission,
        reasoningLevel: "high",
      });
    } finally {
      harness.close();
    }
  });

  it("rolls back legacy disables and the hosted target when authorization carry-over fails", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      harness.run({
        sql: `
          CREATE UNIQUE INDEX IF NOT EXISTS organization_binding_authorizations_org_binding_uq_idx
          ON organization_binding_authorizations (organization_id, binding_id)
        `,
      });
      harness.run({
        sql: "DROP TRIGGER openMeldDaemon_agent_profile_bindings_canonical_enabled_insert_check",
      });
      harness.run({
        sql: "DROP TRIGGER openMeldDaemon_agent_profile_bindings_canonical_enabled_update_check",
      });
      harness.run({
        params: [
          "binding_legacy_admin",
          "owner_account",
          "admin-1",
          AGENT_PROFILE_ID,
          "legacy-runtime",
          "builtin:codex",
          1000,
          1000,
        ],
        sql: `
          INSERT INTO openMeldDaemon_agent_profile_bindings (
            binding_id,
            owner_kind,
            owner_id,
            agent_profile_id,
            openmeld_service_runtime_id,
            agent_controller_ref,
            binding_state,
            created_at_ms,
            updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, 'enabled_primary', ?, ?)
        `,
      });
      harness.run({
        params: [
          "authorization-legacy",
          "org-1",
          "binding_legacy_admin",
          OWNER.id,
          1000,
        ],
        sql: `
          INSERT INTO organization_binding_authorizations (
            id, organization_id, binding_id, authorized_by, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      });
      const currentBindings =
        await listEnabledPrimaryAgentProfileBindingRecordsForProfile({
          agentProfileId: AGENT_PROFILE_ID,
          db: harness.db,
        });

      await expect(
        reconcileRemoteCenterAgentBindingRecord({
          authorization: {
            authorizedBy: "missing-authorizer",
            id: "authorization-hosted",
            organizationId: "org-1",
          },
          currentBindings,
          db: harness.db,
          noncanonicalDisabledReasonCode:
            "center_agent.binding_owner_reconciled",
          record: createBindingRecord({
            agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
            bindingId: "binding_hosted",
            hostedRuntimeIdentityJson: JSON.stringify(
              HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
            ),
            openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
            runtimeKind: "hosted_center_agent",
          }),
        })
      ).rejects.toThrow(FOREIGN_KEY_CONSTRAINT_ERROR_PATTERN);

      expect(
        harness.queryAll<{
          binding_id: string;
          binding_state: string;
          owner_id: string;
        }>({
          params: [AGENT_PROFILE_ID],
          sql: `
            SELECT binding_id, binding_state, owner_id
            FROM openMeldDaemon_agent_profile_bindings
            WHERE agent_profile_id = ?
            ORDER BY binding_id
          `,
        })
      ).toEqual([
        {
          binding_id: "binding_legacy_admin",
          binding_state: "enabled_primary",
          owner_id: "admin-1",
        },
      ]);
      expect(
        harness.queryAll<{
          authorized_by: string;
          binding_id: string;
          id: string;
        }>({
          sql: `
            SELECT id, binding_id, authorized_by
            FROM organization_binding_authorizations
            ORDER BY id
          `,
        })
      ).toEqual([
        {
          authorized_by: OWNER.id,
          binding_id: "binding_legacy_admin",
          id: "authorization-legacy",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("updates hosted model selection only at the expected configuration revision", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_hosted_model",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        runtimeKind: "hosted_center_agent",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record,
      });

      await expect(
        compareAndSetPrimaryAgentProfileBindingModelSelectionRecord({
          agentProfileId: record.agentProfileId,
          db: harness.db,
          expectedConfigurationRevision: 1,
          modelSelectionPatch: {
            modelId: "deepseek/deepseek-v4-flash",
            reasoningLevel: null,
          },
          owner: OWNER,
          updatedAtMs: 2000,
        })
      ).resolves.toMatchObject({
        status: "updated",
        binding: {
          configurationRevision: 2,
          modelId: "deepseek/deepseek-v4-flash",
        },
      });

      await expect(
        compareAndSetPrimaryAgentProfileBindingModelSelectionRecord({
          agentProfileId: record.agentProfileId,
          db: harness.db,
          expectedConfigurationRevision: 1,
          modelSelectionPatch: {
            modelId: null,
            reasoningLevel: null,
          },
          owner: OWNER,
          updatedAtMs: 3000,
        })
      ).resolves.toMatchObject({
        status: "conflict",
        binding: {
          configurationRevision: 2,
          modelId: "deepseek/deepseek-v4-flash",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("creates and reads one enabled primary Binding", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: null,
        createdAtMs: 1000,
        createdByProfileId: "profile-1",
        owner: {
          id: "owner-1",
          kind: "owner_account" as const,
        },
        reasonCode: "agent_profile_binding.created",
        runtimeKind: "openmeld_service" as const,
        hostedRuntimeIdentityJson: null,
        openMeldServiceRuntimeId: "runtime_opaque_1",
        agentControllerCollaborationMode: null,
        agentControllerPermissionMode: "codex:approveForMe",
        configurationRevision: 1,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: null,
        updatedAtMs: 1000,
      };

      await expect(
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record,
        })
      ).resolves.toEqual({
        binding: {
          ...record,
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        outcome: "created",
        status: "accepted",
      });

      await expect(
        readPrimaryAgentProfileBindingRecord({
          agentProfileId: AGENT_PROFILE_ID,
          db: harness.db,
          owner: {
            id: "owner-1",
            kind: "owner_account",
          },
        })
      ).resolves.toEqual({
        ...record,
        bindingState: "enabled_primary",
        disabledAtMs: null,
      });
    } finally {
      harness.close();
    }
  });

  it("creates and reads a hosted Center Agent Binding without a daemon conversation", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const hostedRuntimeIdentityJson = JSON.stringify(
        HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
      );
      const record = createBindingRecord({
        bindingId: "binding_hosted_center_agent",
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        runtimeKind: "hosted_center_agent",
        hostedRuntimeIdentityJson,
      });

      await expect(
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record,
        })
      ).resolves.toEqual({
        binding: {
          ...record,
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        outcome: "created",
        status: "accepted",
      });
      expect(
        harness.queryAll<{
          agent_controller_conversation_id: string | null;
          agent_controller_ref: string;
          hosted_runtime_identity_json: string | null;
          runtime_kind: string;
          openmeld_service_runtime_id: string;
        }>({
          sql: "SELECT agent_controller_ref, agent_controller_conversation_id, runtime_kind, hosted_runtime_identity_json, openmeld_service_runtime_id FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([
        {
          agent_controller_conversation_id: null,
          agent_controller_ref: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          hosted_runtime_identity_json: hostedRuntimeIdentityJson,
          runtime_kind: "hosted_center_agent",
          openmeld_service_runtime_id: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("reuses the existing Binding for the same enabled primary target", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record,
      });

      await expect(
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: {
            ...record,
            bindingId: "binding_opaque_retry",
          },
        })
      ).resolves.toEqual({
        binding: {
          ...record,
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        outcome: "reused",
        status: "accepted",
      });
      expect(
        harness.queryAll<{ binding_id: string }>({
          sql: "SELECT binding_id FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([{ binding_id: "binding_opaque_1" }]);
    } finally {
      harness.close();
    }
  });

  it("updates Agent Controller Permission Mode when the same target is ensured", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record,
      });

      await expect(
        ensurePrimaryAgentProfileBindingRecord({
          agentControllerPermissionModePatch: {
            agentControllerPermissionMode: "codex:approveForMe",
          },
          db: harness.db,
          record: {
            ...record,
            agentControllerPermissionMode: "codex:approveForMe",
            bindingId: "binding_opaque_retry",
            updatedAtMs: 2000,
          },
        })
      ).resolves.toEqual({
        binding: {
          ...record,
          agentControllerPermissionMode: "codex:approveForMe",
          configurationRevision: 2,
          bindingState: "enabled_primary",
          disabledAtMs: null,
          updatedAtMs: 2000,
        },
        outcome: "reused",
        status: "accepted",
      });
      expect(
        harness.queryAll<{
          agent_controller_permission_mode: string | null;
          updated_at_ms: number;
        }>({
          sql: "SELECT agent_controller_permission_mode, updated_at_ms FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([
        {
          agent_controller_permission_mode: "codex:approveForMe",
          updated_at_ms: 2000,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("preserves Agent Controller Permission Mode when reconnecting without a policy patch", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        agentControllerPermissionModePatch: {
          agentControllerPermissionMode: "codex:approveForMe",
        },
        db: harness.db,
        record: {
          ...record,
          agentControllerPermissionMode: "codex:approveForMe",
        },
      });

      await expect(
        reconnectPrimaryAgentProfileBindingRecord({
          acquireExecutionTargetMutationAdmission: async () => undefined,
          db: harness.db,
          record: {
            ...record,
            agentControllerPermissionMode: null,
            bindingId: "binding_opaque_reconnect",
            updatedAtMs: 2000,
          },
        })
      ).resolves.toEqual({
        binding: {
          ...record,
          agentControllerPermissionMode: "codex:approveForMe",
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        outcome: "reused",
        status: "accepted",
      });

      expect(
        harness.queryAll<{
          agent_controller_permission_mode: string | null;
          updated_at_ms: number;
        }>({
          sql: "SELECT agent_controller_permission_mode, updated_at_ms FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([
        {
          agent_controller_permission_mode: "codex:approveForMe",
          updated_at_ms: 1000,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("preserves settings changed after a reconnect reader captured an older Binding", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const initial = {
        ...createBindingRecord({
          bindingId: "binding_before_reconnect",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime_previous",
        }),
        agentControllerPermissionMode: "codex:fullAccess",
        modelId: "gpt-5.6-sol",
        reasoningLevel: "high",
      };
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: initial,
      });

      const staleReconnectSnapshot = await readPrimaryAgentProfileBindingRecord(
        {
          agentProfileId: initial.agentProfileId,
          db: harness.db,
          owner: OWNER,
        }
      );
      expect(staleReconnectSnapshot).toMatchObject({
        agentControllerPermissionMode: "codex:fullAccess",
        configurationRevision: 1,
        modelId: "gpt-5.6-sol",
        reasoningLevel: "high",
      });

      await updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord(
        {
          agentProfileId: initial.agentProfileId,
          agentControllerPermissionModePatch: {
            agentControllerPermissionMode: "codex:askForApproval",
          },
          db: harness.db,
          owner: OWNER,
          updatedAtMs: 2000,
        }
      );
      await expect(
        compareAndSetPrimaryAgentProfileBindingModelSelectionRecord({
          agentProfileId: initial.agentProfileId,
          db: harness.db,
          expectedConfigurationRevision: 2,
          modelSelectionPatch: {
            modelId: "gpt-5.6-sol",
            reasoningLevel: "medium",
          },
          owner: OWNER,
          updatedAtMs: 2500,
        })
      ).resolves.toMatchObject({
        binding: {
          configurationRevision: 3,
        },
        status: "updated",
      });

      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "openmeld-dev",
        owner: OWNER,
      });
      const currentRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 2600,
          runtimeLookupInput,
          openMeldServiceRuntimeId: currentRuntimeId,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: 2700,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 10_000,
          observedAtMs: 2700,
          reasonCodes: ["runtime.agent_controller_report.available"],
          status: "ready",
          openMeldServiceRuntimeId: currentRuntimeId,
        },
      });

      await expect(
        ensurePrimaryAgentProfileBinding({
          agentProfileId: initial.agentProfileId,
          agentControllerRef: "builtin:codex",
          bindingStore: createD1AgentProfileBindingCommandStore({
            acquireExecutionTargetMutationAdmission: async () => undefined,
            db: harness.db,
          }),
          createBindingId: () => "binding_after_reconnect",
          createdByProfileId: "profile-1",
          nowMs: 3000,
          ownerAuthorization: {
            owner: OWNER,
            status: "allowed",
          },
          profileOwnerValidation: {
            owner: OWNER,
            status: "valid",
          },
          runtimeAgentControllerReportStore: {
            readCurrentReport: (input) =>
              readCurrentRuntimeAgentControllerReport({
                agentControllerRef: input.agentControllerRef,
                db: harness.db,
                openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
              }),
          },
          runtimeLookupInput,
          runtimeLookupStore: {
            readRuntimeRecord: (input) =>
              readRuntimeRegistryRecord({
                db: harness.db,
                runtimeLookupInput: input.runtimeLookupInput,
              }),
          },
          openMeldServiceRuntimeId: currentRuntimeId,
          writeMode: "reconnect",
        })
      ).resolves.toMatchObject({
        binding: {
          agentControllerPermissionMode: "codex:askForApproval",
          bindingId: "binding_after_reconnect",
          modelId: "gpt-5.6-sol",
          reasoningLevel: "medium",
          openMeldServiceRuntimeId: "runtime_current",
        },
        outcome: "reconnected",
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("updates only Agent Controller Permission Mode on the enabled primary Binding", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record,
      });

      await expect(
        updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord({
          agentProfileId: record.agentProfileId,
          agentControllerPermissionModePatch: {
            agentControllerPermissionMode: "codex:fullAccess",
          },
          db: harness.db,
          owner: OWNER,
          updatedAtMs: 3000,
        })
      ).resolves.toEqual({
        binding: {
          ...record,
          agentControllerPermissionMode: "codex:fullAccess",
          configurationRevision: 2,
          bindingState: "enabled_primary",
          disabledAtMs: null,
          updatedAtMs: 3000,
        },
        status: "updated",
      });

      expect(
        harness.queryAll<{
          agent_controller_permission_mode: string | null;
          configuration_revision: number;
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          sql: "SELECT agent_controller_permission_mode, configuration_revision, model_id, reasoning_level FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([
        {
          agent_controller_permission_mode: "codex:fullAccess",
          configuration_revision: 2,
          model_id: null,
          reasoning_level: null,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("updates only Agent Controller Collaboration Mode on the enabled primary Binding", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record,
      });

      await expect(
        updatePrimaryAgentProfileBindingAgentControllerCollaborationModeRecord({
          agentProfileId: record.agentProfileId,
          agentControllerCollaborationModePatch: {
            agentControllerCollaborationMode: "codex:plan",
          },
          db: harness.db,
          owner: record.owner,
          updatedAtMs: 2000,
        })
      ).resolves.toEqual({
        binding: {
          ...record,
          agentControllerCollaborationMode: "codex:plan",
          configurationRevision: 2,
          bindingState: "enabled_primary",
          disabledAtMs: null,
          updatedAtMs: 2000,
        },
        status: "updated",
      });

      expect(
        harness.queryFirst<{
          agent_controller_collaboration_mode: string | null;
          agent_controller_permission_mode: string | null;
          configuration_revision: number;
          updated_at_ms: number;
        }>({
          sql: "SELECT agent_controller_collaboration_mode, agent_controller_permission_mode, configuration_revision, updated_at_ms FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual({
        agent_controller_collaboration_mode: "codex:plan",
        agent_controller_permission_mode: null,
        configuration_revision: 2,
        updated_at_ms: 2000,
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a different enabled primary target as a deterministic conflict", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const existing = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: existing,
      });

      await expect(
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: createBindingRecord({
            bindingId: "binding_opaque_2",
            agentControllerRef: "builtin:claude-code",
            openMeldServiceRuntimeId: "runtime_opaque_2",
          }),
        })
      ).resolves.toEqual({
        existingBinding: {
          ...existing,
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        reason: "primary_conflict",
        status: "rejected",
      });
      expect(
        harness.queryAll<{ binding_id: string }>({
          sql: "SELECT binding_id FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([{ binding_id: "binding_opaque_1" }]);
    } finally {
      harness.close();
    }
  });

  it("explicitly reconnects a different enabled primary target", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const existing = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          ...existing,
          agentControllerCollaborationMode: "codex:plan",
        },
      });

      const replacement = {
        ...createBindingRecord({
          bindingId: "binding_opaque_2",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime_opaque_2",
        }),
        createdAtMs: 2000,
        updatedAtMs: 2000,
      };
      await expect(
        reconnectPrimaryAgentProfileBindingRecord({
          acquireExecutionTargetMutationAdmission: async () => undefined,
          db: harness.db,
          record: replacement,
        })
      ).resolves.toEqual({
        binding: {
          ...replacement,
          agentControllerCollaborationMode: "codex:plan",
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        outcome: "reconnected",
        status: "accepted",
      });

      expect(
        harness.queryAll<{
          agent_controller_collaboration_mode: string | null;
          binding_id: string;
          binding_state: string;
          disabled_at_ms: number | null;
        }>({
          sql: "SELECT agent_controller_collaboration_mode, binding_id, binding_state, disabled_at_ms FROM openMeldDaemon_agent_profile_bindings ORDER BY created_at_ms",
        })
      ).toEqual([
        {
          agent_controller_collaboration_mode: "codex:plan",
          binding_id: "binding_opaque_1",
          binding_state: "disabled_historical",
          disabled_at_ms: 2000,
        },
        {
          agent_controller_collaboration_mode: "codex:plan",
          binding_id: "binding_opaque_2",
          binding_state: "enabled_primary",
          disabled_at_ms: null,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("disables the enabled primary Binding when its Agent Profile is removed", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerConversationId: "ctx-shared",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record,
      });

      await expect(
        disablePrimaryAgentProfileBindingRecord({
          agentProfileId: record.agentProfileId,
          db: harness.db,
          disabledAtMs: 3000,
          owner: OWNER,
          reasonCode: "agent_profile_binding.profile_deleted",
        })
      ).resolves.toEqual({
        ...record,
        bindingState: "disabled_historical",
        disabledAtMs: 3000,
        reasonCode: "agent_profile_binding.profile_deleted",
        updatedAtMs: 3000,
      });
      await expect(
        readPrimaryAgentProfileBindingRecord({
          agentProfileId: record.agentProfileId,
          db: harness.db,
          owner: OWNER,
        })
      ).resolves.toBeNull();
      expect(
        harness.queryAll<{
          binding_id: string;
          binding_state: string;
          disabled_at_ms: number | null;
          reason_code: string | null;
        }>({
          sql: "SELECT binding_id, binding_state, disabled_at_ms, reason_code FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([
        {
          binding_id: "binding_opaque_1",
          binding_state: "disabled_historical",
          disabled_at_ms: 3000,
          reason_code: "agent_profile_binding.profile_deleted",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("converges concurrent duplicate ensure calls to one enabled primary Binding", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const record = createBindingRecord({
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });

      const results = await Promise.all([
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record,
        }),
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: {
            ...record,
            bindingId: "binding_opaque_retry",
          },
        }),
      ]);

      expect(results.map((result) => result.status)).toEqual([
        "accepted",
        "accepted",
      ]);
      expect(
        results.map((result) =>
          result.status === "accepted" ? result.binding.bindingId : null
        )
      ).toEqual(["binding_opaque_1", "binding_opaque_1"]);
      expect(
        harness.queryAll<{ binding_id: string }>({
          sql: "SELECT binding_id FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toEqual([{ binding_id: "binding_opaque_1" }]);
    } finally {
      harness.close();
    }
  });

  it("converges concurrent different-target ensure calls to one created Binding and one primary conflict", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const results = await Promise.all([
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: createBindingRecord({
            bindingId: "binding_opaque_1",
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime_opaque_1",
          }),
        }),
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: createBindingRecord({
            bindingId: "binding_opaque_2",
            agentControllerRef: "builtin:claude-code",
            openMeldServiceRuntimeId: "runtime_opaque_2",
          }),
        }),
      ]);

      expect(
        results.filter((result) => result.status === "accepted")
      ).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({
          reason: "primary_conflict",
          status: "rejected",
        }),
      ]);
      expect(
        harness.queryAll<{ binding_id: string }>({
          sql: "SELECT binding_id FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("rejects an enabled primary Binding when another Agent Profile already owns the controller conversation", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const existing = createBindingRecord({
        agentControllerConversationId: "ctx-shared",
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: existing,
      });

      await expect(
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: createBindingRecord({
            agentControllerConversationId: "ctx-shared",
            agentProfileId: OTHER_AGENT_PROFILE_ID,
            bindingId: "binding_opaque_2",
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime_opaque_1",
          }),
        })
      ).resolves.toEqual({
        existingBinding: {
          ...existing,
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        reason: "controller_conversation_conflict",
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("atomically converges concurrent Agent Profiles claiming the same controller conversation", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const results = await Promise.all([
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: createBindingRecord({
            agentControllerConversationId: "ctx-shared",
            agentProfileId: AGENT_PROFILE_ID,
            bindingId: "binding_opaque_1",
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime_opaque_1",
          }),
        }),
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: createBindingRecord({
            agentControllerConversationId: "ctx-shared",
            agentProfileId: OTHER_AGENT_PROFILE_ID,
            bindingId: "binding_opaque_2",
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime_opaque_1",
          }),
        }),
      ]);

      expect(
        results.filter((result) => result.status === "accepted")
      ).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({
          reason: "controller_conversation_conflict",
          status: "rejected",
        }),
      ]);
      expect(
        harness.queryAll<{ binding_id: string }>({
          sql: "SELECT binding_id FROM openMeldDaemon_agent_profile_bindings",
        })
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("reuses this Agent Profile's existing Binding without repairing historical duplicate conversations", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const existing = createBindingRecord({
        agentControllerConversationId: "ctx-shared",
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: existing,
      });
      harness.run({
        params: [
          "binding_opaque_2",
          OWNER.kind,
          OWNER.id,
          OTHER_AGENT_PROFILE_ID,
          "runtime_opaque_1",
          "builtin:codex",
          "ctx-shared",
          1001,
          1001,
          "profile-1",
          "agent_profile_binding.created",
        ],
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
            updated_at_ms,
            disabled_at_ms,
            created_by_profile_id,
            reason_code
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'enabled_primary', ?, ?, null, ?, ?)
        `,
      });

      await expect(
        ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: existing,
        })
      ).resolves.toEqual({
        binding: {
          ...existing,
          bindingState: "enabled_primary",
          disabledAtMs: null,
        },
        outcome: "reused",
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("lets the command service consume real D1 Runtime facts and write Binding truth through the D1 repo", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
    applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
    try {
      const runtimeLookupInput = ownerAccountRuntimeLookupInput();
      const registeredRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_opaque_1",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: registeredRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: 1200,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.available"],
          openMeldServiceRuntimeId: registeredRuntimeId,
          status: "ready",
        },
      });

      await expect(
        ensurePrimaryAgentProfileBinding({
          agentProfileId: AGENT_PROFILE_ID,
          bindingStore: createD1AgentProfileBindingCommandStore({
            db: harness.db,
          }),
          agentControllerRef: "builtin:codex",
          createBindingId: () => "binding_opaque_1",
          createdByProfileId: "profile-1",
          nowMs: 2000,
          ownerAuthorization: {
            owner: OWNER,
            status: "allowed",
          },
          profileOwnerValidation: {
            owner: OWNER,
            status: "valid",
          },
          runtimeAgentControllerReportStore: {
            readCurrentReport: (input) =>
              readCurrentRuntimeAgentControllerReport({
                agentControllerRef: input.agentControllerRef,
                db: harness.db,
                openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
              }),
          },
          openMeldServiceRuntimeId: registeredRuntimeId,
          runtimeLookupInput,
          runtimeLookupStore: {
            readRuntimeRecord: (input) =>
              readRuntimeRegistryRecord({
                db: harness.db,
                runtimeLookupInput: input.runtimeLookupInput,
              }),
          },
        })
      ).resolves.toMatchObject({
        binding: {
          bindingId: "binding_opaque_1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime_opaque_1",
        },
        outcome: "created",
        routable: true,
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });
});

function createBindingRecord(input: {
  agentControllerConversationId?: string | null;
  agentProfileId?: string;
  bindingId: string;
  agentControllerRef: string;
  hostedRuntimeIdentityJson?: string | null;
  runtimeKind?: "openmeld_service" | "hosted_center_agent";
  openMeldServiceRuntimeId: string;
}) {
  return {
    agentProfileId: input.agentProfileId ?? AGENT_PROFILE_ID,
    bindingId: input.bindingId,
    agentControllerRef: input.agentControllerRef,
    agentControllerConversationId: input.agentControllerConversationId ?? null,
    createdAtMs: 1000,
    createdByProfileId: "profile-1",
    owner: {
      id: "owner-1",
      kind: "owner_account" as const,
    },
    reasonCode: "agent_profile_binding.created",
    runtimeKind: input.runtimeKind ?? "openmeld_service",
    hostedRuntimeIdentityJson: input.hostedRuntimeIdentityJson ?? null,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    agentControllerCollaborationMode: null,
    agentControllerPermissionMode: null,
    configurationRevision: 1,
    modelId: null,
    openCodePermission: null,
    reasoningLevel: null,
    updatedAtMs: 1000,
  };
}

function ownerAccountRuntimeLookupInput(): RuntimeLookupInput {
  return createRuntimeLookupInput({
    deviceId: "device-1",
    lane: "openmeld-dev",
    owner: {
      id: "owner-1",
      kind: "owner_account",
    },
  });
}

function applyMigrationForTable(
  harness: ReturnType<typeof createSqliteD1Harness>,
  tableName: string
): void {
  if (tableName !== "openMeldDaemon_agent_profile_bindings") {
    applySingleTableMigration(harness, tableName);
    return;
  }
  applyAgentProfileBindingRepoMigrations(harness);
}

function applyAgentProfileBindingRepoMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  applyAgentProfileBindingIdentityTables(harness);
  applyDrizzleMigrationsForTables(harness, [
    "openmeld_profiles",
    "openMeldDaemon_agent_profile_bindings",
  ]);
  const nowMs = 1000;
  harness.run({
    params: [OWNER.id, "Owner", "owner@example.com", 1, nowMs, nowMs],
    sql: `
      INSERT INTO users (
        id, name, email, email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: ["org-1", "Organization", "organization", nowMs],
    sql: `
      INSERT INTO organizations (id, name, slug, created_at)
      VALUES (?, ?, ?, ?)
    `,
  });
  for (const [profileId, profileHandle] of [
    [AGENT_PROFILE_ID, "agent-one"],
    [OTHER_AGENT_PROFILE_ID, "agent-two"],
  ] as const) {
    harness.run({
      params: [
        profileId,
        profileHandle,
        profileHandle,
        "agent",
        0,
        "active",
        "org-1",
        OWNER.id,
        "migration",
        nowMs,
        nowMs,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    });
  }
}

function applyAgentProfileBindingIdentityTables(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: `
      CREATE TABLE users (
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
      CREATE TABLE organizations (
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
      CREATE TABLE projects (
        id text PRIMARY KEY NOT NULL
      )
    `,
  });
}
