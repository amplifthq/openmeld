import { accountDeletionRequests } from "./account-deletion.schema.ts";
import { accountSidebarPreferences } from "./account-sidebar.schema.ts";
// biome-ignore lint/performance/noNamespaceImport: Better Auth generated schema has dynamic table exports; namespace merge keeps generation resilient.
import * as authSchema from "./auth.schema.ts";
import { memberAgents, memberAgentsRelations } from "./member-agent.schema.ts";
import {
  openMeldProfiles,
  openMeldProfilesRelations,
} from "./openmeld-profile.schema.ts";
import {
  organizationJoinLinks,
  organizationJoinLinksRelations,
} from "./organization-join-link.schema.ts";
import { openMeldProfileDeletionOutbox } from "./profile-deletion-outbox.schema.ts";
import {
  openMeldProfileSpaceHistory,
  openMeldProfileSpaceHistoryRelations,
} from "./profile-space-history.schema.ts";
import { openMeldSpaceDeletionTombstones } from "./space-deletion-tombstone.schema.ts";
import { openMeldWaitlistEmails } from "./waitlist-email.schema.ts";

export const schema = {
  accountDeletionRequests,
  accountSidebarPreferences,
  ...authSchema,
  memberAgents,
  memberAgentsRelations,
  organizationJoinLinks,
  organizationJoinLinksRelations,
  openMeldProfiles,
  openMeldProfilesRelations,
  openMeldProfileSpaceHistory,
  openMeldProfileSpaceHistoryRelations,
  openMeldProfileDeletionOutbox,
  openMeldSpaceDeletionTombstones,
  openMeldWaitlistEmails,
} as const;
