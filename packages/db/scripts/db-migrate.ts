import {
  type DbExecutionMode,
  emitSharedDbMigrateSummary,
} from "../src/tooling/shared-db-migrate.ts";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "prod") {
  throw new Error("db-migrate.ts requires a mode argument: dev | prod");
}

const resolvedMode: DbExecutionMode = mode;
emitSharedDbMigrateSummary(resolvedMode);
