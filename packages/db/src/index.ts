// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a single public entrypoint.

export {
  AUTH_DB_BETTER_AUTH_CONFIG_PATH,
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
  AUTH_DB_BINDING_NAME,
  AUTH_DB_DRIZZLE_CONFIG_PATH,
  AUTH_DB_MIGRATIONS_PATH,
  AUTH_DB_RELEASE_NOTES,
  AUTH_DB_SCHEMA_ENTRYPOINT_PATH,
  AUTH_DB_SCHEMA_GLOB_PATH,
  AUTH_DB_SERVICE_DRIZZLE_WRAPPER_PATH,
  AUTH_DB_WRANGLER_CONFIG_PATH,
  D1_LOCAL_DB_PATH_ENV_NAME,
  getAuthDbMigrationSources,
  getAuthDbSchemaSources,
} from "./auth/fact-metadata.ts";
export {
  buildDbCommandFactSummary,
  buildDbDiagnosticsPayload,
  buildDbFactSnapshot,
} from "./diagnostics/fact-builders.ts";
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
export { dbDebtRegistry } from "./registry/debt-registry.ts";
export {
  getSharedDbMigrationSources,
  getSharedDbSchemaSources,
  LATEST_SHARED_MIGRATION_ID,
  SHARED_DB_BINDING_NAME,
  SHARED_DB_DATABASE_ID,
  SHARED_DB_DATABASE_NAME,
  SHARED_DB_RELEASE_NOTES,
  SHARED_DB_SCHEMA_ENTRYPOINT_PATH,
} from "./shared/fact-metadata.ts";
export { buildSharedRuntimeDbTarget } from "./shared/runtime-target.ts";
