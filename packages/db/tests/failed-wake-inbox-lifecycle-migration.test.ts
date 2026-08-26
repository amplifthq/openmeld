import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle/0146_failed_wake_inbox_lifecycle.sql"
);

const splitMigrationStatements = (source: string): string[] =>
  source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

describe("failed Wake Inbox lifecycle migration", () => {
  it("turns only legacy Space terminal-failure actions into updates", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE inbox_items (
          id text PRIMARY KEY NOT NULL,
          kind text NOT NULL,
          attention text NOT NULL,
          importance text NOT NULL,
          source_kind text NOT NULL,
          resolution_status text NOT NULL,
          read_at_ms integer,
          resolved_at_ms integer,
          CHECK (
            (attention = 'update' AND resolution_status = 'not_applicable' AND resolved_at_ms IS NULL)
            OR (attention = 'action_required' AND resolution_status = 'open' AND resolved_at_ms IS NULL)
            OR (attention = 'action_required' AND resolution_status = 'resolved' AND resolved_at_ms IS NOT NULL)
          )
        );
        INSERT INTO inbox_items VALUES
          ('legacy-failure', 'wake_outcome', 'action_required', 'urgent', 'space_signal', 'open', 1500, NULL),
          ('ordinary-wake-update', 'wake_outcome', 'update', 'normal', 'space_signal', 'not_applicable', NULL, NULL),
          ('task-action', 'center_agent_task', 'action_required', 'urgent', 'center_agent_task_event', 'open', NULL, NULL);
      `);

      for (const statement of splitMigrationStatements(
        fs.readFileSync(migrationPath, "utf8")
      )) {
        database.exec(statement);
      }

      expect(
        database
          .prepare(
            "SELECT id, attention, importance, resolution_status, read_at_ms FROM inbox_items ORDER BY id"
          )
          .all()
      ).toEqual([
        {
          attention: "update",
          id: "legacy-failure",
          importance: "urgent",
          read_at_ms: 1500,
          resolution_status: "not_applicable",
        },
        {
          attention: "update",
          id: "ordinary-wake-update",
          importance: "normal",
          read_at_ms: null,
          resolution_status: "not_applicable",
        },
        {
          attention: "action_required",
          id: "task-action",
          importance: "urgent",
          read_at_ms: null,
          resolution_status: "open",
        },
      ]);
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM inbox_items WHERE attention = 'action_required' AND resolution_status = 'open'"
          )
          .get()
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });
});
