// biome-ignore-all lint/performance/noBarrelFile: This thin subpath alias keeps deprecated auth-named tooling entrypoints bound to the shared DB fact contract.

export {
  emitSharedDbGenerateSummary as emitAuthDbGenerateSummary,
  runSharedDbGenerate as runAuthDbGenerate,
} from "./shared-db-generate.ts";
