import { members } from "@openmeld/db/auth";
import { and, asc, eq, isNull, or, sql } from "@openmeld/db/query";
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

export type MemberAgentRowRecord = Omit<MemberAgentRecord, "profiles">;

export type MemberAgentOwnerHarnessKey = {
  organizationId: string;
  ownerUserId: string;
  harnessKind: MemberAgentHarnessKind;
};

export type MemberAgentRepository = {
  listForOwnerInOrganization: (input: {
    organizationId: string;
    ownerUserId: string;
  }) => Promise<OwnerMemberAgentListing>;
  listOrganizationIdsForOwner: (ownerUserId: string) => Promise<string[]>;
  isCurrentMember: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<boolean>;
  findByOwnerHarness: (
    key: MemberAgentOwnerHarnessKey
  ) => Promise<MemberAgentRowRecord | null>;
  // Conditional insert on the (organization, owner, harness) unique key;
  // a concurrent writer's row wins and is returned by the next read.
  insertDetectedIfAbsent: (
    input: MemberAgentOwnerHarnessKey & { id: string }
  ) => Promise<void>;
  // A hosted Binding is an explicit manual creation. Atomically ensures its
  // Agent, assigns the Profile, and picks the first Profile as the default.
  assignHostedProfile: (input: {
    organizationId: string;
    ownerUserId: string;
    profileId: string;
  }) => Promise<string | null>;
  // Assigns the Profile only while it has no MemberAgent or already has
  // this one; never moves a Profile between MemberAgents.
  assignProfile: (input: {
    memberAgentId: string;
    profileId: string;
  }) => Promise<void>;
  // Sets the default only while none is set. The Profile must already be
  // assigned to this MemberAgent (migration 0039 foreign key).
  setDefaultProfileIfUnset: (input: {
    memberAgentId: string;
    profileId: string;
  }) => Promise<void>;
};

const memberAgentRowColumns = {
  id: memberAgents.id,
  organizationId: memberAgents.organizationId,
  ownerUserId: memberAgents.ownerUserId,
  harnessKind: memberAgents.harnessKind,
  defaultProfileId: memberAgents.defaultProfileId,
  source: memberAgents.source,
  archivedAt: memberAgents.archivedAt,
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
    async listOrganizationIdsForOwner(ownerUserId) {
      const rows = await db
        .selectDistinct({ organizationId: memberAgents.organizationId })
        .from(memberAgents)
        .where(
          and(
            eq(memberAgents.ownerUserId, ownerUserId),
            isNull(memberAgents.archivedAt)
          )
        )
        .orderBy(asc(memberAgents.organizationId));
      return rows.map((row) => row.organizationId);
    },
    async isCurrentMember({ organizationId, userId }) {
      const rows = await db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.organizationId, organizationId),
            eq(members.userId, userId)
          )
        )
        .limit(1);
      return rows.length > 0;
    },
    async findByOwnerHarness({ organizationId, ownerUserId, harnessKind }) {
      const rows = await db
        .select(memberAgentRowColumns)
        .from(memberAgents)
        .where(
          and(
            eq(memberAgents.organizationId, organizationId),
            eq(memberAgents.ownerUserId, ownerUserId),
            eq(memberAgents.harnessKind, harnessKind)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertDetectedIfAbsent({
      id,
      organizationId,
      ownerUserId,
      harnessKind,
    }) {
      const nowMs = Date.now();
      // Conditional on current membership in the same statement, so an owner
      // removed after the ensure began never gains a MemberAgent.
      await db.execute(sql`INSERT INTO ${memberAgents} (
          id, organization_id, owner_user_id, harness_kind, source,
          created_at, updated_at
        )
        SELECT ${id}, ${organizationId}, ${ownerUserId}, ${harnessKind},
          'detected', ${nowMs}, ${nowMs}
        WHERE EXISTS (
          SELECT 1 FROM ${members}
          WHERE ${members.organizationId} = ${organizationId}
            AND ${members.userId} = ${ownerUserId}
        )
        ON CONFLICT (organization_id, owner_user_id, harness_kind) DO NOTHING`);
    },
    async assignHostedProfile({ organizationId, ownerUserId, profileId }) {
      return await db.transaction(async (tx) => {
        const [profile] = await tx
          .select({ profileId: openMeldProfiles.profileId })
          .from(openMeldProfiles)
          .where(
            and(
              eq(openMeldProfiles.profileId, profileId),
              eq(openMeldProfiles.organizationId, organizationId),
              eq(openMeldProfiles.ownerUserId, ownerUserId),
              eq(openMeldProfiles.profileKind, "agent"),
              eq(openMeldProfiles.status, "active"),
              isNull(openMeldProfiles.managedRole),
              isNull(openMeldProfiles.memberAgentId)
            )
          )
          .for("update");
        if (!profile) {
          return null;
        }
        const nowMs = Date.now();
        await tx.execute(sql`INSERT INTO ${memberAgents} (
          id, organization_id, owner_user_id, harness_kind, source,
          created_at, updated_at
        )
        SELECT ${crypto.randomUUID()}, ${organizationId}, ${ownerUserId},
          'hosted', 'manual', ${nowMs}, ${nowMs}
        WHERE EXISTS (
          SELECT 1 FROM ${members}
          WHERE ${members.organizationId} = ${organizationId}
            AND ${members.userId} = ${ownerUserId}
        )
        ON CONFLICT (organization_id, owner_user_id, harness_kind) DO NOTHING`);
        const [agent] = await tx
          .select({ id: memberAgents.id })
          .from(memberAgents)
          .where(
            and(
              eq(memberAgents.organizationId, organizationId),
              eq(memberAgents.ownerUserId, ownerUserId),
              eq(memberAgents.harnessKind, "hosted")
            )
          );
        if (!agent) {
          return null;
        }
        await tx
          .update(openMeldProfiles)
          .set({ memberAgentId: agent.id, updatedAt: new Date(nowMs) })
          .where(eq(openMeldProfiles.profileId, profileId));
        await tx
          .update(memberAgents)
          .set({ defaultProfileId: profileId, updatedAt: new Date(nowMs) })
          .where(
            and(
              eq(memberAgents.id, agent.id),
              isNull(memberAgents.defaultProfileId)
            )
          );
        return agent.id;
      });
    },
    async assignProfile({ memberAgentId, profileId }) {
      await db
        .update(openMeldProfiles)
        .set({ memberAgentId, updatedAt: new Date() })
        .where(
          and(
            eq(openMeldProfiles.profileId, profileId),
            or(
              isNull(openMeldProfiles.memberAgentId),
              eq(openMeldProfiles.memberAgentId, memberAgentId)
            )
          )
        );
    },
    async setDefaultProfileIfUnset({ memberAgentId, profileId }) {
      await db
        .update(memberAgents)
        .set({ defaultProfileId: profileId, updatedAt: new Date() })
        .where(
          and(
            eq(memberAgents.id, memberAgentId),
            isNull(memberAgents.defaultProfileId)
          )
        );
    },
  };
}
