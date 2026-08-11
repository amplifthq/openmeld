import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const TABLE_NAME = "openMeldDaemon_agent_execution_readiness_impacts";
const UNIQUE_ERROR_PATTERN = /UNIQUE/;

const readRepoFile = (relativePath: string): string => {
  return fs.readFileSync(
    path.resolve(repoRootDirectoryPath, relativePath),
    "utf8"
  );
};

const readSharedMigrationStatements = (): readonly string[] => {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) =>
      fs.readFileSync(path.resolve(migrationDirectoryPath, entry), "utf8")
    )
    .join("\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

const applySharedMigrations = (database: DatabaseSync) => {
  for (const statement of readSharedMigrationStatements()) {
    database.exec(statement);
  }
};

describe("Agent execution readiness impact storage schema", () => {
  it("stores one fresh readiness impact per execution target, with TTL and clearing", () => {
    const schemaSource = readRepoFile(
      "packages/db/src/core/agent-execution-readiness-impact.schema.ts"
    );
    const coreIndexSource = readRepoFile("packages/db/src/core/index.ts");
    const coreSchemaSource = readRepoFile(
      "packages/db/src/core/dispatch.schema.ts"
    );
    const sharedSchemaSource = readRepoFile("packages/db/src/schema.ts");

    expect(schemaSource).toContain(
      "export const openMeldDaemonAgentExecutionReadinessImpacts = sqliteTable("
    );
    expect(schemaSource).toContain(`"${TABLE_NAME}"`);
    expect(schemaSource).toContain(
      "openMeldDaemon_agent_execution_readiness_impacts_target_kind_unique"
    );
    expect(schemaSource).toContain(
      "idx_openMeldDaemon_agent_execution_readiness_impacts_readiness"
    );
    expect(schemaSource).toContain(
      "idx_openMeldDaemon_agent_execution_readiness_impacts_source_dispatch"
    );

    expect(coreIndexSource).toContain(
      "openMeldDaemonAgentExecutionReadinessImpacts"
    );
    expect(coreSchemaSource).toContain(
      "openMeldDaemonAgentExecutionReadinessImpacts"
    );
    expect(sharedSchemaSource).toContain(
      "openMeldDaemonAgentExecutionReadinessImpacts"
    );

    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      const columns = database
        .prepare(`PRAGMA table_info('${TABLE_NAME}')`)
        .all()
        .map((column) => column.name);
      expect(columns).toEqual([
        "impact_id",
        "impact_kind",
        "agent_profile_id",
        "binding_id",
        "openmeld_service_runtime_id",
        "agent_controller_ref",
        "reason_code",
        "source",
        "source_dispatch_id",
        "source_attempt_id",
        "observed_at_ms",
        "expires_at_ms",
        "cleared_at_ms",
        "cleared_by_dispatch_id",
        "created_at_ms",
        "updated_at_ms",
      ]);

      insertImpact(database, { impactId: "impact-1" });
      expect(() => insertImpact(database, { impactId: "impact-2" })).toThrow(
        UNIQUE_ERROR_PATTERN
      );
      expect(() =>
        insertImpact(database, {
          impactId: "impact-3",
          openMeldServiceRuntimeId: "runtime-2",
        })
      ).not.toThrow();

      expect(readFreshImpactCount(database, 1000 + 30 * 60 * 1000 - 1)).toBe(2);
      expect(readFreshImpactCount(database, 1000 + 30 * 60 * 1000)).toBe(0);

      clearImpact(database, {
        clearedAtMs: 2000,
        sourceDispatchId: "dispatch-success",
      });
      expect(readFreshImpactCount(database, 2001)).toBe(1);
      expect(readClearedDispatchId(database, "impact-1")).toBe(
        "dispatch-success"
      );
    } finally {
      database.close();
    }
  });
});

function insertImpact(
  database: DatabaseSync,
  input: {
    impactId: string;
    openMeldServiceRuntimeId?: string;
  }
) {
  database
    .prepare(
      `
        INSERT INTO openMeldDaemon_agent_execution_readiness_impacts (
          impact_id,
          impact_kind,
          agent_profile_id,
          binding_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          reason_code,
          source,
          source_dispatch_id,
          source_attempt_id,
          observed_at_ms,
          expires_at_ms,
          cleared_at_ms,
          cleared_by_dispatch_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, 'local_execution', 'agent-profile-1', 'binding-1', ?, 'builtin:codex', 'controller.client.upgrade_required', 'wake_failure', 'dispatch-1', 'attempt-1', 1000, 1801000, NULL, NULL, 1000, 1000)
      `
    )
    .run(input.impactId, input.openMeldServiceRuntimeId ?? "runtime-1");
}

function clearImpact(
  database: DatabaseSync,
  input: {
    clearedAtMs: number;
    sourceDispatchId: string;
  }
) {
  database
    .prepare(
      `
        UPDATE openMeldDaemon_agent_execution_readiness_impacts
        SET
          cleared_at_ms = ?,
          cleared_by_dispatch_id = ?,
          updated_at_ms = ?
        WHERE agent_profile_id = 'agent-profile-1'
          AND binding_id = 'binding-1'
          AND openmeld_service_runtime_id = 'runtime-1'
          AND agent_controller_ref = 'builtin:codex'
          AND cleared_at_ms IS NULL
      `
    )
    .run(input.clearedAtMs, input.sourceDispatchId, input.clearedAtMs);
}

function readFreshImpactCount(database: DatabaseSync, nowMs: number): number {
  const row = database
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM openMeldDaemon_agent_execution_readiness_impacts
        WHERE agent_profile_id = 'agent-profile-1'
          AND binding_id = 'binding-1'
          AND agent_controller_ref = 'builtin:codex'
          AND cleared_at_ms IS NULL
          AND expires_at_ms > ?
      `
    )
    .get(nowMs) as { count: number };
  return row.count;
}

function readClearedDispatchId(
  database: DatabaseSync,
  impactId: string
): string | null {
  const row = database
    .prepare(
      `
        SELECT cleared_by_dispatch_id AS clearedByDispatchId
        FROM openMeldDaemon_agent_execution_readiness_impacts
        WHERE impact_id = ?
      `
    )
    .get(impactId) as { clearedByDispatchId: string | null };
  return row.clearedByDispatchId;
}
