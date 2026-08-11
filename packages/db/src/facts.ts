// Lightweight runtime entrypoint for database diagnostics.
//
// Keep this entrypoint free of Drizzle schema exports. Workers use these facts
// for diagnostics and migration drift checks; loading the schema graph would
// otherwise construct every table before the first request reaches the Worker.

// biome-ignore-all lint/performance/noBarrelFile: This entrypoint intentionally isolates runtime metadata from the schema barrel.
export { buildDbFactSnapshot } from "./diagnostics/fact-builders.ts";
export { LATEST_SHARED_MIGRATION_ID } from "./shared/fact-metadata.ts";
export { buildSharedRuntimeDbTarget } from "./shared/runtime-target.ts";
