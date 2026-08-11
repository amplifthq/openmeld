import fs from "node:fs";
import path from "node:path";
import { getRepoRootDirectoryPath } from "../auth/paths.ts";
import type { DbExecutionMode } from "./db-execution-mode.ts";
import { parseJsoncObject } from "./parse-jsonc.ts";
import {
  meetsSharedLocalSqliteMinimumSignature,
  readSharedLocalSqliteSignature,
  type SharedLocalSqliteSignature,
} from "./shared-db-local-sqlite-signature.ts";

type WranglerD1DatabaseBinding = {
  binding?: unknown;
  database_id?: unknown;
  database_name?: unknown;
};

const normalizeOptionalString = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

export const SHARED_LOCAL_DEV_WRANGLER_STATE_DIRECTORY_NAME =
  ".wrangler-dev-state";
export const DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME =
  "OPENMELD_DEV_WRANGLER_STATE_DIR";

/**
 * Single source of truth for the local dev Miniflare persistence root shared by
 * the Auth + Core worker stack. Standard `pnpm dev` uses the repository-level
 * `.wrangler-dev-state`; `pnpm dev:isolated` supplies an absolute lane-specific
 * override. Every shared OPENMELD_DB tooling command (migrate/verify/inspect)
 * must read and write the same root as its Worker stack. Keeping tooling and the
 * dev worker aligned is what prevents silent local schema drift. See
 * developing/engineering/development-workflow.md "Local Worker Persistence".
 */
export const getSharedLocalDevWranglerStateDirectoryPath = (): string => {
  const isolatedStateDirectory = String(
    process.env[DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME] ?? ""
  ).trim();
  if (isolatedStateDirectory.length > 0) {
    if (!path.isAbsolute(isolatedStateDirectory)) {
      throw new Error(
        `${DEV_WRANGLER_STATE_DIRECTORY_ENV_NAME} must be an absolute path`
      );
    }
    return path.resolve(isolatedStateDirectory);
  }

  return path.resolve(
    getRepoRootDirectoryPath(),
    SHARED_LOCAL_DEV_WRANGLER_STATE_DIRECTORY_NAME
  );
};

const resolveLocalWranglerD1DirectoryPath = (
  wranglerStateDirectoryPath: string
): string => {
  return path.resolve(
    wranglerStateDirectoryPath,
    "v3",
    "d1",
    "miniflare-D1DatabaseObject"
  );
};

