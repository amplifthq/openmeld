import type { DbFactSource } from "@openmeld/schemas/types";

export const AUTH_DB_BINDING_NAME = "OPENMELD_DB" as const;
export const AUTH_DB_SCHEMA_GLOB_PATH = "packages/db/src/auth/*.schema.ts";
export const AUTH_DB_SCHEMA_ENTRYPOINT_PATH = "packages/db/src/auth/schema.ts";
export const AUTH_DB_DRIZZLE_CONFIG_PATH = "packages/db/drizzle.config.ts";
export const AUTH_DB_WRANGLER_CONFIG_PATH = "services/auth/wrangler.jsonc";
export const AUTH_DB_SERVICE_DRIZZLE_WRAPPER_PATH =
  "services/auth/drizzle.config.ts";
export const AUTH_DB_MIGRATIONS_PATH = "packages/db/drizzle";
export const AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH =
  "packages/db/src/auth/auth.schema.ts";
export const AUTH_DB_BETTER_AUTH_CONFIG_PATH =
  "services/auth/src/lib/better-auth/cli-config.ts";
export const D1_LOCAL_DB_PATH_ENV_NAME = "D1_LOCAL_DB_PATH" as const;

export const AUTH_DB_RELEASE_NOTES = [
  "Auth D1 schema truth and shared migration ownership now live in packages/db.",
  "Shared OPENMELD_DB migrations now run through the shared DB gate.",
] as const;

export const getAuthDbSchemaSources = (): DbFactSource[] => {
  return [
    {
      kind: "schema_entrypoint",
      owner: "packages/db",
      path: AUTH_DB_SCHEMA_ENTRYPOINT_PATH,
      note: "Auth D1 schema aggregation now lives in packages/db during Phase 2.",
    },
    {
      kind: "schema_glob",
      owner: "packages/db",
      path: AUTH_DB_SCHEMA_GLOB_PATH,
      note: "Drizzle schema discovery glob now points at packages/db auth schema truth.",
    },
    {
      kind: "generated_schema",
      owner: "packages/db",
      path: AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
      note: "Better Auth code generation now writes canonical auth schema output into packages/db.",
    },
    {
      kind: "drizzle_config",
      owner: "packages/db",
      path: AUTH_DB_DRIZZLE_CONFIG_PATH,
      note: "Canonical auth D1 tooling config lives in packages/db.",
    },
  ];
};

export const getAuthDbMigrationSources = (): DbFactSource[] => {
  return [
    {
      kind: "migration_dir",
      owner: "packages/db",
      path: AUTH_DB_MIGRATIONS_PATH,
      note: "Shared OPENMELD_DB migrations now live in packages/db.",
    },
  ];
};
