import fs from "node:fs";
import path from "node:path";
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

describe("owned device registry schema", () => {
  it("keeps a canonical owned-device schema module, exports, and migration", () => {
    const schemaSource = readRepoFile(
      "packages/db/src/core/owned-device.schema.ts"
    );
    const coreIndexSource = readRepoFile("packages/db/src/core/index.ts");
    const dispatchSchemaSource = readRepoFile(
      "packages/db/src/core/dispatch.schema.ts"
    );
    const rootSchemaSource = readRepoFile("packages/db/src/schema.ts");
    const migrationSource = readRepoFile(
      "packages/db/drizzle/0000_openmeld_initial_schema.sql"
    );
    const journalSource = readRepoFile(
      "packages/db/drizzle/meta/_journal.json"
    );

    expect(schemaSource).toContain(
      "export const openMeldDaemonOwnedDevices = sqliteTable("
    );
    expect(schemaSource).toContain('"openMeldDaemon_owned_devices"');
    expect(schemaSource).toContain('text("owner_user_id").notNull()');
    expect(schemaSource).toContain('text("device_id").notNull()');
    expect(schemaSource).toContain('text("observed_display_name")');
    expect(schemaSource).toContain('text("user_display_name")');
    expect(schemaSource).toContain('text("platform_family")');
    expect(schemaSource).toContain('text("os_version")');
    expect(schemaSource).toContain('text("device_type")');
    expect(schemaSource).toContain('integer("first_seen_at_ms").notNull()');
    expect(schemaSource).toContain('integer("last_observed_at_ms")');
    expect(schemaSource).toContain('integer("updated_at_ms").notNull()');
    expect(schemaSource).toContain(
      'uniqueIndex("openMeldDaemon_owned_devices_owner_device_unique")'
    );

    expect(coreIndexSource).toContain("openMeldDaemonOwnedDevices");
    expect(dispatchSchemaSource).toContain("openMeldDaemonOwnedDevices");
    expect(rootSchemaSource).toContain("openMeldDaemonOwnedDevices");

    expect(migrationSource).toContain(
      "CREATE TABLE `openMeldDaemon_owned_devices`"
    );
    expect(migrationSource).toContain("`owner_user_id` text NOT NULL");
    expect(migrationSource).toContain("`device_id` text NOT NULL");
    expect(migrationSource).toContain(
      "CREATE UNIQUE INDEX `openMeldDaemon_owned_devices_owner_device_unique`"
    );
    expect(migrationSource).toContain("`last_observed_at_ms` integer");
    expect(journalSource).toContain("0000_openmeld_initial_schema");
  });
});
