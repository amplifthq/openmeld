import type { DbFactSnapshot } from "@openmeld/schemas/types";
import { getAuthServiceDirectoryPath } from "../auth/paths.ts";
import { resolveAuthToolingDbTarget } from "../auth/tooling-facts.ts";
import { buildDbFactSnapshot } from "../diagnostics/fact-builders.ts";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
} from "../tooling/db-execution-mode.ts";
import {
  getSharedDbMigrationSources,
  getSharedDbSchemaSources,
  SHARED_DB_BINDING_NAME,
  SHARED_DB_RELEASE_NOTES,
} from "./fact-metadata.ts";

export const buildSharedToolingDbFactSnapshot = (
  authServiceDirectoryPath = getAuthServiceDirectoryPath(),
  mode: DbExecutionMode = resolveDbExecutionMode()
): DbFactSnapshot => {
  const target = resolveAuthToolingDbTarget(authServiceDirectoryPath, mode);
  return buildDbFactSnapshot({
    subject: "shared",
    mode: "tooling",
    bindingName: SHARED_DB_BINDING_NAME,
    schemaSources: getSharedDbSchemaSources(),
    migrationSources: getSharedDbMigrationSources(),
    target: {
      targetKind: target.targetKind,
      bindingName: target.bindingName,
      databaseId: target.databaseId,
      databaseName: target.databaseName,
      localPath: target.localPath,
      resolvedFrom: target.resolvedFrom,
    },
    d1LocalDbPath: target.d1LocalDbPath,
    notes: [...SHARED_DB_RELEASE_NOTES],
  });
};
