import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { members, organizations, users } from "../auth/auth.schema.ts";

export const connectorConnections = sqliteTable(
  "connector_connections",
  {
    connectionName: text("connection_name").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").default("member").notNull(),
    service: text("service").notNull(),
    status: text("status").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    disconnectedAtMs: integer("disconnected_at_ms"),
  },
  (table) => [
    uniqueIndex("connector_connections_org_scope_user_service_unique").on(
      table.organizationId,
      table.scope,
      table.userId,
      table.service
    ),
    uniqueIndex("connector_connections_org_shared_service_unique")
      .on(table.organizationId, table.service)
      .where(sql`"scope" = 'shared'`),
    index("connector_connections_org_service_status_idx").on(
      table.organizationId,
      table.service,
      table.status
    ),
    check(
      "connector_connections_name_format_check",
      sql`length("connection_name") between 1 and 64 and "connection_name" glob '[A-Za-z0-9]*' and "connection_name" not glob '*[^A-Za-z0-9_-]*'`
    ),
    check(
      "connector_connections_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "connector_connections_user_non_empty_check",
      sql`length(trim("user_id")) > 0`
    ),
    check(
      "connector_connections_scope_check",
      sql`"scope" in ('member', 'shared')`
    ),
    check(
      "connector_connections_service_check",
      sql`"service" in (
        'github',
        'feishu',
        'lark',
        'gmail',
        'googlecalendar',
        'googledrive',
        'notion',
        'linear',
        'figma',
        'posthog',
        'cloudflare_browser_rendering',
        'cloudflare_dns',
        'cloudflare_r2',
        'cloudflare_worker'
      )`
    ),
    check(
      "connector_connections_status_check",
      sql`"status" in ('pending', 'active', 'disconnected')`
    ),
    check(
      "connector_connections_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
    check(
      "connector_connections_disconnected_at_valid_check",
      sql`("status" = 'disconnected' and "disconnected_at_ms" is not null) or ("status" != 'disconnected' and "disconnected_at_ms" is null)`
    ),
  ]
);

export const connectorAppRequests = sqliteTable(
  "connector_app_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requesterMemberId: text("requester_member_id").references(
      () => members.id,
      { onDelete: "set null" }
    ),
    providerKey: text("provider_key").notNull(),
    providerId: text("provider_id"),
    providerName: text("provider_name").notNull(),
    requestedCapabilities: text("requested_capabilities")
      .default("[]")
      .notNull(),
    useCase: text("use_case"),
    source: text("source").notNull(),
    status: text("status").default("requested").notNull(),
    availableAtMs: integer("available_at_ms"),
    notifiedAtMs: integer("notified_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("connector_app_requests_org_requester_provider_unique").on(
      table.organizationId,
      table.requesterUserId,
      table.providerKey
    ),
    index("connector_app_requests_status_created_idx").on(
      table.status,
      table.createdAtMs
    ),
    index("connector_app_requests_requester_created_idx").on(
      table.organizationId,
      table.requesterUserId,
      table.createdAtMs
    ),
    check(
      "connector_app_requests_provider_key_non_empty_check",
      sql`length(trim("provider_key")) between 1 and 160`
    ),
    check(
      "connector_app_requests_provider_id_length_check",
      sql`"provider_id" is null or length(trim("provider_id")) between 1 and 160`
    ),
    check(
      "connector_app_requests_provider_name_length_check",
      sql`length(trim("provider_name")) between 1 and 120`
    ),
    check(
      "connector_app_requests_capabilities_length_check",
      sql`length("requested_capabilities") between 2 and 2000 and json_valid("requested_capabilities") and json_type("requested_capabilities") = 'array'`
    ),
    check(
      "connector_app_requests_use_case_length_check",
      sql`"use_case" is null or length("use_case") between 1 and 2000`
    ),
    check(
      "connector_app_requests_source_check",
      sql`"source" in ('openconnector_catalog', 'freeform')`
    ),
    check(
      "connector_app_requests_source_provider_check",
      sql`("source" = 'openconnector_catalog' and "provider_id" is not null) or ("source" = 'freeform' and "provider_id" is null)`
    ),
    check(
      "connector_app_requests_status_check",
      sql`"status" in ('requested', 'available', 'declined')`
    ),
    check(
      "connector_app_requests_available_at_check",
      sql`("status" = 'available' and "available_at_ms" is not null) or ("status" != 'available')`
    ),
    check(
      "connector_app_requests_notified_at_check",
      sql`"notified_at_ms" is null or "available_at_ms" is not null`
    ),
    check(
      "connector_app_requests_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);

export const githubAppInstallationStates = sqliteTable(
  "github_app_installation_states",
  {
    stateDigest: text("state_digest").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id").notNull(),
    targetConnectionName: text("target_connection_name")
      .notNull()
      .references(() => connectorConnections.connectionName, {
        onDelete: "cascade",
      }),
    verificationConnectionName: text("verification_connection_name"),
    installationId: text("installation_id"),
    status: text("status").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("github_app_installation_states_org_user_status_idx").on(
      table.organizationId,
      table.userId,
      table.status
    ),
    index("github_app_installation_states_expires_idx").on(table.expiresAtMs),
    check(
      "github_app_installation_states_digest_non_empty_check",
      sql`length(trim("state_digest")) > 0`
    ),
    check(
      "github_app_installation_states_actor_non_empty_check",
      sql`length(trim("actor_profile_id")) > 0`
    ),
    check(
      "github_app_installation_states_target_name_check",
      sql`length("target_connection_name") between 1 and 64 and "target_connection_name" glob '[A-Za-z0-9]*' and "target_connection_name" not glob '*[^A-Za-z0-9_-]*'`
    ),
    check(
      "github_app_installation_states_verifier_name_check",
      sql`"verification_connection_name" is null or (length("verification_connection_name") between 1 and 64 and "verification_connection_name" glob '[A-Za-z0-9]*' and "verification_connection_name" not glob '*[^A-Za-z0-9_-]*')`
    ),
    check(
      "github_app_installation_states_installation_id_check",
      sql`"installation_id" is null or ("installation_id" glob '[1-9]*' and "installation_id" not glob '*[^0-9]*')`
    ),
    check(
      "github_app_installation_states_status_check",
      sql`"status" in ('installing', 'verifying', 'completed')`
    ),
    check(
      "github_app_installation_states_shape_check",
      sql`(
        ("status" = 'installing' and "installation_id" is null and "verification_connection_name" is null)
        or ("status" in ('verifying', 'completed') and "installation_id" is not null and "verification_connection_name" is not null)
      )`
    ),
    check(
      "github_app_installation_states_expiry_valid_check",
      sql`"expires_at_ms" > "created_at_ms"`
    ),
    check(
      "github_app_installation_states_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
