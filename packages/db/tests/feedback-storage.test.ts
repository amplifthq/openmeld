import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getCoreDbSchemaSources,
  openMeldFeedbackInboxes,
  openMeldFeedbackIssues,
  openMeldFeedbackReportingPolicies,
} from "../src/core";
import { schema } from "../src/schema";

const FEEDBACK_MIGRATION_JOURNAL_INDEX = 20;
const FEEDBACK_MIGRATION_TAG_PATTERN = /^0021_.+/u;
const FEEDBACK_REPORTING_POLICY_MIGRATION_JOURNAL_INDEX = 21;
const FEEDBACK_REPORTING_POLICY_MIGRATION_TAG_PATTERN = /^0022_.+/u;
const UNIQUE_CONSTRAINT_ERROR_PATTERN = /UNIQUE constraint failed/u;

type DrizzleJournal = {
  entries: Array<{
    idx: number;
    tag: string;
  }>;
};

const migrationDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle"
);

const readFeedbackMigrationEntry = () => {
  const journal = JSON.parse(
    fs.readFileSync(
      path.join(migrationDirectoryPath, "meta/_journal.json"),
      "utf8"
    )
  ) as DrizzleJournal;

  return journal.entries.find(
    (entry) => entry.idx === FEEDBACK_MIGRATION_JOURNAL_INDEX
  );
};

