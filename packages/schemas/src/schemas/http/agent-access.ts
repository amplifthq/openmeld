import * as z from "zod/v4";

// Colleague use of an Agent (design-plans/member-agent-program.md §4.6, §7;
// developing/product/space-collaboration.md, Colleague use of an Agent).
// Requests wait for the Agent owner's consent; grants record it. Gated by
// MEMBER_AGENTS_ENABLED.

const identifierSchema = z.string().trim().min(1).max(256);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const displayNameSchema = z.string().trim().min(1).max(200);

export const AGENT_ACCESS_REQUESTS_ROUTE =
  "/v1/organizations/current/agent-access-requests";
export const AGENT_ACCESS_REQUEST_ROUTE =
  "/v1/organizations/current/agent-access-requests/:requestId";
export const AGENT_ACCESS_REQUEST_DECISION_ROUTE =
  "/v1/organizations/current/agent-access-requests/:requestId/decision";
export const AGENT_ACCESS_REQUEST_WITHDRAW_ROUTE =
  "/v1/organizations/current/agent-access-requests/:requestId/withdraw";
export const SPACE_AGENT_REQUESTS_ROUTE = "/v1/spaces/:spaceId/agent-requests";
export const AGENT_PROFILE_ACCESS_GRANTS_ROUTE =
  "/v1/agent-profiles/:agentProfileId/access-grants";
export const AGENT_PROFILE_ACCESS_GRANT_REVOKE_ROUTE =
  "/v1/agent-profiles/:agentProfileId/access-grants/:grantId/revoke";

export const VIEWER_AGENT_ACCESS_GRANTS_ROUTE =
  "/v1/organizations/current/agent-access-grants/mine";
export const AGENT_ACCESS_PENDING_CODE = "agent_access.pending_owner_consent";
export const AGENT_ACCESS_DECLINED_CODE = "agent_access.declined";
// The `space.meta.changed` reason a Space sends when one of its requests
// opens or closes, so the requester's and the owner's views refetch.
export const AGENT_ACCESS_SPACE_CHANGED_REASON = "space.agent_access.changed";

/**
 * - `direct_message`: a colleague's Direct Message to the owner's Agent.
 * - `external_message`: an identified external user's message to the
 *   owner's Agent in a Space it is in; asked every time.
 * - `space_join`: someone else mentioned or added the owner's Agent in a
 *   Space it is not in.
 */
export const agentAccessRequestKindSchema = z.enum([
  "direct_message",
  "external_message",
  "space_join",
]);
export type AgentAccessRequestKind = z.infer<
  typeof agentAccessRequestKindSchema
>;

export const agentAccessRequestStatusSchema = z.enum([
  "pending",
  "allowed",
  "declined",
  "withdrawn",
  "voided",
  "joined",
  // Retired Reply by DM decision; kept so earlier requests stay readable.
  "replied_by_dm",
  "ignored",
]);
export type AgentAccessRequestStatus = z.infer<
  typeof agentAccessRequestStatusSchema
>;

export const agentAccessGranteeKindSchema = z.enum(["member", "external"]);
export type AgentAccessGranteeKind = z.infer<
  typeof agentAccessGranteeKindSchema
>;

export const agentAccessDecisionSchema = z.enum([
  "allow_once",
  "always_allow",
  "decline",
  "join",
  "ignore",
]);
export type AgentAccessDecision = z.infer<typeof agentAccessDecisionSchema>;

/** The owner's choices for one request. External users are never always allowed. */
export function listAgentAccessDecisions(input: {
  kind: AgentAccessRequestKind;
  requesterKind: AgentAccessGranteeKind;
}): AgentAccessDecision[] {
  if (input.kind === "space_join") {
    // Messaging the requester is a conversation, not a decision: the owner
    // opens their Direct Message and the request stays pending.
    return ["join", "ignore"];
  }
  return input.requesterKind === "external"
    ? ["allow_once", "decline"]
    : ["allow_once", "always_allow", "decline"];
}

