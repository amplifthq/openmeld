import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import publishedManifest from "../../../release/local-components.json";
import { createAgentExecutionReadinessReads } from "../src/agent-execution/application/agent-execution-readiness-reads";
import { resolveCoreAgentExecutionReadinessForProfile } from "../src/agent-execution/application/agent-execution-readiness-service";
import { writeAcceptedAgentExecutionReadinessImpact } from "../src/agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import { acceptProviderConversationProofRecord } from "../src/agent-execution/infrastructure/postgresql/provider-conversation-proof-repo";
import { ensurePrimaryAgentProfileBindingRecord } from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { createAvailableCodexAgentControllerInterface } from "./helpers/agent-controller-interface.test-support";
import {
  createPostgresHarness,
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
  publishedManifest.components.service.bundleVersion;
const COMPATIBLE_DAEMON_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;
describe("agent execution readiness through the PostgreSQL binding", () => {
  it("resolves a ready profile from its canonical identity, bindings, reports and proofs", async () => {
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
      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads(),
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
            ready: true,
            required: true,
            source: "runtime_reporting",
            status: "passed",
          },
        },
        primaryAction: "none",
      });
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
      const readiness = await resolveCoreAgentExecutionReadinessForProfile({
        reads: createAgentExecutionReadinessReads(),
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
