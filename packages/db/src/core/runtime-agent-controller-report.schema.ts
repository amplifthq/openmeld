import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonRuntimeAgentControllerReports = sqliteTable(
  "openMeldDaemon_runtime_agent_controller_reports",
  {
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    reportStatus: text("report_status").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    reportedReasonCodesJson: text("reported_reason_codes_json").notNull(),
    agentControllerInterfaceJson: text("agent_controller_interface_json"),
    acceptedAtMs: integer("accepted_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldDaemon_runtime_agent_controller_reports_runtime_agent_controller_unique"
    ).on(table.openMeldServiceRuntimeId, table.agentControllerRef),
    index(
      "idx_openMeldDaemon_runtime_agent_controller_reports_runtime_expires"
    ).on(table.openMeldServiceRuntimeId, table.expiresAtMs),
    index(
      "idx_openMeldDaemon_runtime_agent_controller_reports_agent_controller_status_expires"
    ).on(table.agentControllerRef, table.reportStatus, table.expiresAtMs),
    check(
      "openMeldDaemon_runtime_agent_controller_reports_openmeld_service_runtime_id_non_empty_check",
      sql`length(trim("openmeld_service_runtime_id")) > 0`
    ),
    check(
      "openMeldDaemon_runtime_agent_controller_reports_agent_controller_ref_non_empty_check",
      sql`length(trim("agent_controller_ref")) > 0`
    ),
    check(
      "openMeldDaemon_runtime_agent_controller_reports_status_check",
      sql`"report_status" in ('ready', 'disabled', 'unavailable', 'unknown')`
    ),
    check(
      "openMeldDaemon_runtime_agent_controller_reports_observed_at_positive_check",
      sql`"observed_at_ms" > 0`
    ),
    check(
      "openMeldDaemon_runtime_agent_controller_reports_expires_after_observed_check",
      sql`"expires_at_ms" > "observed_at_ms"`
    ),
    check(
      "openMeldDaemon_runtime_agent_controller_reports_accepted_at_positive_check",
      sql`"accepted_at_ms" > 0`
    ),
    check(
      "openMeldDaemon_runtime_agent_controller_reports_updated_at_positive_check",
      sql`"updated_at_ms" > 0`
    ),
  ]
);
