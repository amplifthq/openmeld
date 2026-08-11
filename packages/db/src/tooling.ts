// biome-ignore-all lint/performance/noBarrelFile: Node-only tooling helpers intentionally share a dedicated public entrypoint.

export {
  getAuthSchemaDirectoryPath,
  getAuthServiceDirectoryPath,
  getPackagesDbDirectoryPath,
  getRepoRootDirectoryPath,
} from "./auth/paths.ts";
export { buildAuthToolingDbFactSnapshot } from "./auth/tooling-fact-snapshot.ts";
export {
  type AuthToolingDbTargetInput,
  findLocalD1DatabasePath,
  isAuthToolingProductionMode,
  resolveAuthDrizzleConfigInput,
  resolveAuthToolingDbTarget,
} from "./auth/tooling-facts.ts";
export {
  getAuthDbDrizzleConfigAbsolutePath,
  getAuthDbMigrationDirectoryAbsolutePath,
  getAuthDbSchemaGlobAbsolutePath,
  getAuthDbWranglerConfigAbsolutePath,
} from "./auth/tooling-paths.ts";
export { buildSharedToolingDbFactSnapshot } from "./shared/tooling-fact-snapshot.ts";
export { resolveSharedDrizzleConfigInput } from "./shared/tooling-facts.ts";
export {
  emitAuthCodegen,
  runAuthCodegen,
} from "./tooling/auth-generate.ts";
export {
  resolveDbExecutionMode,
  SHARED_DB_EXECUTION_MODE_ENV_NAME,
} from "./tooling/db-execution-mode.ts";
export {
  emitSharedDbCheckSummary,
  runSharedDbCheck,
} from "./tooling/shared-db-check.ts";
export {
  emitSharedDbGenerateSummary,
  runSharedDbGenerate,
} from "./tooling/shared-db-generate.ts";
export {
  emitSharedDbInspectSummary,
  runSharedDbInspect,
} from "./tooling/shared-db-inspect.ts";
export {
  type DbExecutionMode,
  emitSharedDbMigrateSummary,
  runSharedDbMigrate,
} from "./tooling/shared-db-migrate.ts";
export {
  emitSharedDbOptimizeSummary,
  runSharedDbOptimize,
} from "./tooling/shared-db-optimize.ts";
export {
  inspectSharedCoreDispatchPhysicalContract,
  verifySharedCoreDispatchPhysicalContract,
} from "./tooling/shared-db-physical-check.ts";
export {
  emitSharedDbVerifySummary,
  runSharedDbVerify,
} from "./tooling/shared-db-verify.ts";
