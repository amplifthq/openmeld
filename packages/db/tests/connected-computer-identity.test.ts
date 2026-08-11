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

describe("connected computer identity schema", () => {
  it("keeps Core-owned connected computer identity separate from legacy device evidence", () => {
    const connectedComputerSchemaSource = readRepoFile(
      "packages/db/src/core/connected-computer.schema.ts"
    );
    const ownedDeviceSchemaSource = readRepoFile(
      "packages/db/src/core/owned-device.schema.ts"
    );
    const coreIndexSource = readRepoFile("packages/db/src/core/index.ts");
    const rootSchemaSource = readRepoFile("packages/db/src/schema.ts");
    const migrationSource = readRepoFile(
      "packages/db/drizzle/0000_openmeld_initial_schema.sql"
    );

    expect(connectedComputerSchemaSource).toContain(
      "export const openMeldDaemonConnectedComputers = sqliteTable("
    );
    expect(connectedComputerSchemaSource).toContain(
      '"openMeldDaemon_connected_computers"'
    );
    expect(connectedComputerSchemaSource).toContain(
      'text("connected_computer_id").notNull()'
    );
    expect(connectedComputerSchemaSource).toContain(
      'uniqueIndex("openMeldDaemon_connected_computers_owner_computer_unique")'
    );
    expect(ownedDeviceSchemaSource).toContain('text("connected_computer_id")');
    expect(ownedDeviceSchemaSource).toContain(
      'index("idx_openMeldDaemon_owned_devices_owner_connected_computer")'
    );
    expect(coreIndexSource).toContain("openMeldDaemonConnectedComputers");
    expect(rootSchemaSource).toContain("openMeldDaemonConnectedComputers");
    expect(migrationSource).toContain(
      "CREATE TABLE `openMeldDaemon_connected_computers`"
    );
    expect(migrationSource).toContain("`connected_computer_id` text");
    expect(migrationSource).toContain(
      "CREATE INDEX `idx_openMeldDaemon_owned_devices_owner_connected_computer`"
    );
  });
});
