import fs from "node:fs";
import path from "node:path";
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

describe("owned device registry schema", () => {
  it("keeps a canonical owned-device schema module, exports, and migration", async () => {
    await assertNativeStorageContract({
      table: "openMeldDaemon_owned_devices",
      uniqueKey: ["owner_user_id", "device_id"],
      epochColumns: [
        "first_seen_at_ms",
        "last_observed_at_ms",
        "updated_at_ms",
      ],
      record: {
        owner_user_id: "owner-a",
        device_id: "device-1",
        connected_computer_id: "computer-1",
        first_seen_at_ms: 1_700_000_000_000,
        last_observed_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
      distinctRecord: {
        owner_user_id: "owner-b",
        device_id: "device-1",
        connected_computer_id: "computer-1",
        first_seen_at_ms: 1_700_000_000_000,
        last_observed_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
    });

    const migrationSource = readRepoFile(
      "packages/db/drizzle/0000_openmeld_initial_schema.sql"
    );
    const journalSource = readRepoFile(
      "packages/db/drizzle/meta/_journal.json"
    );

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
