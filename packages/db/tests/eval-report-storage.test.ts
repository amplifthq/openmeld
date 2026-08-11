import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const TABLE_NAME = "eval_reports";
const CHECK_ERROR_PATTERN = /CHECK/;
const FOREIGN_KEY_ERROR_PATTERN = /FOREIGN KEY/;
const UNIQUE_ERROR_PATTERN = /UNIQUE/;

const readRepoFile = (relativePath: string): string =>
  fs.readFileSync(path.resolve(repoRootDirectoryPath, relativePath), "utf8");

const readMigrationStatements = (): readonly string[] => {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  const statements = fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entry) =>
      readRepoFile(`packages/db/drizzle/${entry}`)
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
    )
    .filter(
      (statement) =>
        statement.length > 0 && statement.includes(`\`${TABLE_NAME}\``)
    );
  if (!statements.some((statement) => statement.startsWith("CREATE TABLE"))) {
    throw new Error(`${TABLE_NAME} migration SQL was not found`);
  }
  return statements;
};

describe("weekly eval report storage schema", () => {
  it("keeps one Organization-scoped projection per reporting period", () => {
    const schemaSource = readRepoFile(
      "packages/db/src/core/eval-report.schema.ts"
    );
    const coreIndexSource = readRepoFile("packages/db/src/core/index.ts");
    const coreSchemaSource = readRepoFile(
      "packages/db/src/core/dispatch.schema.ts"
    );
    const sharedSchemaSource = readRepoFile("packages/db/src/schema.ts");

    expect(schemaSource).toContain("export const evalReports = sqliteTable(");
    expect(coreIndexSource).toContain("evalReports");
    expect(coreSchemaSource).toContain("evalReports");
    expect(sharedSchemaSource).toContain("evalReports");

    const database = new DatabaseSync(":memory:");
    try {
      database.exec(
        "PRAGMA foreign_keys = ON; CREATE TABLE organizations (id text PRIMARY KEY)"
      );
      for (const statement of readMigrationStatements()) {
        database.exec(statement);
      }

      const columns = database
        .prepare(`PRAGMA table_info('${TABLE_NAME}')`)
        .all()
        .map((column) => column.name);
      expect(columns).toEqual([
        "organization_id",
        "period_start",
        "period_end",
        "metrics_json",
        "created_at",
      ]);

      database.exec("INSERT INTO organizations (id) VALUES ('org-a')");
      const insert = database.prepare(
        `
          INSERT INTO eval_reports (
            organization_id,
            period_start,
            period_end,
            metrics_json,
            created_at
          ) VALUES (?, ?, ?, '{}', ?)
        `
      );
      insert.run("org-a", 100, 200, 300);
      expect(() => insert.run("org-a", 100, 200, 301)).toThrow(
        UNIQUE_ERROR_PATTERN
      );
      expect(() => insert.run("org-a", 300, 200, 301)).toThrow(
        CHECK_ERROR_PATTERN
      );
      expect(() => insert.run("org-missing", 200, 300, 301)).toThrow(
        FOREIGN_KEY_ERROR_PATTERN
      );
    } finally {
      database.close();
    }
  });
});
