// biome-ignore-all lint/performance/noBarrelFile: This thin subpath alias keeps root db:optimize entrypoints named by shared DB ownership instead of auth ownership.

export {
  emitSharedDbOptimizeSummary,
  runSharedDbOptimize,
} from "./auth-db-optimize.ts";
export type { DbExecutionMode } from "./db-execution-mode.ts";
