import {
  and,
  desc,
  eq,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  or,
  sql,
} from "@openmeld/db/query";
import type { createAuthDatabase } from "../db";
import { memberAgents } from "../db/member-agent.schema";
import type {
  OpenMeldProfileManagedRole,
  OpenMeldProfileSource,
} from "../db/openmeld-profile.schema";
import { openMeldProfiles } from "../db/openmeld-profile.schema";
import { ProfileValidationError } from "./profile-errors";
export type OpenMeldProfileRecord = InferSelectModel<typeof openMeldProfiles>;
type OpenMeldProfileFactRecord = Pick<
  OpenMeldProfileRecord,
  | "profileId"
  | "profileName"
  | "profileHandle"
  | "profileKind"
  | "status"
  | "ownerUserId"
  | "organizationId"
  | "defaultProjectId"
  | "managedRole"
  | "avatarStyle"
  | "avatarOptions"
>;
type NewOpenMeldProfileRecord = InferInsertModel<typeof openMeldProfiles>;
type PrimaryHumanProfileInsertInput = {
  profileId: string;
  profileName: string;
  profileHandle: string;
  ownerUserId: string;
  createdByUserId?: string | null;
  creatorProfileId?: string | null;
  source?: OpenMeldProfileSource;
};
type AgentProfileInsertInput = {
  profileId: string;
  profileName: string;
  profileHandle: string;
  organizationId: string;
  ownerUserId: string | null;
  createdByUserId?: string | null;
  creationActorProfileId?: string | null;
  creatorProfileId?: string | null;
  creationIdempotencyKey?: string | null;
  managedRole?: OpenMeldProfileManagedRole | null;
  source?: OpenMeldProfileSource;
};
type HumanProfileInsertInput = {
  profileId: string;
  profileName: string;
  profileHandle: string;
  ownerUserId: string;
  createdByUserId?: string | null;
  creatorProfileId?: string | null;
  source?: OpenMeldProfileSource;
};
export type OpenMeldProfileRepository = {
  findFactsByProfileIds: (
    profileIds: string[]
  ) => Promise<OpenMeldProfileFactRecord[]>;
  findByProfileId: (profileId: string) => Promise<OpenMeldProfileRecord | null>;
  findByOwnerAndProfileId: (
    ownerUserId: string,
    profileId: string
  ) => Promise<OpenMeldProfileRecord | null>;
  /** True when a MemberAgent names this Profile as its default Profile. */
  isMemberAgentDefaultProfile: (profileId: string) => Promise<boolean>;
  findAgentByOwnerAndCreationIdempotencyKey: (
    ownerUserId: string,
    creationIdempotencyKey: string
  ) => Promise<OpenMeldProfileRecord | null>;
  findDefaultHumanByOwner: (
    ownerUserId: string
  ) => Promise<OpenMeldProfileRecord | null>;
  // One read for the request-auth hot path: the owner's active default Human
  // Profile and the owner's row for `profileId`, with the same filters as
  // findDefaultHumanByOwner and findByOwnerAndProfileId.
  findDefaultHumanAndOwnedProfile: (
    ownerUserId: string,
    profileId: string
  ) => Promise<{
    defaultHumanProfile: OpenMeldProfileRecord | null;
    ownedProfile: OpenMeldProfileRecord | null;
  }>;
  findManagedAgentByOwnerAndRole: (
    ownerUserId: string,
    managedRole: OpenMeldProfileManagedRole
  ) => Promise<OpenMeldProfileRecord | null>;
  findManagedAgentByOrganizationAndRole: (
    organizationId: string,
    managedRole: OpenMeldProfileManagedRole
  ) => Promise<OpenMeldProfileRecord | null>;
  listByOwner: (ownerUserId: string) => Promise<OpenMeldProfileRecord[]>;
  insertPrimaryHumanProfile: (
    input: PrimaryHumanProfileInsertInput
  ) => Promise<void>;
  activateProfile: (profileId: string) => Promise<boolean>;
  insertAgentProfile: (input: AgentProfileInsertInput) => Promise<void>;
  insertHumanProfile: (input: HumanProfileInsertInput) => Promise<void>;
  updateManagedProfileIdentityForOrganization: (
    organizationId: string,
    profileId: string,
    input: {
      profileName: string;
      profileHandle: string;
    }
  ) => Promise<void>;
  updateAgentAvatarStyle: (
    profileId: string,
    avatarStyle: string,
    scope:
      | {
          organizationId: string;
          avatarOptions?: OpenMeldProfileRecord["avatarOptions"];
          expectedAvatarOptions?: OpenMeldProfileRecord["avatarOptions"];
        }
      | {
          ownerUserId: string;
        }
  ) => Promise<void>;
  updateProfileIdentityForOwner: (
    ownerUserId: string,
    profileId: string,
    input: {
      profileName: string;
      profileHandle: string;
    }
  ) => Promise<void>;
  updateAgentProfileDefaultProjectForOwner: (
    ownerUserId: string,
    organizationId: string,
    profileId: string,
    defaultProjectId: string | null,
    onlyIfUnmodified?: boolean
  ) => Promise<boolean>;
  deleteProfileForOwner: (
    ownerUserId: string,
    profileId: string
  ) => Promise<void>;
};
type OpenMeldProfileDatabase = ReturnType<typeof createAuthDatabase>;
export function createDrizzleOpenMeldProfileRepository(
  db: OpenMeldProfileDatabase
): OpenMeldProfileRepository {
  return {
    async findFactsByProfileIds(profileIds) {
      if (profileIds.length === 0) {
        return [];
      }
      return await db
        .select({
          profileId: openMeldProfiles.profileId,
          profileName: openMeldProfiles.profileName,
          profileHandle: openMeldProfiles.profileHandle,
          profileKind: openMeldProfiles.profileKind,
          status: openMeldProfiles.status,
          ownerUserId: openMeldProfiles.ownerUserId,
          organizationId: openMeldProfiles.organizationId,
          defaultProjectId: openMeldProfiles.defaultProjectId,
          managedRole: openMeldProfiles.managedRole,
          avatarStyle: openMeldProfiles.avatarStyle,
          avatarOptions: openMeldProfiles.avatarOptions,
        })
        .from(openMeldProfiles)
        .where(inArray(openMeldProfiles.profileId, profileIds));
    },
    async findByProfileId(profileId) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(eq(openMeldProfiles.profileId, profileId))
        .limit(1);
      return rows[0] ?? null;
    },
    async findByOwnerAndProfileId(ownerUserId, profileId) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            eq(openMeldProfiles.profileId, profileId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async isMemberAgentDefaultProfile(profileId) {
      const rows = await db
        .select({ id: memberAgents.id })
        .from(memberAgents)
        .where(eq(memberAgents.defaultProfileId, profileId))
        .limit(1);
      return rows.length > 0;
    },
    async findAgentByOwnerAndCreationIdempotencyKey(
      ownerUserId,
      creationIdempotencyKey
    ) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            eq(openMeldProfiles.creationIdempotencyKey, creationIdempotencyKey),
            eq(openMeldProfiles.profileKind, "agent")
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async findDefaultHumanByOwner(ownerUserId) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            eq(openMeldProfiles.profileKind, "human"),
            eq(openMeldProfiles.isDefault, true),
            eq(openMeldProfiles.status, "active")
          )
        )
        .orderBy(
          desc(openMeldProfiles.updatedAt),
          desc(openMeldProfiles.createdAt)
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async findDefaultHumanAndOwnedProfile(ownerUserId, profileId) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            or(
              eq(openMeldProfiles.profileId, profileId),
              and(
                eq(openMeldProfiles.profileKind, "human"),
                eq(openMeldProfiles.isDefault, true),
                eq(openMeldProfiles.status, "active")
              )
            )
          )
        )
        .orderBy(
          desc(openMeldProfiles.updatedAt),
          desc(openMeldProfiles.createdAt)
        );
      return {
        defaultHumanProfile:
          rows.find(
            (row) =>
              row.profileKind === "human" &&
              row.isDefault === true &&
              row.status === "active"
          ) ?? null,
        ownedProfile: rows.find((row) => row.profileId === profileId) ?? null,
      };
    },
    async findManagedAgentByOwnerAndRole(ownerUserId, managedRole) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            eq(openMeldProfiles.profileKind, "agent"),
            eq(openMeldProfiles.managedRole, managedRole),
            eq(openMeldProfiles.status, "active")
          )
        )
        .orderBy(
          desc(openMeldProfiles.updatedAt),
          desc(openMeldProfiles.createdAt)
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async findManagedAgentByOrganizationAndRole(organizationId, managedRole) {
      const rows = await db
        .select()
        .from(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.organizationId, organizationId),
            eq(openMeldProfiles.profileKind, "agent"),
            eq(openMeldProfiles.managedRole, managedRole),
            eq(openMeldProfiles.status, "active")
          )
        )
        .orderBy(
          desc(openMeldProfiles.updatedAt),
          desc(openMeldProfiles.createdAt)
        )
        .limit(1);
      return rows[0] ?? null;
    },
    listByOwner(ownerUserId) {
      return db
        .select()
        .from(openMeldProfiles)
        .where(eq(openMeldProfiles.ownerUserId, ownerUserId))
        .orderBy(
          desc(openMeldProfiles.isDefault),
          desc(openMeldProfiles.updatedAt),
          desc(openMeldProfiles.createdAt)
        );
    },
    async insertPrimaryHumanProfile(input) {
      const now = new Date();
      const value: NewOpenMeldProfileRecord = {
        profileId: input.profileId,
        profileName: input.profileName,
        profileHandle: input.profileHandle,
        profileKind: "human",
        isDefault: true,
        status: "active",
        ownerUserId: input.ownerUserId,
        createdByUserId: input.createdByUserId ?? null,
        creatorProfileId: input.creatorProfileId ?? null,
        source: input.source ?? "auth_bootstrap",
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(openMeldProfiles).values(value).onConflictDoNothing();
    },
    async activateProfile(profileId) {
      const targetOwnerUserId = db
        .select({ ownerUserId: openMeldProfiles.ownerUserId })
        .from(openMeldProfiles)
        .where(eq(openMeldProfiles.profileId, profileId))
        .limit(1);
      const now = new Date();
      const [, updatedRows] = await db.transaction((tx) =>
        Promise.all([
          tx
            .update(openMeldProfiles)
            .set({
              isDefault: false,
              updatedAt: now,
            })
            .where(
              and(
                eq(openMeldProfiles.ownerUserId, targetOwnerUserId),
                eq(openMeldProfiles.profileKind, "human"),
                eq(openMeldProfiles.isDefault, true)
              )
            ),
          tx
            .update(openMeldProfiles)
            .set({
              status: "active",
              isDefault: true,
              updatedAt: now,
            })
            .where(eq(openMeldProfiles.profileId, profileId))
            .returning({ profileId: openMeldProfiles.profileId }),
        ])
      );
      return updatedRows.length > 0;
    },
    async insertAgentProfile(input) {
      const now = new Date();
      const value: NewOpenMeldProfileRecord = {
        profileId: input.profileId,
        profileName: input.profileName,
        profileHandle: input.profileHandle,
        profileKind: "agent",
        isDefault: false,
        status: "active",
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        createdByUserId: input.createdByUserId ?? null,
        creationActorProfileId: input.creationActorProfileId ?? null,
        creatorProfileId: input.creatorProfileId ?? null,
        creationIdempotencyKey: input.creationIdempotencyKey ?? null,
        defaultProjectRevision: 0,
        managedRole: input.managedRole ?? null,
        source: input.source ?? "cli_create",
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(openMeldProfiles).values(value).onConflictDoNothing();
    },
    async insertHumanProfile(input) {
      const now = new Date();
      const value: NewOpenMeldProfileRecord = {
        profileId: input.profileId,
        profileName: input.profileName,
        profileHandle: input.profileHandle,
        profileKind: "human",
        isDefault: false,
        status: "active",
        ownerUserId: input.ownerUserId,
        createdByUserId: input.createdByUserId ?? null,
        creatorProfileId: input.creatorProfileId ?? null,
        source: input.source ?? "cli_create",
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(openMeldProfiles).values(value).onConflictDoNothing();
    },
    async updateManagedProfileIdentityForOrganization(
      organizationId,
      profileId,
      input
    ) {
      await db
        .update(openMeldProfiles)
        .set({
          profileName: input.profileName,
          profileHandle: input.profileHandle,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(openMeldProfiles.organizationId, organizationId),
            eq(openMeldProfiles.profileId, profileId),
            eq(openMeldProfiles.managedRole, "center_agent")
          )
        );
    },
    async updateAgentAvatarStyle(profileId, avatarStyle, scope) {
      const updated = await db
        .update(openMeldProfiles)
        .set({
          avatarStyle,
          ...("avatarOptions" in scope
            ? { avatarOptions: scope.avatarOptions }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(openMeldProfiles.profileId, profileId),
            eq(openMeldProfiles.profileKind, "agent"),
            "expectedAvatarOptions" in scope &&
              scope.expectedAvatarOptions !== undefined
              ? sql`${openMeldProfiles.avatarOptions} IS NOT DISTINCT FROM ${scope.expectedAvatarOptions === null ? null : JSON.stringify(scope.expectedAvatarOptions)}::jsonb`
              : undefined,
            "organizationId" in scope
              ? eq(openMeldProfiles.organizationId, scope.organizationId)
              : eq(openMeldProfiles.ownerUserId, scope.ownerUserId)
          )
        )
        .returning({ profileId: openMeldProfiles.profileId });
      if (!updated.length) {
        throw new ProfileValidationError(
          "This avatar changed. Refresh and try again."
        );
      }
    },
    async updateProfileIdentityForOwner(ownerUserId, profileId, input) {
      await db
        .update(openMeldProfiles)
        .set({
          profileName: input.profileName,
          profileHandle: input.profileHandle,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            eq(openMeldProfiles.profileId, profileId)
          )
        );
    },
    async updateAgentProfileDefaultProjectForOwner(
      ownerUserId,
      organizationId,
      profileId,
      defaultProjectId,
      onlyIfUnmodified
    ) {
      const updated = await db
        .update(openMeldProfiles)
        .set({
          defaultProjectId,
          updatedAt: sql`GREATEST(${Date.now()}, ${openMeldProfiles.updatedAt} + 1)`,
        })
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            eq(openMeldProfiles.organizationId, organizationId),
            eq(openMeldProfiles.profileId, profileId),
            eq(openMeldProfiles.profileKind, "agent"),
            ...(onlyIfUnmodified
              ? [eq(openMeldProfiles.defaultProjectRevision, 0)]
              : [])
          )
        )
        .returning({ profileId: openMeldProfiles.profileId });
      return updated.length === 1;
    },
    async deleteProfileForOwner(ownerUserId, profileId) {
      await db
        .delete(openMeldProfiles)
        .where(
          and(
            eq(openMeldProfiles.ownerUserId, ownerUserId),
            eq(openMeldProfiles.profileId, profileId)
          )
        );
    },
  };
}
