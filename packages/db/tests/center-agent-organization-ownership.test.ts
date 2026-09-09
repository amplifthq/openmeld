import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = fs
  .readdirSync(new URL("../drizzle/", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort();
function migrate(db: DatabaseSync, names: string[]) {
  for (const name of names) {
    db.exec("BEGIN");
    try {
      for (const statement of fs
        .readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8")
        .split("--> statement-breakpoint")) {
        if (statement.trim()) {
          db.exec(statement);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

describe("Center Agent Organization ownership migration", () => {
  it("preserves identity, bindings, preferences and designation when the creator is deleted", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      migrate(
        db,
        migrations.filter((name) => name < "0162_")
      );
      db.exec(`
        INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('creator', 'Creator', 'creator@example.test', 1000, 1000), ('member', 'Member', 'member@example.test', 1000, 1000);
        INSERT INTO organizations (id, name, slug, created_at) VALUES ('org', 'Organization', 'organization', 1000);
        INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, organization_id, created_by_user_id, managed_role, source, created_at, updated_at)
        VALUES ('agt_11111111-1111-4111-8111-111111111111', 'Center Agent', 'center-agent', 'agent', 'creator', 'org', 'creator', 'center_agent', 'auth_bootstrap', 1000, 1000),
               ('22222222-2222-4222-8222-222222222222', 'Member', 'member', 'human', 'member', NULL, 'member', NULL, 'auth_bootstrap', 1000, 1000);
        INSERT INTO center_agent_designations (organization_id, agent_profile_id, designated_by, operating_state, paused_at, paused_by_user_id, created_at)
        VALUES ('org', 'agt_11111111-1111-4111-8111-111111111111', 'creator', 'paused', 1000, 'creator', 1000);
        INSERT INTO openmeld_profile_space_history (profile_id, gateway_host, space_id, last_joined_at, pinned_at, created_at, updated_at)
        VALUES ('22222222-2222-4222-8222-222222222222', 'localhost', 'private-space', 1000, 1000, 1000, 1000);
        INSERT INTO openMeldDaemon_agent_profile_bindings (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id, runtime_kind, hosted_runtime_identity_json, agent_controller_ref, binding_state, created_at_ms, updated_at_ms)
        VALUES ('binding-stable', 'owner_account', 'creator', 'agt_11111111-1111-4111-8111-111111111111', 'hosted', 'hosted_center_agent', '{"kind":"hosted_center_agent"}', 'hosted:center-agent', 'enabled_primary', 1000, 1000);
        INSERT INTO center_agent_audit_journal (id, organization_id, actor_profile_id, action, created_at)
        VALUES ('audit-stable', 'org', 'agt_11111111-1111-4111-8111-111111111111', 'read_context', 1000);
        INSERT INTO center_agent_context_manifests (id, organization_id, requested_by_profile_id, actor_profile_id, conversation_space_id, client_name, view, schema_version, requested_token_budget, estimated_token_count, included_message_count, truncated, truncation_reasons_json, source_refs_json, audit_entry_id, created_at)
        VALUES ('manifest-stable', 'org', '22222222-2222-4222-8222-222222222222', 'agt_11111111-1111-4111-8111-111111111111', 'private-space', 'test-client', 'messages', 'center_agent_context_manifest.v1', 256, 0, 0, 0, '[]', '[]', 'audit-stable', 1000);
        INSERT INTO openMeldRemoteAgent_conversation_generations (organization_id, logical_conversation_id, active_generation, started_at_ms, rollover_delivery_id, created_at_ms, updated_at_ms)
        VALUES ('org', 'conversation-stable', 2, 1000, 'delivery-stable', 1000, 1000);
      `);
      migrate(
        db,
        migrations.filter((name) => name >= "0162_")
      );
      expect(
        db
          .prepare(
            "SELECT id, audit_entry_id, conversation_space_id FROM center_agent_context_manifests"
          )
          .get()
      ).toEqual({
        id: "manifest-stable",
        audit_entry_id: "audit-stable",
        conversation_space_id: "private-space",
      });
      expect(
        db
          .prepare(
            "SELECT id, actor_profile_id FROM center_agent_audit_journal"
          )
          .get()
      ).toEqual({
        id: "audit-stable",
        actor_profile_id: "agt_11111111-1111-4111-8111-111111111111",
      });
      expect(
        db
          .prepare(
            "SELECT logical_conversation_id, active_generation, rollover_delivery_id FROM openMeldRemoteAgent_conversation_generations"
          )
          .get()
      ).toEqual({
        logical_conversation_id: "conversation-stable",
        active_generation: 2,
        rollover_delivery_id: "delivery-stable",
      });
      expect(
        db
          .prepare(
            "SELECT owner_user_id, organization_id FROM openmeld_profiles WHERE profile_id = 'agt_11111111-1111-4111-8111-111111111111'"
          )
          .get()
      ).toEqual({ owner_user_id: null, organization_id: "org" });
      expect(
        db
          .prepare(
            "SELECT binding_id, owner_kind, owner_id FROM openMeldDaemon_agent_profile_bindings"
          )
          .get()
      ).toEqual({
        binding_id: "binding-stable",
        owner_kind: "organization",
        owner_id: "org",
      });
      expect(
        db
          .prepare(
            "SELECT pinned_at FROM openmeld_profile_space_history WHERE profile_id = '22222222-2222-4222-8222-222222222222'"
          )
          .get()
      ).toEqual({ pinned_at: 1000 });
      expect(
        db
          .prepare("SELECT count(*) AS n FROM openmeld_profile_deletion_outbox")
          .get()
      ).toEqual({ n: 0 });
      db.exec("DELETE FROM users WHERE id = 'creator'");
      expect(
        db
          .prepare(
            "SELECT created_by_user_id FROM openmeld_profiles WHERE profile_id = 'agt_11111111-1111-4111-8111-111111111111'"
          )
          .get()
      ).toEqual({ created_by_user_id: null });
      expect(
        db
          .prepare(
            "SELECT designated_by, operating_state, paused_by_user_id FROM center_agent_designations"
          )
          .get()
      ).toEqual({
        designated_by: null,
        operating_state: "paused",
        paused_by_user_id: null,
      });
      expect(() =>
        db.exec(
          "UPDATE openmeld_profiles SET owner_user_id = 'member' WHERE profile_id = 'agt_11111111-1111-4111-8111-111111111111'"
        )
      ).toThrow();
      expect(() =>
        db.exec(
          "UPDATE openMeldDaemon_agent_profile_bindings SET owner_id = 'another-org' WHERE binding_id = 'binding-stable'"
        )
      ).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      db.exec("DELETE FROM organizations WHERE id = 'org'");
      expect(
        db
          .prepare(
            "SELECT owner_user_id, organization_id FROM openmeld_profile_deletion_outbox WHERE profile_id = 'agt_11111111-1111-4111-8111-111111111111'"
          )
          .get()
      ).toEqual({ owner_user_id: null, organization_id: "org" });
    } finally {
      db.close();
    }
  });
});
