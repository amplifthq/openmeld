import { describe, expect, it } from "vitest";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("focused D1 migration fixtures", () => {
  it("rebuilds requested identity and Binding tables with foreign keys and ownership guards intact", () => {
    const harness = createSqliteD1Harness();
    try {
      applyDrizzleMigrationsForTables(harness, [
        "users",
        "organizations",
        "members",
        "openmeld_profiles",
        "openMeldDaemon_agent_profile_bindings",
      ]);
      expect(harness.queryFirst({ sql: "PRAGMA foreign_keys" })).toEqual({
        foreign_keys: 1,
      });
      expect(
        harness.queryFirst({
          sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organization_binding_authorizations'",
        })
      ).toBeNull();
      harness.run({
        sql: "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@example.test', 1000, 1000)",
      });
      harness.run({
        sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('org', 'Organization', 'organization', 1000)",
      });
      harness.run({
        sql: "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ('agt_11111111-1111-4111-8111-111111111111', 'Agent', 'agent', 'agent', 'org', 'owner', 'cli_create')",
      });
      harness.run({
        sql: "INSERT INTO openMeldDaemon_agent_profile_bindings (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id, agent_controller_ref, binding_state, created_at_ms, updated_at_ms) VALUES ('binding', 'owner_account', 'owner', 'agt_11111111-1111-4111-8111-111111111111', 'runtime', 'builtin:codex', 'enabled_primary', 1000, 1000)",
      });
      expect(() =>
        harness.run({
          sql: "UPDATE openMeldDaemon_agent_profile_bindings SET owner_id = 'another-owner' WHERE binding_id = 'binding'",
        })
      ).toThrow("agent_profile_binding_canonical_enabled_check");
      expect(() =>
        harness.run({
          sql: "UPDATE openmeld_profiles SET owner_user_id = 'missing-user'",
        })
      ).toThrow("FOREIGN KEY constraint failed");
      expect(harness.queryAll({ sql: "PRAGMA foreign_key_check" })).toEqual([]);
    } finally {
      harness.close();
    }
  });
});
