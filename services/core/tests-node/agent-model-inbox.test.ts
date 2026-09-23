import { describe, expect, it, vi } from "vitest";
import {
  type AgentModelInboxSnapshot,
  reconcileAgentModelInboxProjection,
} from "../src/inbox/application/agent-model-inbox";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const original: AgentModelInboxSnapshot = {
  organizationId: "org_one",
  ownerUserId: "user_owner",
  profileId: "profile_one",
  profileName: "Research",
  identity: "binding/model-A/review-1",
  verdict: "blocked",
  occurredAtMs: 1000,
  message:
    "This model is no longer offered. Change this agent's model to continue.",
};

describe("model recovery Inbox projection", () => {
  it("deduplicates refreshes, preserves read history and never creates an email", async () => {
    const h = harness();
    try {
      const input = {
        db: h.db,
        nowMs: 2000,
        readCurrent: async () => original,
      };
      await reconcileAgentModelInboxProjection(input);
      h.run({ sql: "UPDATE inbox_items SET read_at_ms = 2100" });
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 3000 });
      expect(
        h.queryAll({
          sql: "SELECT resolution_status, read_at_ms, preview FROM inbox_items",
        })
      ).toEqual([
        {
          resolution_status: "open",
          read_at_ms: 2100,
          preview: original.message,
        },
      ]);
      expect(
        h.queryAll({ sql: "SELECT * FROM inbox_email_deliveries" })
      ).toEqual([]);
    } finally {
      h.close();
    }
  });

  it("keeps a same-model issue on unknown account evidence, clears after a user change and supports a later recurrence", async () => {
    const h = harness();
    try {
      let source = original;
      const input = { db: h.db, nowMs: 2000, readCurrent: async () => source };
      await reconcileAgentModelInboxProjection(input);
      source = { ...original, verdict: "unknown" };
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 2500 });
      expect(
        h.queryAll({ sql: "SELECT resolution_status FROM inbox_items" })
      ).toEqual([{ resolution_status: "open" }]);
      source = { ...original, identity: "binding/model-B", verdict: "clear" };
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 3000 });
      expect(
        h.queryAll({
          sql: "SELECT resolution_status, read_at_ms FROM inbox_items",
        })
      ).toEqual([{ resolution_status: "resolved", read_at_ms: null }]);
      source = original;
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 4000 });
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 5000 });
      expect(
        h.queryAll({
          sql: "SELECT resolution_status FROM inbox_items ORDER BY created_at_ms",
        })
      ).toEqual([
        { resolution_status: "resolved" },
        { resolution_status: "open" },
      ]);
      expect(original.identity).toBe("binding/model-A/review-1");
    } finally {
      h.close();
    }
  });

  it("does not publish a stale model observation after the user changed models", async () => {
    const h = harness();
    try {
      const readCurrent = vi
        .fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValue({
          ...original,
          identity: "binding/model-B",
          verdict: "clear",
        });
      await reconcileAgentModelInboxProjection({
        db: h.db,
        nowMs: 2000,
        readCurrent,
      });
      expect(h.queryAll({ sql: "SELECT * FROM inbox_items" })).toEqual([]);
    } finally {
      h.close();
    }
  });

  it("clears only this Profile's model issue, not another Agent's pending work", async () => {
    const h = harness();
    try {
      await reconcileAgentModelInboxProjection({
        db: h.db,
        nowMs: 2000,
        readCurrent: async () => original,
      });
      await reconcileAgentModelInboxProjection({
        db: h.db,
        nowMs: 2000,
        readCurrent: async () => ({
          ...original,
          profileId: "profile_two",
          identity: "other-model",
        }),
      });
      await reconcileAgentModelInboxProjection({
        db: h.db,
        nowMs: 3000,
        readCurrent: async () => ({ ...original, verdict: "clear" }),
      });
      expect(
        h.queryAll({
          sql: "SELECT json_extract(source_target_json, '$.profileId') AS profileId, resolution_status FROM inbox_items ORDER BY profileId",
        })
      ).toEqual([
        { profileId: "profile_one", resolution_status: "resolved" },
        { profileId: "profile_two", resolution_status: "open" },
      ]);
    } finally {
      h.close();
    }
  });
});

function harness() {
  const h = createSqliteD1Harness();
  h.run({
    sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, created_at INTEGER NOT NULL)",
  });
  h.run({
    sql: "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL)",
  });
  applyDrizzleMigrationsForTables(h, [
    "openmeld_profiles",
    "center_agent_designations",
    "center_agent_tasks",
    "center_agent_task_authorized_readers",
    "inbox_items",
    "inbox_email_deliveries",
    "inbox_notification_preferences",
    "inbox_center_agent_read_watermarks",
    "space_index_spaces",
    "space_index_memberships",
  ]);
  h.run({
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('org_one','Org','org',1000)",
  });
  h.run({
    sql: "INSERT INTO users (id, name, email) VALUES ('user_owner','Owner','owner@example.com')",
  });
  return h;
}
