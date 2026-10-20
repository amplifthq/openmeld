// biome-ignore-all lint/performance/noBarrelFile: This subpath entrypoint intentionally re-exports the canonical auth db surface.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getPostgresRequestPool } from "../postgresql.ts";
import { schema as authSchema } from "./schema.ts";

export function createAuthDatabase() {
  return drizzle(getPostgresRequestPool(), { schema: authSchema });
}

export function createAuthCodegenDatabase() {
  // Schema generation has no runtime bindings. This deliberately unreachable
  // loopback endpoint prevents accidental use of environment database defaults.
  return drizzle(
    new pg.Pool({
      connectionString: "postgresql://codegen@127.0.0.1:9/openmeld_codegen",
    }),
    { schema: authSchema }
  );
}

export { accountSidebarPreferences } from "./account-sidebar.schema.ts";
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
  MemberAgentHarnessKind,
  MemberAgentSourceValue,
} from "./member-agent.schema.ts";
export {
  MEMBER_AGENT_HARNESS_KINDS,
  MEMBER_AGENT_SOURCES,
  memberAgents,
  memberAgentsRelations,
} from "./member-agent.schema.ts";
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
