import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMessageChannelSetupRequest,
  resolveMessageChannelSetupRequests,
} from "../src/remote-agent/application/message-channel-setup-request-service";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Message Channel setup requests", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;

  beforeEach(async () => {
    harness = await createPostgresHarness();

    await harness.query({
      values: ["org_one", "One", "one", 1],
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
    });
    for (const [id, name] of [
      ["member_one", "Member One"],
      ["owner_one", "Owner One"],
      ["admin_one", "Admin One"],
    ] as const) {
      await harness.query({
        values: [id, name, `${id}@example.test`],
        text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
      });
    }
  });

  afterEach(async () => await harness.close());

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
      await (
        await harness.queryAll<{ count: number }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."organization_message_channel_setup_requests"',
        })
      )[0]?.count
    ).toBe(1);
    expect(
      await harness.queryAll<{
        recipient_user_id: string;
        resolution_status: string;
        source_kind: string;
      }>({
        text: 'SELECT recipient_user_id, resolution_status, source_kind FROM "openmeld"."inbox_items" ORDER BY recipient_user_id',
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
      await harness.queryAll<{ resolution_status: string }>({
        text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
      })
    ).toEqual([{ resolution_status: "resolved" }]);
    expect(
      await harness.queryAll<{ status: string }>({
        text: 'SELECT status FROM "openmeld"."organization_message_channel_setup_requests"',
      })
    ).toEqual([{ status: "resolved" }]);
  });
});
