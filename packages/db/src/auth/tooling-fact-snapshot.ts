import type { DbFactSnapshot } from "@openmeld/schemas/types";
import { buildDbFactSnapshot } from "../diagnostics/fact-builders.ts";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
} from "../tooling/db-execution-mode.ts";
import {
  AUTH_DB_BINDING_NAME,
  AUTH_DB_RELEASE_NOTES,
  getAuthDbMigrationSources,
  getAuthDbSchemaSources,
} from "./fact-metadata.ts";
import { getAuthServiceDirectoryPath } from "./paths.ts";
import { resolveAuthToolingDbTarget } from "./tooling-facts.ts";

export const buildAuthToolingDbFactSnapshot = (
  authServiceDirectoryPath = getAuthServiceDirectoryPath(),
  mode: DbExecutionMode = resolveDbExecutionMode()
): DbFactSnapshot => {
  const target = resolveAuthToolingDbTarget(authServiceDirectoryPath, mode);
  return buildDbFactSnapshot({
    subject: "auth",
    mode: "tooling",
    bindingName: AUTH_DB_BINDING_NAME,
    schemaSources: getAuthDbSchemaSources(),
    migrationSources: getAuthDbMigrationSources(),
    target: {
      targetKind: target.targetKind,
      bindingName: target.bindingName,
      databaseId: target.databaseId,
      databaseName: target.databaseName,
      localPath: target.localPath,
      resolvedFrom: target.resolvedFrom,
    },
    d1LocalDbPath: target.d1LocalDbPath,
    notes: [...AUTH_DB_RELEASE_NOTES],
  });
};
