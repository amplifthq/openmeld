import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  requireAuthorizationUpdateInbox,
  resolveAuthorizationUpdateInbox,
} from "../src/inbox/application/authorization-update-inbox";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("shared authorization-update Inbox lifecycle", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  beforeEach(async () => {
    harness = await createPostgresHarness();
    for (const sql of [
      "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org', 'Organization', 'organization', 0), ('other', 'Other', 'other', 0)",
      "INSERT INTO \"openmeld\".\"users\" (id, name, email, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@example.test', 0, 0), ('admin', 'Admin', 'admin@example.test', 0, 0), ('member', 'Member', 'member@example.test', 0, 0)",
      'CREATE TABLE "openmeld"."source_authorization"(needed integer)',
      'GRANT SELECT ON "openmeld"."source_authorization" TO openmeld_pg_runtime',
      'INSERT INTO "openmeld"."source_authorization" VALUES (1)',
    ]) {
      await harness.query({ text: sql });
    }
  });
  afterEach(async () => await harness.close());
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
      sql: (parameterOffset: number) =>
        `EXISTS (SELECT 1 FROM "openmeld"."source_authorization" WHERE needed = $${parameterOffset + 1})`,
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
      await harness.queryAll({
        text: 'SELECT recipient_user_id, attention, resolution_status FROM "openmeld"."inbox_items" ORDER BY recipient_user_id',
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
      await (
        await harness.queryFirst<{ count: number }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."inbox_email_deliveries"',
        })
      )?.count
    ).toBe(2);
  });
  it("clears action, unread and pending email for every recipient after one completed authorization", async () => {
    await requireAuthorizationUpdateInbox({ ...identity, db: harness.db });
    await harness.query({
      text: 'UPDATE "openmeld"."source_authorization" SET needed = 0',
    });
    await resolveAuthorizationUpdateInbox({
      ...identity,
      db: harness.db,
      nowMs: 4000,
      sourceGuard: { ...identity.sourceGuard, bindings: [0] },
    });
    expect(
      await harness.queryAll({
        text: 'SELECT resolution_status, read_at_ms FROM "openmeld"."inbox_items"',
      })
    ).toEqual([
      { resolution_status: "resolved", read_at_ms: 4000 },
      { resolution_status: "resolved", read_at_ms: 4000 },
    ]);
    expect(
      await harness.queryAll({
        text: 'SELECT state FROM "openmeld"."inbox_email_deliveries"',
      })
    ).toEqual([{ state: "suppressed" }, { state: "suppressed" }]);
    await requireAuthorizationUpdateInbox({
      ...identity,
      db: harness.db,
      nowMs: 5000,
    });
    expect(
      await (
        await harness.queryFirst<{ count: number }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."inbox_items" WHERE resolution_status = \'open\'',
        })
      )?.count
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
      await (
        await harness.queryFirst<{ count: number }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."inbox_items" WHERE resolution_status = \'open\' AND read_at_ms IS NULL',
        })
      )?.count
    ).toBe(2);
    expect(
      await (
        await harness.queryFirst<{ count: number }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."inbox_email_deliveries" WHERE state = \'pending\'',
        })
      )?.count
    ).toBe(2);
  });
  it("never creates a late notification after the source has already recovered", async () => {
    await harness.query({
      text: 'UPDATE "openmeld"."source_authorization" SET needed = 0',
    });
    await requireAuthorizationUpdateInbox({ ...identity, db: harness.db });
    expect(
      await harness.queryAll({
        text: 'SELECT id FROM "openmeld"."inbox_items"',
      })
    ).toEqual([]);
    expect(
      await harness.queryAll({
        text: 'SELECT id FROM "openmeld"."inbox_email_deliveries"',
      })
    ).toEqual([]);
  });
});
