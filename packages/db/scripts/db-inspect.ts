import type { DbExecutionMode } from "../src/tooling/db-execution-mode.ts";
import { emitSharedDbInspectSummary } from "../src/tooling/shared-db-inspect.ts";

const mode = process.argv[2];
if (mode !== "dev") {
  throw new Error("db-inspect.ts requires the dev mode argument");
}

const resolvedMode: DbExecutionMode = mode;
emitSharedDbInspectSummary(resolvedMode);