export const findLatestLocalWranglerSqlitePath = (
  wranglerStateDirectoryPath: string
): string => {
  const d1ObjectDirectoryPath = resolveLocalWranglerD1DirectoryPath(
    wranglerStateDirectoryPath
  );
  if (!fs.existsSync(d1ObjectDirectoryPath)) {
    return path.resolve(wranglerStateDirectoryPath, "local.sqlite");
  }

  const sqliteFiles = fs
    .readdirSync(d1ObjectDirectoryPath, {
      encoding: "utf-8",
      withFileTypes: true,
    })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => path.resolve(d1ObjectDirectoryPath, entry.name))
    .filter((entry) => fs.existsSync(entry))
    .map((entry) => ({
      path: entry,
      mtimeMs: fs.statSync(entry).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((entry) => entry.path);

  const latestSqliteFile = sqliteFiles[0];
  if (!latestSqliteFile) {
    return path.resolve(wranglerStateDirectoryPath, "local.sqlite");
  }

  return latestSqliteFile;
};

type SharedLocalWranglerSqliteCandidate = {
  mtimeMs: number;
  path: string;
  signature: SharedLocalSqliteSignature;
};

export class MissingLocalWranglerSqliteCandidatesError extends Error {
  constructor(d1ObjectDirectoryPath: string) {
    super(
      `no local D1 sqlite candidates were found under ${d1ObjectDirectoryPath}`
    );
    this.name = "MissingLocalWranglerSqliteCandidatesError";
  }
}

const listLocalWranglerD1SqliteCandidates = (
  wranglerStateDirectoryPath: string
): SharedLocalWranglerSqliteCandidate[] => {
  const d1ObjectDirectoryPath = resolveLocalWranglerD1DirectoryPath(
    wranglerStateDirectoryPath
  );
  if (!fs.existsSync(d1ObjectDirectoryPath)) {
    return [];
  }

  return fs
    .readdirSync(d1ObjectDirectoryPath, {
      encoding: "utf-8",
      withFileTypes: true,
    })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => {
      const sqlitePath = path.resolve(d1ObjectDirectoryPath, entry.name);
      return {
        mtimeMs: fs.statSync(sqlitePath).mtimeMs,
        path: sqlitePath,
        signature: readSharedLocalSqliteSignature(sqlitePath),
      };
    });
};

const compareSharedLocalWranglerSqliteCandidates = (
  left: SharedLocalWranglerSqliteCandidate,
  right: SharedLocalWranglerSqliteCandidate
): number => {
  if (left.signature.hasD1Migrations !== right.signature.hasD1Migrations) {
    return (
      Number(right.signature.hasD1Migrations) -
      Number(left.signature.hasD1Migrations)
    );
  }

  if (left.signature.matchedGroupCount !== right.signature.matchedGroupCount) {
    return right.signature.matchedGroupCount - left.signature.matchedGroupCount;
  }

  if (left.signature.totalMatchCount !== right.signature.totalMatchCount) {
    return right.signature.totalMatchCount - left.signature.totalMatchCount;
  }

  if (
    left.signature.dispatchMatchCount !== right.signature.dispatchMatchCount
  ) {
    return (
      right.signature.dispatchMatchCount - left.signature.dispatchMatchCount
    );
  }

  if (left.signature.authMatchCount !== right.signature.authMatchCount) {
    return right.signature.authMatchCount - left.signature.authMatchCount;
  }

  if (left.mtimeMs !== right.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }

  return 0;
};

export const resolveSharedLocalWranglerSqlitePath = (
  wranglerStateDirectoryPath: string
): string => {
  const d1ObjectDirectoryPath = resolveLocalWranglerD1DirectoryPath(
    wranglerStateDirectoryPath
  );
  const candidates = listLocalWranglerD1SqliteCandidates(
    wranglerStateDirectoryPath
  );

  if (candidates.length === 0) {
    throw new MissingLocalWranglerSqliteCandidatesError(d1ObjectDirectoryPath);
  }

  const matchingCandidates = candidates.filter((candidate) => {
    return meetsSharedLocalSqliteMinimumSignature(candidate.signature);
  });

  if (matchingCandidates.length === 0) {
    throw new Error(
      `no local D1 sqlite candidate under ${d1ObjectDirectoryPath} matches the shared OPENMELD_DB signature`
    );
  }

  const sortedCandidates = [...matchingCandidates].sort((left, right) => {
    const comparison = compareSharedLocalWranglerSqliteCandidates(left, right);
    return comparison === 0 ? left.path.localeCompare(right.path) : comparison;
  });
  const selectedCandidate = sortedCandidates[0];
  const nextCandidate = sortedCandidates[1];

  if (
    selectedCandidate &&
    nextCandidate &&
    compareSharedLocalWranglerSqliteCandidates(
      selectedCandidate,
      nextCandidate
    ) === 0
  ) {
    throw new Error(
      `multiple local D1 sqlite candidates under ${d1ObjectDirectoryPath} match the shared OPENMELD_DB signature equally`
    );
  }

  if (!selectedCandidate) {
    throw new Error(
      `failed to resolve a shared OPENMELD_DB local sqlite candidate under ${d1ObjectDirectoryPath}`
    );
  }

  return selectedCandidate.path;
};

export const resolveWranglerD1BindingMetadata = (input: {
  bindingName: string;
  mode: DbExecutionMode;
  wranglerConfigAbsolutePath: string;
}): {
  databaseId: string | null;
  databaseName: string | null;
} => {
  const configSource = fs.readFileSync(
    input.wranglerConfigAbsolutePath,
    "utf8"
  );
  return resolveWranglerD1BindingMetadataFromSource({
    bindingName: input.bindingName,
    mode: input.mode,
    source: configSource,
  });
};

export const resolveWranglerD1BindingMetadataFromSource = (input: {
  bindingName: string;
  mode: DbExecutionMode;
  source: string;
}): {
  databaseId: string | null;
  databaseName: string | null;
} => {
  const parsed = parseJsoncObject<{
    d1_databases?: WranglerD1DatabaseBinding[];
    env?: {
      prod?: {
        d1_databases?: WranglerD1DatabaseBinding[];
      };
    };
  }>(input.source);

  const bindings =
    input.mode === "prod"
      ? (parsed.env?.prod?.d1_databases ?? [])
      : (parsed.d1_databases ?? []);
  const openMeldDbBinding = bindings.find((entry) => {
    return normalizeOptionalString(entry.binding) === input.bindingName;
  });

  return {
    databaseId: normalizeOptionalString(openMeldDbBinding?.database_id),
    databaseName: normalizeOptionalString(openMeldDbBinding?.database_name),
  };
};
