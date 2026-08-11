import { createAgentProfileBindingDisplayProjection } from "@openmeld/agent-runtime";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  getAgentExecutionReadinessResponseSchema,
} from "@openmeld/schemas";
import type { GetAgentExecutionReadinessResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { toHttpAgentProfileBindingProjection } from "../src/agent-profile-binding/application/agent-profile-binding-http-projection";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("Agent Profile Binding HTTP projection", () => {
  it("maps a real display primaryBinding into the readiness response schema", () => {
    const displayBinding = createAgentProfileBindingDisplayProjection({
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: "binding-1",
      bindingState: "enabled_primary",
      executionTarget: {
        agentControllerConversationId: "conversation-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      agentControllerPermissionMode: "codex:askForApproval",
      modelSelection: {
        modelId: "gpt-5",
        reasoningLevel: "medium",
      },
    });
    const response = buildReadinessResponse({
      primaryBinding: toHttpAgentProfileBindingProjection(displayBinding),
    });

    const parsed = getAgentExecutionReadinessResponseSchema.parse(response);

    expect(parsed.primaryBinding).toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: "binding-1",
      bindingState: "enabled_primary",
      grantsClaimSuccess: false,
      routable: true,
      executionTarget: {
        agentControllerConversationId: "conversation-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
      },
    });
    expect(parsed.primaryBinding).not.toHaveProperty("dispatchReadableFacts");
    expect(parsed.primaryBinding).not.toHaveProperty("diagnosticPointer");
  });

  it("keeps explicit collaboration mode on Binding responses but can omit it from compatibility-sensitive readiness", () => {
    const displayBinding = createAgentProfileBindingDisplayProjection({
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerCollaborationMode: "codex:plan",
      bindingId: "binding-1",
      bindingState: "enabled_primary",
      executionTarget: {
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
    });

    expect(toHttpAgentProfileBindingProjection(displayBinding)).toMatchObject({
      agentControllerCollaborationMode: "codex:plan",
    });
    expect(
      toHttpAgentProfileBindingProjection(displayBinding, {
        includeAgentControllerCollaborationMode: false,
      })
    ).not.toHaveProperty("agentControllerCollaborationMode");
  });
});

function buildReadinessResponse(input: {
  primaryBinding: GetAgentExecutionReadinessResponse["primaryBinding"];
}): GetAgentExecutionReadinessResponse {
  return {
    agentExecutionReadiness: readyExecutionReadiness(),
    agentWakeAvailability: buildAgentWakeAvailability(),
    agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
    agentProfileId: AGENT_PROFILE_ID,
    agentControllerRef: "builtin:codex",
    generatedAt: "2026-05-10T00:00:00.000Z",
    ownerUserId: "owner-1",
    primaryBinding: input.primaryBinding,
    primaryActionPlan: {
      action: "none",
      target: null,
    },
    profileName: "Codex",
    routeDeviceId: "device-1",
    routeLane: "dev-local",
    runtimeDeviceDisplayName: "Felix's MacBook Pro",
    wakeRouteEvidence: {
      observedAt: "2026-05-10T00:00:00.000Z",
      reasonCode: "online",
      status: "online",
    },
    wakeRouteStatus: buildWakeRouteStatus(),
  };
}

function readyExecutionReadiness(): GetAgentExecutionReadinessResponse["agentExecutionReadiness"] {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    displayState: "ready",
    facts: {
      profile: {
        active: true,
        reasonCodes: [],
        source: "profile_identity",
      },
      binding: {
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        source: "binding_truth",
      },
      claim: {
        executionBlocked: false,
        grantsClaimSuccess: false,
        reasonCodes: ["claim.not_checked"],
        source: "not_checked",
      },
      providerAccount: {
        blocked: false,
        expiresAtMs: null,
        observedAtMs: null,
        provider: null,
        reasonCodes: [],
        source: "not_checked",
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
        source: "not_required",
        status: "not_required",
      },
      readinessImpact: {
        blocked: false,
        expiresAtMs: null,
        impactKind: null,
        observedAtMs: null,
        reasonCodes: [],
        source: "not_checked",
      },
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["service.ready"],
        source: "runtime_transport",
      },
      service: {
        executionCompatible: true,
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device-1",
        lane: "dev-local",
        observedAt: "2026-05-10T00:00:00.000Z",
        online: true,
        reasonCodes: ["daemon_route.online"],
        source: "daemon_route",
      },
      runtime: {
        ready: true,
        reasonCodes: ["runtime.ready"],
        source: "prepare_readiness",
      },
    },
    primaryAction: "none",
    reasonCodes: ["agent_execution.ready"],
  };
}

function buildAgentWakeAvailability(): GetAgentExecutionReadinessResponse["agentWakeAvailability"] {
  return {
    action: "none",
    badgeLabel: "Ready",
    category: "available",
    isRefreshing: false,
    label: "Ready for Wake",
    phase: "available",
    reasonCode: "agent_execution.ready",
    status: "available_for_wake",
    summary: "This agent can reply from this computer.",
    tooltip: "Ready for Wake",
  };
}

function buildAgentWakeRouteRegistration(): GetAgentExecutionReadinessResponse["agentWakeRouteRegistration"] {
  return {
    status: "registered",
    reasonCode: null,
    reportedAtMs: 1_777_000_000_000,
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    lane: "dev-local",
    serviceVersion: "0.7.57",
  };
}

function buildWakeRouteStatus(): GetAgentExecutionReadinessResponse["wakeRouteStatus"] {
  return {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    lane: "dev-local",
    lastHeartbeatMs: 1_770_000_000_000,
    leaseEpoch: 1,
    status: "ready",
  };
}
