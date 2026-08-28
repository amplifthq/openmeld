import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { resolveCoreAgentExecutionReadinessForProfile } from "../src/agent-execution/application/agent-execution-readiness-service";
import { writeAcceptedAgentExecutionReadinessImpact } from "../src/agent-execution/infrastructure/d1/agent-execution-readiness-impact-repo";
import { acceptProviderConversationProofRecord } from "../src/agent-execution/infrastructure/d1/provider-conversation-proof-repo";
import { ensurePrimaryAgentProfileBindingRecord } from "../src/agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import { createSplitDomainD1Harness } from "./helpers/sqlite-d1-harness.test-support";

// Physical DB split routing gate (physical-db-split.md Stage B safety net).
//
// resolveCoreAgentExecutionReadiness reads eight local-state tables through the
// localStateDb(env) accessor. Here the env binds ONLY OPENMELD_LOCAL_STATE_DB (loaded
// with the real openmeld-local-state baseline) and deliberately omits OPENMELD_DB, so the
// `?? OPENMELD_DB` fallback cannot mask a misroute: if any readiness read were wired
// to wakeEvidenceDb/projectionsDb it would resolve to undefined here and the
// rich result below would collapse to a store-unavailable shape. Existing-tests-
// green (which keep OPENMELD_DB) cannot prove this; this gate can.

const OWNER_USER_ID = "owner-1";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const GENERATED_AT = "2026-05-10T00:00:00.000Z";
const GENERATED_AT_MS = Date.parse(GENERATED_AT);
// These readiness fixtures represent a supported Service. Keep the version
// explicit so a release manifest that still describes the previous public
// version cannot silently turn unrelated readiness tests into update tests.
const CURRENT_SERVICE_VERSION = "0.3.126";
const COMPATIBLE_DAEMON_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;

describe("agent execution readiness routes every read to openmeld-local-state", () => {
  it("resolves a ready profile reading bindings, reports and proofs from OPENMELD_LOCAL_STATE_DB only", async () => {
    const harness = createSplitDomainD1Harness("openmeld-local-state");
    try {
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
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
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

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        env: createLocalStateRoutedEnv({
          db: harness.db,
          routeDeviceId: "device-current",
          routeLane: "dev-local",
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

  it("surfaces fresh readiness-impact evidence read from OPENMELD_LOCAL_STATE_DB only", async () => {
    const harness = createSplitDomainD1Harness("openmeld-local-state");
    try {
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
        db: harness.db,
        nowMs: GENERATED_AT_MS,
        report: {
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

      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        env: createLocalStateRoutedEnv({
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
          readinessImpact: {
            blocked: true,
            impactKind: "local_execution",
            reasonCodes: ["controller.client.upgrade_required"],
            source: "wake_failure",
          },
          runtime: { ready: true },
        },
        primaryAction: "run_prepare",
      });
      expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
        "controller.client.upgrade_required"
      );
    } finally {
      harness.close();
    }
  });
});

function createLocalStateRoutedEnv(input: {
  db: D1Database;
  routeDeviceId: string | null;
  routeLane: string | null;
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
    }),
    // Routing gate: per-domain binding only, NO OPENMELD_DB fallback.
    OPENMELD_LOCAL_STATE_DB: input.db,
  } as unknown as CoreBindings;
}

function createRuntimeTransportNamespace(input: {
  routeDeviceId: string | null;
  routeLane: string | null;
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
              online: true,
              serviceVersion: CURRENT_SERVICE_VERSION,
            })
          );
        },
      }) as unknown as DurableObjectStub,
    idFromName: () => ({ toString: () => "runtime-transport-owner-1" }),
  } as unknown as DurableObjectNamespace;
}
