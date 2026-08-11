import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getCoreDbSchemaSources,
  organizationInformationProtectionPolicies,
} from "../src/core";
import { schema } from "../src/schema";

const MIGRATION_JOURNAL_INDEX = 61;
const MIGRATION_TAG_PATTERN = /^0061_.+/u;
const migrationDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle"
);

type DrizzleJournal = {
  entries: Array<{ idx: number; tag: string }>;
};

function applySharedMigrations(database: DatabaseSync): void {
  const statements = fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) =>
      fs.readFileSync(path.join(migrationDirectoryPath, entry), "utf8")
    )
    .join("\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    database.exec(statement);
  }
}

describe("Organization information protection storage", () => {
  it("exports one Core-owned policy table through the shared schema", () => {
    expect(organizationInformationProtectionPolicies).toBeDefined();
    expect(schema.organizationInformationProtectionPolicies).toBe(
      organizationInformationProtectionPolicies
    );
    expect(getCoreDbSchemaSources()).toContainEqual({
      kind: "schema_module",
      owner: "packages/db",
      path: "packages/db/src/core/organization-information-protection.schema.ts",
      note: "Core owns the admin-managed Organization information protection policy in shared D1.",
    });
  });

  it("creates the policy table in migration 0061", () => {
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(migrationDirectoryPath, "meta/_journal.json"),
        "utf8"
      )
    ) as DrizzleJournal;
    expect(
      journal.entries.find((entry) => entry.idx === MIGRATION_JOURNAL_INDEX)
    ).toMatchObject({
      idx: MIGRATION_JOURNAL_INDEX,
      tag: expect.stringMatching(MIGRATION_TAG_PATTERN),
    });

    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      const columns = database
        .prepare(
          "PRAGMA table_info('organization_information_protection_policies')"
        )
        .all()
        .map((column) => column.name);
      expect(columns).toEqual([
        "organization_id",
        "protected_information",
        "updated_by_user_id",
        "created_at_ms",
        "updated_at_ms",
      ]);
    } finally {
      database.close();
    }
  });
});
