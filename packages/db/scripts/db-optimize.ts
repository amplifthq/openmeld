import type { DbExecutionMode } from "../src/tooling/shared-db-migrate.ts";
import { emitSharedDbOptimizeSummary } from "../src/tooling/shared-db-optimize.ts";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "prod") {
  throw new Error("db-optimize.ts requires a mode argument: dev | prod");
}

const resolvedMode: DbExecutionMode = mode;
emitSharedDbOptimizeSummary(resolvedMode);
