import type {
  OrganizationDirectoryResponse,
  RuntimeTransportAgentProfileOperationalContext,
} from "@openmeld/schemas/types";

type OrganizationDirectoryAgentProfileOperationalContext = NonNullable<
  OrganizationDirectoryResponse["agentProfiles"][number]["operationalContext"]
>;

export function projectOrganizationDirectoryAgentProfileOperationalContext(input: {
  exposeWorkReferences: boolean;
  operationalContext: RuntimeTransportAgentProfileOperationalContext;
  spaceNamesById: ReadonlyMap<string, string>;
}): OrganizationDirectoryAgentProfileOperationalContext {
  if (input.operationalContext.status === "checking") {
    return { status: "checking" };
  }
  if (input.operationalContext.status === "idle") {
    return { status: "idle", waitingCount: 0 };
  }
  const summary = {
    status: input.operationalContext.status,
    waitingCount: input.operationalContext.waitingCount,
  };
  if (!input.exposeWorkReferences) {
    return summary;
  }
  const location = (reference: { spaceId: string }) => ({
    spaceId: reference.spaceId,
    spaceName:
      input.spaceNamesById.get(reference.spaceId) ?? "Unavailable space",
  });
  return {
    ...summary,
    ...(input.operationalContext.status === "paused" &&
    input.operationalContext.recoveryAction
      ? { recoveryAction: input.operationalContext.recoveryAction }
      : {}),
    ...(input.operationalContext.currentWorkReference
      ? {
          currentWorkLocation: location(
            input.operationalContext.currentWorkReference
          ),
        }
      : {}),
    ...(input.operationalContext.queuedWorkReferences
      ? {
          queuedWorkLocations:
            input.operationalContext.queuedWorkReferences.map(location),
        }
      : {}),
  };
}
