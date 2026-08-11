import { createSpaceDiagnosticReportResponseSchema } from "@openmeld/schemas";
import type { CreateSpaceDiagnosticReportResponse } from "@openmeld/schemas/types";

export async function writeSpaceDiagnosticReport(input: {
  db: D1Database;
  report: CreateSpaceDiagnosticReportResponse;
}): Promise<void> {
  const parsed = createSpaceDiagnosticReportResponseSchema.safeParse(
    input.report
  );
  if (!parsed.success) {
    throw new Error("invalid diagnostic report storage payload");
  }

  const report = parsed.data;
  const statements: D1PreparedStatement[] = [
    input.db
      .prepare(
        `
          INSERT INTO openMeldDaemon_space_diagnostic_reports (
            diagnostic_report_id,
            space_id,
            reported_signal_id,
            reply_to_signal_id,
            thread_id,
            problem_type,
            reporter_profile_id,
            wake_pointer_derivation_status,
            reason_codes_json,
            created_at_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        report.diagnosticReportId,
        report.spaceId,
        report.reportedSignalId,
        report.replyToSignalId,
        report.threadId,
        report.problemType,
        report.reporterProfileId,
        report.wakePointerDerivation.status,
        JSON.stringify(report.wakePointerDerivation.reasonCodes),
        report.createdAtMs
      ),
  ];

  for (const pointer of report.wakePointers) {
    statements.push(
      input.db
        .prepare(
          `
            INSERT INTO openMeldDaemon_space_diagnostic_report_wake_pointers (
              diagnostic_report_id,
              space_id,
              client_message_id,
              source_signal_id,
              target_profile_id,
              created_at_ms
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          report.diagnosticReportId,
          pointer.spaceId,
          pointer.clientMessageId,
          pointer.sourceSignalId,
          pointer.targetProfileId,
          report.createdAtMs
        )
    );
  }

  await input.db.batch(statements);
}
