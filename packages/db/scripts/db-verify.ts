import type { DbExecutionMode } from "../src/tooling/shared-db-migrate.ts";
import { emitSharedDbVerifySummary } from "../src/tooling/shared-db-verify.ts";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "prod") {
  throw new Error("db-verify.ts requires a mode argument: dev | prod");
}

const resolvedMode: DbExecutionMode = mode;
emitSharedDbVerifySummary(resolvedMode);
