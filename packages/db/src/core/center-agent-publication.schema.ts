import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { openMeldProfiles } from "../auth/openmeld-profile.schema.ts";

export const centerAgentPublicationOperations = sqliteTable(
  "center_agent_publication_operations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    representedUserId: text("represented_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceRevision: text("source_revision").notNull(),
    destinationKind: text("destination_kind").notNull(),
    destinationId: text("destination_id").notNull(),
    requestSignature: text("request_signature").notNull(),
    status: text("status").notNull(),
    responseJson: text("response_json"),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_publication_operations_scope_unique").on(
      table.organizationId,
      table.actorProfileId,
      table.sourceKind,
      table.sourceId,
      table.sourceRevision,
      table.destinationKind,
      table.destinationId
    ),
    index("center_agent_publication_operations_org_updated_idx").on(
      table.organizationId,
      desc(table.updatedAtMs)
    ),
    check(
      "center_agent_publication_operations_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "center_agent_publication_operations_source_kind_check",
      sql`"source_kind" in ('organization_document', 'remote_agent_execution', 'routine_run')`
    ),
    check(
      "center_agent_publication_operations_source_id_non_empty_check",
      sql`length(trim("source_id")) > 0`
    ),
    check(
      "center_agent_publication_operations_source_revision_shape_check",
      sql`length("source_revision") = 64
        and "source_revision" not glob '*[^0-9a-f]*'`
    ),
    check(
      "center_agent_publication_operations_destination_kind_check",
      sql`"destination_kind" in ('slack_channel')`
    ),
    check(
      "center_agent_publication_operations_destination_id_non_empty_check",
      sql`length(trim("destination_id")) > 0`
    ),
    check(
      "center_agent_publication_operations_signature_shape_check",
      sql`length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'`
    ),
    check(
      "center_agent_publication_operations_status_check",
      sql`"status" in ('pending', 'completed', 'failed', 'outcome_unknown')`
    ),
    check(
      "center_agent_publication_operations_state_check",
      sql`(
        "status" = 'pending'
        and "response_json" is null
        and "claim_id" is not null
        and "claim_expires_at_ms" is not null
      ) or (
        "status" = 'completed'
        and "response_json" is not null
        and "claim_id" is null
        and "claim_expires_at_ms" is null
      ) or (
        "status" in ('failed', 'outcome_unknown')
        and "response_json" is null
        and "claim_id" is null
        and "claim_expires_at_ms" is null
      )`
    ),
    check(
      "center_agent_publication_operations_claim_expiry_check",
      sql`"claim_expires_at_ms" is null
        or "claim_expires_at_ms" > "updated_at_ms"`
    ),
    check(
      "center_agent_publication_operations_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
