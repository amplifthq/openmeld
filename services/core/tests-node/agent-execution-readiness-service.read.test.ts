import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createAgentExecutionReadinessReads } from "../src/agent-execution/application/agent-execution-readiness-reads";
import { resolveCoreAgentExecutionReadinessForProfile } from "../src/agent-execution/application/agent-execution-readiness-service";
import { writeAcceptedAgentExecutionReadinessImpact } from "../src/agent-execution/infrastructure/d1/agent-execution-readiness-impact-repo";
import { acceptProviderConversationProofRecord } from "../src/agent-execution/infrastructure/d1/provider-conversation-proof-repo";
import { ensurePrimaryAgentProfileBindingRecord } from "../src/agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import { createAvailableCodexAgentControllerInterface } from "./helpers/agent-controller-interface.test-support";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const OWNER_USER_ID = "owner-1";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "org-1";
const GENERATED_AT = "2026-05-10T00:00:00.000Z";
const GENERATED_AT_MS = Date.parse(GENERATED_AT);
const AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE =
  createAvailableCodexAgentControllerInterface({ observedAt: GENERATED_AT });
// These readiness fixtures represent a supported Service. Keep the version
// explicit so a release manifest that still describes the previous public
// version cannot silently turn unrelated readiness tests into update tests.
const CURRENT_SERVICE_VERSION = "0.3.197";
const COMPATIBLE_DAEMON_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;

