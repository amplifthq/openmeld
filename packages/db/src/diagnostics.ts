// biome-ignore-all lint/performance/noBarrelFile: This package subpath intentionally exposes the canonical diagnostics db surface.

export {
  openMeldDaemonSpaceDiagnosticReports,
  openMeldDaemonSpaceDiagnosticReportWakePointers,
} from "./diagnostics/diagnostic-report.schema.ts";
export {
  DIAGNOSTICS_DB_BINDING_NAME,
  DIAGNOSTICS_DB_CURRENT_SHARED_BINDING_NAME,
  DIAGNOSTICS_DB_MIGRATIONS_PATH,
  DIAGNOSTICS_DB_RELEASE_NOTES,
  DIAGNOSTICS_DB_SCHEMA_DEFINITION_PATH,
  DIAGNOSTICS_DB_SCHEMA_ENTRYPOINT_PATH,
  getDiagnosticsDbMigrationSources,
  getDiagnosticsDbSchemaSources,
} from "./diagnostics/fact-metadata.ts";
export { diagnosticsSchema } from "./diagnostics/schema.ts";
