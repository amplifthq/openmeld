import * as z from "zod/v4";
import { harnessKindSchema } from "../daemon/harness-kind";

// Release decision for the MemberAgent program (design-plans/member-agent-program.md).
// Every MemberAgent read surface checks this flag. It is on; it can be turned
// off again without a migration.
export const MEMBER_AGENTS_ENABLED: boolean = true;

export const MEMBER_AGENTS_DISABLED_CODE = "member_agents.disabled";
export const MEMBER_AGENTS_DISABLED_MESSAGE =
  "Agents grouped by harness are not available yet.";

const identifierSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const memberAgentSourceSchema = z.enum([
  "detected",
  "migrated",
  "manual",
]);
export type MemberAgentSource = z.infer<typeof memberAgentSourceSchema>;

// Read projection of one persisted MemberAgent. State is derived elsewhere;
// the row has no status.
export const memberAgentSchema = z.strictObject({
  id: identifierSchema,
  organizationId: identifierSchema,
  ownerUserId: identifierSchema,
  harnessKind: harnessKindSchema,
  defaultProfileId: identifierSchema.nullable(),
  source: memberAgentSourceSchema,
  archivedAt: isoDateTimeSchema.nullable(),
});
export type MemberAgent = z.infer<typeof memberAgentSchema>;

export const memberAgentProfileSummarySchema = z.strictObject({
  openMeldProfileId: identifierSchema,
  profileName: z.string().min(1),
  // True only for the MemberAgent's default Profile.
  isDefault: z.boolean(),
});
export type MemberAgentProfileSummary = z.infer<
  typeof memberAgentProfileSummarySchema
>;

export const unassignedAgentProfileSummarySchema = z.strictObject({
  openMeldProfileId: identifierSchema,
  profileName: z.string().min(1),
});

export const memberAgentWithProfilesSchema = memberAgentSchema.extend({
  profiles: z.array(memberAgentProfileSummarySchema),
});
export type MemberAgentWithProfiles = z.infer<
  typeof memberAgentWithProfilesSchema
>;

export const listMemberAgentsResponseSchema = z.strictObject({
  ok: z.literal(true),
  organizationId: identifierSchema,
  memberAgents: z.array(memberAgentWithProfilesSchema),
  unassignedProfiles: z.array(unassignedAgentProfileSummarySchema),
});
export type ListMemberAgentsResponse = z.infer<
  typeof listMemberAgentsResponseSchema
>;
