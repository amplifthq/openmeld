import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonAgentProfileBindings = sqliteTable(
  "openMeldDaemon_agent_profile_bindings",
  {
    bindingId: text("binding_id").primaryKey(),
    ownerKind: text("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),
    agentProfileId: text("agent_profile_id").notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    runtimeKind: text("runtime_kind").notNull().default("openmeld_service"),
    hostedRuntimeIdentityJson: text("hosted_runtime_identity_json"),
    agentControllerRef: text("agent_controller_ref").notNull(),
    agentControllerConversationId: text("agent_controller_conversation_id"),
    modelId: text("model_id"),
    reasoningLevel: text("reasoning_level"),
    agentControllerPermissionMode: text("agent_controller_permission_mode"),
    agentControllerCollaborationMode: text(
      "agent_controller_collaboration_mode"
    ),
    openCodePermission: text("opencode_permission"),
    configurationRevision: integer("configuration_revision")
      .notNull()
      .default(1),
    bindingState: text("binding_state").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    disabledAtMs: integer("disabled_at_ms"),
    createdByProfileId: text("created_by_profile_id"),
    reasonCode: text("reason_code"),
  },
  (table) => [
    uniqueIndex("openMeldDaemon_agent_profile_bindings_enabled_primary_unique")
      .on(table.ownerKind, table.ownerId, table.agentProfileId)
      .where(sql`"binding_state" = 'enabled_primary'`),
    index(
      "idx_openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_agent_controller"
    ).on(table.openMeldServiceRuntimeId, table.agentControllerRef),
    index("idx_openMeldDaemon_agent_profile_bindings_owner_profile_state").on(
      table.ownerKind,
      table.ownerId,
      table.agentProfileId,
      table.bindingState
    ),
    index("idx_openMeldDaemon_agent_profile_bindings_profile_enabled_owner")
      .on(table.agentProfileId, table.ownerKind, table.ownerId)
      .where(sql`"binding_state" = 'enabled_primary'`),
    check(
      "openMeldDaemon_agent_profile_bindings_binding_id_non_empty_check",
      sql`length(trim("binding_id")) > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_owner_kind_check",
      sql`"owner_kind" in ('owner_account')`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_owner_id_non_empty_check",
      sql`length(trim("owner_id")) > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_agent_profile_id_non_empty_check",
      sql`length(trim("agent_profile_id")) > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_id_non_empty_check",
      sql`length(trim("openmeld_service_runtime_id")) > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_runtime_kind_check",
      sql`"runtime_kind" in ('openmeld_service', 'hosted_center_agent')`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_hosted_identity_check",
      sql`(("runtime_kind" = 'openmeld_service' and "hosted_runtime_identity_json" is null) or ("runtime_kind" = 'hosted_center_agent' and "hosted_runtime_identity_json" is not null and json_valid("hosted_runtime_identity_json")))`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_agent_controller_ref_non_empty_check",
      sql`length(trim("agent_controller_ref")) > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_agent_controller_conversation_id_non_empty_check",
      sql`"agent_controller_conversation_id" is null or length(trim("agent_controller_conversation_id")) > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_state_check",
      sql`"binding_state" in ('enabled_primary', 'disabled_historical')`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_created_at_positive_check",
      sql`"created_at_ms" > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_updated_at_valid_check",
      sql`"updated_at_ms" >= "created_at_ms"`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_disabled_at_positive_check",
      sql`"disabled_at_ms" is null or "disabled_at_ms" > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_lifecycle_check",
      sql`(("binding_state" = 'enabled_primary' and "disabled_at_ms" is null) or ("binding_state" = 'disabled_historical' and "disabled_at_ms" is not null))`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_created_by_non_empty_check",
      sql`"created_by_profile_id" is null or length(trim("created_by_profile_id")) > 0`
    ),
    check(
      "openMeldDaemon_agent_profile_bindings_reason_code_check",
      sql`"reason_code" is null or (length(trim("reason_code")) > 0 and length("reason_code") <= 160)`
    ),
  ]
);
