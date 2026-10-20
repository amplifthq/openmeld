import { sql } from "drizzle-orm";
import { bigint, check, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { memberAgents } from "../auth/member-agent.schema.ts";
import { openMeldProfiles } from "../auth/openmeld-profile.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

export const AGENT_ACCESS_REQUEST_KINDS = [
  "direct_message",
  "external_message",
  "space_join",
] as const;
export type AgentAccessRequestKindValue =
  (typeof AGENT_ACCESS_REQUEST_KINDS)[number];

export const AGENT_ACCESS_REQUEST_STATUSES = [
  "pending",
  "allowed",
  "declined",
  "withdrawn",
  "voided",
  "joined",
  "replied_by_dm",
  "ignored",
] as const;
export type AgentAccessRequestStatusValue =
  (typeof AGENT_ACCESS_REQUEST_STATUSES)[number];

export const AGENT_ACCESS_DECISIONS = [
  "allow_once",
  "always_allow",
  "decline",
  "join",
  "ignore",
] as const;
export type AgentAccessDecisionValue = (typeof AGENT_ACCESS_DECISIONS)[number];

export const AGENT_ACCESS_GRANTEE_KINDS = ["member", "external"] as const;
export type AgentAccessGranteeKindValue =
  (typeof AGENT_ACCESS_GRANTEE_KINDS)[number];

/**
 * A request for an Agent owner's consent (developing/product/inbox.md, Agent
 * owner requests). The Space that holds the Wake writes it; only the owner
 * decides it, once, from `pending`. The Space then applies the decision and
 * records `applied_at_ms`. `decision` is the owner's answer and never
 * changes; `status` is where the request is now, and a grant written from it
 * keeps its own lifecycle (revoked or not).
 */
export const agentAccessRequests = applicationTable(
  "agent_access_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AgentAccessRequestKindValue>().notNull(),
    spaceId: text("space_id").notNull(),
    // The bound message. Absent only for an Add-members request.
    sourceSignalId: text("source_signal_id"),
    agentProfileId: text("agent_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    // Null for a personal Agent Profile not yet assigned to a MemberAgent.
    memberAgentId: text("member_agent_id").references(() => memberAgents.id, {
      onDelete: "cascade",
    }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requesterProfileId: text("requester_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    requesterKind: text("requester_kind")
      .$type<AgentAccessGranteeKindValue>()
      .notNull(),
    status: text("status").$type<AgentAccessRequestStatusValue>().notNull(),
    // Null while pending, and for a request closed without an owner answer.
    decision: text("decision").$type<AgentAccessDecisionValue>(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    decidedAtMs: bigint("decided_at_ms", { mode: "number" }),
    decidedByUserId: text("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    appliedAtMs: bigint("applied_at_ms", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("agent_access_requests_message_target_uq_idx")
      .on(table.spaceId, table.sourceSignalId, table.agentProfileId)
      .where(sql`${table.sourceSignalId} is not null`),
    index("agent_access_requests_owner_status_idx").on(
      table.ownerUserId,
      table.status
    ),
    index("agent_access_requests_requester_status_idx").on(
      table.requesterUserId,
      table.status
    ),
    index("agent_access_requests_space_idx").on(table.spaceId, table.status),
    check(
      "agent_access_requests_kind_check",
      sql`"kind" in ('direct_message', 'external_message', 'space_join')`
    ),
    check(
      "agent_access_requests_status_check",
      sql`"status" in ('pending', 'allowed', 'declined', 'withdrawn', 'voided', 'joined', 'replied_by_dm', 'ignored')`
    ),
    check(
      "agent_access_requests_requester_kind_check",
      sql`"requester_kind" in ('member', 'external')`
    ),
    check(
      "agent_access_requests_identity_check",
      sql`length(trim("id")) > 0 and length(trim("space_id")) > 0
        and "requester_user_id" <> "owner_user_id"`
    ),
    // Only a held message has a Wake to release; a Space join needs a member.
    check(
      "agent_access_requests_shape_check",
      sql`("kind" = 'space_join' and "requester_kind" = 'member')
        or ("kind" = 'direct_message' and "source_signal_id" is not null)
        or ("kind" = 'external_message' and "requester_kind" = 'external'
          and "source_signal_id" is not null)`
    ),
    check(
      "agent_access_requests_decision_check",
      sql`("status" = 'pending' and "decided_at_ms" is null and "applied_at_ms" is null)
        or ("status" <> 'pending' and "decided_at_ms" is not null)`
    ),
    // An owner answer is one of the decisions and agrees with the status it
    // moved the request to; a void request keeps the answer it had.
    check(
      "agent_access_requests_owner_decision_check",
      sql`("decision" is null and "status" in ('pending', 'withdrawn', 'voided', 'replied_by_dm'))
        or ("decision" in ('allow_once', 'always_allow') and "status" in ('allowed', 'voided'))
        or ("decision" = 'decline' and "status" = 'declined')
        or ("decision" = 'join' and "status" in ('joined', 'voided'))
        or ("decision" = 'ignore' and "status" = 'ignored')`
    ),
  ]
);

/**
 * Consent an Agent owner gave a colleague or identified external user for
 * one Agent Profile. `always` is a standing grant for members only; `once`
 * covers the Session (Direct Message) or message of one request. Revoking
 * stops new tasks; running ones finish.
 */
export const agentProfileAccessGrants = applicationTable(
  "agent_profile_access_grants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    granteeUserId: text("grantee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    granteeKind: text("grantee_kind")
      .$type<AgentAccessGranteeKindValue>()
      .notNull(),
    scope: text("scope").$type<"always" | "once">().notNull(),
    requestId: text("request_id").references(() => agentAccessRequests.id, {
      onDelete: "cascade",
    }),
    // A `once` grant's Session or message.
    spaceId: text("space_id"),
    sourceSignalId: text("source_signal_id"),
    grantedByUserId: text("granted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedAtMs: bigint("granted_at_ms", { mode: "number" }).notNull(),
    revokedAtMs: bigint("revoked_at_ms", { mode: "number" }),
    revokedByUserId: text("revoked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("agent_profile_access_grants_active_always_uq_idx")
      .on(table.profileId, table.granteeUserId)
      .where(sql`${table.scope} = 'always' and ${table.revokedAtMs} is null`),
    uniqueIndex("agent_profile_access_grants_request_uq_idx")
      .on(table.requestId)
      .where(sql`${table.requestId} is not null`),
    index("agent_profile_access_grants_grantee_idx").on(
      table.granteeUserId,
      table.profileId
    ),
    index("agent_profile_access_grants_profile_idx").on(table.profileId),
    check(
      "agent_profile_access_grants_kind_check",
      sql`"grantee_kind" in ('member', 'external') and "scope" in ('always', 'once')`
    ),
    // External users are asked every time: never a standing grant.
    check(
      "agent_profile_access_grants_external_once_check",
      sql`"grantee_kind" = 'member' or "scope" = 'once'`
    ),
    check(
      "agent_profile_access_grants_once_shape_check",
      sql`"scope" = 'always' or ("request_id" is not null and "space_id" is not null)`
    ),
    check(
      "agent_profile_access_grants_revoked_check",
      sql`"revoked_at_ms" is null or "revoked_at_ms" >= "granted_at_ms"`
    ),
  ]
);
