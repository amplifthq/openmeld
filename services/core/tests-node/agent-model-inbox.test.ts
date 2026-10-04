import { describe, expect, it, vi } from "vitest";
import {
  type AgentModelInboxSnapshot,
  reconcileAgentModelInboxProjection,
} from "../src/inbox/application/agent-model-inbox";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const original: AgentModelInboxSnapshot = {
  organizationId: "org_one",
  ownerUserId: "user_owner",
  profileId: "agt_11111111-1111-4111-8111-111111111111",
  profileName: "Research",
  identity: "binding/model-A/review-1",
  verdict: "blocked",
  occurredAtMs: 1000,
  message:
    "This model is no longer offered. Change this agent's model to continue.",
};

describe("model recovery Inbox projection", () => {
  it("deduplicates refreshes, preserves read history and never creates an email", async () => {
    const h = await harness();
    try {
      const input = {
        db: h.db,
        nowMs: 2000,
        readCurrent: async () => original,
      };
      await reconcileAgentModelInboxProjection(input);
      const inbox = createInboxService({ db: h.db, nowMs: () => 2100 });
      const reader = {
        organizationId: original.organizationId,
        recipientUserId: original.ownerUserId,
      };
      const { items } = await inbox.list({ ...reader, view: "needs_action" });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        sourceTarget: { kind: "agent_profile", profileId: original.profileId },
        sourceFacts: { personalAgentProfileIds: [original.profileId] },
      });
      expect(await inbox.summary(reader)).toMatchObject({
        unresolvedActionCount: 1,
        totalUnreadCount: 1,
      });
      const item = items[0];
      if (!item) {
        throw new Error("Expected the model recovery item in the Inbox");
      }
      await inbox.markRead({ ...reader, itemId: item.id, read: true });
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 3000 });
      expect(
        await h.queryAll({
          text: 'SELECT resolution_status, read_at_ms, preview FROM "openmeld"."inbox_items"',
        })
      ).toEqual([
        {
          resolution_status: "open",
          read_at_ms: 2100,
          preview: original.message,
        },
      ]);
      expect(await inbox.summary(reader)).toMatchObject({
        unresolvedActionCount: 1,
        totalUnreadCount: 0,
      });
      expect(
        (await inbox.list({ ...reader, view: "needs_action" })).items
      ).toHaveLength(1);
      expect(
        await h.queryAll({
          text: 'SELECT * FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("exposes owner-only notices only while the exact personal Agent still belongs to that recipient and Organization", async () => {
    const h = await harness();
    try {
      await reconcileAgentModelInboxProjection({
        db: h.db,
        nowMs: 2000,
        readCurrent: async () => original,
      });
      const inbox = createInboxService({ db: h.db });
      const reader = {
        organizationId: original.organizationId,
        recipientUserId: original.ownerUserId,
      };
      expect((await inbox.list(reader)).items).toHaveLength(1);
      for (const denied of [
        { ...reader, recipientUserId: "user_other" },
        { ...reader, organizationId: "org_other" },
      ]) {
        expect((await inbox.list(denied)).items).toEqual([]);
        expect(await inbox.summary(denied)).toMatchObject({
          unresolvedActionCount: 0,
          totalUnreadCount: 0,
        });
      }
      await h.query({
        text: "UPDATE \"openmeld\".\"openmeld_profiles\" SET owner_user_id = 'user_other' WHERE profile_id = 'agt_11111111-1111-4111-8111-111111111111'",
      });
      expect((await inbox.list(reader)).items).toEqual([]);
      expect(await inbox.summary(reader)).toMatchObject({
        unresolvedActionCount: 0,
        totalUnreadCount: 0,
      });
      // Access revocation preserves the historical row instead of deleting it.
      expect(
        await h.queryAll({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual([{ resolution_status: "open" }]);
    } finally {
      await h.close();
    }
  });

  it("keeps a same-model issue on unknown account evidence, clears after a user change and supports a later recurrence", async () => {
    const h = await harness();
    try {
      let source = original;
      const input = { db: h.db, nowMs: 2000, readCurrent: async () => source };
      await reconcileAgentModelInboxProjection(input);
      source = { ...original, verdict: "unknown" };
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 2500 });
      expect(
        await h.queryAll({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual([{ resolution_status: "open" }]);
      source = { ...original, identity: "binding/model-B", verdict: "clear" };
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 3000 });
      expect(
        await h.queryAll({
          text: 'SELECT resolution_status, read_at_ms FROM "openmeld"."inbox_items"',
        })
      ).toEqual([{ resolution_status: "resolved", read_at_ms: null }]);
      source = original;
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 4000 });
      await reconcileAgentModelInboxProjection({ ...input, nowMs: 5000 });
      expect(
        await h.queryAll({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items" ORDER BY created_at_ms',
        })
      ).toEqual([
        { resolution_status: "resolved" },
        { resolution_status: "open" },
      ]);
      expect(original.identity).toBe("binding/model-A/review-1");
    } finally {
      await h.close();
    }
  });

  it("does not publish a stale model observation after the user changed models", async () => {
    const h = await harness();
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
      expect(
        await h.queryAll({ text: 'SELECT * FROM "openmeld"."inbox_items"' })
      ).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("clears only this Profile's model issue, not another Agent's pending work", async () => {
    const h = await harness();
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
          profileId: "agt_22222222-2222-4222-8222-222222222222",
          identity: "other-model",
        }),
      });
      await reconcileAgentModelInboxProjection({
        db: h.db,
        nowMs: 3000,
        readCurrent: async () => ({ ...original, verdict: "clear" }),
      });
      expect(
        await h.queryAll({
          text: 'SELECT ((source_target_json)::jsonb #>> \'{profileId}\') AS "profileId", resolution_status FROM "openmeld"."inbox_items" ORDER BY "profileId"',
        })
      ).toEqual([
        {
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          resolution_status: "resolved",
        },
        {
          profileId: "agt_22222222-2222-4222-8222-222222222222",
          resolution_status: "open",
        },
      ]);
    } finally {
      await h.close();
    }
  });
});

async function harness() {
  const h = await createPostgresHarness();

  await h.query({
    text: "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org_one','Org','org',1000)",
  });
  await h.query({
    text: "INSERT INTO \"openmeld\".\"users\" (id, name, email) VALUES ('user_owner','Owner','owner@example.com')",
  });
  await h.query({
    text: "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org_other','Other Org','other-org',1000)",
  });
  await h.query({
    text: "INSERT INTO \"openmeld\".\"users\" (id, name, email) VALUES ('user_other','Other','other@example.com')",
  });
  for (const profileId of [
    original.profileId,
    "agt_22222222-2222-4222-8222-222222222222",
  ]) {
    await h.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles"
      (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, source, created_at, updated_at)
      VALUES ($1, 'Research', $2, 'agent', 0, 'active', 'org_one', 'user_owner', 'cli_create', 1000, 1000)`,
      values: [profileId, profileId],
    });
  }
  return h;
}
