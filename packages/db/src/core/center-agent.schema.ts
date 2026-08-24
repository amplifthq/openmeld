import { sql } from "drizzle-orm";
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

export const centerAgentDesignations = sqliteTable(
  "center_agent_designations",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentProfileId: text("agent_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    duty: text("duty"),
    designatedBy: text("designated_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operatingState: text("operating_state").default("active").notNull(),
    pausedAt: integer("paused_at", { mode: "timestamp_ms" }),
    pausedByUserId: text("paused_by_user_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_designations_org_uq_idx").on(
      table.organizationId
    ),
    index("center_agent_designations_agent_profile_idx").on(
      table.agentProfileId
    ),
    index("center_agent_designations_designated_by_idx").on(table.designatedBy),
    check(
      "center_agent_designations_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "center_agent_designations_agent_profile_non_empty_check",
      sql`length(trim("agent_profile_id")) > 0`
    ),
    check(
      "center_agent_designations_designated_by_non_empty_check",
      sql`length(trim("designated_by")) > 0`
    ),
    check(
      "center_agent_designations_operating_state_check",
      sql`"operating_state" in ('active', 'paused')`
    ),
    check(
      "center_agent_designations_pause_state_check",
      sql`(
        ("operating_state" = 'active' and "paused_at" is null and "paused_by_user_id" is null)
        or
        ("operating_state" = 'paused' and "paused_at" is not null and "paused_by_user_id" is not null)
      )`
    ),
    check("center_agent_designations_mvp_duty_null_check", sql`"duty" is null`),
  ]
);

export const centerAgentAuditJournal = sqliteTable(
  "center_agent_audit_journal",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    action: text("action").notNull(),
    onBehalfOfProfileId: text("on_behalf_of_profile_id").references(
      () => openMeldProfiles.profileId,
      { onDelete: "set null" }
    ),
    onBehalfOfUserId: text("on_behalf_of_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    onBehalfOfDisplayName: text("on_behalf_of_display_name"),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    sourceNativeDeliveryId: text("source_native_delivery_id"),
    sourceSpaceId: text("source_space_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("center_agent_audit_journal_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("center_agent_audit_journal_actor_created_idx").on(
      table.actorProfileId,
      table.createdAt
    ),
    index("center_agent_audit_journal_on_behalf_profile_idx").on(
      table.onBehalfOfProfileId
    ),
    index("center_agent_audit_journal_source_native_delivery_idx").on(
      table.sourceNativeDeliveryId
    ),
    check(
      "center_agent_audit_journal_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "center_agent_audit_journal_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "center_agent_audit_journal_actor_profile_non_empty_check",
      sql`length(trim("actor_profile_id")) > 0`
    ),
    check(
      "center_agent_audit_journal_action_non_empty_check",
      sql`length(trim("action")) > 0`
    ),
  ]
);

export const centerAgentContextManifests = sqliteTable(
  "center_agent_context_manifests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestedByProfileId: text("requested_by_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    conversationSpaceId: text("conversation_space_id").notNull(),
    clientName: text("client_name").notNull(),
    view: text("view").notNull(),
    schemaVersion: text("schema_version").notNull(),
    requestedTokenBudget: integer("requested_token_budget").notNull(),
    estimatedTokenCount: integer("estimated_token_count").notNull(),
    includedMessageCount: integer("included_message_count").notNull(),
    truncated: integer("truncated", { mode: "boolean" }).notNull(),
    truncationReasonsJson: text("truncation_reasons_json").notNull(),
    continuationCursor: text("continuation_cursor"),
    sourceRefsJson: text("source_refs_json").notNull(),
    auditEntryId: text("audit_entry_id")
      .notNull()
      .references(() => centerAgentAuditJournal.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_context_manifests_audit_uq_idx").on(
      table.auditEntryId
    ),
    index("center_agent_context_manifests_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("center_agent_context_manifests_requester_created_idx").on(
      table.requestedByProfileId,
      table.createdAt
    ),
    index("center_agent_context_manifests_conversation_created_idx").on(
      table.conversationSpaceId,
      table.createdAt
    ),
    check(
      "center_agent_context_manifests_identity_non_empty_check",
      sql`length(trim("id")) > 0 and length(trim("conversation_space_id")) > 0 and length(trim("client_name")) > 0 and length(trim("audit_entry_id")) > 0`
    ),
    check(
      "center_agent_context_manifests_view_check",
      sql`"view" = 'messages'`
    ),
    check(
      "center_agent_context_manifests_schema_version_check",
      sql`"schema_version" = 'center_agent_context_manifest.v1'`
    ),
    check(
      "center_agent_context_manifests_budget_check",
      sql`"requested_token_budget" between 256 and 32768 and "estimated_token_count" >= 0 and "included_message_count" between 0 and 50`
    ),
    check(
      "center_agent_context_manifests_json_check",
      sql`json_valid("truncation_reasons_json") and json_type("truncation_reasons_json") = 'array' and json_valid("source_refs_json") and json_type("source_refs_json") = 'array'`
    ),
  ]
);

export const centerAgentContextManifestMaterializations = sqliteTable(
  "center_agent_context_manifest_materializations",
  {
    manifestId: text("manifest_id")
      .primaryKey()
      .references(() => centerAgentContextManifests.id, {
        onDelete: "cascade",
      }),
    entriesJson: text("entries_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  () => [
    check(
      "center_agent_context_manifest_materializations_manifest_non_empty_check",
      sql`length(trim("manifest_id")) > 0`
    ),
    check(
      "center_agent_context_manifest_materializations_json_check",
      sql`json_valid("entries_json") and json_type("entries_json") = 'array'`
    ),
  ]
);

export const centerAgentContextLoadReceipts = sqliteTable(
  "center_agent_context_load_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    manifestId: text("manifest_id")
      .notNull()
      .references(() => centerAgentContextManifests.id, {
        onDelete: "cascade",
      }),
    requestedByProfileId: text("requested_by_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    clientName: text("client_name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    selectedEntriesJson: text("selected_entries_json").notNull(),
    estimatedTokenCount: integer("estimated_token_count").notNull(),
    includedMessageCount: integer("included_message_count").notNull(),
    auditEntryId: text("audit_entry_id")
      .notNull()
      .references(() => centerAgentAuditJournal.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_context_load_receipts_manifest_uq_idx").on(
      table.manifestId
    ),
    uniqueIndex("center_agent_context_load_receipts_audit_uq_idx").on(
      table.auditEntryId
    ),
    index("center_agent_context_load_receipts_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("center_agent_context_load_receipts_requester_created_idx").on(
      table.requestedByProfileId,
      table.createdAt
    ),
    check(
      "center_agent_context_load_receipts_identity_non_empty_check",
      sql`length(trim("id")) > 0 and length(trim("manifest_id")) > 0 and length(trim("client_name")) > 0 and length(trim("audit_entry_id")) > 0`
    ),
    check(
      "center_agent_context_load_receipts_schema_version_check",
      sql`"schema_version" = 'center_agent_context_load_receipt.v1'`
    ),
    check(
      "center_agent_context_load_receipts_budget_check",
      sql`"estimated_token_count" >= 0 and "included_message_count" between 1 and 50`
    ),
    check(
      "center_agent_context_load_receipts_json_check",
      sql`json_valid("selected_entries_json") and json_type("selected_entries_json") = 'array'`
    ),
  ]
);

export const centerAgentAttentionRequests = sqliteTable(
  "center_agent_attention_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    triggerSignalId: text("trigger_signal_id").notNull(),
    sourceNativeDeliveryId: text("source_native_delivery_id").notNull(),
    submissionId: text("submission_id").notNull(),
    impact: text("impact").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").default("open").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    resolvedAtMs: integer("resolved_at_ms"),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_attention_requests_submission_unique").on(
      table.submissionId
    ),
    index("center_agent_attention_requests_open_recipient_idx").on(
      table.organizationId,
      table.recipientUserId,
      table.spaceId,
      table.status
    ),
    check(
      "center_agent_attention_requests_identity_non_empty_check",
      sql`length(trim("id")) > 0 and length(trim("space_id")) > 0 and length(trim("trigger_signal_id")) > 0 and length(trim("source_native_delivery_id")) > 0 and length(trim("submission_id")) > 0`
    ),
    check(
      "center_agent_attention_requests_impact_check",
      sql`"impact" in ('response_needed', 'work_blocked', 'material_failure_risk')`
    ),
    check(
      "center_agent_attention_requests_status_check",
      sql`("status" = 'open' and "resolved_at_ms" is null) or ("status" = 'resolved' and "resolved_at_ms" is not null)`
    ),
    check(
      "center_agent_attention_requests_copy_check",
      sql`length(trim("title")) between 1 and 160 and length(trim("prompt")) between 1 and 500`
    ),
    check(
      "center_agent_attention_requests_timestamps_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("resolved_at_ms" is null or "resolved_at_ms" >= "created_at_ms")`
    ),
  ]
);

