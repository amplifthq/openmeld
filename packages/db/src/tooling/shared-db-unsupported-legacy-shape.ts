import { getPackagesDbDirectoryPath } from "../auth/paths.ts";
import {
  listSharedLocalWorkerDbTargetDescriptors,
  resolveSharedLocalWorkerDbTargetLocalPath,
} from "../shared/local-worker-targets.ts";
import type { ToolingCommandRunner } from "./command-runner.ts";
import type { DbExecutionMode } from "./db-execution-mode.ts";
import {
  runSharedDbQuery,
  type SqliteTableInfoRow,
} from "./shared-db-query.ts";
import { MissingLocalWranglerSqliteCandidatesError } from "./wrangler-d1-target.ts";

export type SharedDbUnsupportedLegacyShapeInspection = {
  detail: string | null;
  status: "blocked" | "drift_detected" | "ok";
  unsupportedTableNames: string[];
};

export const UNSUPPORTED_LEGACY_CORE_DISPATCH_SCHEMA_SHAPE_BLOCKED_REASON =
  "unsupported legacy Core dispatch schema shape: normalize with the previous migration-capable build or reset local state before running the shared DB gate";

type LegacyCoreDispatchRequiredColumns = {
  readonly requiredColumnNames: readonly string[];
  readonly tableName: string;
};

const LEGACY_CORE_DISPATCH_REQUIRED_COLUMNS: readonly LegacyCoreDispatchRequiredColumns[] =
  [
    {
      tableName: "openMeldDaemon_dispatch_attempts",
      requiredColumnNames: ["connection_generation", "lease_epoch"],
    },
    {
      tableName: "openMeldDaemon_dispatch_results",
      requiredColumnNames: ["actor_name", "message_envelope_json"],
    },
    {
      tableName: "openMeldDaemon_dispatch_ledger",
      requiredColumnNames: [
        "latest_attempt_id",
        "reply_hint_sent_at_ms",
        "final_reply_sent_at_ms",
      ],
    },
  ] as const;

const normalizeSqliteIdentifier = (value: unknown): string => {
  return String(value ?? "")
    .trim()
    .toLowerCase();
};

export const buildUnsupportedLegacyCoreDispatchTableNames = (input: {
  columnsByTableName: ReadonlyMap<string, readonly string[]>;
}): string[] => {
  return LEGACY_CORE_DISPATCH_REQUIRED_COLUMNS.flatMap((table) => {
    const actualColumnNames = input.columnsByTableName.get(table.tableName);
    if (!actualColumnNames || actualColumnNames.length === 0) {
      return [];
    }

    const actualColumnNameSet = new Set(
      actualColumnNames.map((columnName) =>
        normalizeSqliteIdentifier(columnName)
      )
    );
    const hasMissingRequiredColumn = table.requiredColumnNames.some(
      (columnName) => !actualColumnNameSet.has(columnName)
    );

    return hasMissingRequiredColumn ? [table.tableName] : [];
  });
};

const readDispatchColumnsByTableName = (input: {
  localDbPath?: string;
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
  wranglerConfigAbsolutePath?: string;
}): {
  blockedReason: string | null;
  columnsByTableName: Map<string, string[]>;
} => {
  const columnsByTableName = new Map<string, string[]>();

  for (const table of LEGACY_CORE_DISPATCH_REQUIRED_COLUMNS) {
    const query = runSharedDbQuery<SqliteTableInfoRow>({
      localDbPath: input.localDbPath,
      mode: input.mode,
      packagesDbDirectoryPath: input.packagesDbDirectoryPath,
      runner: input.runner,
      sql: `PRAGMA table_info('${table.tableName}');`,
      wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
    });

    if (query.blockedReason) {
      return {
        blockedReason: `failed to inspect ${table.tableName}: ${query.blockedReason}`,
        columnsByTableName: new Map<string, string[]>(),
      };
    }

    if (query.rows.length === 0) {
      continue;
    }

    columnsByTableName.set(
      table.tableName,
      query.rows.map((row) => normalizeSqliteIdentifier(row.name))
    );
  }

  return {
    blockedReason: null,
    columnsByTableName,
  };
};

export const inspectUnsupportedLegacyCoreDispatchShape = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner: ToolingCommandRunner;
  skipMissingLocalTargets?: boolean;
}): SharedDbUnsupportedLegacyShapeInspection => {
  const packagesDbDirectoryPath =
    input.packagesDbDirectoryPath ?? getPackagesDbDirectoryPath();
  let targets: Array<{
    localDbPath?: string;
    targetLabel: string | null;
    wranglerConfigAbsolutePath?: string;
  }> | null = null;

  try {
    targets =
      input.mode === "dev"
        ? listSharedLocalWorkerDbTargetDescriptors().flatMap((target) => {
            try {
              return [
                {
                  localDbPath: resolveSharedLocalWorkerDbTargetLocalPath(),
                  targetLabel: target.targetLabel,
                  wranglerConfigAbsolutePath: target.wranglerConfigAbsolutePath,
                },
              ];
            } catch (error) {
              if (
                input.skipMissingLocalTargets &&
                error instanceof MissingLocalWranglerSqliteCandidatesError
              ) {
                return [];
              }
              throw error;
            }
          })
        : [
            {
              localDbPath: undefined,
              targetLabel: null,
              wranglerConfigAbsolutePath: undefined,
            },
          ];
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      status: "blocked",
      unsupportedTableNames: [],
    };
  }

  for (const target of targets) {
    const readColumnsResult = readDispatchColumnsByTableName({
      localDbPath: target.localDbPath,
      mode: input.mode,
      packagesDbDirectoryPath,
      runner: input.runner,
      wranglerConfigAbsolutePath: target.wranglerConfigAbsolutePath,
    });

    if (readColumnsResult.blockedReason) {
      return {
        detail: target.targetLabel
          ? `${target.targetLabel}: ${readColumnsResult.blockedReason}`
          : readColumnsResult.blockedReason,
        status: "blocked",
        unsupportedTableNames: [],
      };
    }

    const unsupportedLegacyTableNames =
      buildUnsupportedLegacyCoreDispatchTableNames({
        columnsByTableName: readColumnsResult.columnsByTableName,
      });
    if (unsupportedLegacyTableNames.length === 0) {
      continue;
    }

    return {
      detail: target.targetLabel
        ? `${target.targetLabel}: ${UNSUPPORTED_LEGACY_CORE_DISPATCH_SCHEMA_SHAPE_BLOCKED_REASON}; unsupported tables: ${unsupportedLegacyTableNames.join(", ")}`
        : `${UNSUPPORTED_LEGACY_CORE_DISPATCH_SCHEMA_SHAPE_BLOCKED_REASON}; unsupported tables: ${unsupportedLegacyTableNames.join(", ")}`,
      status: "drift_detected",
      unsupportedTableNames: unsupportedLegacyTableNames,
    };
  }

  return {
    detail: null,
    status: "ok",
    unsupportedTableNames: [],
  };
};

export const detectUnsupportedLegacyCoreDispatchShape = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner: ToolingCommandRunner;
  skipMissingLocalTargets?: boolean;
}): string | null => {
  return inspectUnsupportedLegacyCoreDispatchShape(input).detail;
};