describe.each([
  false,
  true,
])("agent execution readiness service D1 read model (batch=%s)", (batchProfileReads) => {
  it("blocks readiness when the online daemon route is for a different Runtime than the Binding runtime", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const oldRuntimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-old",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const oldRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: oldRuntimeLookupInput,
        openMeldServiceRuntimeId: "runtime_old_opaque",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId: oldRuntimeId,
          runtimeLookupInput: oldRuntimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
          agentControllerInterface: AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE,
          agentControllerRef: "builtin:codex",
          expiresAtMs: GENERATED_AT_MS + 60_000,
          observedAtMs: GENERATED_AT_MS,
          reasonCodes: ["runtime.ready"],
          openMeldServiceRuntimeId: oldRuntimeId,
          status: "ready",
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "bind_11111111-1111-4111-8111-111111111111",
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: oldRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          routeDeviceId: "device-current",
          routeLane: "dev-local",
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "blocked",
        facts: {
          binding: {
            routable: true,
            source: "binding_truth",
          },
          claim: {
            executionBlocked: true,
            reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
            source: "claim_diagnostics",
          },
          route: {
            deviceId: "device-current",
            online: true,
          },
          runtime: {
            ready: false,
          },
        },
      });
      expect(readiness.agentExecutionReadiness.displayState).toBe("blocked");
      expect(readiness.spaceMemberAgentExecutionReadiness.displayState).toBe(
        "blocked"
      );
    } finally {
      harness.close();
    }
  });

  it("uses the Core primary Binding capability as the only profile execution target", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
          agentControllerInterface: AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE,
          agentControllerRef: "builtin:codex",
          expiresAtMs: GENERATED_AT_MS + 60_000,
          observedAtMs: GENERATED_AT_MS,
          reasonCodes: ["runtime.ready"],
          openMeldServiceRuntimeId,
          status: "ready",
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "bind_22222222-2222-4222-8222-222222222222",
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          routeDeviceId: "device-current",
          routeLane: "dev-local",
          workingFolderBindingId: "bind_22222222-2222-4222-8222-222222222222",
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "ready",
        facts: {
          binding: {
            routable: true,
            source: "binding_truth",
          },
          claim: {
            executionBlocked: false,
            reasonCodes: [],
            source: "claim_diagnostics",
          },
        },
        primaryAction: "none",
      });
      expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
        "claim_eligibility.binding_capability_mismatch"
      );
    } finally {
      harness.close();
    }
  });

  it("keeps missing Codex App Server provider conversation proof as diagnostics only", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
          agentControllerInterface: AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE,
          agentControllerRef: "builtin:codex",
          expiresAtMs: GENERATED_AT_MS + 60_000,
          observedAtMs: GENERATED_AT_MS,
          reasonCodes: ["runtime.ready"],
          openMeldServiceRuntimeId,
          status: "ready",
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "bind_77777777-7777-4777-8777-777777777777",
          agentControllerConversationId: "codex-thread-1",
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          routeDeviceId: "device-current",
          routeLane: "dev-local",
          workingFolderBindingId: "bind_77777777-7777-4777-8777-777777777777",
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "ready",
        facts: {
          providerConversation: {
            agentControllerConversationId: "codex-thread-1",
            ready: false,
            reasonCodes: ["provider_conversation.proof_missing"],
            required: true,
            source: "runtime_reporting",
            status: "missing",
          },
        },
        primaryAction: "none",
      });
      expect(
        readiness.spaceMemberAgentExecutionReadiness.facts.providerConversation
      ).toMatchObject({
        agentControllerConversationId: "codex-thread-1",
        ready: false,
        required: true,
        status: "missing",
      });
    } finally {
      harness.close();
    }
  });

  it("allows readiness when the bound Codex App Server controller thread has fresh proof", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      const bindingId = "bind_88888888-8888-4888-8888-888888888888";
      const agentControllerConversationId = "codex-thread-2";

      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
          agentControllerInterface: AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE,
          agentControllerRef: "builtin:codex",
          expiresAtMs: GENERATED_AT_MS + 60_000,
          observedAtMs: GENERATED_AT_MS,
          reasonCodes: ["runtime.ready"],
          openMeldServiceRuntimeId,
          status: "ready",
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId,
          agentControllerConversationId,
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });
      await acceptProviderConversationProofRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        proof: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId,
          agentControllerConversationId,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId,
          errorCode: null,
          errorMessage: null,
          errorType: null,
          expiresAtMs: GENERATED_AT_MS + 60_000,
          intrusive: false,
          method: "codex_app_server_thread_resume",
          observedAtMs: GENERATED_AT_MS,
          provider: "codex",
          status: "passed",
          transportMode: "codex-app-server",
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          routeDeviceId: "device-current",
          routeLane: "dev-local",
          workingFolderBindingId: bindingId,
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "ready",
        facts: {
          providerConversation: {
            agentControllerConversationId,
            ready: true,
            reasonCodes: [],
            required: true,
            source: "runtime_reporting",
            status: "passed",
          },
        },
        primaryAction: "none",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps readiness impact as history without overriding current facts", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      const bindingId = "bind_66666666-6666-4666-8666-666666666666";
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
          agentControllerInterface: AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE,
          agentControllerRef: "builtin:codex",
          expiresAtMs: GENERATED_AT_MS + 60_000,
          observedAtMs: GENERATED_AT_MS,
          reasonCodes: ["runtime.ready"],
          openMeldServiceRuntimeId,
          status: "ready",
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId,
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });
      await writeAcceptedAgentExecutionReadinessImpact({
        agentProfileId: AGENT_PROFILE_ID,
        db: harness.db,
        executionIdentity: {
          bindingId,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
        },
        observedAtMs: GENERATED_AT_MS,
        reasonCode: "controller.client.upgrade_required",
        sourceAttemptId: "attempt-readiness-impact",
        sourceDispatchId: "dispatch-readiness-impact",
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          routeDeviceId: "device-current",
          routeLane: "dev-local",
          workingFolderBindingId: bindingId,
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "ready",
        facts: {
          binding: {
            routable: true,
            source: "binding_truth",
          },
          claim: {
            executionBlocked: false,
            source: "claim_diagnostics",
          },
          readinessImpact: {
            blocked: true,
            impactKind: "local_execution",
            reasonCodes: ["controller.client.upgrade_required"],
            source: "wake_failure",
          },
          route: {
            online: true,
          },
          runtime: {
            ready: true,
          },
        },
        primaryAction: "none",
      });
      expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
        "controller.client.upgrade_required"
      );
      expect(
        readiness.spaceMemberAgentExecutionReadiness.facts.readinessImpact
      ).toMatchObject({
        blocked: true,
        reasonCodes: ["controller.client.upgrade_required"],
        source: "wake_failure",
      });
    } finally {
      harness.close();
    }
  });

  it("auto-checks route recovery when a fresh controller report exists without a live route", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
          agentControllerInterface: AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE,
          agentControllerRef: "builtin:codex",
          expiresAtMs: GENERATED_AT_MS + 60_000,
          observedAtMs: GENERATED_AT_MS,
          reasonCodes: ["runtime.ready"],
          openMeldServiceRuntimeId,
          status: "ready",
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "bind_33333333-3333-4333-8333-333333333333",
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          ownerServiceDeviceIds: [],
          routeDeviceId: null,
          routeLane: null,
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "not_ready",
        facts: {
          localService: {
            reachable: true,
            reasonCodes: ["local_service.refresh_in_progress"],
            refreshable: true,
            source: "runtime_transport",
          },
          route: {
            online: false,
          },
          runtime: {
            ready: true,
          },
        },
        primaryAction: "check_status",
      });
      expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
        "local_service.not_connected_for_account"
      );
    } finally {
      harness.close();
    }
  });

  it("requires service reconnect when stale controller evidence has no live local service path", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await acceptRuntimeAgentControllerReportRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: GENERATED_AT_MS - 1,
          observedAtMs: GENERATED_AT_MS - 120_000,
          reasonCodes: ["runtime.ready"],
          openMeldServiceRuntimeId,
          status: "ready",
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "bind_33333333-3333-4333-8333-333333333333",
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          ownerServiceDeviceIds: [],
          routeDeviceId: null,
          routeLane: null,
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "not_ready",
        facts: {
          localService: {
            reachable: false,
            reasonCodes: ["local_service.not_connected_for_account"],
            refreshable: false,
            source: "runtime_transport",
          },
          route: {
            online: false,
          },
          runtime: {
            ready: false,
          },
        },
        primaryAction: "connect_service",
      });
    } finally {
      harness.close();
    }
  });

  it("auto-checks stale runtime evidence when a same-account local service can refresh the binding runtime", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "bind_44444444-4444-4444-8444-444444444444",
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          ownerServiceSessions: [
            { deviceId: "device-current", lane: "dev-local" },
          ],
          routeDeviceId: null,
          routeLane: null,
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        displayState: "not_ready",
        facts: {
          localService: {
            reachable: true,
            reasonCodes: ["local_service.refresh_in_progress"],
            refreshable: true,
            source: "runtime_transport",
          },
          route: {
            online: false,
          },
          runtime: {
            ready: false,
          },
        },
        primaryAction: "check_status",
      });
      expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
        "runtime.agent_controller_report_missing"
      );
    } finally {
      harness.close();
    }
  });

  it("does not treat another lane on the same device as a refreshable local service path", async () => {
    const harness = createSqliteD1Harness();
    applyReadinessMigrations(harness);
    try {
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: {
          id: OWNER_USER_ID,
          kind: "owner_account",
        },
      });
      const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: runtimeLookupInput,
        openMeldServiceRuntimeId: "runtime_current_opaque",
        source: "runtime_registry_authority",
      });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: GENERATED_AT_MS,
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        },
      });
      await ensurePrimaryAgentProfileBindingRecord({
        db: harness.db,
        record: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "bind_55555555-5555-4555-8555-555555555555",
          agentControllerRef: "builtin:codex",
          createdAtMs: GENERATED_AT_MS,
          owner: {
            id: OWNER_USER_ID,
            kind: "owner_account",
          },
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
          updatedAtMs: GENERATED_AT_MS,
        },
      });

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads({ batchProfileReads }),
        activeOrganizationId: ORGANIZATION_ID,
        env: createReadinessEnv({
          db: harness.db,
          ownerServiceSessions: [
            { deviceId: "device-current", lane: "canary" },
          ],
          routeDeviceId: null,
          routeLane: null,
        }),
        generatedAt: GENERATED_AT,
        profileId: AGENT_PROFILE_ID,
      });

      expect(readiness.agentExecutionReadiness).toMatchObject({
        facts: {
          localService: {
            reasonCodes: ["local_service.identity_mismatch"],
            reachable: false,
            refreshable: false,
          },
        },
        primaryAction: "reconnect_binding",
      });
    } finally {
      harness.close();
    }
  });
});

