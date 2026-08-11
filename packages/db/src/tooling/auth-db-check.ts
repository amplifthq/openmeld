// biome-ignore-all lint/performance/noBarrelFile: This thin subpath alias keeps deprecated auth-named tooling entrypoints bound to the shared DB fact contract.

export {
  emitSharedDbCheckSummary as emitAuthDbCheckSummary,
  runSharedDbCheck as runAuthDbCheck,
} from "./shared-db-check.ts";
