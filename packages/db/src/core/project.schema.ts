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

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    repositoryFingerprint: text("repository_fingerprint"),
    repositoryUrl: text("repository_url"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    archivedAtMs: integer("archived_at_ms"),
  },
  (table) => [
    uniqueIndex("projects_org_slug_unique")
      .on(table.organizationId, table.slug)
      .where(sql`"archived_at_ms" is null`),
    index("projects_org_archived_updated_idx").on(
      table.organizationId,
      table.archivedAtMs,
      desc(table.updatedAtMs)
    ),
    index("projects_repository_fingerprint_idx").on(
      table.repositoryFingerprint
    ),
    check("projects_id_non_empty_check", sql`length(trim("id")) > 0`),
    check(
      "projects_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check("projects_name_non_empty_check", sql`length(trim("name")) > 0`),
    check(
      "projects_slug_shape_check",
      sql`length("slug") > 0
        and "slug" = lower("slug")
        and "slug" not glob '*[^a-z0-9-]*'
        and "slug" not like '-%'
        and "slug" not like '%-'
        and "slug" not like '%--%'`
    ),
    check(
      "projects_repository_fingerprint_shape_check",
      sql`"repository_fingerprint" is null or (
        length("repository_fingerprint") = 71
        and substr("repository_fingerprint", 1, 7) = 'sha256:'
        and substr("repository_fingerprint", 8) not glob '*[^0-9a-f]*'
      )`
    ),
    check(
      "projects_repository_url_shape_check",
      sql`"repository_url" is null or (
        "repository_url" like 'https://%'
        and "repository_url" not like '%@%'
        and "repository_url" not like '%?%'
        and "repository_url" not like '%#%'
      )`
    ),
    check(
      "projects_creator_non_empty_check",
      sql`length(trim("created_by_user_id")) > 0`
    ),
    check(
      "projects_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
    check(
      "projects_archived_at_valid_check",
      sql`"archived_at_ms" is null or "archived_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const centerAgentProjectOperations = sqliteTable(
  "center_agent_project_operations",
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
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_project_operations_scope_unique").on(
      table.organizationId,
      table.actorProfileId,
      table.representedUserId,
      table.operationKind,
      table.operationId
    ),
    index("center_agent_project_operations_org_updated_idx").on(
      table.organizationId,
      desc(table.updatedAtMs)
    ),
    check(
      "center_agent_project_operations_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "center_agent_project_operations_operation_id_non_empty_check",
      sql`length(trim("operation_id")) > 0`
    ),
    check(
      "center_agent_project_operations_kind_check",
      sql`"operation_kind" in (
        'create_project',
        'update_project',
        'set_agent_profile_default_project',
        'remove_project'
      )`
    ),
    check(
      "center_agent_project_operations_signature_shape_check",
      sql`length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'`
    ),
    check(
      "center_agent_project_operations_target_non_empty_check",
      sql`length(trim("target_resource_id")) > 0`
    ),
    check(
      "center_agent_project_operations_status_check",
      sql`"status" in ('pending', 'completed')`
    ),
    check(
      "center_agent_project_operations_response_check",
      sql`(
        "status" = 'pending' and "response_json" is null
      ) or (
        "status" = 'completed' and "response_json" is not null
      )`
    ),
    check(
      "center_agent_project_operations_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const centerAgentProjectRemoveConfirmations = sqliteTable(
  "center_agent_project_remove_confirmations",
  {
    tokenHash: text("token_hash").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    representedUserId: text("represented_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    representedProfileId: text("represented_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectUpdatedAtMs: integer("project_updated_at_ms").notNull(),
    preparedRequestId: text("prepared_request_id").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    consumedAtMs: integer("consumed_at_ms"),
    consumedOperationId: text("consumed_operation_id"),
  },
  (table) => [
    index("center_agent_project_remove_confirmations_org_expiry_idx").on(
      table.organizationId,
      table.expiresAtMs
    ),
    index("center_agent_project_remove_confirmations_project_idx").on(
      table.projectId
    ),
    check(
      "center_agent_project_remove_confirmations_token_shape_check",
      sql`length("token_hash") = 64
        and "token_hash" not glob '*[^0-9a-f]*'`
    ),
    check(
      "center_agent_project_remove_confirmations_request_non_empty_check",
      sql`length(trim("prepared_request_id")) > 0`
    ),
    check(
      "center_agent_project_remove_confirmations_expiry_check",
      sql`"expires_at_ms" > "created_at_ms"`
    ),
    check(
      "center_agent_project_remove_confirmations_consumed_check",
      sql`(
        "consumed_at_ms" is null and "consumed_operation_id" is null
      ) or (
        "consumed_at_ms" is not null
        and "consumed_operation_id" is not null
        and length(trim("consumed_operation_id")) > 0
      )`
    ),
  ]
);
