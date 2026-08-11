import {
  AUTH_DB_BETTER_AUTH_CONFIG_PATH as authDbBetterAuthConfigPath,
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH as authDbBetterAuthGeneratedSchemaPath,
  AUTH_DB_BINDING_NAME as authDbBindingName,
  AUTH_DB_DRIZZLE_CONFIG_PATH as authDbDrizzleConfigPath,
  AUTH_DB_MIGRATIONS_PATH as authDbMigrationsPath,
  AUTH_DB_RELEASE_NOTES as authDbReleaseNotes,
  AUTH_DB_SCHEMA_ENTRYPOINT_PATH as authDbSchemaEntrypointPath,
  AUTH_DB_SCHEMA_GLOB_PATH as authDbSchemaGlobPath,
  AUTH_DB_SERVICE_DRIZZLE_WRAPPER_PATH as authDbServiceDrizzleWrapperPath,
  AUTH_DB_WRANGLER_CONFIG_PATH as authDbWranglerConfigPath,
  D1_LOCAL_DB_PATH_ENV_NAME as d1LocalDbPathEnvName,
  getAuthDbMigrationSources as getAuthDbMigrationSourcesFromDb,
  getAuthDbSchemaSources as getAuthDbSchemaSourcesFromDb,
} from "@openmeld/db";

export const AUTH_DB_BINDING_NAME = authDbBindingName;
export const AUTH_DB_BETTER_AUTH_CONFIG_PATH = authDbBetterAuthConfigPath;
export const AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH =
  authDbBetterAuthGeneratedSchemaPath;
export const AUTH_DB_DRIZZLE_CONFIG_PATH = authDbDrizzleConfigPath;
export const AUTH_DB_MIGRATIONS_PATH = authDbMigrationsPath;
export const AUTH_DB_RELEASE_NOTES = authDbReleaseNotes;
export const AUTH_DB_SCHEMA_ENTRYPOINT_PATH = authDbSchemaEntrypointPath;
export const AUTH_DB_SCHEMA_GLOB_PATH = authDbSchemaGlobPath;
export const AUTH_DB_SERVICE_DRIZZLE_WRAPPER_PATH =
  authDbServiceDrizzleWrapperPath;
export const AUTH_DB_WRANGLER_CONFIG_PATH = authDbWranglerConfigPath;
export const D1_LOCAL_DB_PATH_ENV_NAME = d1LocalDbPathEnvName;
export const getAuthDbMigrationSources = getAuthDbMigrationSourcesFromDb;
export const getAuthDbSchemaSources = getAuthDbSchemaSourcesFromDb;
