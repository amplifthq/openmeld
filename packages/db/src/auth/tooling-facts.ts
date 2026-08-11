import fs from "node:fs";
import path from "node:path";
import type { DbFactTarget } from "@openmeld/schemas/types";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
} from "../tooling/db-execution-mode.ts";
import {
  findLatestLocalWranglerSqlitePath,
  getSharedLocalDevWranglerStateDirectoryPath,
  resolveWranglerD1BindingMetadata,
} from "../tooling/wrangler-d1-target.ts";
import {
  AUTH_DB_BINDING_NAME,
  D1_LOCAL_DB_PATH_ENV_NAME,
} from "./fact-metadata.ts";
import { getAuthServiceDirectoryPath } from "./paths.ts";
import { resolveAuthProductionCredentials } from "./production-credentials.ts";
import {
  getAuthDbMigrationDirectoryRelativePathFromPackagesDb,
  getAuthDbSchemaGlobAbsolutePath,
  getAuthDbWranglerConfigAbsolutePath,
} from "./tooling-paths.ts";

export type AuthToolingDbTargetInput = DbFactTarget & {
  d1LocalDbPath: string | null;
};

const readOptionalEnvValue = (name: string): string | null => {
  const value = String(process.env[name] ?? "").trim();
  return value.length > 0 ? value : null;
};

const resolveExplicitLocalD1DatabasePath = (): string | null => {
  const explicitPath = String(
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] ?? ""
  ).trim();
  if (!explicitPath) {
    return null;
  }
  return path.resolve(explicitPath);
};

export function findLocalD1DatabasePath(
  authServiceDirectoryPath?: string
): string {
  const explicitPath = resolveExplicitLocalD1DatabasePath();
  if (explicitPath) {
    return explicitPath;
  }

  if (authServiceDirectoryPath) {
    return findLatestLocalWranglerSqlitePath(
      path.resolve(authServiceDirectoryPath, ".wrangler", "state")
    );
  }

  return findLatestLocalWranglerSqlitePath(
    getSharedLocalDevWranglerStateDirectoryPath()
  );
}

export const isAuthToolingProductionMode = (
  mode = resolveDbExecutionMode()
): boolean => {
  return mode === "prod";
};

export const resolveAuthToolingDbTarget = (
  authServiceDirectoryPath = getAuthServiceDirectoryPath(),
  mode = resolveDbExecutionMode()
): AuthToolingDbTargetInput => {
  const wranglerBindingMetadata = resolveWranglerD1BindingMetadata({
    bindingName: AUTH_DB_BINDING_NAME,
    mode,
    wranglerConfigAbsolutePath: getAuthDbWranglerConfigAbsolutePath(),
  });
  if (isAuthToolingProductionMode(mode)) {
    const explicitDatabaseId = readOptionalEnvValue(
      "CLOUDFLARE_D1_DATABASE_ID"
    );
    return {
      targetKind: "d1_http",
      bindingName: AUTH_DB_BINDING_NAME,
      databaseId: explicitDatabaseId ?? wranglerBindingMetadata.databaseId,
      databaseName: wranglerBindingMetadata.databaseName,
      localPath: null,
      resolvedFrom: explicitDatabaseId ? "cloudflare_env" : "wrangler_config",
      d1LocalDbPath: null,
    };
  }

  const explicitLocalPath = resolveExplicitLocalD1DatabasePath();
  const localPath = findLocalD1DatabasePath();
  let resolvedFrom: string;
  if (explicitLocalPath) {
    resolvedFrom = D1_LOCAL_DB_PATH_ENV_NAME;
  } else if (
    fs.existsSync(getSharedLocalDevWranglerStateDirectoryPath()) ||
    fs.existsSync(path.resolve(authServiceDirectoryPath, ".wrangler"))
  ) {
    resolvedFrom = "wrangler_local_cache";
  } else {
    resolvedFrom = "wrangler_local_default";
  }

  return {
    targetKind: "d1_local_sqlite",
    bindingName: AUTH_DB_BINDING_NAME,
    databaseId: wranglerBindingMetadata.databaseId,
    databaseName: wranglerBindingMetadata.databaseName,
    localPath,
    resolvedFrom,
    d1LocalDbPath: explicitLocalPath,
  };
};

export const resolveAuthDrizzleConfigInput = (
  authServiceDirectoryPath = getAuthServiceDirectoryPath(),
  mode: DbExecutionMode = resolveDbExecutionMode(),
  dependencies: {
    env?: NodeJS.ProcessEnv;
    readWranglerConfigSource?: () => string;
    writeDiagnostic?: (message: string) => void;
  } = {}
) => {
  if (isAuthToolingProductionMode(mode)) {
    const env = dependencies.env ?? process.env;
    const credentials = resolveAuthProductionCredentials({
      env,
      readWranglerConfigSource:
        dependencies.readWranglerConfigSource ??
        (() => fs.readFileSync(getAuthDbWranglerConfigAbsolutePath(), "utf8")),
    });
    if (credentials.databaseIdSource === "wrangler_config") {
      (
        dependencies.writeDiagnostic ??
        ((message) => process.stderr.write(`[db] ${message}\n`))
      )(
        "CLOUDFLARE_D1_DATABASE_ID resolved from services/auth/wrangler.jsonc env.prod OPENMELD_DB database_id."
      );
    }
    return {
      dialect: "sqlite" as const,
      schema: [getAuthDbSchemaGlobAbsolutePath()],
      out: getAuthDbMigrationDirectoryRelativePathFromPackagesDb(),
      driver: "d1-http" as const,
      dbCredentials: {
        accountId: credentials.accountId,
        databaseId: credentials.databaseId,
        token: credentials.token,
      },
    };
  }

  const target = resolveAuthToolingDbTarget(authServiceDirectoryPath, mode);
  return {
    dialect: "sqlite" as const,
    schema: [getAuthDbSchemaGlobAbsolutePath()],
    out: getAuthDbMigrationDirectoryRelativePathFromPackagesDb(),
    dbCredentials: {
      url: target.localPath ?? findLocalD1DatabasePath(),
    },
  };
};
