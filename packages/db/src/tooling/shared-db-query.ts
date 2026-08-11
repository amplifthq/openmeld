import type { ToolingCommandRunner } from "./command-runner.ts";
import type { DbExecutionMode } from "./db-execution-mode.ts";
import { runSharedLocalSqliteQuery } from "./shared-db-local-sqlite-query.ts";
import { runSharedWranglerJsonQuery } from "./shared-db-wrangler-query.ts";

export type {
  SqliteIndexColumnRow,
  SqliteIndexListRow,
  SqliteTableInfoRow,
} from "./shared-db-sqlite-types.ts";

export const runSharedDbQuery = <TRow>(input: {
  localDbPath?: string;
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner: ToolingCommandRunner;
  sql: string;
  wranglerConfigAbsolutePath?: string;
}): { blockedReason: string | null; rows: TRow[] } => {
  if (input.mode === "dev") {
    if (!input.localDbPath) {
      return {
        blockedReason:
          "shared OPENMELD_DB local sqlite target is unavailable for dev inspection",
        rows: [],
      };
    }

    return runSharedLocalSqliteQuery<TRow>({
      localDbPath: input.localDbPath,
      sql: input.sql,
    });
  }

  return runSharedWranglerJsonQuery<TRow>({
    mode: input.mode,
    packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    runner: input.runner,
    sql: input.sql,
    wranglerConfigAbsolutePath: input.wranglerConfigAbsolutePath,
  });
};
