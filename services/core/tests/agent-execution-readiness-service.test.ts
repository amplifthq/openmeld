import {
  createAgentExecutionStatusDisplayRows,
  createAgentProfileBindingDisplayProjection,
  resolveHostedAgentWakeAvailability,
} from "@openmeld/agent-runtime";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  resolveAgentProfileOrganizationClaimDiagnostics,
  resolveCoreAgentExecutionReadinessForProfile,
} from "../src/agent-execution/application/agent-execution-readiness-service";
import type { CoreBindings } from "../src/lib/bindings";

describe("agent-execution-readiness-service", () => {
  it("resolves a profile from Core evidence without relying on space-member snapshots", async () => {
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: {} as CoreBindings,
      generatedAt: "2026-05-10T00:00:00.000Z",
      profileId: "agt_readiness_without_snapshot",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      agentProfileId: "agt_readiness_without_snapshot",
      facts: {
        binding: {
          routable: false,
        },
        route: {
          online: false,
        },
        runtime: {
          ready: false,
        },
      },
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).toEqual(
      expect.arrayContaining([
        "agent_profile.identity_lookup_unavailable",
        "agent_profile_binding.store_unavailable",
        "agent_profile.organization_context_missing",
        "runtime.projection_missing",
        "agent_execution.route_unavailable",
        "not_requested",
      ])
    );
    expect(readiness.agentExecutionReadiness.displayState).toBe("unknown");
    expect(readiness.spaceMemberAgentExecutionReadiness.displayState).toBe(
      "unknown"
    );
  });

  it("keeps runtime claim readiness for an Agent Profile owned by the active Organization without legacy Wake access", async () => {
    const readiness = await resolveAgentProfileOrganizationClaimDiagnostics({
      activeOrganizationId: "org-acme",
      binding: createPrimaryBinding(),
      env: createAuthorizationEnv(null, {
        managed_role: null,
        organization_id: "org-acme",
        owner_user_id: "user-1",
        profile_kind: "agent",
        profile_name: "Acme Agent",
      }),
      resolveRuntimeClaimDiagnostics: async () => ({
        reasonCodes: [],
        status: "accepted",
      }),
    });

    expect(readiness).toEqual({ reasonCodes: [], status: "accepted" });
  });

  it("fails closed when Agent Profile readiness has no active Organization", async () => {
    const readiness = await resolveAgentProfileOrganizationClaimDiagnostics({
      activeOrganizationId: null,
      binding: createPrimaryBinding(),
      env: createAuthorizationEnv(null, {
        managed_role: null,
        organization_id: "org-acme",
        owner_user_id: "user-1",
        profile_kind: "agent",
        profile_name: "Acme Agent",
      }),
      resolveRuntimeClaimDiagnostics: async () => ({
        reasonCodes: [],
        status: "accepted",
      }),
    });

    expect(readiness).toEqual({
      reasonCodes: ["agent_profile.organization_context_missing"],
      status: "unavailable",
    });
  });

  it("blocks an ordinary Agent Profile owned by another Organization even when legacy Wake access remains", async () => {
    const readiness = await resolveAgentProfileOrganizationClaimDiagnostics({
      activeOrganizationId: "org-acme",
      binding: createPrimaryBinding(),
      env: createAuthorizationEnv(
        {
          authorized_by: "user-1",
          binding_id: "binding-1",
          created_at: 1,
          id: "authorization-1",
          organization_id: "org-acme",
        },
        {
          managed_role: null,
          organization_id: "org-personal",
          owner_user_id: "user-1",
          profile_kind: "agent",
          profile_name: "Personal Agent",
        }
      ),
      resolveRuntimeClaimDiagnostics: async () => ({
        reasonCodes: [],
        status: "accepted",
      }),
    });

    expect(readiness).toEqual({
      reasonCodes: ["agent_profile.organization_mismatch"],
      status: "rejected",
    });
  });

  it("blocks a Center Agent from another Organization even when Wake access remains", async () => {
    const readiness = await resolveAgentProfileOrganizationClaimDiagnostics({
      activeOrganizationId: "org-acme",
      binding: createPrimaryBinding(),
      env: createAuthorizationEnv(
        {
          authorized_by: "user-1",
          binding_id: "binding-1",
          created_at: 1,
          id: "authorization-1",
          organization_id: "org-acme",
        },
        {
          managed_role: "center_agent",
          organization_id: "org-personal",
          owner_user_id: "user-1",
          profile_kind: "agent",
          profile_name: "Personal Center Agent",
        }
      ),
      resolveRuntimeClaimDiagnostics: async () => ({
        reasonCodes: [],
        status: "accepted",
      }),
    });

    expect(readiness).toEqual({
      reasonCodes: ["agent_profile.organization_mismatch"],
      status: "rejected",
    });
  });

  it("keeps the Organization's own Center Agent claim readiness", async () => {
    const readiness = await resolveAgentProfileOrganizationClaimDiagnostics({
      activeOrganizationId: "org-acme",
      binding: createPrimaryBinding(),
      env: createAuthorizationEnv(
        {
          authorized_by: "user-1",
          binding_id: "binding-1",
          created_at: 1,
          id: "authorization-1",
          organization_id: "org-acme",
        },
        {
          managed_role: "center_agent",
          organization_id: "org-acme",
          owner_user_id: "user-1",
          profile_kind: "agent",
          profile_name: "Acme Center Agent",
        }
      ),
      resolveRuntimeClaimDiagnostics: async () => ({
        reasonCodes: [],
        status: "accepted",
      }),
    });

    expect(readiness).toEqual({ reasonCodes: [], status: "accepted" });
  });

  it("shows an Organization's hosted Center Agent as ready only after canonical Organization verification", async () => {
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      activeOrganizationId: "org-acme",
      env: createHostedCenterAgentReadinessEnv({
        profileOrganizationId: "org-acme",
        modelId: "deepseek/deepseek-v4-flash",
      }),
      generatedAt: "2026-05-10T00:00:00.000Z",
      profileId: "agt_readiness_without_snapshot",
    });

    expect(readiness.modelSelection).toEqual({
      modelId: "deepseek/deepseek-v4-flash",
    });
    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "ready",
      facts: {
        claim: {
          executionBlocked: false,
          reasonCodes: [],
          source: "not_checked",
        },
        localService: {
          reachable: false,
          reasonCodes: [],
          source: "not_checked",
        },
        route: {
          online: true,
          reasonCodes: ["remote_agent.available"],
          source: "hosted_route",
        },
        runtime: {
          ready: true,
          reasonCodes: [],
          source: "native_runtime",
        },
        service: {
          executionCompatible: true,
          observedEpoch: null,
          reasonCodes: [],
          source: "not_checked",
        },
      },
      primaryAction: "none",
    });
    const displayRows = createAgentExecutionStatusDisplayRows(
      readiness.agentExecutionReadiness
    );
    expect(displayRows.find((row) => row.label === "Wake")).toEqual({
      label: "Wake",
      value: "Wake has not been checked yet.",
    });
    expect(displayRows).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value: "Available for Wake · This Agent can answer now.",
        },
        {
          label: "Hosted runtime",
          value: "Hosted runtime is available.",
        },
        {
          label: "OpenMeld Service",
          value: "OpenMeld Service has not been checked for this agent yet.",
        },
        {
          label: "Hosted reply route",
          value: "Hosted reply route is available.",
        },
      ])
    );
    expect(JSON.stringify(displayRows)).not.toContain("this computer");
    expect(JSON.stringify(displayRows)).not.toContain("Local agent");
    expect(
      resolveHostedAgentWakeAvailability({
        readiness: readiness.agentExecutionReadiness,
      })
    ).toMatchObject({
      badgeLabel: "Available",
      reasonCode: "remote_agent.available",
      status: "available_for_wake",
      summary: "This Agent can answer now.",
    });
  });

  it("does not expose hosted readiness as Available without an active Organization", async () => {
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      env: createHostedCenterAgentReadinessEnv({
        profileOrganizationId: "org-acme",
      }),
      generatedAt: "2026-05-10T00:00:00.000Z",
      profileId: "agt_readiness_without_snapshot",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "blocked",
      facts: {
        claim: {
          executionBlocked: true,
          reasonCodes: ["agent_profile.organization_context_missing"],
          source: "claim_diagnostics",
        },
        localService: {
          reachable: false,
          reasonCodes: [],
          source: "not_checked",
        },
        route: {
          online: false,
          reasonCodes: [],
          source: "not_checked",
        },
        runtime: {
          ready: false,
          reasonCodes: [],
          source: "not_checked",
        },
        service: {
          executionCompatible: true,
          observedEpoch: null,
          reasonCodes: [],
          source: "not_checked",
        },
      },
      primaryAction: "check_status",
    });
    expect(
      resolveHostedAgentWakeAvailability({
        readiness: readiness.agentExecutionReadiness,
      })
    ).toMatchObject({
      badgeLabel: "Workspace unavailable",
      reasonCode: "agent_profile.organization_context_missing",
      status: "unavailable_for_wake",
    });
  });

  it("blocks a hosted designation that points to a foreign canonical Agent Profile", async () => {
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      activeOrganizationId: "org-acme",
      env: createHostedCenterAgentReadinessEnv({
        profileOrganizationId: "org-foreign",
      }),
      generatedAt: "2026-05-10T00:00:00.000Z",
      profileId: "agt_readiness_without_snapshot",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "blocked",
      facts: {
        claim: {
          executionBlocked: true,
          reasonCodes: ["agent_profile.organization_mismatch"],
          source: "claim_diagnostics",
        },
        localService: {
          reachable: false,
          reasonCodes: [],
          source: "not_checked",
        },
        route: {
          online: false,
          reasonCodes: [],
          source: "not_checked",
        },
        runtime: {
          ready: false,
          reasonCodes: [],
          source: "not_checked",
        },
        service: {
          executionCompatible: true,
          observedEpoch: null,
          reasonCodes: [],
          source: "not_checked",
        },
      },
      primaryAction: "check_status",
    });
    expect(readiness.agentExecutionReadiness.reasonCodes).toContain(
      "agent_profile.organization_mismatch"
    );
    expect(readiness.spaceMemberAgentExecutionReadiness.displayState).toBe(
      "blocked"
    );
    expect(
      resolveHostedAgentWakeAvailability({
        readiness: readiness.agentExecutionReadiness,
      })
    ).toMatchObject({
      badgeLabel: "Wrong workspace",
      label: "Wrong workspace",
      reasonCode: "agent_profile.organization_mismatch",
      status: "unavailable_for_wake",
      summary: "This Agent Profile belongs to a different workspace.",
      tooltip: "This Agent Profile belongs to another workspace",
    });
  });

  it("keeps hosted capability failure separate from workstation readiness", async () => {
    const readiness = await resolveCoreAgentExecutionReadinessForProfile({
      activeOrganizationId: "org-acme",
      env: createHostedCenterAgentReadinessEnv({
        profileOrganizationId: "org-acme",
        remoteAgentWorkerAvailable: false,
      }),
      generatedAt: "2026-05-10T00:00:00.000Z",
      profileId: "agt_readiness_without_snapshot",
    });

    expect(readiness.agentExecutionReadiness).toMatchObject({
      displayState: "not_ready",
      facts: {
        claim: {
          executionBlocked: false,
          reasonCodes: [],
          source: "not_checked",
        },
        localService: {
          reachable: false,
          reasonCodes: [],
          source: "not_checked",
        },
        route: {
          online: false,
          reasonCodes: ["remote_agent.worker_unavailable"],
          source: "hosted_route",
        },
        runtime: {
          ready: false,
          reasonCodes: ["remote_agent.worker_unavailable"],
          source: "native_runtime",
        },
        service: {
          executionCompatible: true,
          observedEpoch: null,
          reasonCodes: [],
          source: "not_checked",
        },
      },
      primaryAction: "check_status",
    });
    expect(
      resolveHostedAgentWakeAvailability({
        readiness: readiness.agentExecutionReadiness,
      })
    ).toMatchObject({
      reasonCode: "remote_agent.worker_unavailable",
      status: "unavailable_for_wake",
    });
  });
});

