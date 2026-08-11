import { desc } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const openMeldDaemonSpaceDiagnosticReports = sqliteTable(
  "openMeldDaemon_space_diagnostic_reports",
  {
    diagnosticReportId: text("diagnostic_report_id").primaryKey(),
    spaceId: text("space_id").notNull(),
    reportedSignalId: text("reported_signal_id").notNull(),
    replyToSignalId: text("reply_to_signal_id"),
    threadId: text("thread_id"),
    problemType: text("problem_type").notNull(),
    reporterProfileId: text("reporter_profile_id").notNull(),
    wakePointerDerivationStatus: text(
      "wake_pointer_derivation_status"
    ).notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    index("idx_openMeldDaemon_space_diagnostic_reports_space_created").on(
      table.spaceId,
      desc(table.createdAtMs)
    ),
    index("idx_openMeldDaemon_space_diagnostic_reports_reported_signal").on(
      table.spaceId,
      table.reportedSignalId
    ),
    index("idx_openMeldDaemon_space_diagnostic_reports_reporter_created").on(
      table.reporterProfileId,
      desc(table.createdAtMs)
    ),
  ]
);

export const openMeldDaemonSpaceDiagnosticReportWakePointers = sqliteTable(
  "openMeldDaemon_space_diagnostic_report_wake_pointers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    diagnosticReportId: text("diagnostic_report_id").notNull(),
    spaceId: text("space_id").notNull(),
    clientMessageId: text("client_message_id"),
    sourceSignalId: text("source_signal_id").notNull(),
    targetProfileId: text("target_profile_id").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldDaemon_space_diagnostic_report_wake_pointer_unique"
    ).on(table.diagnosticReportId, table.sourceSignalId, table.targetProfileId),
    index("idx_openMeldDaemon_space_diagnostic_report_wake_pointers_report").on(
      table.diagnosticReportId
    ),
    index("idx_openMeldDaemon_space_diagnostic_report_wake_pointers_client").on(
      table.spaceId,
      table.clientMessageId
    ),
    index("idx_openMeldDaemon_space_diagnostic_report_wake_pointers_target").on(
      table.spaceId,
      table.targetProfileId,
      desc(table.createdAtMs)
    ),
  ]
);
