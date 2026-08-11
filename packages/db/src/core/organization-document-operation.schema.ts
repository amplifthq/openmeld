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

export const centerAgentOrganizationDocumentOperations = sqliteTable(
  "center_agent_organization_document_operations",
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
    operationId: text("operation_id").notNull(),
    operationKind: text("operation_kind").notNull(),
    requestSignature: text("request_signature").notNull(),
    targetResourceId: text("target_resource_id").notNull(),
    responseJson: text("response_json"),
    status: text("status").notNull(),
    // These stay nullable and unconstrained during the expand phase because the
    // previous Core writes neither field and may complete a claimed row without
    // clearing it. Current Core treats pending rows without a claim as recoverable.
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_org_document_operations_scope_unique").on(
      table.organizationId,
      table.actorProfileId,
      table.representedUserId,
      table.operationKind,
      table.operationId
    ),
    index("center_agent_org_document_operations_org_updated_idx").on(
      table.organizationId,
      desc(table.updatedAtMs)
    ),
    check(
      "center_agent_org_document_operations_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "center_agent_org_document_operations_operation_id_non_empty_check",
      sql`length(trim("operation_id")) > 0`
    ),
    check(
      "center_agent_org_document_operations_kind_check",
      sql`"operation_kind" in ('create_folder', 'rename_folder', 'move_document', 'save_document')`
    ),
    check(
      "center_agent_org_document_operations_signature_shape_check",
      sql`length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'`
    ),
    check(
      "center_agent_org_document_operations_target_non_empty_check",
      sql`length(trim("target_resource_id")) > 0`
    ),
    check(
      "center_agent_org_document_operations_status_check",
      sql`"status" in ('pending', 'completed')`
    ),
    check(
      "center_agent_org_document_operations_response_check",
      sql`(
        "status" = 'pending' and "response_json" is null
      ) or (
        "status" = 'completed' and "response_json" is not null
      )`
    ),
    check(
      "center_agent_org_document_operations_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
