import * as z from "zod/v4";
import { harnessKindSchema } from "../daemon/harness-kind";

const identifierSchema = z.string().trim().min(1);

export const MEMBER_AGENT_NOT_FOUND_CODE = "member_agent.not_found";

// `GET /v1/member-agents/:memberAgentId/profiles` (Auth). Any member of the
// current Organization resolves a MemberAgent link here, not only its owner.
export function buildMemberAgentProfilesRoute(memberAgentId: string): string {
  return `/v1/member-agents/${encodeURIComponent(memberAgentId)}/profiles`;
}

// The Profiles of one MemberAgent that the caller can see. Visibility follows
// All Agents: active Agent Profiles of the current Organization. A
// MemberAgent of another Organization reads as not found.
export const resolveMemberAgentProfilesResponseSchema = z.strictObject({
  ok: z.literal(true),
  organizationId: identifierSchema,
  memberAgentId: identifierSchema,
  ownerUserId: identifierSchema,
  harnessKind: harnessKindSchema,
  // Null while the MemberAgent has no default or the caller cannot see it.
  defaultProfileId: identifierSchema.nullable(),
  // Oldest first.
  profileIds: z.array(identifierSchema),
});
export type ResolveMemberAgentProfilesResponse = z.infer<
  typeof resolveMemberAgentProfilesResponseSchema
>;
