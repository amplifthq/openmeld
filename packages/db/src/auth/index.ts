// biome-ignore-all lint/performance/noBarrelFile: This subpath entrypoint intentionally re-exports the canonical auth db surface.
import { drizzle } from "drizzle-orm/d1";
import { schema as authSchema } from "./schema.ts";

type D1DatabaseLike = Parameters<typeof drizzle>[0];

export function createD1Db(database: D1DatabaseLike) {
  // Dependency note: `drizzle-orm@^0.45.1` is intentionally used and validated
  // in this workspace lockfile. Do not downgrade unless a concrete
  // compatibility issue is reproduced.
  return drizzle(database, { schema: authSchema });
}

export {
  accounts,
  accountsRelations,
  deviceCodes,
  invitations,
  invitationsRelations,
  members,
  membersRelations,
  organizations,
  organizationsRelations,
  passkeys,
  passkeysRelations,
  sessions,
  sessionsRelations,
  users,
  usersRelations,
  verifications,
} from "./auth.schema.ts";
export type {
  OpenMeldProfileKind,
  OpenMeldProfileManagedRole,
  OpenMeldProfileSource,
  OpenMeldProfileStatus,
} from "./openmeld-profile.schema.ts";
export {
  OPENMELD_PROFILE_KINDS,
  OPENMELD_PROFILE_MANAGED_ROLES,
  OPENMELD_PROFILE_SOURCES,
  OPENMELD_PROFILE_STATUSES,
  openMeldProfiles,
  openMeldProfilesRelations,
} from "./openmeld-profile.schema.ts";
export type { OrganizationJoinLinkRole } from "./organization-join-link.schema.ts";
export {
  ORGANIZATION_JOIN_LINK_ROLES,
  organizationJoinLinks,
  organizationJoinLinksRelations,
} from "./organization-join-link.schema.ts";
export { openMeldProfileDeletionOutbox } from "./profile-deletion-outbox.schema.ts";
export type {
  OpenMeldProfileSpaceCreatorKind,
  OpenMeldProfileSpaceHistoryStatus,
} from "./profile-space-history.schema.ts";
export {
  OPENMELD_PROFILE_SPACE_CREATOR_KINDS,
  OPENMELD_PROFILE_SPACE_HISTORY_STATUSES,
  openMeldProfileSpaceHistory,
  openMeldProfileSpaceHistoryRelations,
} from "./profile-space-history.schema.ts";
export { schema } from "./schema.ts";
export { openMeldSpaceDeletionTombstones } from "./space-deletion-tombstone.schema.ts";
export { openMeldWaitlistEmails } from "./waitlist-email.schema.ts";
