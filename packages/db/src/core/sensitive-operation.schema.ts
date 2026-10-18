import { sql } from "drizzle-orm";
import { bigint, check, index, text } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { openMeldProfiles } from "../auth/openmeld-profile.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

export const CREDENTIAL_CONFIRMATION_STATUSES = [
  "pending",
  "approved",
  "declined",
  "consumed",
  "expired",
] as const;
export type CredentialConfirmationStatusValue =
  (typeof CREDENTIAL_CONFIRMATION_STATUSES)[number];

export const SENSITIVE_OPERATION_SOURCE_KINDS = [
  "task_credential",
  "web_session",
  "cli_credential",
  "center_agent",
] as const;
export type SensitiveOperationSourceKindValue =
  (typeof SENSITIVE_OPERATION_SOURCE_KINDS)[number];

export const SENSITIVE_OPERATION_OUTCOMES = [
  "succeeded",
  "failed",
  "rejected",
  "confirmation_required",
  "declined",
] as const;
export type SensitiveOperationOutcomeValue =
  (typeof SENSITIVE_OPERATION_OUTCOMES)[number];

/**
 * The owner's confirmation of one sensitive operation made with the CLI
 * credential while a task with another root requester was running
 * (design-plans/member-agent-program.md §4.7 item 3). It is bound to the
 * owner, Organization, operation and request digest, and is used once.
 */
export const sensitiveOperationConfirmations = applicationTable(
  "sensitive_operation_confirmations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    agentProfileId: text("agent_profile_id").references(
      () => openMeldProfiles.profileId,
      { onDelete: "set null" }
    ),
    requestDigest: text("request_digest").notNull(),
    // The root requester of a running task that opened the window, for the
    // owner's card. Null when the window could not be verified.
    blockingRootProfileId: text("blocking_root_profile_id"),
    status: text("status").$type<CredentialConfirmationStatusValue>().notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
    decidedAtMs: bigint("decided_at_ms", { mode: "number" }),
    consumedAtMs: bigint("consumed_at_ms", { mode: "number" }),
  },
  (table) => [
    index("sensitive_operation_confirmations_owner_digest_idx").on(
      table.ownerUserId,
      table.organizationId,
      table.requestDigest
    ),
    check(
      "sensitive_operation_confirmations_status_check",
      sql`"status" in ('pending', 'approved', 'declined', 'consumed', 'expired')`
    ),
    check(
      "sensitive_operation_confirmations_decision_check",
      sql`("status" = 'pending' and "decided_at_ms" is null)
        or ("status" = 'expired')
        or ("status" in ('approved', 'declined', 'consumed') and "decided_at_ms" is not null)`
    ),
    check(
      "sensitive_operation_confirmations_consumed_check",
      sql`("status" = 'consumed') = ("consumed_at_ms" is not null)`
    ),
  ]
);

/**
 * One row per sensitive operation decision (§4.7 item 4). Rows survive the
 * Profile: there is no foreign key on `agent_profile_id`. The owner reads
 * them on the MemberAgent detail path.
 */
export const sensitiveOperationAuditEvents = applicationTable(
  "sensitive_operation_audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull(),
    agentProfileId: text("agent_profile_id"),
    operation: text("operation").notNull(),
    sourceKind: text("source_kind")
      .$type<SensitiveOperationSourceKindValue>()
      .notNull(),
    chainRootProfileId: text("chain_root_profile_id"),
    taskExecutionId: text("task_execution_id"),
    outcome: text("outcome").$type<SensitiveOperationOutcomeValue>().notNull(),
    reasonCode: text("reason_code"),
    confirmationId: text("confirmation_id"),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    index("sensitive_operation_audit_events_profile_idx").on(
      table.agentProfileId,
      table.createdAtMs
    ),
    index("sensitive_operation_audit_events_actor_idx").on(
      table.organizationId,
      table.actorUserId,
      table.createdAtMs
    ),
    check(
      "sensitive_operation_audit_events_source_kind_check",
      sql`"source_kind" in ('task_credential', 'web_session', 'cli_credential', 'center_agent')`
    ),
    check(
      "sensitive_operation_audit_events_outcome_check",
      sql`"outcome" in ('succeeded', 'failed', 'rejected', 'confirmation_required', 'declined')`
    ),
  ]
);
