import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertNativeStorageContract } from "./native-storage.test-support";

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
  it("keeps Runtime Registry as a dedicated Core table with canonical uniqueness", async () => {
    await assertNativeStorageContract({
      table: "openMeldDaemon_runtime_registry_records",
      uniqueKey: ["owner_kind", "owner_id", "device_id", "lane"],
      epochColumns: ["created_at_ms", "last_registered_at_ms", "updated_at_ms"],
      record: {
        openmeld_service_runtime_id: "runtime-a",
        owner_kind: "owner_account",
        owner_id: "owner-a",
        device_id: "device-1",
        lane: "openmeld-dev",
        created_at_ms: 1_700_000_000_000,
        last_registered_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
      distinctRecord: {
        openmeld_service_runtime_id: "runtime-b",
        owner_kind: "owner_account",
        owner_id: "owner-b",
        device_id: "device-1",
        lane: "openmeld-dev",
        created_at_ms: 1_700_000_000_000,
        last_registered_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
    });

    const migrationSource = readSharedMigrationSources();

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
