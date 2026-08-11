import type {
  DaemonExecutionCompatibility,
  OrganizationMemberOpenMeldServiceState,
} from "@openmeld/schemas/types";

export type OrganizationMemberOpenMeldServiceSession = {
  executionCompatibility: DaemonExecutionCompatibility;
  serviceUpdateWakeBlocked: boolean;
};

export function resolveOrganizationMemberOpenMeldServiceState(input: {
  sessions: readonly OrganizationMemberOpenMeldServiceSession[];
}): OrganizationMemberOpenMeldServiceState {
  if (input.sessions.length === 0) {
    return "not_connected";
  }

  const hasUsableSession = input.sessions.some(
    (session) =>
      session.executionCompatibility.status === "compatible" &&
      !session.serviceUpdateWakeBlocked
  );
  return hasUsableSession ? "connected" : "needs_attention";
}
