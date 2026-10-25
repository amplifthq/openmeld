import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createAgentExecutionReadinessReads } from "../src/agent-execution/application/agent-execution-readiness-reads";
import {
  preloadRuntimeDeviceDisplayNamesForOwner,
  resolveCoreAgentExecutionReadinessForProfile,
} from "../src/agent-execution/application/agent-execution-readiness-service";
import { writeAcceptedAgentExecutionReadinessImpact } from "../src/agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import {
  clearProviderAccessFailureEvidenceForExecutionSuccess,
  writeAcceptedProviderAccessFailureEvidence,
} from "../src/agent-execution/infrastructure/postgresql/provider-access-evidence-repo";
import {
  acceptProviderConversationProofRecord,
  readFreshProviderConversationProofForBinding,
} from "../src/agent-execution/infrastructure/postgresql/provider-conversation-proof-repo";
import { ensurePrimaryAgentProfileBindingRecord } from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import {
  createPublishedCliReleasesBucket,
  PUBLISHED_LOCAL_COMPONENTS_MANIFEST,
} from "../test-support/published-local-components-release";
import { createAvailableCodexAgentControllerInterface } from "./helpers/agent-controller-interface.test-support";
import {
  createFaultInjectingPostgresDatabase,
  createPostgresHarness,
  observeNativePostgresQueries,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const OWNER_USER_ID = "owner-1";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "org-1";
const GENERATED_AT = "2026-05-10T00:00:00.000Z";
const GENERATED_AT_MS = Date.parse(GENERATED_AT);
const AVAILABLE_CODEX_AGENT_CONTROLLER_INTERFACE =
  createAvailableCodexAgentControllerInterface({ observedAt: GENERATED_AT });
// Physical routing scenarios use the matching supported release; version
// eligibility belongs to the local-component update tests.
const CURRENT_SERVICE_VERSION =
  PUBLISHED_LOCAL_COMPONENTS_MANIFEST.components.service.bundleVersion;
const COMPATIBLE_DAEMON_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;
describe("agent execution readiness through the PostgreSQL binding", () => {
  it("batches 94 profiles while preserving exact evidence, owner conflicts, expiry and request freshness", async () => {
    const harness = await createPostgresHarness();
    try {
      await seedAgentProfileOrganizationContext(harness.db);
      const owner = { id: OWNER_USER_ID, kind: "owner_account" as const };
      const identities = Array.from({ length: 94 }, (_, index) => ({
        agentProfileId:
          index === 0 ? AGENT_PROFILE_ID : `agt_${crypto.randomUUID()}`,
        bindingId: `bind_${crypto.randomUUID()}`,
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-batch",
      }));
      const identityAt = (index: number) => {
        const identity = identities[index];
        if (!identity) {
          throw new Error(`Missing fixture identity ${index}`);
        }
        return identity;
      };
      await harness.db.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles"
          (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, organization_id, source)
          SELECT id, 'Batch Agent', id, 'agent', $2, $3, 'cli_create' FROM UNNEST($1::text[]) AS id`,
        values: [
          identities.slice(1).map((identity) => identity.agentProfileId),
          OWNER_USER_ID,
          ORGANIZATION_ID,
        ],
      });
      await harness.db.query({
        text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
          (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
           agent_controller_ref, agent_controller_conversation_id, binding_state, created_at_ms, updated_at_ms)
          SELECT binding, 'owner_account', $3, profile, 'runtime-batch', 'builtin:codex',
            'thread-' || profile, 'enabled_primary', 1, 1
          FROM UNNEST($1::text[], $2::text[]) AS pair(binding, profile)`,
        values: [
          identities.map((identity) => identity.bindingId),
          identities.map((identity) => identity.agentProfileId),
          OWNER_USER_ID,
        ],
      });
      // Accepted failure records with deliberately different execution identities
      // must never leak into the current Binding's readiness.
      for (const [index, override] of [
        [0, {}],
        [1, {}],
        [2, { openMeldServiceRuntimeId: "old-runtime" }],
        [3, { agentControllerRef: "builtin:claude-code" }],
        [4, { agentProfileId: identityAt(5).agentProfileId }],
        [5, { bindingId: "old-binding" }],
        [6, {}],
      ] as const) {
        const identity = { ...identityAt(index), ...override };
        await writeAcceptedProviderAccessFailureEvidence({
          db: harness.db,
          agentProfileId: identity.agentProfileId,
          executionIdentity: identity,
          evidence: {
            observedAtMs: GENERATED_AT_MS,
            provider:
              identity.agentControllerRef === "builtin:codex"
                ? "codex"
                : "claude-code",
            reasonCode: "provider_account.organization_access_disabled",
            source: "wake_failure",
          },
          observedAtMs: GENERATED_AT_MS,
          sourceAttemptId: `attempt-${index}`,
          sourceDispatchId: `dispatch-${index}`,
        });
        await writeAcceptedAgentExecutionReadinessImpact({
          db: harness.db,
          agentProfileId: identity.agentProfileId,
          executionIdentity: identity,
          reasonCode: "controller.client.upgrade_required",
          observedAtMs: GENERATED_AT_MS,
          sourceAttemptId: `attempt-${index}`,
          sourceDispatchId: `dispatch-${index}`,
        });
      }
      for (const table of [
        "openMeldDaemon_provider_access_evidence",
        "openMeldDaemon_agent_execution_readiness_impacts",
      ]) {
        await harness.db.query({
          text: `UPDATE "openmeld"."${table}" SET expires_at_ms = $1 WHERE agent_profile_id = $2`,
          values: [GENERATED_AT_MS, identityAt(1).agentProfileId],
        });
      }
      await clearProviderAccessFailureEvidenceForExecutionSuccess({
        db: harness.db,
        agentProfileId: identityAt(6).agentProfileId,
        executionIdentity: identityAt(6),
        clearedAtMs: GENERATED_AT_MS + 1,
        sourceAttemptId: "success-attempt",
        sourceDispatchId: "success-dispatch",
      });
      // Other profiles in the same owner inventory can conflict even when they
      // are absent from the displayed/authorized readiness batch.
      const conflictingProfileIds = Array.from(
        { length: 4 },
        () => `agt_${crypto.randomUUID()}`
      );
      await harness.db.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles"
          (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, organization_id, source)
          SELECT id, 'Conflict Agent', id, 'agent', $2, $3, 'cli_create' FROM UNNEST($1::text[]) AS id`,
        values: [conflictingProfileIds, OWNER_USER_ID, ORGANIZATION_ID],
      });
      for (const [index, updated, created, binding] of [
        [0, 2, 1, "conflict-older"],
        [1, 3, 1, "conflict-created-older"],
        [2, 3, 2, "conflict-tie-a"],
        [3, 3, 2, "conflict-tie-z"],
      ] as const) {
        await harness.db.query({
          text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
            (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
             agent_controller_ref, agent_controller_conversation_id, binding_state, created_at_ms, updated_at_ms)
            VALUES ($1, 'owner_account', $2, $3, 'runtime-other', 'builtin:codex', $4, 'enabled_primary', $5, $6)`,
          values: [
            binding,
            OWNER_USER_ID,
            conflictingProfileIds[index],
            `thread-${AGENT_PROFILE_ID}`,
            created,
            updated,
          ],
        });
      }
      const reads = createAgentExecutionReadinessReads();
      const queryCount = vi.spyOn(harness.db, "query");
      await reads.preloadPrimaryBindings({
        db: harness.db,
        owner,
        profileIds: identities.map((identity) => identity.agentProfileId),
        nowMs: GENERATED_AT_MS,
      });
      const results = await Promise.all(
        identities.map(async (identity) => {
          const request = {
            ...identity,
            db: harness.db,
            nowMs: GENERATED_AT_MS,
          };
          return {
            binding: await reads.readPrimaryAgentProfileBindingRecord({
              db: harness.db,
              owner,
              agentProfileId: identity.agentProfileId,
            }),
            context: await reads.readAgentProfileOrganizationContext(request),
            access:
              await reads.readFreshProviderAccessEvidenceForBinding(request),
            impact:
              await reads.readFreshAgentExecutionReadinessImpactForBinding(
                request
              ),
            conflict:
              await reads.readPrimaryAgentProfileBindingRecordByControllerConversation(
                {
                  db: harness.db,
                  owner,
                  agentControllerRef: identity.agentControllerRef,
                  agentControllerConversationId: `thread-${identity.agentProfileId}`,
                  excludeAgentProfileId: identity.agentProfileId,
                }
              ),
          };
        })
      );
      expect(queryCount).toHaveBeenCalledTimes(5);
      queryCount.mockRestore();
      const displayQueries = observeNativePostgresQueries(vi.fn());
      try {
        expect(
          await preloadRuntimeDeviceDisplayNamesForOwner({
            env: {
              OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
            } as CoreBindings,
            ownerUserId: OWNER_USER_ID,
            targets: [],
          })
        ).toEqual(new Map());
        expect(displayQueries).not.toHaveBeenCalled();
      } finally {
        displayQueries.mockRestore();
      }
      for (const [index, result] of results.entries()) {
        expect(result.binding?.bindingId).toBe(identityAt(index).bindingId);
        expect(result.context).toMatchObject({
          organizationId: ORGANIZATION_ID,
          ownerUserId: OWNER_USER_ID,
        });
        if (index === 0) {
          expect(result.access).toMatchObject({
            reasonCode: "provider_account.organization_access_disabled",
          });
          expect(result.impact).toMatchObject({
            reasonCode: "controller.client.upgrade_required",
          });
          expect(result.conflict?.bindingId).toBe("conflict-tie-z");
        } else {
          expect(result.access).toBeNull();
          expect(result.impact).toEqual(
            index === 6
              ? expect.objectContaining({
                  reasonCode: "controller.client.upgrade_required",
                })
              : null
          );
          expect(result.conflict).toBeNull();
        }
      }
      const current = {
        ...identityAt(0),
        db: harness.db,
        nowMs: GENERATED_AT_MS,
      };
      const access = results[0]?.access;
      const impact = results[0]?.impact;
      expect(access).not.toBeNull();
      expect(impact).not.toBeNull();
      if (!(access && impact)) {
        throw new Error("Expected current accepted failure evidence");
      }
      expect(
        await reads.readFreshProviderAccessEvidenceForBinding({
          ...current,
          nowMs: access.expiresAtMs,
        })
      ).toBeNull();
      expect(
        await reads.readFreshAgentExecutionReadinessImpactForBinding({
          ...current,
          nowMs: impact.expiresAtMs,
        })
      ).toBeNull();
      expect(
        await reads.readPrimaryAgentProfileBindingRecord({
          ...current,
          owner: { ...owner, id: "another-owner" },
        })
      ).toBeNull();
      await clearProviderAccessFailureEvidenceForExecutionSuccess({
        db: harness.db,
        agentProfileId: AGENT_PROFILE_ID,
        executionIdentity: identityAt(0),
        clearedAtMs: GENERATED_AT_MS + 1,
        sourceAttemptId: "new-attempt",
        sourceDispatchId: "new-dispatch",
      });
      await harness.db.query({
        text: `UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET binding_state = 'disabled_historical', disabled_at_ms = 4 WHERE binding_id = 'conflict-tie-z'`,
      });
      const nextRequest = createAgentExecutionReadinessReads();
      await nextRequest.preloadPrimaryBindings({
        db: harness.db,
        owner,
        profileIds: [AGENT_PROFILE_ID],
        nowMs: GENERATED_AT_MS + 1,
      });
      expect(
        await nextRequest.readFreshProviderAccessEvidenceForBinding(current)
      ).toBeNull();
      expect(
        (
          await nextRequest.readPrimaryAgentProfileBindingRecordByControllerConversation(
            {
              db: harness.db,
              owner,
              agentControllerRef: "builtin:codex",
              agentControllerConversationId: `thread-${AGENT_PROFILE_ID}`,
              excludeAgentProfileId: AGENT_PROFILE_ID,
            }
          )
        )?.bindingId
      ).toBe("conflict-tie-a");
      expect(
        await reads.readFreshProviderAccessEvidenceForBinding(current)
      ).toMatchObject({
        reasonCode: "provider_account.organization_access_disabled",
      });
      const failedDb = createFaultInjectingPostgresDatabase({
        db: harness.db,
        matches: (sql) =>
          sql.includes(
            'FROM "openmeld"."openMeldDaemon_provider_access_evidence"'
          ),
      });
      const failedReads = createAgentExecutionReadinessReads();
      await failedReads.preloadPrimaryBindings({
        db: failedDb,
        owner,
        profileIds: [AGENT_PROFILE_ID],
        nowMs: GENERATED_AT_MS + 1,
      });
      await expect(
        failedReads.readFreshProviderAccessEvidenceForBinding({
          ...current,
          db: failedDb,
        })
      ).rejects.toThrow("injected PostgreSQL query failure");
      expect(
        await failedReads.readFreshAgentExecutionReadinessImpactForBinding({
          ...current,
          db: failedDb,
        })
      ).toMatchObject({ reasonCode: "controller.client.upgrade_required" });
    } finally {
      await harness.close();
    }
  });
  it("preserves ready, provider failure, expired and blocked claim facts from preloaded PostgreSQL evidence", async () => {
    const harness = await createPostgresHarness();
    try {
      await seedAgentProfileOrganizationContext(harness.db);
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
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
        authFreshnessRequired: true,
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
          owner: { id: OWNER_USER_ID, kind: "owner_account" },
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
      const reads = createAgentExecutionReadinessReads();
      await reads.preloadPrimaryBindings({
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
        profileIds: [AGENT_PROFILE_ID, "missing-profile"],
      });
      expect(
        await reads.readPrimaryAgentProfileBindingRecord({
          db: harness.db,
          owner: { id: OWNER_USER_ID, kind: "owner_account" },
          agentProfileId: "missing-profile",
        })
      ).toBeNull();
      const proofRead = {
        db: harness.db,
        agentProfileId: AGENT_PROFILE_ID,
        bindingId,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId,
        openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
        provider: "codex" as const,
        methods: [
          "codex_app_server_thread_read",
          "codex_app_server_thread_resume",
        ] as const,
        nowMs: GENERATED_AT_MS,
      };
      const queryCount = vi.spyOn(harness.db, "query");
      expect(
        await reads.readFreshProviderConversationProofForBinding(proofRead)
      ).toMatchObject({ status: "passed" });
      expect(
        await reads.readFreshProviderConversationProofForBinding({
          ...proofRead,
          agentControllerConversationId: "different-conversation",
        })
      ).toBeNull();
      expect(
        await reads.readFreshProviderConversationProofForBinding({
          ...proofRead,
          nowMs: GENERATED_AT_MS + 60_000,
        })
      ).toBeNull();
      expect(queryCount).not.toHaveBeenCalled();
      queryCount.mockRestore();
      // A newer read failure must supersede a still-fresh legacy resume pass.
      await acceptProviderConversationProofRecord({
        db: harness.db,
        nowMs: GENERATED_AT_MS + 1,
        proof: {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId,
          agentControllerConversationId,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId,
          errorCode: "context.missing",
          errorMessage: "Stored conversation no longer exists",
          errorType: "config",
          expiresAtMs: GENERATED_AT_MS + 60_000,
          intrusive: false,
          method: "codex_app_server_thread_read",
          observedAtMs: GENERATED_AT_MS + 1,
          provider: "codex",
          status: "failed",
          transportMode: "codex-app-server",
        },
      });
      const currentProof = { ...proofRead, nowMs: GENERATED_AT_MS + 2 };
      expect(
        await readFreshProviderConversationProofForBinding(currentProof)
      ).toMatchObject({
        status: "failed",
        method: "codex_app_server_thread_read",
      });
      const freshReads = createAgentExecutionReadinessReads();
      await freshReads.preloadPrimaryBindings({
        db: harness.db,
        nowMs: GENERATED_AT_MS + 2,
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
        profileIds: [AGENT_PROFILE_ID],
      });
      expect(
        await freshReads.readFreshProviderConversationProofForBinding(
          currentProof
        )
      ).toMatchObject({
        status: "failed",
        method: "codex_app_server_thread_read",
      });
      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads,
        activeOrganizationId: ORGANIZATION_ID,
        env: createLocalStateRoutedEnv({
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
            method: "codex_app_server_thread_read",
            ready: false,
            required: true,
            source: "runtime_reporting",
            status: "failed",
          },
        },
        primaryAction: "none",
      });
      await writeAcceptedProviderAccessFailureEvidence({
        db: harness.db,
        agentProfileId: AGENT_PROFILE_ID,
        executionIdentity: {
          bindingId,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
        },
        evidence: {
          observedAtMs: GENERATED_AT_MS,
          provider: "codex",
          reasonCode: "provider_account.organization_access_disabled",
          source: "wake_failure",
        },
        observedAtMs: GENERATED_AT_MS,
        sourceAttemptId: "provider-attempt",
        sourceDispatchId: "provider-dispatch",
      });
      const resolvePreloadedReadiness = (db: PostgresDatabase) => {
        const env = createLocalStateRoutedEnv({
          db,
          routeDeviceId: "device-current",
          routeLane: "dev-local",
          workingFolderBindingId: bindingId,
        });
        // Match the production RPC owner: preload and resolution share the
        // request-owned façade instead of two equivalent connection URLs.
        return withPostgresRequest(env.OPENMELD_POSTGRESQL, async () => {
          const reads = createAgentExecutionReadinessReads();
          await reads.preloadPrimaryBindings({
            db: getPostgresDatabase(env),
            owner: { id: OWNER_USER_ID, kind: "owner_account" },
            profileIds: [AGENT_PROFILE_ID],
            nowMs: GENERATED_AT_MS,
          });
          return resolveCoreAgentExecutionReadinessForProfile({
            env,
            reads,
            activeOrganizationId: ORGANIZATION_ID,
            generatedAt: GENERATED_AT,
            profileId: AGENT_PROFILE_ID,
          });
        });
      };
      const providerFailure = await resolvePreloadedReadiness(harness.db);
      expect(providerFailure.agentExecutionReadiness).toMatchObject({
        // Wake failure history is diagnostic. Current runtime/account facts
        // still own public Wakeability.
        displayState: "ready",
        facts: {
          providerAccount: {
            blocked: true,
            reasonCodes: ["provider_account.organization_access_disabled"],
            source: "wake_failure",
          },
        },
      });
      await harness.db.query({
        text: `UPDATE "openmeld"."openMeldDaemon_provider_access_evidence" SET expires_at_ms = $1 WHERE agent_profile_id = $2`,
        values: [GENERATED_AT_MS, AGENT_PROFILE_ID],
      });
      const expired = await resolvePreloadedReadiness(harness.db);
      expect(expired.agentExecutionReadiness.displayState).toBe("ready");
      expect(expired.agentExecutionReadiness.reasonCodes).not.toContain(
        "provider_account.organization_access_disabled"
      );
      const failedContextDb = createFaultInjectingPostgresDatabase({
        db: harness.db,
        matches: (sql) => sql.includes('FROM "openmeld"."openmeld_profiles"'),
      });
      const failedContext = await resolvePreloadedReadiness(failedContextDb);
      expect(failedContext.agentExecutionReadiness.facts.claim).toMatchObject({
        executionBlocked: true,
        reasonCodes: ["agent_profile.organization_lookup_failed"],
      });
      expect(failedContext.agentExecutionReadiness.displayState).toBe(
        "blocked"
      );
    } finally {
      await harness.close();
    }
  });
  it("reads readiness-impact history without overriding current facts", async () => {
    const harness = await createPostgresHarness();
    try {
      await seedAgentProfileOrganizationContext(harness.db);
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-current",
        lane: "dev-local",
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
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
        authFreshnessRequired: true,
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
          owner: { id: OWNER_USER_ID, kind: "owner_account" },
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
      const reads = createAgentExecutionReadinessReads();
      await reads.preloadPrimaryBindings({
        db: harness.db,
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
        profileIds: [AGENT_PROFILE_ID],
        nowMs: GENERATED_AT_MS,
      });
      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads,
        activeOrganizationId: ORGANIZATION_ID,
        env: createLocalStateRoutedEnv({
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
          readinessImpact: {
            blocked: true,
            impactKind: "local_execution",
            reasonCodes: ["controller.client.upgrade_required"],
            source: "wake_failure",
          },
          runtime: { ready: true },
        },
        primaryAction: "none",
      });
      expect(readiness.agentExecutionReadiness.reasonCodes).not.toContain(
        "controller.client.upgrade_required"
      );
    } finally {
      await harness.close();
    }
  });
});
function createLocalStateRoutedEnv(input: {
  db: PostgresDatabase;
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
      routeDeviceId: input.routeDeviceId,
      routeLane: input.routeLane,
      workingFolderBindingId: input.workingFolderBindingId,
    }),
    OPENMELD_POSTGRESQL: postgresTestBinding(input.db),
    OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
  } as unknown as CoreBindings;
}
async function seedAgentProfileOrganizationContext(
  db: PostgresDatabase
): Promise<void> {
  await db.query({
    text: `INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at) VALUES ($1, 'Owner', 'owner@example.test', $2, $2)`,
    values: [OWNER_USER_ID, GENERATED_AT_MS],
  });
  await db.query({
    text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Organization', 'organization', $2)`,
    values: [ORGANIZATION_ID, GENERATED_AT_MS],
  });
  await db.query({
    ...{
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
        VALUES ($1, $2, $3, 'agent', 0, 'active', $4, $5, 'cli_create', $6, $7)
      `,
      values: [],
    },
    values: [
      AGENT_PROFILE_ID,
      "Codex",
      "codex",
      ORGANIZATION_ID,
      OWNER_USER_ID,
      GENERATED_AT_MS,
      GENERATED_AT_MS,
    ],
  });
}
function createRuntimeTransportNamespace(input: {
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
            if (!input.routeDeviceId) {
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
                sessions: [
                  {
                    capabilities: {},
                    connectionGeneration: 1,
                    daemonSessionId: "session-1",
                    deviceId: input.routeDeviceId,
                    executionCompatibility:
                      COMPATIBLE_DAEMON_EXECUTION_CONTRACT,
                    lane: input.routeLane ?? "dev-local",
                    lastHeartbeatMs: GENERATED_AT_MS,
                    serviceVersion: CURRENT_SERVICE_VERSION,
                  },
                ],
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
