import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  fs
    .readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8")
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean);

describe("channel file publication migration", () => {
  it("preserves all prior Slack outcomes under enforced foreign keys", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE organizations(id text PRIMARY KEY); CREATE TABLE openmeld_profiles(profile_id text PRIMARY KEY); INSERT INTO users VALUES ('user'); INSERT INTO organizations VALUES ('org'); INSERT INTO openmeld_profiles VALUES ('agent');"
      );
      const prior = read("0145_calm_tarot.sql").find((sql) =>
        sql.startsWith(
          "CREATE TABLE `__new_center_agent_publication_operations`"
        )
      );
      if (!prior) {
        throw new Error("Historical publication schema missing");
      }
      db.exec(prior);
      db.exec(
        "ALTER TABLE __new_center_agent_publication_operations RENAME TO center_agent_publication_operations"
      );
      for (const status of [
        "pending",
        "completed",
        "failed",
        "outcome_unknown",
      ]) {
        db.prepare(
          "INSERT INTO center_agent_publication_operations (id, organization_id, actor_profile_id, represented_user_id, source_kind, source_id, source_revision, destination_kind, destination_id, request_signature, status, response_json, claim_id, claim_expires_at_ms, created_at_ms, updated_at_ms) VALUES (?, 'org', 'agent', 'user', 'remote_agent_execution', 'run', ?, 'slack_file', ?, ?, ?, ?, ?, ?, 1, 2)"
        ).run(
          status,
          "a".repeat(64),
          status,
          "b".repeat(64),
          status,
          status === "completed" ? '{"fileId":"F_saved"}' : null,
          status === "pending" ? "claim" : null,
          status === "pending" ? 1000 : null
        );
      }
      const before = db
        .prepare(
          "SELECT * FROM center_agent_publication_operations ORDER BY id"
        )
        .all();
      db.exec("BEGIN");
      for (const sql of read("0165_pretty_solo.sql")) {
        db.exec(sql);
      }
      db.exec("COMMIT");
      expect(
        db
          .prepare(
            "SELECT * FROM center_agent_publication_operations ORDER BY id"
          )
          .all()
      ).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      db.exec(
        "UPDATE center_agent_publication_operations SET destination_kind = 'message_channel_file' WHERE id = 'failed'"
      );
      expect(() =>
        db.exec(
          "UPDATE center_agent_publication_operations SET destination_kind = 'arbitrary' WHERE id = 'failed'"
        )
      ).toThrow();
    } finally {
      db.close();
    }
  });
});
