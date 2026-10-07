import { describe, expect, it } from "vitest";
import { createInboxFeedService } from "../src/inbox/application/inbox-feed-service";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";

describe("canonical account Inbox scope", () => {
  it("shares one device item across authorized Organization feeds without exposing another tenant or accepting a legacy mutation", async () => {
    const f = await createInboxFeedFixture();
    try {
      await f.item("organization-private");
      await f.item("other-private", {
        organizationId: "other-org",
        sourceTarget: { kind: "space", spaceId: "other-space" },
      });
      await f.query({
        text: `INSERT INTO "openmeld"."inbox_items"
        (id, organization_id, recipient_user_id, kind, attention, importance, title, preview, source_kind, source_key, source_target_json, resolution_status, occurred_at_ms, created_at_ms, updated_at_ms)
        VALUES ('device-item', NULL, 'owner', 'desktop_update', 'update', 'normal', 'Update available', 'An update for your test device.', 'desktop_update', 'installation:version', $1, 'not_applicable', 1, 1, 1)`,
        values: [
          JSON.stringify({
            kind: "desktop_update",
            installationId: "installation",
            lane: "dev-local",
            deviceName: "Test device",
            platform: "darwin",
            version: "1.2.3",
            state: "available",
          }),
        ],
      });
      const feed = createInboxFeedService({ db: f.db });
      const a = await feed.list(f.identity);
      const b = await feed.list({ ...f.identity, organizationId: "other-org" });
      expect(a.rows.map((r) => r.item.id)).toContain("device-item");
      expect(b.rows.map((r) => r.item.id)).toContain("device-item");
      expect(a.rows.map((r) => r.item.title)).not.toContain("other-private");
      expect(b.rows.map((r) => r.item.title)).not.toContain(
        "organization-private"
      );
      expect(
        (await feed.list({ ...f.identity, recipientUserId: "other" })).rows
      ).toEqual([]);
      const legacy = createInboxService({ db: f.db });
      await expect(
        legacy.get({ ...f.identity, itemId: "device-item" })
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        legacy.markRead({ ...f.identity, itemId: "device-item", read: true })
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await legacy.list(f.identity)).items.map((i) => i.id)
      ).not.toContain("device-item");
      const current = createInboxService({
        db: f.db,
        includeAccountItems: true,
      });
      await current.markRead({
        ...f.identity,
        itemId: "device-item",
        read: true,
      });
      expect(
        (
          await current.get({
            ...f.identity,
            organizationId: "other-org",
            itemId: "device-item",
          })
        ).item.readAt
      ).not.toBeNull();
      await current.dismiss({
        ...f.identity,
        organizationId: "other-org",
        itemId: "device-item",
      });
      expect(
        (await feed.list(f.identity)).rows.map((r) => r.item.id)
      ).not.toContain("device-item");
      expect(
        await f.queryFirst({
          text: 'SELECT count(*) AS n FROM "openmeld"."inbox_items" WHERE id = \'device-item\'',
        })
      ).toEqual({ n: 1 });
    } finally {
      await f.close();
    }
  });
});