const readMigrationStatements = (): readonly string[] => {
  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) =>
      fs.readFileSync(path.join(migrationDirectoryPath, entry), "utf8")
    )
    .join("\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

const applySharedMigrations = (database: DatabaseSync): void => {
  for (const statement of readMigrationStatements()) {
    database.exec(statement);
  }
};

describe("Feedback storage", () => {
  it("exports all Core-owned Feedback tables through the shared schema", () => {
    expect(openMeldFeedbackReportingPolicies).toBeDefined();
    expect(schema.openMeldFeedbackInboxes).toBe(openMeldFeedbackInboxes);
    expect(schema.openMeldFeedbackIssues).toBe(openMeldFeedbackIssues);
    expect(schema.openMeldFeedbackReportingPolicies).toBe(
      openMeldFeedbackReportingPolicies
    );
    expect(getCoreDbSchemaSources()).toContainEqual({
      kind: "schema_module",
      owner: "packages/db",
      path: "packages/db/src/core/feedback.schema.ts",
      note: "Feedback Inbox, Feedback Issue, and Feedback reporting policy truth is Core-owned and migrates through the shared OPENMELD_DB history.",
    });
  });

  it("keeps the public migration tag at 0021 while the Drizzle index stays 20", () => {
    const entry = readFeedbackMigrationEntry();

    expect(entry).toMatchObject({
      idx: FEEDBACK_MIGRATION_JOURNAL_INDEX,
      tag: expect.stringMatching(FEEDBACK_MIGRATION_TAG_PATTERN),
    });
    expect(
      fs.existsSync(
        path.join(
          migrationDirectoryPath,
          "meta",
          `${String(FEEDBACK_MIGRATION_JOURNAL_INDEX).padStart(4, "0")}_snapshot.json`
        )
      )
    ).toBe(true);
  });

  it("adds the reporting policy in migration 0022 at Drizzle index 21", () => {
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(migrationDirectoryPath, "meta/_journal.json"),
        "utf8"
      )
    ) as DrizzleJournal;
    const entry = journal.entries.find(
      (candidate) =>
        candidate.idx === FEEDBACK_REPORTING_POLICY_MIGRATION_JOURNAL_INDEX
    );

    expect(entry).toMatchObject({
      idx: FEEDBACK_REPORTING_POLICY_MIGRATION_JOURNAL_INDEX,
      tag: expect.stringMatching(
        FEEDBACK_REPORTING_POLICY_MIGRATION_TAG_PATTERN
      ),
    });
    expect(
      fs.existsSync(
        path.join(
          migrationDirectoryPath,
          "meta",
          `${String(FEEDBACK_REPORTING_POLICY_MIGRATION_JOURNAL_INDEX).padStart(4, "0")}_snapshot.json`
        )
      )
    ).toBe(true);
  });

  it("creates the Feedback Inbox and Feedback Issue columns and indexes", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      expect(readColumns(database, "openMeldFeedback_inboxes")).toEqual([
        "inbox_id",
        "organization_id",
        "label",
        "inbox_key",
        "delivery_mode",
        "status",
        "created_at_ms",
        "updated_at_ms",
      ]);
      expect(readColumns(database, "openMeldFeedback_issues")).toEqual([
        "issue_id",
        "inbox_id",
        "organization_id",
        "category",
        "summary",
        "details",
        "submitter_kind",
        "submitter_user_id",
        "source_organization_id",
        "contact_email",
        "client_context",
        "status",
        "triage_note",
        "created_at_ms",
        "updated_at_ms",
      ]);
      expect(
        readColumns(database, "openMeldFeedback_reporting_policies")
      ).toEqual([
        "organization_id",
        "reporting_enabled",
        "updated_by_user_id",
        "created_at_ms",
        "updated_at_ms",
      ]);

      expect(readIndexes(database, "openMeldFeedback_inboxes")).toContain(
        "openMeldFeedback_inboxes_inbox_key_unique"
      );
      expect(readIndexes(database, "openMeldFeedback_issues")).toContain(
        "idx_openMeldFeedback_issues_inbox_status_created"
      );
    } finally {
      database.close();
    }
  });

  it("defaults new issues to new and rejects duplicate inbox keys", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      insertInbox(database, {
        inboxId: "feedback_inbox_1",
        inboxKey: "feedback_key_1",
      });
      database
        .prepare(
          `
            INSERT INTO openMeldFeedback_issues (
              issue_id,
              inbox_id,
              organization_id,
              category,
              summary,
              submitter_kind,
              created_at_ms,
              updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          "feedback_issue_1",
          "feedback_inbox_1",
          "org_1",
          "bug",
          "The submit button did not respond.",
          "human",
          1000,
          1000
        );

      expect(
        database
          .prepare(
            "SELECT status FROM openMeldFeedback_issues WHERE issue_id = ?"
          )
          .get("feedback_issue_1")
      ).toEqual({ status: "new" });
      expect(() =>
        insertInbox(database, {
          inboxId: "feedback_inbox_2",
          inboxKey: "feedback_key_1",
        })
      ).toThrow(UNIQUE_CONSTRAINT_ERROR_PATTERN);
    } finally {
      database.close();
    }
  });

  it("defaults Center Agent Feedback reporting to enabled", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      database
        .prepare(
          "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
        )
        .run("org_reporting", "Reporting Org", "reporting-org", 1000);
      database
        .prepare(
          `
            INSERT INTO openMeldFeedback_reporting_policies (
              organization_id,
              created_at_ms,
              updated_at_ms
            ) VALUES (?, ?, ?)
          `
        )
        .run("org_reporting", 1000, 1000);

      expect(
        database
          .prepare(
            `
              SELECT
                reporting_enabled AS reportingEnabled,
                updated_by_user_id AS updatedByUserId
              FROM openMeldFeedback_reporting_policies
              WHERE organization_id = ?
            `
          )
          .get("org_reporting")
      ).toEqual({ reportingEnabled: 1, updatedByUserId: null });
    } finally {
      database.close();
    }
  });
});

function readColumns(database: DatabaseSync, tableName: string): unknown[] {
  return database
    .prepare(`PRAGMA table_info('${tableName}')`)
    .all()
    .map((column) => column.name);
}

function readIndexes(database: DatabaseSync, tableName: string): unknown[] {
  return database
    .prepare(`PRAGMA index_list('${tableName}')`)
    .all()
    .map((index) => index.name);
}

function insertInbox(
  database: DatabaseSync,
  input: { inboxId: string; inboxKey: string }
): void {
  database
    .prepare(
      `
        INSERT INTO openMeldFeedback_inboxes (
          inbox_id,
          organization_id,
          label,
          inbox_key,
          delivery_mode,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      input.inboxId,
      "org_1",
      "OpenMeld Feedback",
      input.inboxKey,
      "inbox_only",
      "active",
      1000,
      1000
    );
}
