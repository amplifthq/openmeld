import type { DbFactSource } from "@openmeld/schemas/types";

export const DIAGNOSTICS_DB_BINDING_NAME = "OPENMELD_DIAGNOSTICS_DB" as const;
export const DIAGNOSTICS_DB_CURRENT_SHARED_BINDING_NAME =
  "OPENMELD_DB" as const;
export const DIAGNOSTICS_DB_SCHEMA_DEFINITION_PATH =
  "packages/db/src/diagnostics/diagnostic-report.schema.ts";
export const DIAGNOSTICS_DB_SCHEMA_ENTRYPOINT_PATH =
  "packages/db/src/diagnostics/schema.ts";
export const DIAGNOSTICS_DB_MIGRATIONS_PATH = "packages/db/drizzle";

export const DIAGNOSTICS_DB_RELEASE_NOTES = [
  "Diagnostics has its own logical DB domain and future physical binding name OPENMELD_DIAGNOSTICS_DB.",
  "During the current shared-D1 phase, Diagnostics tables are intentionally migrated into OPENMELD_DB through the shared packages/db schema entrypoint.",
] as const;

export const getDiagnosticsDbSchemaSources = (): DbFactSource[] => {
  return [
    {
      kind: "diagnostics_schema_entrypoint",
      owner: "packages/db",
      path: DIAGNOSTICS_DB_SCHEMA_ENTRYPOINT_PATH,
      note: "Diagnostics schema truth is separated by domain while still participating in the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "diagnostics_schema_module",
      owner: "packages/db",
      path: DIAGNOSTICS_DB_SCHEMA_DEFINITION_PATH,
      note: "Diagnostic Report storage schema owns user-submitted diagnostic report facts and derived wake pointers.",
    },
  ];
};

export const getDiagnosticsDbMigrationSources = (): DbFactSource[] => {
  return [
    {
      kind: "migration_dir",
      owner: "packages/db",
      path: DIAGNOSTICS_DB_MIGRATIONS_PATH,
      note: "Diagnostics currently uses the shared OPENMELD_DB migration history until physical DB split.",
    },
  ];
};
