// Lightweight Core runtime diagnostics entrypoint. The canonical Drizzle
// schema remains available through @openmeld/db/core for tooling and schema
// consumers, while Workers can import metadata without evaluating every table.

// biome-ignore-all lint/performance/noBarrelFile: This entrypoint intentionally isolates runtime metadata from the schema barrel.
export {
  CORE_DB_BINDING_NAME,
  CORE_DB_RELEASE_NOTES,
  getCoreDbMigrationSources,
  getCoreDbSchemaSources,
} from "./core/fact-metadata.ts";
