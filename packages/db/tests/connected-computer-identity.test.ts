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

describe("connected computer identity schema", () => {
  it("keeps Core-owned connected computer identity separate from legacy device evidence", async () => {
    await assertNativeStorageContract({
      table: "openMeldDaemon_connected_computers",
      uniqueKey: ["owner_user_id", "connected_computer_id"],
      epochColumns: ["created_at_ms", "updated_at_ms"],
      record: {
        owner_user_id: "owner-a",
        connected_computer_id: "computer-1",
        created_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
      distinctRecord: {
        owner_user_id: "owner-b",
        connected_computer_id: "computer-1",
        created_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
    });

    const migrationSource = readRepoFile(
      "packages/db/drizzle/0000_openmeld_initial_schema.sql"
    );

    expect(migrationSource).toContain(
      "CREATE TABLE `openMeldDaemon_connected_computers`"
    );
    expect(migrationSource).toContain("`connected_computer_id` text");
    expect(migrationSource).toContain(
      "CREATE INDEX `idx_openMeldDaemon_owned_devices_owner_connected_computer`"
    );
  });
});
