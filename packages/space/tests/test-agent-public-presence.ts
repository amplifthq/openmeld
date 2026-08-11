import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";

type AgentAgentWakeAvailability = NonNullable<
  SpaceMemberAgentSnapshot["agentWakeAvailability"]
>;
type AgentWakeRouteRegistration = NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentWakeRouteRegistration"]
>;

export function createTestAgentAgentWakeAvailability(
  status: AgentAgentWakeAvailability["status"]
): AgentAgentWakeAvailability {
  switch (status) {
    case "available_for_wake":
      return {
        action: "none",
        badgeLabel: "Available",
        category: "available",
        isRefreshing: false,
        label: "Available for Wake",
        phase: "available",
        reasonCode: "agent_execution.ready",
        status,
        summary: "Can reply from this computer in Spaces.",
        tooltip: "Available for Wake",
      };
    case "unavailable_for_wake":
      return {
        action: "reconnect_binding",
        badgeLabel: "Connect",
        category: "unavailable",
        isRefreshing: false,
        label: "Connect local agent",
        phase: "connect_local_agent",
        reasonCode: "agent_profile_binding.missing",
        status,
        summary: "Connect a local agent before this profile can reply.",
        tooltip: "Connect local agent",
      };
    case "checking_connection":
      return {
        action: "check_status",
        badgeLabel: "Checking",
        category: "checking",
        isRefreshing: true,
        label: "Checking connection",
        phase: "checking_status",
        reasonCode: "agent_execution.check_status",
        status,
        summary: "Checking this agent's Wake availability.",
        tooltip: "Checking Wake availability",
      };
    case "offline_for_wake":
      return {
        action: "connect_service",
        badgeLabel: "Offline",
        category: "offline",
        isRefreshing: false,
        label: "Offline for Wake",
        phase: "service_not_connected",
        reasonCode: "service.not_running",
        status,
        summary:
          "Connect OpenMeld Service on this computer before this agent can reply.",
        tooltip: "OpenMeld Service is not connected on this computer.",
      };
    default:
      throw new Error(`Unhandled agent wake availability status: ${status}`);
  }
}

export function createTestAgentWakeRouteRegistration(
  input: Partial<AgentWakeRouteRegistration> = {}
): AgentWakeRouteRegistration {
  return {
    status: "registered",
    reasonCode: "wake_route.registered",
    reportedAtMs: 1_768_000_000_000,
    daemonSessionId: "daemon-session-test",
    deviceId: "device-test",
    lane: "dev-local",
    serviceVersion: "0.7.52",
    ...input,
  };
}
