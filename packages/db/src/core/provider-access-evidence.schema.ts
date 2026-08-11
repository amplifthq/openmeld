import { desc } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonProviderAccessEvidence = sqliteTable(
  "openMeldDaemon_provider_access_evidence",
  {
    evidenceId: text("evidence_id").primaryKey(),
    provider: text("provider").notNull(),
    agentProfileId: text("agent_profile_id").notNull(),
    bindingId: text("binding_id").notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    reasonCode: text("reason_code").notNull(),
    source: text("source").notNull(),
    sourceDispatchId: text("source_dispatch_id").notNull(),
    sourceAttemptId: text("source_attempt_id").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    clearedAtMs: integer("cleared_at_ms"),
    clearedByDispatchId: text("cleared_by_dispatch_id"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldDaemon_provider_access_evidence_execution_provider_unique"
    ).on(
      table.agentProfileId,
      table.bindingId,
      table.openMeldServiceRuntimeId,
      table.agentControllerRef,
      table.provider
    ),
    index("idx_openMeldDaemon_provider_access_evidence_readiness").on(
      table.agentProfileId,
      table.bindingId,
      table.openMeldServiceRuntimeId,
      table.agentControllerRef,
      table.expiresAtMs
    ),
    index("idx_openMeldDaemon_provider_access_evidence_source_dispatch").on(
      table.sourceDispatchId,
      table.sourceAttemptId
    ),
    index("idx_openMeldDaemon_provider_access_evidence_observed").on(
      table.provider,
      desc(table.observedAtMs)
    ),
  ]
);
