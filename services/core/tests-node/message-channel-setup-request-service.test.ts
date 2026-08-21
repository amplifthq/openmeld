import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMessageChannelSetupRequest,
  resolveMessageChannelSetupRequests,
} from "../src/remote-agent/application/message-channel-setup-request-service";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Message Channel setup requests", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `CREATE TABLE organizations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    });
    harness.run({
      sql: `CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )`,
    });
    applyDrizzleMigrationsForTables(harness, [
      "organization_message_channel_setup_requests",
      "inbox_items",
      "inbox_email_deliveries",
    ]);
    harness.run({
      params: ["org_one", "One", "one", 1],
      sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
    });
    for (const [id, name] of [
      ["member_one", "Member One"],
      ["owner_one", "Owner One"],
      ["admin_one", "Admin One"],
    ] as const) {
      harness.run({
        params: [id, name, `${id}@example.test`],
        sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
      });
    }
  });

  afterEach(() => harness.close());

  it("creates one durable request and an actionable Inbox item for every admin", async () => {
    const first = await createMessageChannelSetupRequest({
      db: harness.db,
      nowMs: 1000,
      organizationId: "org_one",
      provider: "slack",
      recipients: ["owner_one", "admin_one"],
      requester: { displayName: "Member One", userId: "member_one" },
    });
    const repeated = await createMessageChannelSetupRequest({
      db: harness.db,
      nowMs: 1100,
      organizationId: "org_one",
      provider: "slack",
      recipients: ["owner_one", "admin_one"],
      requester: { displayName: "Member One", userId: "member_one" },
    });

    expect(first.status).toBe("created");
    expect(repeated).toMatchObject({
      recipientCount: 2,
      requestId: first.requestId,
      status: "already_requested",
    });
    expect(
      harness.queryAll<{ count: number }>({
        sql: "SELECT count(*) AS count FROM organization_message_channel_setup_requests",
      })[0]?.count
    ).toBe(1);
    expect(
      harness.queryAll<{
        recipient_user_id: string;
        resolution_status: string;
        source_kind: string;
      }>({
        sql: "SELECT recipient_user_id, resolution_status, source_kind FROM inbox_items ORDER BY recipient_user_id",
      })
    ).toEqual([
      {
        recipient_user_id: "admin_one",
        resolution_status: "open",
        source_kind: "organization_member_request",
      },
      {
        recipient_user_id: "owner_one",
        resolution_status: "open",
        source_kind: "organization_member_request",
      },
    ]);
  });

  it("resolves every matching Inbox request when the Organization connects the provider", async () => {
    await createMessageChannelSetupRequest({
      db: harness.db,
      nowMs: 1000,
      organizationId: "org_one",
      provider: "lark",
      recipients: ["owner_one"],
      requester: { displayName: "Member One", userId: "member_one" },
    });

    expect(
      await resolveMessageChannelSetupRequests({
        db: harness.db,
        organizationId: "org_one",
        provider: "lark",
        resolvedAtMs: 2000,
      })
    ).toBe(1);
    expect(
      harness.queryAll<{ resolution_status: string }>({
        sql: "SELECT resolution_status FROM inbox_items",
      })
    ).toEqual([{ resolution_status: "resolved" }]);
    expect(
      harness.queryAll<{ status: string }>({
        sql: "SELECT status FROM organization_message_channel_setup_requests",
      })
    ).toEqual([{ status: "resolved" }]);
  });
});
