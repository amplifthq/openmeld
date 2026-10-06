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

describe("runtime agent controller report storage schema", () => {
  it("keeps current Runtime Agent Controller Reports in a dedicated Core table", async () => {
    await assertNativeStorageContract({
      table: "openMeldDaemon_runtime_agent_controller_reports",
      uniqueKey: ["openmeld_service_runtime_id", "agent_controller_ref"],
      epochColumns: [
        "observed_at_ms",
        "expires_at_ms",
        "accepted_at_ms",
        "updated_at_ms",
      ],
      record: {
        openmeld_service_runtime_id: "runtime-a",
        agent_controller_ref: "builtin:codex",
        report_status: "ready",
        observed_at_ms: 1_700_000_000_000,
        expires_at_ms: 1_700_000_001_000,
        reported_reason_codes_json: "[]",
        agent_controller_interface_json: null,
        accepted_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
      distinctRecord: {
        openmeld_service_runtime_id: "runtime-b",
        agent_controller_ref: "builtin:codex",
        report_status: "ready",
        observed_at_ms: 1_700_000_000_000,
        expires_at_ms: 1_700_000_001_000,
        reported_reason_codes_json: "[]",
        agent_controller_interface_json: null,
        accepted_at_ms: 1_700_000_000_000,
        updated_at_ms: 1_700_000_000_000,
      },
    });

    const migrationSource = readSharedMigrationSources();
    const localStateSplitBaselineSource = readRepoFile(
      "packages/db/split/openmeld-local-state/0000_baseline.sql"
    );

    expect(migrationSource).toContain(
      "CREATE TABLE `openMeldDaemon_runtime_agent_controller_reports`"
    );
    expect(migrationSource).toContain(
      "CREATE UNIQUE INDEX `openMeldDaemon_runtime_agent_controller_reports_runtime_agent_controller_unique`"
    );
    expect(migrationSource).toContain(
      "CREATE INDEX `idx_openMeldDaemon_runtime_agent_controller_reports_runtime_expires`"
    );
    expect(migrationSource).toContain(
      "CREATE INDEX `idx_openMeldDaemon_runtime_agent_controller_reports_agent_controller_status_expires`"
    );
    expect(migrationSource).toContain("`agent_controller_interface_json` text");
    expect(migrationSource).not.toContain(
      "openMeldDaemon_runtime_capability_reports"
    );
    expect(localStateSplitBaselineSource).toContain(
      "`agent_controller_interface_json` text"
    );
    expect(localStateSplitBaselineSource).not.toContain(
      "openMeldDaemon_runtime_capability_reports"
    );
  });
});
