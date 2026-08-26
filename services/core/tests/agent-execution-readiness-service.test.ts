import { createAgentProfileBindingDisplayProjection } from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  resolveCoreAgentExecutionReadinessForProfile,
  resolveOrganizationAwareClaimDiagnostics,
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
        "agent_profile_binding.profile_owner_unavailable",
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

  it("blocks Organization readiness when the primary Binding has no Wake access", async () => {
    const readiness = await resolveOrganizationAwareClaimDiagnostics({
      activeOrganizationId: "org-acme",
      binding: createPrimaryBinding(),
      env: createAuthorizationEnv(null),
      resolveRuntimeClaimDiagnostics: async () => ({
        reasonCodes: [],
        status: "accepted",
      }),
    });

    expect(readiness).toEqual({
      reasonCodes: ["organization_binding_authorization.required"],
      status: "rejected",
    });
  });

  it("keeps runtime claim readiness when Organization Wake access is on", async () => {
    const readiness = await resolveOrganizationAwareClaimDiagnostics({
      activeOrganizationId: "org-acme",
      binding: createPrimaryBinding(),
      env: createAuthorizationEnv({
        authorized_by: "user-1",
        binding_id: "binding-1",
        created_at: 1,
        id: "authorization-1",
        organization_id: "org-acme",
      }),
      resolveRuntimeClaimDiagnostics: async () => ({
        reasonCodes: [],
        status: "accepted",
      }),
    });

    expect(readiness).toEqual({ reasonCodes: [], status: "accepted" });
  });

  it("blocks a Center Agent from another Organization even when Wake access remains", async () => {
    const readiness = await resolveOrganizationAwareClaimDiagnostics({
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
      reasonCodes: ["center_agent.organization_mismatch"],
      status: "rejected",
    });
  });

  it("keeps the Organization's own Center Agent claim readiness", async () => {
    const readiness = await resolveOrganizationAwareClaimDiagnostics({
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
    organization_id: null,
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