/** The status a decision moves a pending request to. */
export function resolveAgentAccessDecisionStatus(
  decision: AgentAccessDecision
): AgentAccessRequestStatus {
  switch (decision) {
    case "allow_once":
    case "always_allow":
      return "allowed";
    case "decline":
      return "declined";
    case "join":
      return "joined";
    case "ignore":
      return "ignored";
    default:
      throw new Error("Unknown Agent access decision");
  }
}

/**
 * The grant a request wrote, as it is now. Consent can be taken back after
 * it was given, so the owner's decision alone does not say whether it still
 * holds.
 */
export const agentAccessRequestGrantViewSchema = z.strictObject({
  status: z.enum(["active", "revoked"]),
  revokedAt: isoDateTimeSchema.nullable(),
});
export type AgentAccessRequestGrantView = z.infer<
  typeof agentAccessRequestGrantViewSchema
>;

export const agentAccessRequestViewSchema = z.strictObject({
  id: identifierSchema,
  kind: agentAccessRequestKindSchema,
  status: agentAccessRequestStatusSchema,
  // The owner's answer; it never changes. Null while pending, and when the
  // request closed without one (withdrawn, or void before an answer).
  decision: agentAccessDecisionSchema.nullable(),
  // Null when the request wrote no grant (not allowed).
  grant: agentAccessRequestGrantViewSchema.nullable(),
  spaceId: identifierSchema,
  sourceSignalId: identifierSchema.nullable(),
  agentProfileId: identifierSchema,
  agentProfileName: displayNameSchema,
  ownerUserId: identifierSchema,
  ownerName: displayNameSchema,
  requesterProfileId: identifierSchema,
  requesterName: displayNameSchema,
  requesterKind: agentAccessGranteeKindSchema,
  createdAt: isoDateTimeSchema,
  decidedAt: isoDateTimeSchema.nullable(),
  // The viewer's relation; only the owner gets decisions.
  viewerRole: z.enum(["owner", "requester"]),
  availableDecisions: z.array(agentAccessDecisionSchema).max(3),
});
export type AgentAccessRequestView = z.infer<
  typeof agentAccessRequestViewSchema
>;

export const listAgentAccessRequestsQuerySchema = z.strictObject({
  spaceId: identifierSchema.optional(),
  role: z.enum(["owner", "requester"]).optional(),
  status: z.literal("pending").optional(),
});
export type ListAgentAccessRequestsQuery = z.infer<
  typeof listAgentAccessRequestsQuerySchema
>;

export const AGENT_ACCESS_REQUEST_LIST_LIMIT = 100;

export const listAgentAccessRequestsResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  requests: z
    .array(agentAccessRequestViewSchema)
    .max(AGENT_ACCESS_REQUEST_LIST_LIMIT),
});
export type ListAgentAccessRequestsResponse = z.infer<
  typeof listAgentAccessRequestsResponseSchema
>;

export const agentAccessRequestRouteParamsSchema = z.strictObject({
  requestId: identifierSchema,
});

export const getAgentAccessRequestResponseSchema = z.strictObject({
  request: agentAccessRequestViewSchema,
});
export type GetAgentAccessRequestResponse = z.infer<
  typeof getAgentAccessRequestResponseSchema
>;

export const decideAgentAccessRequestBodySchema = z.strictObject({
  decision: agentAccessDecisionSchema,
});
export type DecideAgentAccessRequestBody = z.infer<
  typeof decideAgentAccessRequestBodySchema
>;

export const decideAgentAccessRequestResponseSchema = z.strictObject({
  request: agentAccessRequestViewSchema,
});
export type DecideAgentAccessRequestResponse = z.infer<
  typeof decideAgentAccessRequestResponseSchema
>;

export const withdrawAgentAccessRequestResponseSchema = z.strictObject({
  request: agentAccessRequestViewSchema,
});
export type WithdrawAgentAccessRequestResponse = z.infer<
  typeof withdrawAgentAccessRequestResponseSchema
>;

