import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  requireAuthorizationUpdateInbox,
  resolveAuthorizationUpdateInbox,
} from "../src/inbox/application/authorization-update-inbox";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("shared authorization-update Inbox lifecycle", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;
  beforeEach(() => {
    harness = createSqliteD1Harness();
    for (const sql of [
      "CREATE TABLE organizations(id text PRIMARY KEY)",
      "CREATE TABLE users(id text PRIMARY KEY)",
      "INSERT INTO organizations VALUES ('org'), ('other')",
      "INSERT INTO users VALUES ('owner'), ('admin'), ('member')",
      "CREATE TABLE source_authorization(needed integer)",
      "INSERT INTO source_authorization VALUES (1)",
    ]) {
      harness.run({ sql });
    }
    applyDrizzleMigrationsForTables(harness, [
      "inbox_items",
      "inbox_email_deliveries",
    ]);
  });
  afterEach(() => harness.close());
  const identity = {
    organizationId: "org",
    sourceId: "channel.feishu.test",
    requirementRevision: "v2",
    displayName: "Feishu",
    target: { kind: "settings" as const, section: "channels" as const },
    occurredAtMs: 1000,
    nowMs: 2000,
    members: [
      { userId: "owner", role: "owner" },
      { userId: "admin", role: "admin" },
      { userId: "member", role: "member" },
    ],
    sourceGuard: {
      sql: "EXISTS (SELECT 1 FROM source_authorization WHERE needed = ?)",
      bindings: [1],
    },
  };
  it("deduplicates a requirement for owners/admins and queues their existing email delivery", async () => {
    await requireAuthorizationUpdateInbox({ ...identity, db: harness.db });
    await requireAuthorizationUpdateInbox({
      ...identity,
      db: harness.db,
      nowMs: 3000,
    });
    expect(
      harness.queryAll({
        sql: "SELECT recipient_user_id, attention, resolution_status FROM inbox_items ORDER BY recipient_user_id",
      })
    ).toEqual([
      {
        recipient_user_id: "admin",
        attention: "action_required",
        resolution_status: "open",
      },
      {
        recipient_user_id: "owner",
        attention: "action_required",
        resolution_status: "open",
      },
    ]);
    expect(
      harness.queryFirst<{ count: number }>({
        sql: "SELECT count(*) AS count FROM inbox_email_deliveries",
      })?.count
    ).toBe(2);
  });
  it("clears action, unread and pending email for every recipient after one completed authorization", async () => {
    await requireAuthorizationUpdateInbox({ ...identity, db: harness.db });
    harness.run({ sql: "UPDATE source_authorization SET needed = 0" });
    await resolveAuthorizationUpdateInbox({
      ...identity,
      db: harness.db,
      nowMs: 4000,
      sourceGuard: { ...identity.sourceGuard, bindings: [0] },
    });
    expect(
      harness.queryAll({
        sql: "SELECT resolution_status, read_at_ms FROM inbox_items",
      })
    ).toEqual([
      { resolution_status: "resolved", read_at_ms: 4000 },
      { resolution_status: "resolved", read_at_ms: 4000 },
    ]);
    expect(
      harness.queryAll({ sql: "SELECT state FROM inbox_email_deliveries" })
    ).toEqual([{ state: "suppressed" }, { state: "suppressed" }]);
    await requireAuthorizationUpdateInbox({
      ...identity,
      db: harness.db,
      nowMs: 5000,
    });
    expect(
      harness.queryFirst<{ count: number }>({
        sql: "SELECT count(*) AS count FROM inbox_items WHERE resolution_status = 'open'",
      })?.count
    ).toBe(0);
  });
  it("does not clear a newer requirement with stale success evidence", async () => {
    await requireAuthorizationUpdateInbox({ ...identity, db: harness.db });
    await resolveAuthorizationUpdateInbox({
      ...identity,
      db: harness.db,
      nowMs: 4000,
      sourceGuard: { ...identity.sourceGuard, bindings: [0] },
    });
    expect(
      harness.queryFirst<{ count: number }>({
        sql: "SELECT count(*) AS count FROM inbox_items WHERE resolution_status = 'open' AND read_at_ms IS NULL",
      })?.count
    ).toBe(2);
    expect(
      harness.queryFirst<{ count: number }>({
        sql: "SELECT count(*) AS count FROM inbox_email_deliveries WHERE state = 'pending'",
      })?.count
    ).toBe(2);
  });
  it("never creates a late notification after the source has already recovered", async () => {
    harness.run({ sql: "UPDATE source_authorization SET needed = 0" });
    await requireAuthorizationUpdateInbox({ ...identity, db: harness.db });
    expect(harness.queryAll({ sql: "SELECT id FROM inbox_items" })).toEqual([]);
    expect(
      harness.queryAll({ sql: "SELECT id FROM inbox_email_deliveries" })
    ).toEqual([]);
  });
});
