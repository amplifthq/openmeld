import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle/0145_calm_tarot.sql"
);
const UNIQUE_CONSTRAINT_PATTERN = /unique constraint failed/iu;

const applyMigration = (database: DatabaseSync): void => {
  const statements = fs
    .readFileSync(migrationPath, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    database.exec(statement);
  }
};

describe("Center Agent publication operation storage", () => {
  it("backfills existing publications and scopes new operations independently", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE organizations (id text PRIMARY KEY NOT NULL);
        CREATE TABLE users (id text PRIMARY KEY NOT NULL);
        CREATE TABLE openmeld_profiles (profile_id text PRIMARY KEY NOT NULL);
        INSERT INTO organizations (id) VALUES ('org-1');
        INSERT INTO users (id) VALUES ('user-1');
        INSERT INTO openmeld_profiles (profile_id) VALUES ('agent-1');
        CREATE TABLE center_agent_publication_operations (
          id text PRIMARY KEY NOT NULL,
          organization_id text NOT NULL,
          actor_profile_id text NOT NULL,
          represented_user_id text NOT NULL,
          source_kind text NOT NULL,
          source_id text NOT NULL,
          source_revision text NOT NULL,
          destination_kind text NOT NULL,
          destination_id text NOT NULL,
          request_signature text NOT NULL,
          status text NOT NULL,
          response_json text,
          claim_id text,
          claim_expires_at_ms integer,
          created_at_ms integer NOT NULL,
          updated_at_ms integer NOT NULL
        );
        INSERT INTO center_agent_publication_operations (
          id,
          organization_id,
          actor_profile_id,
          represented_user_id,
          source_kind,
          source_id,
          source_revision,
          destination_kind,
          destination_id,
          request_signature,
          status,
          response_json,
          claim_id,
          claim_expires_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'publication-1',
          'org-1',
          'agent-1',
          'user-1',
          'remote_agent_execution',
          'execution-1',
          '${"a".repeat(64)}',
          'slack_channel',
          'channel-1',
          '${"b".repeat(64)}',
          'completed',
          '{}',
          NULL,
          NULL,
          1000,
          1000
        );
      `);

      applyMigration(database);

      expect(
        database
          .prepare(
            "SELECT operation_key FROM center_agent_publication_operations WHERE id = ?"
          )
          .get("publication-1")
      ).toEqual({ operation_key: "source" });
      expect(
        database
          .prepare(
            "PRAGMA index_info('center_agent_publication_operations_scope_unique')"
          )
          .all()
          .map((column) => column.name)
      ).toEqual([
        "organization_id",
        "actor_profile_id",
        "source_kind",
        "source_id",
        "source_revision",
        "operation_key",
        "destination_kind",
        "destination_id",
      ]);

      const insertOperation = database.prepare(`
        INSERT INTO center_agent_publication_operations (
          id,
          organization_id,
          actor_profile_id,
          represented_user_id,
          source_kind,
          source_id,
          source_revision,
          operation_key,
          destination_kind,
          destination_id,
          request_signature,
          status,
          response_json,
          claim_id,
          claim_expires_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, 'org-1', 'agent-1', 'user-1', 'remote_agent_execution',
          'execution-1', ?, ?, 'slack_channel', 'channel-1', ?, 'completed',
          '{}', NULL, NULL, 1001, 1001)
      `);
      insertOperation.run(
        "publication-2",
        "a".repeat(64),
        "notify-release-owner",
        "c".repeat(64)
      );

      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM center_agent_publication_operations"
          )
          .get()
      ).toEqual({ count: 2 });
      expect(() =>
        insertOperation.run(
          "publication-duplicate",
          "a".repeat(64),
          "notify-release-owner",
          "c".repeat(64)
        )
      ).toThrow(UNIQUE_CONSTRAINT_PATTERN);
    } finally {
      database.close();
    }
  });
});
