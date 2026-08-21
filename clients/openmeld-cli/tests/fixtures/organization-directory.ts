import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  OrganizationDirectoryAgentProfile,
  OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";

export const ORGANIZATION_DIRECTORY_FIXTURE_GENERATED_AT =
  "2026-07-19T12:00:00.000Z";
export const ORGANIZATION_DIRECTORY_FIXTURE_ID = "org-1";
export const ORGANIZATION_DIRECTORY_FIXTURE_HUMAN_PROFILE_ID =
  "22222222-2222-4222-8222-222222222222";
export const ORGANIZATION_DIRECTORY_FIXTURE_CENTER_AGENT_PROFILE_ID =
  "agt_77777777-7777-4777-8777-777777777777";

export function buildOrganizationDirectoryFixture(input?: {
  agentProfiles?: OrganizationDirectoryAgentProfile[];
}): OrganizationDirectoryResponse {
  return {
    organizationId: ORGANIZATION_DIRECTORY_FIXTURE_ID,
    generatedAt: ORGANIZATION_DIRECTORY_FIXTURE_GENERATED_AT,
    members: [
      {
        memberId: "member-1",
        organizationId: ORGANIZATION_DIRECTORY_FIXTURE_ID,
        userId: "user-2",
        role: "member",
        joinedAt: "2026-07-18T12:00:00.000Z",
        lastActiveAt: "2026-07-19T11:30:00.000Z",
        user: {
          id: "user-2",
          name: "Mira Chen",
          email: "mira@example.com",
          image: null,
        },
        humanProfile: {
          profileId: ORGANIZATION_DIRECTORY_FIXTURE_HUMAN_PROFILE_ID,
          profileName: "Mira",
          profileHandle: "mira",
          status: "active",
          lastUsedAt: ORGANIZATION_DIRECTORY_FIXTURE_GENERATED_AT,
        },
      },
    ],
    agentProfiles: input?.agentProfiles ?? [buildAgentDirectoryProfile()],
  };
}

export function buildAgentDirectoryProfile(input?: {
  profileId?: string;
  isCenterAgent?: boolean;
}): OrganizationDirectoryAgentProfile {
  const profileId =
    input?.profileId ?? ORGANIZATION_DIRECTORY_FIXTURE_CENTER_AGENT_PROFILE_ID;
  return {
    organizationId: ORGANIZATION_DIRECTORY_FIXTURE_ID,
    profileId,
    profileName: "Atlas",
    profileHandle: "atlas",
    profileKind: "agent",
    isDefault: false,
    status: "active",
    ownerUserId: "user-2",
    ownerName: "Mira Chen",
    source: "agent_profile_binding_api",
    managedRole: input?.isCenterAgent === false ? null : "center_agent",
    createdByUserId: "user-2",
    creatorProfileId: ORGANIZATION_DIRECTORY_FIXTURE_HUMAN_PROFILE_ID,
    lastUsedAt: null,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: ORGANIZATION_DIRECTORY_FIXTURE_GENERATED_AT,
    isCenterAgent: input?.isCenterAgent ?? true,
    readiness: buildAgentReadiness(profileId),
  };
}

function buildAgentReadiness(agentProfileId: string) {
  return {
    agentExecutionReadiness: {
      agentProfileId,
      displayState: "ready" as const,
      facts: {
        profile: {
          active: true,
          reasonCodes: ["agent_profile.active"],
          source: "profile_identity" as const,
        },
        binding: {
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          source: "binding_truth" as const,
        },
        claim: {
          executionBlocked: false,
          grantsClaimSuccess: false as const,
          reasonCodes: ["claim.eligible"],
          source: "claim_diagnostics" as const,
        },
        providerAccount: {
          blocked: false,
          expiresAtMs: null,
          observedAtMs: null,
          provider: null,
          reasonCodes: [],
          source: "not_checked" as const,
        },
        providerConversation: {
          agentControllerConversationId: null,
          errorCode: null,
          errorMessage: null,
          errorType: null,
          expiresAtMs: null,
          method: null,
          observedAtMs: null,
          provider: null,
          ready: true,
          reasonCodes: [],
          required: false,
          source: "not_required" as const,
          status: "not_required" as const,
        },
        readinessImpact: {
          blocked: false,
          expiresAtMs: null,
          impactKind: null,
          observedAtMs: null,
          reasonCodes: [],
          source: "not_checked" as const,
        },
        localService: {
          reachable: true,
          refreshable: false,
          reasonCodes: ["runtime_transport.session_reachable"],
          source: "runtime_transport" as const,
        },
        service: {
          executionCompatible: true,
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: String(CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH),
          reasonCodes: ["service.execution_compatible"],
          source: "runtime_transport" as const,
        },
        route: {
          deviceId: "device-1",
          lane: "dev-local" as const,
          observedAt: ORGANIZATION_DIRECTORY_FIXTURE_GENERATED_AT,
          online: true,
          reasonCodes: ["daemon_route.online"],
          source: "daemon_route" as const,
        },
        runtime: {
          ready: true,
          reasonCodes: ["runtime.ready"],
          source: "prepare_readiness" as const,
        },
      },
      primaryAction: "none" as const,
      reasonCodes: ["agent_execution.ready"],
    },
    agentWakeAvailability: {
      action: "none" as const,
      badgeLabel: "Available",
      category: "available" as const,
      isRefreshing: false,
      label: "This profile can be woken in Space",
      phase: "available" as const,
      reasonCode: "agent_execution.ready",
      status: "available_for_wake" as const,
      summary: "Can reply from this computer in Spaces.",
      tooltip: "Available for Wake",
    },
    agentWakeRouteRegistration: {
      status: "registered" as const,
      reasonCode: null,
      reportedAtMs: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local" as const,
      serviceVersion: "0.3.2",
    },
    agentProfileId,
    agentControllerRef: "builtin:codex",
    generatedAt: ORGANIZATION_DIRECTORY_FIXTURE_GENERATED_AT,
    ownerUserId: "user-2",
    primaryBinding: {
      agentProfileId,
      authoritySource: "binding_truth" as const,
      bindingId: `binding_${agentProfileId}`,
      bindingState: "enabled_primary" as const,
      dispatchEligibility: {
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "routable" as const,
      },
      grantsClaimSuccess: false as const,
      reasonCodes: ["agent_profile_binding.command_eligible"],
      resolutionSource: "binding_truth" as const,
      routable: true,
      executionTarget: {
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority" as const,
          value: "runtime-1",
        },
      },
    },
    primaryActionPlan: {
      action: "none" as const,
      target: null,
    },
    profileName: "Atlas",
    routeDeviceId: "device-1",
    routeLane: "dev-local" as const,
    runtimeDeviceDisplayName: "Mira MacBook",
    wakeRouteEvidence: {
      observedAt: ORGANIZATION_DIRECTORY_FIXTURE_GENERATED_AT,
      reasonCode: "online" as const,
      status: "online" as const,
    },
    wakeRouteStatus: {
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local" as const,
      lastHeartbeatMs: 1,
      leaseEpoch: 1,
      status: "ready" as const,
    },
  };
}
