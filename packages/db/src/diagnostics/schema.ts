import {
  openMeldDaemonSpaceDiagnosticReports,
  openMeldDaemonSpaceDiagnosticReportWakePointers,
} from "./diagnostic-report.schema.ts";

export const diagnosticsSchema = {
  openMeldDaemonSpaceDiagnosticReports,
  openMeldDaemonSpaceDiagnosticReportWakePointers,
} as const;