function createPrimaryBinding() {
  return createAgentProfileBindingDisplayProjection({
    agentProfileId: "agt_readiness_without_snapshot",
    bindingId: "binding-1",
    bindingState: "enabled_primary",
    executionTarget: {
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    },
  });
}

function createAuthorizationEnv(
  record: unknown,
  profileContext: unknown = {
    managed_role: null,
    organization_id: "org-personal",
    owner_user_id: "user-1",
    profile_kind: "agent",
    profile_name: "Personal Agent",
  }
): CoreBindings {
  return {
    OPENMELD_DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () =>
            sql.includes("FROM openmeld_profiles") ? profileContext : record,
        }),
      }),
    } as unknown as D1Database,
  } as CoreBindings;
}

function createHostedCenterAgentReadinessEnv(input: {
  modelId?: string;
  profileOrganizationId: string;
  remoteAgentWorkerAvailable?: boolean;
}): CoreBindings {
  const profileId = "agt_readiness_without_snapshot";
  const db = {
    prepare: (sql: string) => {
      const normalizedSql = sql.toLowerCase();
      return {
        bind: () => ({
          first: () => {
            if (
              normalizedSql.includes(
                "from openmelddaemon_agent_profile_bindings"
              )
            ) {
              return {
                agent_controller_collaboration_mode: null,
                agent_controller_conversation_id: null,
                agent_controller_permission_mode: null,
                agent_controller_ref: HOSTED_CENTER_AGENT_CONTROLLER_REF,
                agent_profile_id: profileId,
                binding_id: "binding-hosted-center-agent",
                binding_state: "enabled_primary",
                configuration_revision: 1,
                created_at_ms: 1,
                created_by_profile_id: null,
                disabled_at_ms: null,
                hosted_runtime_identity_json: JSON.stringify(
                  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
                ),
                model_id: input.modelId ?? null,
                opencode_permission: null,
                owner_id: "user-1",
                owner_kind: "owner_account",
                reason_code: "center_agent.remote_agent_designation",
                reasoning_level: null,
                runtime_kind: "hosted_center_agent",
                updated_at_ms: 1,
                openmeld_service_runtime_id:
                  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
              };
            }
            if (normalizedSql.includes("from center_agent_designations")) {
              return {
                agent_profile_id: profileId,
                created_at: 1,
                designated_by: "user-1",
                duty: null,
                operating_state: "active",
                organization_id: "org-acme",
                paused_at: null,
                paused_by_user_id: null,
              };
            }
            if (normalizedSql.includes("from openmeld_profiles")) {
              return {
                managed_role: "center_agent",
                organization_id: input.profileOrganizationId,
                owner_user_id: "user-1",
                profile_kind: "agent",
                profile_name: "Center Agent",
              };
            }
            return null;
          },
        }),
      };
    },
  } as unknown as D1Database;
  return {
    OPENMELD_AUTH_WORKER: {
      resolveProfileById: async () => ({
        ok: true as const,
        profile: {
          ownerUserId: "user-1",
          profileHandle: "center-agent",
          profileId,
          profileKind: "agent" as const,
          profileName: "Center Agent",
          status: "active" as const,
        },
      }),
    },
    OPENMELD_DB: db,
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
    ...(input.remoteAgentWorkerAvailable === false
      ? {}
      : {
          OPENMELD_REMOTE_AGENT_WORKER: {
            submitConversationTurn: async () => ({
              accepted: true,
            }),
          },
        }),
  } as unknown as CoreBindings;
}
