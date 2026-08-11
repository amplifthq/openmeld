// biome-ignore-all lint/performance/noBarrelFile: This thin subpath alias keeps root db:migrate entrypoints named by shared DB ownership instead of auth ownership.

export {
  emitSharedDbMigrateSummary,
  runSharedDbMigrate,
} from "./auth-db-migrate.ts";
export type { DbExecutionMode } from "./db-execution-mode.ts";
