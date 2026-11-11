import type {
  OrganizationAgentRuntimeOverviewResponse,
  OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";

/** Project a validated Core response for installed readers with strict schemas. */
export function projectOrganizationPublicWakeabilityReason<
  T extends
    | OrganizationDirectoryResponse
    | OrganizationAgentRuntimeOverviewResponse,
>(response: T, includePublicWakeabilityReason: boolean): T {
  if (includePublicWakeabilityReason) {
    return response;
  }
  return {
    ...response,
    agentProfiles: response.agentProfiles.map((profile) => {
      const { publicWakeabilityReason, ...readiness } = profile.readiness;
      return { ...profile, readiness };
    }),
  };
}
