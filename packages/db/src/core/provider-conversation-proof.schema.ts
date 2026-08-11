import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonProviderConversationProofs = sqliteTable(
  "openMeldDaemon_provider_conversation_proofs",
  {
    proofId: text("proof_id").primaryKey(),
    provider: text("provider").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull(),
    agentProfileId: text("agent_profile_id").notNull(),
    bindingId: text("binding_id").notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    agentControllerConversationId: text(
      "agent_controller_conversation_id"
    ).notNull(),
    transportMode: text("transport_mode").notNull(),
    intrusive: integer("intrusive").notNull(),
    errorCode: text("error_code"),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    observedAtMs: integer("observed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldDaemon_provider_conversation_proofs_target_method_unique"
    ).on(
      table.agentProfileId,
      table.bindingId,
      table.openMeldServiceRuntimeId,
      table.agentControllerRef,
      table.agentControllerConversationId,
      table.provider,
      table.method
    ),
    index("idx_openMeldDaemon_provider_conversation_proofs_readiness").on(
      table.agentProfileId,
      table.bindingId,
      table.openMeldServiceRuntimeId,
      table.agentControllerRef,
      table.agentControllerConversationId,
      table.expiresAtMs
    ),
    index("idx_openMeldDaemon_provider_conversation_proofs_observed").on(
      table.provider,
      table.method,
      desc(table.observedAtMs)
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_provider_check",
      sql`"provider" = 'codex'`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_method_check",
      sql`"method" = 'codex_app_server_thread_resume'`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_status_check",
      sql`"status" in ('passed', 'failed')`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_transport_mode_check",
      sql`"transport_mode" = 'codex-app-server'`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_intrusive_false_check",
      sql`"intrusive" = 0`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_observed_at_positive_check",
      sql`"observed_at_ms" > 0`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_expires_after_observed_check",
      sql`"expires_at_ms" > "observed_at_ms"`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_created_at_positive_check",
      sql`"created_at_ms" > 0`
    ),
    check(
      "openMeldDaemon_provider_conversation_proofs_updated_at_positive_check",
      sql`"updated_at_ms" > 0`
    ),
  ]
);
