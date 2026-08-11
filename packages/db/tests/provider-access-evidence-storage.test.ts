import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const TABLE_NAME = "openMeldDaemon_provider_access_evidence";
const UNIQUE_ERROR_PATTERN = /UNIQUE/;

const readRepoFile = (relativePath: string): string => {
  return fs.readFileSync(
    path.resolve(repoRootDirectoryPath, relativePath),
    "utf8"
  );
};

const readMigrationStatementsForTable = (
  tableName: string
): readonly string[] => {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  const quotedTableName = `\`${tableName}\``;
  const statements = fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entry) =>
      fs
        .readFileSync(path.resolve(migrationDirectoryPath, entry), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
    )
    .filter(
      (statement) => statement.length > 0 && statement.includes(quotedTableName)
    );
  if (
    !statements.some((statement) =>
      statement.includes(`CREATE TABLE ${quotedTableName}`)
    )
  ) {
    throw new Error(`${tableName} migration SQL was not found`);
  }

  return statements;
};

const applyMigrationForTable = (database: DatabaseSync, tableName: string) => {
  for (const statement of readMigrationStatementsForTable(tableName)) {
    database.exec(statement);
  }
};

describe("Provider access evidence storage schema", () => {
  it("stores one fresh provider account blocker per matching execution target", () => {
    const schemaSource = readRepoFile(
      "packages/db/src/core/provider-access-evidence.schema.ts"
    );
    const coreIndexSource = readRepoFile("packages/db/src/core/index.ts");
    const coreSchemaSource = readRepoFile(
      "packages/db/src/core/dispatch.schema.ts"
    );
    const sharedSchemaSource = readRepoFile("packages/db/src/schema.ts");

    expect(schemaSource).toContain(
      "export const openMeldDaemonProviderAccessEvidence = sqliteTable("
    );
    expect(schemaSource).toContain(`"${TABLE_NAME}"`);
    expect(schemaSource).toContain(
      "openMeldDaemon_provider_access_evidence_execution_provider_unique"
    );
    expect(schemaSource).toContain(
      "idx_openMeldDaemon_provider_access_evidence_readiness"
    );
    expect(schemaSource).toContain(
      "idx_openMeldDaemon_provider_access_evidence_source_dispatch"
    );

    expect(coreIndexSource).toContain("openMeldDaemonProviderAccessEvidence");
    expect(coreSchemaSource).toContain("openMeldDaemonProviderAccessEvidence");
    expect(sharedSchemaSource).toContain(
      "openMeldDaemonProviderAccessEvidence"
    );

    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationForTable(database, TABLE_NAME);

      const columns = database
        .prepare(`PRAGMA table_info('${TABLE_NAME}')`)
        .all()
        .map((column) => column.name);
      expect(columns).toEqual([
        "evidence_id",
        "provider",
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

      const indexes = database
        .prepare(`PRAGMA index_list('${TABLE_NAME}')`)
        .all()
        .map((index) => index.name);
      expect(indexes).toContain(
        "openMeldDaemon_provider_access_evidence_execution_provider_unique"
      );
      expect(indexes).toContain(
        "idx_openMeldDaemon_provider_access_evidence_readiness"
      );
      expect(indexes).toContain(
        "idx_openMeldDaemon_provider_access_evidence_source_dispatch"
      );

      insertEvidence(database, { evidenceId: "evidence-1" });
      expect(() =>
        insertEvidence(database, { evidenceId: "evidence-2" })
      ).toThrow(UNIQUE_ERROR_PATTERN);
      expect(() =>
        insertEvidence(database, {
          agentControllerRef: "builtin:codex",
          evidenceId: "evidence-3",
        })
      ).not.toThrow();
    } finally {
      database.close();
    }
  });
});

function insertEvidence(
  database: DatabaseSync,
  input: {
    agentControllerRef?: string;
    evidenceId: string;
  }
) {
  database
    .prepare(
      `
        INSERT INTO openMeldDaemon_provider_access_evidence (
          evidence_id,
          provider,
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
        VALUES (?, 'claude-code', 'agent-profile-1', 'binding-1', 'runtime-1', ?, 'provider_account.subscription_access_unavailable', 'wake_failure', 'dispatch-1', 'attempt-1', 1000, 4600000, NULL, NULL, 1000, 1000)
      `
    )
    .run(input.evidenceId, input.agentControllerRef ?? "builtin:claude-code");
}
