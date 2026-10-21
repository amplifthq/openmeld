import type { OwnerMemberAgentListing } from "@openmeld/auth/server";
import type { ListMemberAgentsResponse } from "@openmeld/schemas";

export function toListMemberAgentsResponse(
  organizationId: string,
  listing: OwnerMemberAgentListing
): ListMemberAgentsResponse {
  return {
    ok: true,
    organizationId,
    memberAgents: listing.memberAgents.map((memberAgent) => ({
      id: memberAgent.id,
      organizationId: memberAgent.organizationId,
      ownerUserId: memberAgent.ownerUserId,
      harnessKind: memberAgent.harnessKind,
      defaultProfileId: memberAgent.defaultProfileId,
      source: memberAgent.source,
      archivedAt: memberAgent.archivedAt?.toISOString() ?? null,
      profiles: memberAgent.profiles.map((profile) => ({
        openMeldProfileId: profile.profileId,
        profileName: profile.profileName,
        isDefault: profile.isDefault,
      })),
    })),
    unassignedProfiles: listing.unassignedProfiles.map((profile) => ({
      openMeldProfileId: profile.profileId,
      profileName: profile.profileName,
    })),
  };
}
