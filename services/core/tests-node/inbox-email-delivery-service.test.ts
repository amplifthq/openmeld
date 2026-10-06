import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { AuthRpcSendInboxUrgentEmailResult } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  retryInboxUrgentEmailDeliveries,
  type SendInboxUrgentEmail,
} from "../src/inbox/application/inbox-email-delivery-service";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Inbox urgent email delivery", () => {
  const allowOrganizationAccess = async () => "allowed" as const;
  it("requires a current owner or admin before sending an authorization reminder", async () => {
    const harness = await createInboxHarness();
    try {
      await ensureInboxItem({
        db: harness.db,
        nowMs: 1000,
        candidate: {
          organizationId: "org-1",
          recipientUserId: "user-1",
          sourceKind: "system_attention_event",
          sourceKey: "authorization-update:channel.feishu.test:v2",
          sourceTarget: { kind: "settings", section: "channels" },
          attention: "action_required",
          importance: "urgent",
          kind: "system_issue",
          occurredAtMs: 1000,
          contextLabel: "Authorization update",
          title: "Update Feishu permissions",
          preview: "Approve updated permissions.",
        },
      });
      const resolveOrganizationAccess = vi.fn(async () => "denied" as const);
      const send = vi.fn<SendInboxUrgentEmail>();
      const result = await retryInboxUrgentEmailDeliveries({
        db: harness.db,
        nowMs: 2000,
        resolveOrganizationAccess,
        send,
      });
      expect(resolveOrganizationAccess).toHaveBeenCalledWith({
        organizationId: "org-1",
        recipientUserId: "user-1",
        requireOrganizationManager: true,
      });
      expect(result.suppressed).toBe(1);
      expect(send).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("suppresses queued Agent creation approval email during the launch hold", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(harness.db, "held-request");
      await harness.db.query({
        ...{
          text: 'UPDATE "openmeld"."inbox_items" SET source_target_json = $1 WHERE id = $2',
          values: [],
        },
        values: [
          JSON.stringify({
            kind: "agent_profile_creation_request",
            requestId: "held-request",
          }),
          seeded.itemId,
        ],
      });
      const send = vi.fn<SendInboxUrgentEmail>();
      await expect(
        retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 2000,
          resolveOrganizationAccess: allowOrganizationAccess,
          send,
        })
      ).resolves.toEqual({ attempted: 1, failed: 0, sent: 0, suppressed: 1 });
      expect(send).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("sends transactional invitation review email even when urgent email preferences are off", async () => {
    const harness = await createInboxHarness();
    try {
      const item = await ensureInboxItem({
        db: harness.db,
        nowMs: 1000,
        candidate: {
          organizationId: "org-1",
          recipientUserId: "user-1",
          sourceKey: "invitation:request-1",
          sourceKind: "organization_member_request",
          sourceTarget: {
            kind: "organization_join_request",
            requestId: "request-1",
          },
          attention: "action_required",
          importance: "urgent",
          kind: "organization_request",
          occurredAtMs: 1000,
          contextLabel: null,
          title: "Review invitation",
          preview: "A teammate is waiting to join.",
        },
      });
      await harness.query({
        values: ["user-1", 0, 1500, 1500],
        text: 'INSERT INTO "openmeld"."inbox_notification_preferences" (user_id, urgent_email_enabled, created_at_ms, updated_at_ms) VALUES ($1, $2, $3, $4)',
      });
      const send = vi.fn<SendInboxUrgentEmail>(async (input) => ({
        deliveryId: input.deliveryId,
        messageId: "review-email",
        status: "sent",
      }));
      expect(
        await retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 2000,
          resolveOrganizationAccess: allowOrganizationAccess,
          send,
        })
      ).toEqual({ attempted: 1, failed: 0, sent: 1, suppressed: 0 });
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: item.deliveryId,
          purpose: "invitation_review",
          invitationRequestId: "request-1",
          userId: "user-1",
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("does not resend after a confirmed sent ledger state", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(harness.db, "delivery-source-1");
      const send = vi.fn<SendInboxUrgentEmail>(async (input) => ({
        deliveryId: input.deliveryId,
        messageId: "message-1",
        status: "sent",
      }));
      const first = await retryInboxUrgentEmailDeliveries({
        db: harness.db,
        nowMs: 2000,
        resolveOrganizationAccess: allowOrganizationAccess,
        send,
      });
      const second = await retryInboxUrgentEmailDeliveries({
        db: harness.db,
        nowMs: 3000,
        resolveOrganizationAccess: allowOrganizationAccess,
        send,
      });
      expect(first).toEqual({
        attempted: 1,
        failed: 0,
        sent: 1,
        suppressed: 0,
      });
      expect(second).toEqual({
        attempted: 0,
        failed: 0,
        sent: 0,
        suppressed: 0,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        deliveryId: seeded.deliveryId,
        itemId: seeded.itemId,
        organizationId: "org-1",
        preview: "The agent needs your approval to continue.",
        title: "Approval required",
        userId: "user-1",
      });
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        attempt_count: 1,
        message_id: "message-1",
        state: "sent",
      });
    } finally {
      await harness.close();
    }
  });
  it("suppresses delivery when the account preference is disabled", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(harness.db, "delivery-source-2");
      await harness.query({
        values: ["user-1", 0, 1500, 1500],
        text: 'INSERT INTO "openmeld"."inbox_notification_preferences" (user_id, urgent_email_enabled, created_at_ms, updated_at_ms) VALUES ($1, $2, $3, $4)',
      });
      const send = vi.fn<SendInboxUrgentEmail>();
      await expect(
        retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 2000,
          resolveOrganizationAccess: allowOrganizationAccess,
          send,
        })
      ).resolves.toEqual({ attempted: 1, failed: 0, sent: 0, suppressed: 1 });
      expect(send).not.toHaveBeenCalled();
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        state: "suppressed",
        suppressed_reason: "preference_disabled",
      });
    } finally {
      await harness.close();
    }
  });
  it("redrives a transient failure after backoff", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(harness.db, "delivery-source-3");
      const outcomes: AuthRpcSendInboxUrgentEmailResult[] = [
        {
          code: "email_send_transient",
          deliveryId: seeded.deliveryId,
          retryable: true,
          status: "failed",
        },
        {
          deliveryId: seeded.deliveryId,
          messageId: "message-3",
          status: "sent",
        },
      ];
      const send = vi.fn<SendInboxUrgentEmail>(() => {
        const outcome = outcomes.shift();
        if (!outcome) {
          throw new Error("Unexpected send");
        }
        return Promise.resolve(outcome);
      });
      await retryInboxUrgentEmailDeliveries({
        db: harness.db,
        nowMs: 2000,
        resolveOrganizationAccess: allowOrganizationAccess,
        send,
      });
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        attempt_count: 1,
        last_error_code: "email_send_transient",
        next_attempt_at_ms: 62_000,
        state: "pending",
      });
      await expect(
        retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 61_999,
          resolveOrganizationAccess: allowOrganizationAccess,
          send,
        })
      ).resolves.toMatchObject({ attempted: 0 });
      await expect(
        retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 62_000,
          resolveOrganizationAccess: allowOrganizationAccess,
          send,
        })
      ).resolves.toMatchObject({ attempted: 1, sent: 1 });
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        attempt_count: 2,
        message_id: "message-3",
        state: "sent",
      });
    } finally {
      await harness.close();
    }
  });
  it("suppresses items resolved before their email claim", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(harness.db, "delivery-source-4");
      await harness.query({
        values: [1500, 1500, seeded.itemId],
        text: 'UPDATE "openmeld"."inbox_items" SET resolution_status = \'resolved\', resolved_at_ms = $1, updated_at_ms = $2 WHERE id = $3',
      });
      const send = vi.fn<SendInboxUrgentEmail>();
      await retryInboxUrgentEmailDeliveries({
        db: harness.db,
        nowMs: 2000,
        resolveOrganizationAccess: allowOrganizationAccess,
        send,
      });
      expect(send).not.toHaveBeenCalled();
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        state: "suppressed",
        suppressed_reason: "source_resolved",
      });
    } finally {
      await harness.close();
    }
  });
  it("suppresses an urgent Space interaction after membership is revoked", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(
        harness.db,
        "delivery-source-revoked"
      );
      await harness.query({
        values: [1500, 1500, "space-1", "profile-user-1"],
        text: `
          UPDATE "openmeld"."space_index_memberships"
          SET status = 'removed', removed_at_ms = $1, source_updated_at_ms = $2
          WHERE space_id = $3 AND profile_id = $4
        `,
      });
      const send = vi.fn<SendInboxUrgentEmail>();
      await expect(
        retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 2000,
          resolveOrganizationAccess: allowOrganizationAccess,
          send,
        })
      ).resolves.toEqual({ attempted: 1, failed: 0, sent: 0, suppressed: 1 });
      expect(send).not.toHaveBeenCalled();
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        state: "suppressed",
        suppressed_reason: "source_access_revoked",
      });
    } finally {
      await harness.close();
    }
  });
  it("suppresses urgent email after Organization membership is revoked", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(
        harness.db,
        "delivery-source-organization-revoked"
      );
      const send = vi.fn<SendInboxUrgentEmail>();
      await expect(
        retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 2000,
          resolveOrganizationAccess: async () => "denied",
          send,
        })
      ).resolves.toEqual({ attempted: 1, failed: 0, sent: 0, suppressed: 1 });
      expect(send).not.toHaveBeenCalled();
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        state: "suppressed",
        suppressed_reason: "source_access_revoked",
      });
    } finally {
      await harness.close();
    }
  });
  it("retries urgent email when Organization access cannot be verified", async () => {
    const harness = await createInboxHarness();
    try {
      const seeded = await seedUrgentItem(
        harness.db,
        "delivery-source-organization-unavailable"
      );
      const send = vi.fn<SendInboxUrgentEmail>();
      await expect(
        retryInboxUrgentEmailDeliveries({
          db: harness.db,
          nowMs: 2000,
          resolveOrganizationAccess: async () => "unavailable",
          send,
        })
      ).resolves.toEqual({ attempted: 1, failed: 1, sent: 0, suppressed: 0 });
      expect(send).not.toHaveBeenCalled();
      await expect(
        readDelivery(harness.db, seeded.deliveryId)
      ).resolves.toMatchObject({
        last_error_code: "organization_access_unavailable",
        state: "pending",
      });
    } finally {
      await harness.close();
    }
  });
});
async function seedUrgentItem(db: PostgresDatabase, sourceKey: string) {
  const result = await ensureInboxItem({
    candidate: {
      attention: "action_required",
      contextLabel: "Build failures",
      importance: "urgent",
      kind: "agent_interaction",
      occurredAtMs: 1000,
      organizationId: "org-1",
      preview: "The agent needs your approval to continue.",
      recipientUserId: "user-1",
      sourceKey,
      sourceKind: "runtime_coordinator_interaction",
      sourceTarget: {
        interactionId: sourceKey,
        kind: "agent_interaction",
        runtimeCoordinatorExecutionId: `runtime-${sourceKey}`,
        spaceId: "space-1",
      },
      title: "Approval required",
    },
    db,
    nowMs: 1000,
  });
  if (!result.deliveryId) {
    throw new Error("Urgent item did not create a delivery");
  }
  return { deliveryId: result.deliveryId, itemId: result.itemId };
}
async function readDelivery(db: PostgresDatabase, deliveryId: string) {
  return await db
    .query({
      ...{
        text: 'SELECT state, attempt_count, next_attempt_at_ms, message_id, last_error_code, suppressed_reason FROM "openmeld"."inbox_email_deliveries" WHERE id = $1',
        values: [],
      },
      values: [deliveryId],
    })
    .then((result) => result.rows[0] ?? null);
}
async function createInboxHarness() {
  const harness = await createPostgresHarness();
  await harness.query({
    values: ["org-1", "Amplift", "amplift", 1000],
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
  });
  await harness.query({
    values: ["user-1", "Felix", "felix@amplift.ai"],
    text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
  });
  await harness.query({
    values: [
      "space-1",
      "org-1",
      "private",
      "active",
      1000,
      1000,
      "space-projection",
    ],
    text: `
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        organization_visibility,
        status,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
  });
  await harness.query({
    values: [
      "space-1",
      "profile-user-1",
      "Felix",
      "user-1",
      1000,
      1000,
      1000,
      "membership-projection",
    ],
    text: `
      INSERT INTO "openmeld"."space_index_memberships" (
        space_id,
        profile_id,
        profile_kind_snapshot,
        profile_name_snapshot,
        owner_user_id_snapshot,
        status,
        member_source,
        added_at_ms,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES ($1, $2, 'human', $3, $4, 'active', 'joined_directly', $5, $6, $7, $8)
    `,
  });
  return harness;
}
