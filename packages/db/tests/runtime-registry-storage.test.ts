import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const readRepoFile = (relativePath: string): string => {
  return fs.readFileSync(
    path.resolve(repoRootDirectoryPath, relativePath),
    "utf8"
  );
};

const readSharedMigrationSources = (): string => {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );

  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => readRepoFile(`packages/db/drizzle/${entry}`))
    .join("\n");
};

const readSharedMigrationStatements = (): readonly string[] =>
  readSharedMigrationSources()
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const applySharedMigrations = (database: DatabaseSync) => {
  for (const statement of readSharedMigrationStatements()) {
    database.exec(statement);
  }
};

describe("runtime registry storage schema", () => {
  it("keeps Runtime Registry as a dedicated Core D1 table with canonical uniqueness", () => {
    const schemaSource = readRepoFile(
      "packages/db/src/core/runtime-registry.schema.ts"
    );
    const coreIndexSource = readRepoFile("packages/db/src/core/index.ts");
    const coreSchemaSource = readRepoFile(
      "packages/db/src/core/dispatch.schema.ts"
    );
    const sharedSchemaSource = readRepoFile("packages/db/src/schema.ts");
    const migrationSource = readSharedMigrationSources();

    expect(schemaSource).toContain(
      "export const openMeldDaemonRuntimeRegistryRecords = sqliteTable("
    );
    expect(schemaSource).toContain('"openMeldDaemon_runtime_registry_records"');
    expect(schemaSource).toContain(
      'text("openmeld_service_runtime_id").primaryKey()'
    );
    expect(schemaSource).toContain('text("owner_kind").notNull()');
    expect(schemaSource).toContain('text("owner_id").notNull()');
    expect(schemaSource).toContain('text("device_id").notNull()');
    expect(schemaSource).toContain('text("lane").notNull()');
    expect(schemaSource).toContain('integer("created_at_ms").notNull()');
    expect(schemaSource).toContain(
      'integer("last_registered_at_ms").notNull()'
    );
    expect(schemaSource).toContain('integer("updated_at_ms").notNull()');
    expect(schemaSource).toContain(
      "openMeldDaemon_runtime_registry_records_owner_device_lane_unique"
    );
    expect(schemaSource).toContain("\"owner_kind\" in ('owner_account')");

    expect(coreIndexSource).toContain("openMeldDaemonRuntimeRegistryRecords");
    expect(coreSchemaSource).toContain("openMeldDaemonRuntimeRegistryRecords");
    expect(sharedSchemaSource).toContain(
      "openMeldDaemonRuntimeRegistryRecords"
    );
    expect(migrationSource).toContain(
      "CREATE TABLE `openMeldDaemon_runtime_registry_records`"
    );
    expect(migrationSource).toContain(
      "CREATE UNIQUE INDEX `openMeldDaemon_runtime_registry_records_owner_device_lane_unique`"
    );

    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      const columns = database
        .prepare("PRAGMA table_info('openMeldDaemon_runtime_registry_records')")
        .all()
        .map((column) => column.name);
      expect(columns).toContain("openmeld_service_runtime_id");
      expect(columns).not.toContain("runtime_id");
    } finally {
      database.close();
    }
  });
});
