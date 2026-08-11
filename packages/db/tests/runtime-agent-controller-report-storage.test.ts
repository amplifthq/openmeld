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
  it("keeps current Runtime Agent Controller Reports in a dedicated Core D1 table", () => {
    const schemaSource = readRepoFile(
      "packages/db/src/core/runtime-agent-controller-report.schema.ts"
    );
    const coreIndexSource = readRepoFile("packages/db/src/core/index.ts");
    const coreSchemaSource = readRepoFile(
      "packages/db/src/core/dispatch.schema.ts"
    );
    const sharedSchemaSource = readRepoFile("packages/db/src/schema.ts");
    const migrationSource = readSharedMigrationSources();
    const localStateSplitBaselineSource = readRepoFile(
      "packages/db/split/openmeld-local-state/0000_baseline.sql"
    );

    expect(schemaSource).toContain(
      "export const openMeldDaemonRuntimeAgentControllerReports = sqliteTable("
    );
    expect(schemaSource).toContain(
      '"openMeldDaemon_runtime_agent_controller_reports"'
    );
    expect(schemaSource).toContain(
      'text("openmeld_service_runtime_id").notNull()'
    );
    expect(schemaSource).toContain('text("agent_controller_ref").notNull()');
    expect(schemaSource).toContain('text("report_status").notNull()');
    expect(schemaSource).toContain('integer("observed_at_ms").notNull()');
    expect(schemaSource).toContain('integer("expires_at_ms").notNull()');
    expect(schemaSource).toContain(
      'text("reported_reason_codes_json").notNull()'
    );
    expect(schemaSource).toContain('text("agent_controller_interface_json")');
    expect(schemaSource).toContain('integer("accepted_at_ms").notNull()');
    expect(schemaSource).toContain('integer("updated_at_ms").notNull()');
    expect(schemaSource).toContain(
      '"openMeldDaemon_runtime_agent_controller_reports_runtime_agent_controller_unique"'
    );
    expect(schemaSource).toContain(
      '"idx_openMeldDaemon_runtime_agent_controller_reports_runtime_expires"'
    );
    expect(schemaSource).toContain(
      '"idx_openMeldDaemon_runtime_agent_controller_reports_agent_controller_status_expires"'
    );

    expect(coreIndexSource).toContain(
      "openMeldDaemonRuntimeAgentControllerReports"
    );
    expect(coreSchemaSource).toContain(
      "openMeldDaemonRuntimeAgentControllerReports"
    );
    expect(sharedSchemaSource).toContain(
      "openMeldDaemonRuntimeAgentControllerReports"
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
