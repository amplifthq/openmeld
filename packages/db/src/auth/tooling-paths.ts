import path from "node:path";
import {
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
  AUTH_DB_MIGRATIONS_PATH,
  AUTH_DB_WRANGLER_CONFIG_PATH,
} from "./fact-metadata.ts";
import {
  getAuthSchemaDirectoryPath,
  getPackagesDbDirectoryPath,
  getRepoRootDirectoryPath,
} from "./paths.ts";

export const getAuthDbSchemaGlobAbsolutePath = (): string => {
  return path.resolve(getAuthSchemaDirectoryPath(), "*.schema.ts");
};

export const getAuthDbDrizzleConfigAbsolutePath = (): string => {
  return path.resolve(getPackagesDbDirectoryPath(), "drizzle.config.ts");
};

export const getAuthDbMigrationDirectoryAbsolutePath = (): string => {
  return path.resolve(getRepoRootDirectoryPath(), AUTH_DB_MIGRATIONS_PATH);
};

export const getAuthDbGeneratedSchemaAbsolutePath = (): string => {
  return path.resolve(
    getRepoRootDirectoryPath(),
    AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH
  );
};

export const getAuthDbWranglerConfigAbsolutePath = (): string => {
  return path.resolve(getRepoRootDirectoryPath(), AUTH_DB_WRANGLER_CONFIG_PATH);
};

export const getAuthDbMigrationDirectoryRelativePathFromPackagesDb =
  (): string => {
    return path.relative(
      getPackagesDbDirectoryPath(),
      getAuthDbMigrationDirectoryAbsolutePath()
    );
  };