export const spaceAgentRequestRouteParamsSchema = z.strictObject({
  spaceId: identifierSchema,
});

/** Ask the owner to let their Agent join; `signalId` binds the request to a message. */
export const createSpaceAgentRequestBodySchema = z.strictObject({
  agentProfileId: identifierSchema,
  signalId: identifierSchema.optional(),
});
export type CreateSpaceAgentRequestBody = z.infer<
  typeof createSpaceAgentRequestBodySchema
>;

export const createSpaceAgentRequestResponseSchema = z.strictObject({
  request: agentAccessRequestViewSchema,
});
export type CreateSpaceAgentRequestResponse = z.infer<
  typeof createSpaceAgentRequestResponseSchema
>;

export const agentProfileAccessGrantViewSchema = z.strictObject({
  id: identifierSchema,
  profileId: identifierSchema,
  granteeUserId: identifierSchema,
  granteeName: displayNameSchema,
  granteeKind: agentAccessGranteeKindSchema,
  scope: z.enum(["always", "once"]),
  grantedAt: isoDateTimeSchema,
});
export type AgentProfileAccessGrantView = z.infer<
  typeof agentProfileAccessGrantViewSchema
>;

export const agentProfileAccessGrantsRouteParamsSchema = z.strictObject({
  agentProfileId: identifierSchema,
});

/**
 * The owner always allows a member, for example after Allow once. It writes
 * a new standing grant with its own lifecycle; the request that led to it
 * keeps its decision. Members only; an existing active standing grant is
 * returned as it is.
 */
export const createAgentProfileAccessGrantBodySchema = z.strictObject({
  granteeUserId: identifierSchema,
  scope: z.literal("always"),
});
export type CreateAgentProfileAccessGrantBody = z.infer<
  typeof createAgentProfileAccessGrantBodySchema
>;
export const agentProfileAccessGrantRevokeRouteParamsSchema = z.strictObject({
  agentProfileId: identifierSchema,
  grantId: identifierSchema,
});

export const AGENT_PROFILE_ACCESS_GRANT_LIST_LIMIT = 200;

export const listAgentProfileAccessGrantsResponseSchema = z.strictObject({
  profileId: identifierSchema,
  grants: z
    .array(agentProfileAccessGrantViewSchema)
    .max(AGENT_PROFILE_ACCESS_GRANT_LIST_LIMIT),
});
export type ListAgentProfileAccessGrantsResponse = z.infer<
  typeof listAgentProfileAccessGrantsResponseSchema
>;

export const createAgentProfileAccessGrantResponseSchema = z.strictObject({
  grant: agentProfileAccessGrantViewSchema,
  // False when an active standing grant already existed.
  created: z.boolean(),
});
export type CreateAgentProfileAccessGrantResponse = z.infer<
  typeof createAgentProfileAccessGrantResponseSchema
>;

export const revokeAgentProfileAccessGrantResponseSchema = z.strictObject({
  grantId: identifierSchema,
  revokedAt: isoDateTimeSchema,
});
export type RevokeAgentProfileAccessGrantResponse = z.infer<
  typeof revokeAgentProfileAccessGrantResponseSchema
>;

/**
 * The signed-in member's own standing grants: colleagues' Agents they may
 * start work with without asking. One-chat grants stay out; they cover a
 * single conversation, not the Agent.
 */
export const viewerAgentAccessGrantViewSchema = z.strictObject({
  profileId: identifierSchema,
  grantedAt: isoDateTimeSchema,
});
export type ViewerAgentAccessGrantView = z.infer<
  typeof viewerAgentAccessGrantViewSchema
>;

export const listViewerAgentAccessGrantsResponseSchema = z.strictObject({
  organizationId: identifierSchema,
  grants: z
    .array(viewerAgentAccessGrantViewSchema)
    .max(AGENT_PROFILE_ACCESS_GRANT_LIST_LIMIT),
});
export type ListViewerAgentAccessGrantsResponse = z.infer<
  typeof listViewerAgentAccessGrantsResponseSchema
>;
