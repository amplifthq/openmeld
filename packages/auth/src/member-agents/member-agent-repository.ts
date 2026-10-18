import { and, asc, eq, isNull } from "@openmeld/db/query";
import type { createAuthDatabase } from "../db";
import {
  type MemberAgentHarnessKind,
  type MemberAgentSourceValue,
  memberAgents,
} from "../db/member-agent.schema";
import { openMeldProfiles } from "../db/openmeld-profile.schema";

export type MemberAgentProfileRecord = {
  profileId: string;
  profileName: string;
  isDefault: boolean;
};

export type MemberAgentRecord = {
  id: string;
  organizationId: string;
  ownerUserId: string;
  harnessKind: MemberAgentHarnessKind;
  defaultProfileId: string | null;
  source: MemberAgentSourceValue;
  archivedAt: Date | null;
  profiles: MemberAgentProfileRecord[];
};

export type UnassignedAgentProfileRecord = {
  profileId: string;
  profileName: string;
};

export type OwnerMemberAgentListing = {
  memberAgents: MemberAgentRecord[];
  unassignedProfiles: UnassignedAgentProfileRecord[];
};

export type MemberAgentRepository = {
  listForOwnerInOrganization: (input: {
    organizationId: string;
    ownerUserId: string;
  }) => Promise<OwnerMemberAgentListing>;
};

type MemberAgentDatabase = ReturnType<typeof createAuthDatabase>;

export function createDrizzleMemberAgentRepository(
  db: MemberAgentDatabase
): MemberAgentRepository {
  return {
    async listForOwnerInOrganization({ organizationId, ownerUserId }) {
      const [agentRows, profileRows] = await Promise.all([
        db
          .select({
            id: memberAgents.id,
            organizationId: memberAgents.organizationId,
            ownerUserId: memberAgents.ownerUserId,
            harnessKind: memberAgents.harnessKind,
            defaultProfileId: memberAgents.defaultProfileId,
            source: memberAgents.source,
            archivedAt: memberAgents.archivedAt,
          })
          .from(memberAgents)
          .where(
            and(
              eq(memberAgents.organizationId, organizationId),
              eq(memberAgents.ownerUserId, ownerUserId)
            )
          )
          .orderBy(asc(memberAgents.createdAt), asc(memberAgents.id)),
        // Ordinary owned Agent Profiles only: managed Profiles (Center Agent,
        // legacy assistants) are outside the MemberAgent structure.
        db
          .select({
            profileId: openMeldProfiles.profileId,
            profileName: openMeldProfiles.profileName,
            memberAgentId: openMeldProfiles.memberAgentId,
          })
          .from(openMeldProfiles)
          .where(
            and(
              eq(openMeldProfiles.organizationId, organizationId),
              eq(openMeldProfiles.ownerUserId, ownerUserId),
              eq(openMeldProfiles.profileKind, "agent"),
              eq(openMeldProfiles.status, "active"),
              isNull(openMeldProfiles.managedRole)
            )
          )
          .orderBy(
            asc(openMeldProfiles.createdAt),
            asc(openMeldProfiles.profileId)
          ),
      ]);

      const agents = new Map<string, MemberAgentRecord>(
        agentRows.map((row) => [row.id, { ...row, profiles: [] }])
      );
      const unassignedProfiles: UnassignedAgentProfileRecord[] = [];
      for (const profile of profileRows) {
        const agent = profile.memberAgentId
          ? agents.get(profile.memberAgentId)
          : undefined;
        if (!agent) {
          unassignedProfiles.push({
            profileId: profile.profileId,
            profileName: profile.profileName,
          });
          continue;
        }
        agent.profiles.push({
          profileId: profile.profileId,
          profileName: profile.profileName,
          isDefault: agent.defaultProfileId === profile.profileId,
        });
      }
      for (const agent of agents.values()) {
        // The default Profile leads; the rest keep creation order.
        agent.profiles.sort(
          (left, right) => Number(right.isDefault) - Number(left.isDefault)
        );
      }
      return { memberAgents: [...agents.values()], unassignedProfiles };
    },
  };
}
