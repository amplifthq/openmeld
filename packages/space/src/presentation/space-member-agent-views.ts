import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";

export type SpaceMemberAgentPublicCollaborationView = {
  agentWakeAvailability: NonNullable<
    SpaceMemberAgentSnapshot["agentWakeAvailability"]
  > | null;
};

export type SpaceMemberAgentOwnerWakeDiagnosticsView = {
  agentExecutionReadiness:
    | NonNullable<
        SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
      >["agentExecutionReadiness"]
    | undefined;
  wakeRouteEvidence:
    | NonNullable<
        SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
      >["wakeRouteEvidence"]
    | undefined;
  wakeRouteStatus:
    | NonNullable<
        SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
      >["wakeRouteStatus"]
    | undefined;
  state:
    | NonNullable<SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]>["state"]
    | null;
  source: "owner_wake_diagnostics" | "none";
};

export function resolveSpaceMemberAgentPublicCollaborationView(
  member: SpaceMemberAgentSnapshot
): SpaceMemberAgentPublicCollaborationView {
  return {
    agentWakeAvailability: member.agentWakeAvailability ?? null,
  };
}

export function resolveSpaceMemberAgentOwnerWakeDiagnosticsView(
  member: SpaceMemberAgentSnapshot
): SpaceMemberAgentOwnerWakeDiagnosticsView {
  if (member.ownerWakeDiagnostics) {
    return {
      agentExecutionReadiness:
        member.ownerWakeDiagnostics.agentExecutionReadiness,
      wakeRouteEvidence: member.ownerWakeDiagnostics.wakeRouteEvidence,
      wakeRouteStatus: member.ownerWakeDiagnostics.wakeRouteStatus,
      state: member.ownerWakeDiagnostics.state,
      source: "owner_wake_diagnostics",
    };
  }

  if (member.ownerWakeDiagnostics === null) {
    return {
      agentExecutionReadiness: undefined,
      wakeRouteEvidence: undefined,
      wakeRouteStatus: undefined,
      state: null,
      source: "none",
    };
  }

  return {
    agentExecutionReadiness: undefined,
    wakeRouteEvidence: undefined,
    wakeRouteStatus: undefined,
    state: null,
    source: "none",
  };
}