export const centerAgentConnectorActionOperations = sqliteTable(
  "center_agent_connector_action_operations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    requesterAttributionKey: text("requester_attribution_key").notNull(),
    representedUserId: text("represented_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    sourceNativeDeliveryId: text("source_native_delivery_id"),
    operationId: text("operation_id").notNull(),
    requestSignature: text("request_signature").notNull(),
    service: text("service").notNull(),
    actionId: text("action_id").notNull(),
    connectionName: text("connection_name").notNull(),
    connectionOwnerDisplayName: text("connection_owner_display_name"),
    connectionOwnerUserId: text("connection_owner_user_id"),
    connectionScope: text("connection_scope"),
    status: text("status").notNull(),
    providerExecutionId: text("provider_execution_id"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_connector_action_operations_scope_unique").on(
      table.organizationId,
      table.actorProfileId,
      table.requesterAttributionKey,
      table.operationId
    ),
    index("center_agent_connector_action_operations_org_updated_idx").on(
      table.organizationId,
      table.updatedAtMs
    ),
    check(
      "center_agent_connector_action_operations_requester_attribution_check",
      sql`(
        "represented_user_id" is not null
        and "source_native_delivery_id" is null
        and "requester_attribution_key" = 'user:' || "represented_user_id"
      ) or (
        "represented_user_id" is null
        and "source_native_delivery_id" is not null
        and "requester_attribution_key" = 'delivery:' || "source_native_delivery_id"
      )`
    ),
    check(
      "center_agent_connector_action_operations_id_non_empty_check",
      sql`length(trim("id")) > 0`
    ),
    check(
      "center_agent_connector_action_operations_operation_id_non_empty_check",
      sql`length(trim("operation_id")) > 0`
    ),
    check(
      "center_agent_connector_action_operations_signature_shape_check",
      sql`length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'`
    ),
    check(
      "center_agent_connector_action_operations_service_non_empty_check",
      sql`length(trim("service")) > 0`
    ),
    check(
      "center_agent_connector_action_operations_action_non_empty_check",
      sql`length(trim("action_id")) > 0`
    ),
    check(
      "center_agent_connector_action_operations_connection_non_empty_check",
      sql`length(trim("connection_name")) > 0`
    ),
    check(
      "center_agent_connector_action_operations_connection_snapshot_check",
      sql`(
        "connection_owner_display_name" is null
        and "connection_owner_user_id" is null
        and "connection_scope" is null
      ) or (
        "connection_owner_display_name" is not null
        and "connection_owner_user_id" is not null
        and "connection_scope" is not null
        and
        length(trim("connection_owner_display_name")) > 0
        and length(trim("connection_owner_user_id")) > 0
        and "connection_scope" in ('member', 'shared')
      )`
    ),
    check(
      "center_agent_connector_action_operations_status_check",
      sql`"status" in ('pending', 'completed', 'failed', 'outcome_unknown')`
    ),
    check(
      "center_agent_connector_action_operations_pending_evidence_check",
      sql`"status" != 'pending' or "provider_execution_id" is null`
    ),
    check(
      "center_agent_connector_action_operations_updated_at_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
  ]
);
