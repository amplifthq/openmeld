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
import { describe, expect, it, vi } from "vitest";
import { ensurePrimaryAgentProfileBinding } from "../src/agent-profile-binding/application/agent-profile-binding-command-service";
import {
  compareAndSetPrimaryAgentProfileBindingModelSelectionRecord,
  createPostgresAgentProfileBindingCommandStore,
  disablePrimaryAgentProfileBindingRecord,
  ensurePrimaryAgentProfileBindingRecord,
  listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController,
  listPrimaryAgentProfileConfigurations,
  readPrimaryAgentProfileBindingRecord,
  reconnectPrimaryAgentProfileBindingRecord,
  updatePrimaryAgentProfileBindingAgentControllerCollaborationModeRecord,
  updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord,
  updatePrimaryAgentProfileBindingConversationId,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import {
  acceptRuntimeAgentControllerReportRecord,
  readCurrentRuntimeAgentControllerReport,
} from "../src/runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import {
  readRuntimeRegistryRecord,
  registerRuntimeRegistryRecord,
} from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { withPermissionModeAuditAttribution } from "../src/sensitive-operations/application/permission-mode-audit-context";
import { PUBLISHED_LOCAL_COMPONENTS_MANIFEST } from "../test-support/published-local-components-release";
import {
  createPostgresHarness,
  installPostgresWriteFailure,
} from "./helpers/postgresql-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const OTHER_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const OWNER = {
  id: "owner-1",
  kind: "owner_account",
} as const;
describe("Agent Profile Binding repo write-side", () => {
  it("initializes a Binding once, retains later model settings, and refuses a changed target", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
    try {
      const record = createBindingRecord({
        bindingId: "creation-binding",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "creation-runtime",
      });
      const initial = await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        initializeOnly: true,
        record: { ...record, modelId: "gpt-5.6-sol", reasoningLevel: "high" },
      });
      expect(initial).toMatchObject({
        status: "accepted",
        outcome: "created",
        binding: { modelId: "gpt-5.6-sol", reasoningLevel: "high" },
      });
      const chosen = await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        modelSelectionPatch: {
          modelId: "gpt-6-astra",
          reasoningLevel: "medium",
        },
        record: { ...record, updatedAtMs: 2000 },
      });
      const resumed = await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        initializeOnly: true,
        modelSelectionPatch: { modelId: "gpt-5.6-sol", reasoningLevel: "high" },
        record: { ...record, updatedAtMs: 3000 },
      });
      expect(resumed).toEqual({ ...chosen, outcome: "reused" });
      expect(resumed).toMatchObject({
        binding: {
          modelId: "gpt-6-astra",
          reasoningLevel: "medium",
          updatedAtMs: 2000,
        },
      });
      expect(
        await ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          initializeOnly: true,
          record: { ...record, openMeldServiceRuntimeId: "other-runtime" },
        })
      ).toMatchObject({ status: "rejected", reason: "primary_conflict" });
      expect(
        await readPrimaryAgentProfileBindingRecord({
          agentProfileId: AGENT_PROFILE_ID,
          db: harness.db,
          owner: OWNER,
        })
      ).toMatchObject({
        modelId: "gpt-6-astra",
        openMeldServiceRuntimeId: "creation-runtime",
      });
    } finally {
      await harness.close();
    }
  });

  it("reads member-visible configuration for exact authorized Profile/owner pairs without extra query rounds", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
    try {
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: createBindingRecord({
          bindingId: "branding-binding",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
          agentControllerConversationId: "private-session",
        }),
      });
      const profiles = [
        { profileId: AGENT_PROFILE_ID, ownerUserId: OWNER.id },
        ...Array.from({ length: 100 }, (_, index) => ({
          profileId: `missing-${index}`,
          ownerUserId: OWNER.id,
        })),
      ];
      const legacyPrepare = vi.spyOn(harness.db, "query");
      expect([
        ...(await listPrimaryAgentProfileConfigurations({
          db: harness.db,
          profiles,
        })),
      ]).toEqual([[AGENT_PROFILE_ID, { agentControllerRef: "builtin:codex" }]]);
      expect(legacyPrepare).toHaveBeenCalledTimes(1);
      expect(
        legacyPrepare.mock.calls.map(([query]) =>
          typeof query === "string" ? 0 : query.values?.length
        )
      ).toEqual([3]);
      legacyPrepare.mockRestore();
      await harness.db.query({
        text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET model_id = 'gpt-5.6-sol', reasoning_level = 'high' WHERE binding_id = 'branding-binding'",
        values: [],
      });
      const prepare = vi.spyOn(harness.db, "query");
      const withModels = await listPrimaryAgentProfileConfigurations({
        db: harness.db,
        profiles,
        includeModelSelection: true,
      });
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(
        prepare.mock.calls.map(([query]) =>
          typeof query === "string" ? 0 : query.values?.length
        )
      ).toEqual([3]);
      expect([...withModels]).toEqual([
        [
          AGENT_PROFILE_ID,
          {
            agentControllerRef: "builtin:codex",
            modelSelection: { modelId: "gpt-5.6-sol", reasoningLevel: "high" },
          },
        ],
      ]);
      prepare.mockRestore();
      await harness.db.query({
        text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET model_id = NULL WHERE binding_id = \'branding-binding\'',
        values: [],
      });
      expect(
        (
          await listPrimaryAgentProfileConfigurations({
            db: harness.db,
            profiles,
            includeModelSelection: true,
          })
        ).get(AGENT_PROFILE_ID)?.modelSelection
      ).toBeNull();
      expect([
        ...(await listPrimaryAgentProfileConfigurations({
          db: harness.db,
          profiles: [
            { profileId: AGENT_PROFILE_ID, ownerUserId: "wrong-owner" },
          ],
        })),
      ]).toEqual([]);
      await disablePrimaryAgentProfileBindingRecord({
        db: harness.db,
        owner: OWNER,
        agentProfileId: AGENT_PROFILE_ID,
        disabledAtMs: 2000,
        reasonCode: "test",
      });
      expect([
        ...(await listPrimaryAgentProfileConfigurations({
          db: harness.db,
          profiles,
        })),
      ]).toEqual([]);
    } finally {
      await harness.close();
    }
  });
  it("updates hosted model selection only at the expected configuration revision", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
    await harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = \'center_agent\', owner_user_id = NULL WHERE profile_id = $1',
      values: [AGENT_PROFILE_ID],
    });
    try {
      const record = {
        ...createBindingRecord({
          bindingId: "binding_hosted_model",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          hostedRuntimeIdentityJson: JSON.stringify(
            HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
          ),
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          runtimeKind: "hosted_center_agent",
        }),
        owner: { kind: "organization" as const, id: "org-1" },
      };
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
          owner: record.owner,
          updatedAtMs: 2000,
        })
      ).resolves.toMatchObject({
        status: "updated",
        binding: {
          configurationRevision: 2,
          modelId: "deepseek/deepseek-v4-flash",
        },
      });
      expect([
        ...(await listPrimaryAgentProfileConfigurations({
          db: harness.db,
          profiles: [
            {
              profileId: record.agentProfileId,
              ownerUserId: null,
              managedRole: "center_agent",
              organizationId: "org-1",
            },
          ],
          includeModelSelection: true,
        })),
      ]).toEqual([
        [
          record.agentProfileId,
          {
            agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
            modelSelection: { modelId: "deepseek/deepseek-v4-flash" },
          },
        ],
      ]);
      await expect(
        compareAndSetPrimaryAgentProfileBindingModelSelectionRecord({
          agentProfileId: record.agentProfileId,
          db: harness.db,
          expectedConfigurationRevision: 1,
          modelSelectionPatch: {
            modelId: null,
            reasoningLevel: null,
          },
          owner: record.owner,
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
      await harness.close();
    }
  });
  it("creates and reads one enabled primary Binding", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
      await harness.close();
    }
  });
  it("creates and reads a hosted Center Agent Binding without a daemon conversation", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
    await harness.query({
      text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = \'center_agent\', owner_user_id = NULL WHERE profile_id = $1',
      values: [AGENT_PROFILE_ID],
    });
    try {
      const hostedRuntimeIdentityJson = JSON.stringify(
        HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
      );
      const record = {
        ...createBindingRecord({
          bindingId: "binding_hosted_center_agent",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          openMeldServiceRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
          runtimeKind: "hosted_center_agent",
          hostedRuntimeIdentityJson,
        }),
        owner: { kind: "organization" as const, id: "org-1" },
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
      expect(
        await harness.queryAll<{
          agent_controller_conversation_id: string | null;
          agent_controller_ref: string;
          hosted_runtime_identity_json: string | null;
          runtime_kind: string;
          openmeld_service_runtime_id: string;
        }>({
          text: 'SELECT agent_controller_ref, agent_controller_conversation_id, runtime_kind, hosted_runtime_identity_json, openmeld_service_runtime_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
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
      await harness.close();
    }
  });
  it("reuses the existing Binding for the same enabled primary target", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          binding_id: string;
        }>({
          text: 'SELECT binding_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual([{ binding_id: "binding_opaque_1" }]);
    } finally {
      await harness.close();
    }
  });
  it("updates Agent Controller Permission Mode when the same target is ensured", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          agent_controller_permission_mode: string | null;
          updated_at_ms: number;
        }>({
          text: 'SELECT agent_controller_permission_mode, updated_at_ms FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual([
        {
          agent_controller_permission_mode: "codex:approveForMe",
          updated_at_ms: 2000,
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("preserves Agent Controller Permission Mode when reconnecting without a policy patch", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          agent_controller_permission_mode: string | null;
          updated_at_ms: number;
        }>({
          text: 'SELECT agent_controller_permission_mode, updated_at_ms FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual([
        {
          agent_controller_permission_mode: "codex:approveForMe",
          updated_at_ms: 1000,
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("preserves settings changed after a reconnect reader captured an older Binding", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        authFreshnessRequired: true,
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
          localComponentsManifest: PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
          agentProfileId: initial.agentProfileId,
          agentControllerRef: "builtin:codex",
          bindingStore: createPostgresAgentProfileBindingCommandStore({
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
      await harness.close();
    }
  });
  it.each([
    { reconnect: false, failAudit: false },
    { reconnect: false, failAudit: true },
    { reconnect: true, failAudit: false },
    { reconnect: true, failAudit: true },
  ])("commits permission changes with their audit or rolls both back: %j", async ({
    reconnect,
    failAudit,
  }) => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
    const record = {
      ...createBindingRecord({
        bindingId: "audited-old",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "audited-runtime",
      }),
      agentControllerPermissionMode: "codex:askForApproval",
    };
    try {
      await ensurePrimaryAgentProfileBindingRecord({ db: harness.db, record });
      if (failAudit) {
        await installPostgresWriteFailure({
          harness,
          table: "sensitive_operation_audit_events",
          operation: "INSERT",
          message: "audit unavailable",
        });
      }
      const mutation = withPermissionModeAuditAttribution<unknown>(
        {
          actorUserId: OWNER.id,
          organizationId: "org-1",
          requestId: "permission-request",
          sourceKind: "web_session",
          chainRootProfileId: null,
          taskExecutionId: null,
          confirmationId: null,
        },
        () =>
          reconnect
            ? reconnectPrimaryAgentProfileBindingRecord({
                db: harness.db,
                acquireExecutionTargetMutationAdmission: async () => undefined,
                record: {
                  ...record,
                  bindingId: "audited-new",
                  openMeldServiceRuntimeId: "new-runtime",
                  updatedAtMs: 3000,
                },
                agentControllerPermissionModePatch: {
                  agentControllerPermissionMode: "codex:fullAccess",
                },
              })
            : updatePrimaryAgentProfileBindingAgentControllerPermissionModeRecord(
                {
                  db: harness.db,
                  agentProfileId: AGENT_PROFILE_ID,
                  owner: OWNER,
                  updatedAtMs: 3000,
                  agentControllerPermissionModePatch: {
                    agentControllerPermissionMode: "codex:fullAccess",
                  },
                }
              )
      );
      if (failAudit) {
        await expect(mutation).rejects.toThrow("audit unavailable");
      } else {
        await mutation;
      }
      const saved = await readPrimaryAgentProfileBindingRecord({
        db: harness.db,
        agentProfileId: AGENT_PROFILE_ID,
        owner: OWNER,
      });
      expect(saved).toMatchObject({
        agentControllerPermissionMode: failAudit
          ? "codex:askForApproval"
          : "codex:fullAccess",
        bindingId: !failAudit && reconnect ? "audited-new" : "audited-old",
      });
      const events = await harness.queryAll<{
        actor_user_id: string;
        source_kind: string;
        permission_mode_change_json: string;
      }>({
        text: 'SELECT actor_user_id, source_kind, permission_mode_change_json FROM "openmeld"."sensitive_operation_audit_events"',
      });
      expect(events).toHaveLength(failAudit ? 0 : 1);
      if (!failAudit) {
        expect(events[0]).toMatchObject({
          actor_user_id: OWNER.id,
          source_kind: "web_session",
        });
        const event = events[0];
        if (!event) {
          throw new Error("Expected committed permission audit");
        }
        expect(JSON.parse(event.permission_mode_change_json)).toEqual({
          bindingId: reconnect ? "audited-new" : "audited-old",
          previousMode: "codex:askForApproval",
          mode: "codex:fullAccess",
          previousRevision: 1,
          revision: reconnect ? 1 : 2,
          requestId: "permission-request",
        });
      }
    } finally {
      await harness.close();
    }
  });

  it("updates only Agent Controller Permission Mode on the enabled primary Binding", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          agent_controller_permission_mode: string | null;
          configuration_revision: number;
          model_id: string | null;
          reasoning_level: string | null;
        }>({
          text: 'SELECT agent_controller_permission_mode, configuration_revision, model_id, reasoning_level FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
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
      await harness.close();
    }
  });
  it("updates only Agent Controller Collaboration Mode on the enabled primary Binding", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryFirst<{
          agent_controller_collaboration_mode: string | null;
          agent_controller_permission_mode: string | null;
          configuration_revision: number;
          updated_at_ms: number;
        }>({
          text: 'SELECT agent_controller_collaboration_mode, agent_controller_permission_mode, configuration_revision, updated_at_ms FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual({
        agent_controller_collaboration_mode: "codex:plan",
        agent_controller_permission_mode: null,
        configuration_revision: 2,
        updated_at_ms: 2000,
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects a different enabled primary target as a deterministic conflict", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          binding_id: string;
        }>({
          text: 'SELECT binding_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual([{ binding_id: "binding_opaque_1" }]);
    } finally {
      await harness.close();
    }
  });
  it("explicitly reconnects a different enabled primary target", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          agent_controller_collaboration_mode: string | null;
          binding_id: string;
          binding_state: string;
          disabled_at_ms: number | null;
        }>({
          text: 'SELECT agent_controller_collaboration_mode, binding_id, binding_state, disabled_at_ms FROM "openmeld"."openMeldDaemon_agent_profile_bindings" ORDER BY created_at_ms',
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
      await harness.close();
    }
  });
  it("disables the enabled primary Binding when its Agent Profile is removed", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          binding_id: string;
          binding_state: string;
          disabled_at_ms: number | null;
          reason_code: string | null;
        }>({
          text: 'SELECT binding_id, binding_state, disabled_at_ms, reason_code FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
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
      await harness.close();
    }
  });
  it("converges concurrent duplicate ensure calls to one enabled primary Binding", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
      const winner = results[0];
      if (winner?.status !== "accepted") {
        throw new Error("Expected an accepted Binding");
      }
      expect(
        results.map((result) =>
          result.status === "accepted" ? result.binding.bindingId : null
        )
      ).toEqual([winner.binding.bindingId, winner.binding.bindingId]);
      expect(
        await harness.queryAll<{
          binding_id: string;
        }>({
          text: 'SELECT binding_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toEqual([{ binding_id: winner.binding.bindingId }]);
    } finally {
      await harness.close();
    }
  });
  it("converges concurrent different-target ensure calls to one created Binding and one primary conflict", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          binding_id: string;
        }>({
          text: 'SELECT binding_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
  it("rejects an enabled primary Binding when another Agent Profile already owns the controller conversation", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
      await harness.close();
    }
  });
  it("atomically converges concurrent Agent Profiles claiming the same controller conversation", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        await harness.queryAll<{
          binding_id: string;
        }>({
          text: 'SELECT binding_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings"',
        })
      ).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
  it("allows only one concurrent Binding update to claim a controller conversation", async () => {
    const harness = await createPostgresHarness();
    await applyAgentProfileBindingRepoMigrations(harness);
    try {
      for (const [agentProfileId, bindingId, conversationId] of [
        [AGENT_PROFILE_ID, "binding-one", "initial-one"],
        [OTHER_AGENT_PROFILE_ID, "binding-two", "initial-two"],
      ] as const) {
        await ensurePrimaryAgentProfileBindingRecord({
          db: harness.db,
          record: createBindingRecord({
            agentProfileId,
            bindingId,
            agentControllerConversationId: conversationId,
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "runtime-one",
          }),
        });
      }
      const outcomes = await Promise.all(
        (
          [
            [AGENT_PROFILE_ID, "binding-one"],
            [OTHER_AGENT_PROFILE_ID, "binding-two"],
          ] as const
        ).map(([agentProfileId, bindingId]) =>
          updatePrimaryAgentProfileBindingConversationId({
            db: harness.db,
            owner: OWNER,
            agentProfileId,
            bindingId,
            agentControllerConversationId: "shared-update",
            updatedAtMs: 2000,
          })
        )
      );
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(1);
      const persisted = await harness.db.query<{ agent_profile_id: string }>({
        text: 'SELECT agent_profile_id FROM "openmeld"."openMeldDaemon_agent_profile_bindings" WHERE agent_controller_conversation_id = $1',
        values: ["shared-update"],
      });
      expect(persisted.rows).toEqual([
        { agent_profile_id: outcomes.find(Boolean)?.agentProfileId },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("reuses this Agent Profile's existing Binding without repairing historical duplicate conversations", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
      await harness.query({
        values: [
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
        text: `
          INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'enabled_primary', $8, $9, null, $10, $11)
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
      await harness.close();
    }
  });
  it("lets the command service consume real D1 Runtime facts and write Binding truth through the D1 repo", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_runtime_agent_controller_reports"
    );
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
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
        authFreshnessRequired: true,
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
          localComponentsManifest: PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
          agentProfileId: AGENT_PROFILE_ID,
          bindingStore: createPostgresAgentProfileBindingCommandStore({
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
      await harness.close();
    }
  });
  it("lists only enabled Profiles bound to the reported Runtime and Agent Controller", async () => {
    const harness = await createPostgresHarness();
    await applyMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
    try {
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: createBindingRecord({
          agentControllerRef: "builtin:codex",
          bindingId: "binding_codex_target",
          openMeldServiceRuntimeId: "runtime_target",
        }),
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: createBindingRecord({
          agentControllerRef: "builtin:claude-code",
          agentProfileId: OTHER_AGENT_PROFILE_ID,
          bindingId: "binding_claude_other",
          openMeldServiceRuntimeId: "runtime_target",
        }),
      });
      await expect(
        listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          openMeldServiceRuntimeId: "runtime_target",
          owner: OWNER,
        })
      ).resolves.toMatchObject([
        {
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime_target",
        },
      ]);
    } finally {
      await harness.close();
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
async function applyMigrationForTable(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  tableName: string
): Promise<void> {
  if (tableName !== "openMeldDaemon_agent_profile_bindings") {
    return;
  }
  await applyAgentProfileBindingRepoMigrations(harness);
}
async function applyAgentProfileBindingRepoMigrations(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  const nowMs = 1000;
  await harness.query({
    values: [OWNER.id, "Owner", "owner@example.com", 1, nowMs, nowMs],
    text: `
      INSERT INTO "openmeld"."users" (
        id, name, email, email_verified, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
  });
  await harness.query({
    values: ["org-1", "Organization", "organization", nowMs],
    text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ($1, $2, $3, $4)
    `,
  });
  for (const [profileId, profileHandle] of [
    [AGENT_PROFILE_ID, "agent-one"],
    [OTHER_AGENT_PROFILE_ID, "agent-two"],
  ] as const) {
    await harness.query({
      values: [
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
    });
  }
}
