import { getAuthServiceDirectoryPath } from "../auth/paths.ts";
import {
  findLocalD1DatabasePath,
  isAuthToolingProductionMode,
  resolveAuthDrizzleConfigInput,
  resolveAuthToolingDbTarget,
} from "../auth/tooling-facts.ts";
import { getAuthDbMigrationDirectoryRelativePathFromPackagesDb } from "../auth/tooling-paths.ts";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
} from "../tooling/db-execution-mode.ts";
import { getSharedDbSchemaEntryPointAbsolutePath } from "./tooling-paths.ts";

export const resolveSharedDrizzleConfigInput = (
  authServiceDirectoryPath = getAuthServiceDirectoryPath(),
  mode: DbExecutionMode = resolveDbExecutionMode()
) => {
  if (isAuthToolingProductionMode(mode)) {
    const authDrizzleConfigInput = resolveAuthDrizzleConfigInput(
      authServiceDirectoryPath,
      mode
    );
    if (!("driver" in authDrizzleConfigInput)) {
      throw new Error(
        "resolveSharedDrizzleConfigInput expected the auth drizzle config to resolve a production D1 HTTP target."
      );
    }

    return {
      dialect: "sqlite" as const,
      schema: [getSharedDbSchemaEntryPointAbsolutePath()],
      out: getAuthDbMigrationDirectoryRelativePathFromPackagesDb(),
      driver: "d1-http" as const,
      dbCredentials: authDrizzleConfigInput.dbCredentials,
    };
  }

  const target = resolveAuthToolingDbTarget(authServiceDirectoryPath, mode);
  return {
    dialect: "sqlite" as const,
    schema: [getSharedDbSchemaEntryPointAbsolutePath()],
    out: getAuthDbMigrationDirectoryRelativePathFromPackagesDb(),
    dbCredentials: {
      url: target.localPath ?? findLocalD1DatabasePath(),
    },
  };
};