function applyReadinessMigrations(
  harness: Pick<ReturnType<typeof createSqliteD1Harness>, "run">
): void {
  harness.run({
    sql: `
      CREATE TABLE openmeld_profiles (
        profile_id text PRIMARY KEY NOT NULL,
        profile_name text NOT NULL,
        profile_handle text NOT NULL,
        profile_kind text NOT NULL,
        is_default integer NOT NULL,
        status text NOT NULL,
        organization_id text,
        owner_user_id text NOT NULL,
        source text NOT NULL,
        managed_role text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )
    `,
  });
  applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
  applyMigrationForTable(harness, "openMeldDaemon_runtime_registry_records");
  applyMigrationForTable(
    harness,
    "openMeldDaemon_runtime_agent_controller_reports"
  );
  applyMigrationForTable(
    harness,
    "openMeldDaemon_provider_conversation_proofs"
  );
  applyMigrationForTable(harness, "openMeldDaemon_provider_access_evidence");
  applyMigrationForTable(
    harness,
    "openMeldDaemon_agent_execution_readiness_impacts"
  );
  harness.run({
    params: [
      AGENT_PROFILE_ID,
      "Codex",
      "codex",
      ORGANIZATION_ID,
      OWNER_USER_ID,
      GENERATED_AT_MS,
      GENERATED_AT_MS,
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
      VALUES (?, ?, ?, 'agent', 0, 'active', ?, ?, 'cli_create', ?, ?)
    `,
  });
}

function createReadinessEnv(input: {
  db: D1Database;
  ownerServiceDeviceIds?: readonly string[];
  ownerServiceSessions?: readonly { deviceId: string; lane: string }[];
  routeDeviceId: string | null;
  routeLane: string | null;
  workingFolderBindingId?: string;
}): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveProfileById: vi.fn().mockResolvedValue({
        ok: true,
        profile: {
          ownerUserId: OWNER_USER_ID,
          profileHandle: "codex",
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex",
          status: "active",
        },
      }),
    },
    OPENMELD_RUNTIME_TRANSPORT: createRuntimeTransportNamespace({
      ownerServiceDeviceIds: input.ownerServiceDeviceIds ?? [],
      ownerServiceSessions: input.ownerServiceSessions ?? null,
      routeDeviceId: input.routeDeviceId,
      routeLane: input.routeLane,
      workingFolderBindingId: input.workingFolderBindingId,
    }),
    OPENMELD_DB: input.db,
  } as unknown as CoreBindings;
}

function createRuntimeTransportNamespace(input: {
  ownerServiceDeviceIds: readonly string[];
  ownerServiceSessions: readonly { deviceId: string; lane: string }[] | null;
  routeDeviceId: string | null;
  routeLane: string | null;
  workingFolderBindingId?: string;
}): DurableObjectNamespace {
  return {
    get: () =>
      ({
        fetch: (request: Request | string) => {
          const url = typeof request === "string" ? request : request.url;
          if (url.endsWith("/lookup-owner-service")) {
            const sessions =
              input.ownerServiceSessions ??
              input.ownerServiceDeviceIds.map((deviceId) => ({
                deviceId,
                lane: "dev-local",
              }));
            if (sessions.length === 0) {
              return Promise.resolve(
                Response.json({
                  online: false,
                  reasonCode: "daemon.session.not_found",
                })
              );
            }
            return Promise.resolve(
              Response.json({
                online: true,
                sessions: sessions.map((session, index) => ({
                  capabilities: {},
                  connectionGeneration: 1,
                  daemonSessionId: `session-${index + 1}`,
                  deviceId: session.deviceId,
                  executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_CONTRACT,
                  lane: session.lane,
                  lastHeartbeatMs: GENERATED_AT_MS,
                  serviceVersion: CURRENT_SERVICE_VERSION,
                })),
              })
            );
          }

          if (!input.routeDeviceId) {
            return Promise.resolve(
              Response.json({
                online: false,
                reasonCode: "daemon.profile.offline",
              })
            );
          }

          return Promise.resolve(
            Response.json({
              capabilities: {},
              connectionGeneration: 1,
              daemonSessionId: "session-1",
              deviceId: input.routeDeviceId,
              executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_CONTRACT,
              lane: input.routeLane ?? "dev-local",
              lastHeartbeatMs: GENERATED_AT_MS,
              leaseEpoch: 1,
              ...(input.workingFolderBindingId
                ? {
                    localWakeRouteReport: {
                      daemonSessionId: "session-1",
                      deviceId: input.routeDeviceId,
                      expectedRoutesContractVersion: "v4",
                      includedProfileIds: [AGENT_PROFILE_ID],
                      lane: input.routeLane ?? "dev-local",
                      reportedAtMs: GENERATED_AT_MS,
                      skippedProfiles: [],
                      workingFolderObservations: [
                        {
                          bindingId: input.workingFolderBindingId,
                          configurationRevision: 1,
                          defaultProjectId: null,
                          localProjectBindingGeneration: null,
                          observedAtMs: GENERATED_AT_MS,
                          profileId: AGENT_PROFILE_ID,
                          reasonCode: null,
                          source: "profile_workspace",
                          status: "ready",
                        },
                      ],
                    },
                  }
                : {}),
              online: true,
              serviceVersion: CURRENT_SERVICE_VERSION,
            })
          );
        },
      }) as unknown as DurableObjectStub,
    idFromName: () => ({ toString: () => "runtime-transport-owner-1" }),
  } as unknown as DurableObjectNamespace;
}
