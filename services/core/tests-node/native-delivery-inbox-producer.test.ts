import { describe, expect, it } from "vitest";
import { projectLinkedSlackNativeDeliveryInboxItem } from "../src/remote-agent/application/native-delivery-inbox-producer";
import { reconcileLinkedSlackNativeDeliveryInbox } from "../src/remote-agent/application/native-delivery-service";
import { resolveSlackInboxSourceTarget } from "../src/remote-agent/application/slack-inbox-source-target";
import {
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const SLACK_INBOX_SOURCE_TARGET = {
  channelId: "channel_one",
  kind: "message_channel",
  messageId: "1000.0002",
  permalink: "https://amplift.slack.com/archives/channel_one/p10000002",
  provider: "slack",
  teamId: "team_one",
  threadRootMessageId: "1000.0001",
} as const;

describe("Slack native delivery Inbox producer", () => {
  it("uses the published Slack reply as the exact source and falls back to the thread root", async () => {
    const requestedMessageIds: string[] = [];
    const fetchImpl = (input: RequestInfo | URL) => {
      const requestUrl = new URL(String(input));
      const messageId = requestUrl.searchParams.get("message_ts") ?? "";
      requestedMessageIds.push(messageId);
      return Promise.resolve(
        Response.json({
          ok: true,
          permalink: `https://amplift.slack.com/archives/channel_one/p${messageId.replace(".", "")}`,
        })
      );
    };
    const sourceDelivery = {
      publishedSignalId: "1000.0002",
      slackChannelId: "channel_one",
      slackTeamId: "team_one",
      slackThreadTs: "1000.0001",
    };

    await expect(
      resolveSlackInboxSourceTarget({
        botToken: "xoxb-test",
        delivery: sourceDelivery,
        fetchImpl,
      })
    ).resolves.toMatchObject({
      messageId: "1000.0002",
      permalink: "https://amplift.slack.com/archives/channel_one/p10000002",
      threadRootMessageId: "1000.0001",
    });
    await expect(
      resolveSlackInboxSourceTarget({
        botToken: "xoxb-test",
        delivery: { ...sourceDelivery, publishedSignalId: null },
        fetchImpl,
      })
    ).resolves.toMatchObject({
      messageId: "1000.0001",
      threadRootMessageId: "1000.0001",
    });
    expect(requestedMessageIds).toEqual(["1000.0002", "1000.0001"]);
  });

  it("delivers to the exact linked user without requiring an Auth directory lookup", async () => {
    const harness = createInboxHarness();
    try {
      const delivery = {
        conversationKind: "slack",
        deliveryId: "delivery_slack_1",
        onBehalfOfUserId: "user_two",
        organizationId: "org_one",
      };

      await projectLinkedSlackNativeDeliveryInboxItem({
        db: harness.db,
        delivery,
        occurredAtMs: 2000,
        sourceTarget: SLACK_INBOX_SOURCE_TARGET,
        status: "succeeded",
      });
      await projectLinkedSlackNativeDeliveryInboxItem({
        db: harness.db,
        delivery,
        occurredAtMs: 2000,
        sourceTarget: SLACK_INBOX_SOURCE_TARGET,
        status: "succeeded",
      });

      expect(
        harness.queryAll<{
          recipient_user_id: string;
          source_key: string;
          source_target_json: string;
          title: string;
        }>({
          sql: `
            SELECT recipient_user_id, source_key, source_target_json, title
            FROM inbox_items
          `,
        })
      ).toEqual([
        {
          recipient_user_id: "user_two",
          source_key: "delivery_slack_1:terminal",
          source_target_json: JSON.stringify(SLACK_INBOX_SOURCE_TARGET),
          title: "Center Agent replied in Slack",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("ignores anonymous and non-Slack deliveries", async () => {
    const harness = createInboxHarness();
    try {
      await projectLinkedSlackNativeDeliveryInboxItem({
        db: harness.db,
        delivery: {
          conversationKind: "slack",
          deliveryId: "delivery_anonymous",
          onBehalfOfUserId: null,
          organizationId: "org_one",
        },
        occurredAtMs: 2000,
        sourceTarget: SLACK_INBOX_SOURCE_TARGET,
        status: "succeeded",
      });
      await projectLinkedSlackNativeDeliveryInboxItem({
        db: harness.db,
        delivery: {
          conversationKind: "space",
          deliveryId: "delivery_space",
          onBehalfOfUserId: "user_one",
          organizationId: "org_one",
        },
        occurredAtMs: 2000,
        sourceTarget: SLACK_INBOX_SOURCE_TARGET,
        status: "succeeded",
      });

      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_items",
        })?.count
      ).toBe(0);
    } finally {
      harness.close();
    }
  });

  it("resolves an unknown publication card and creates the immutable confirmed terminal card", async () => {
    const harness = createInboxHarness();
    try {
      const delivery = {
        conversationKind: "slack",
        deliveryId: "delivery_upgrade",
        onBehalfOfUserId: "user_two",
        organizationId: "org_one",
      };
      await projectLinkedSlackNativeDeliveryInboxItem({
        db: harness.db,
        delivery,
        occurredAtMs: 2000,
        sourceTarget: SLACK_INBOX_SOURCE_TARGET,
        status: "publication_failed",
      });
      await projectLinkedSlackNativeDeliveryInboxItem({
        db: harness.db,
        delivery,
        occurredAtMs: 3000,
        sourceTarget: SLACK_INBOX_SOURCE_TARGET,
        status: "succeeded",
      });
      await projectLinkedSlackNativeDeliveryInboxItem({
        db: harness.db,
        delivery,
        occurredAtMs: 4000,
        sourceTarget: SLACK_INBOX_SOURCE_TARGET,
        status: "publication_failed",
      });

      expect(
        harness.queryAll<{
          attention: string;
          resolution_status: string;
          source_key: string;
          title: string;
        }>({
          sql: `
            SELECT attention, resolution_status, source_key, title
            FROM inbox_items
            ORDER BY source_key
          `,
        })
      ).toEqual([
        {
          attention: "action_required",
          resolution_status: "resolved",
          source_key: "delivery_upgrade:publication_unknown",
          title: "Check the Center Agent reply in Slack",
        },
        {
          attention: "update",
          resolution_status: "not_applicable",
          source_key: "delivery_upgrade:terminal",
          title: "Center Agent replied in Slack",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("reconciles a missing item from the durable terminal delivery ledger", async () => {
    const harness = createInboxHarness({ nativeDeliveryLedger: true });
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: "attempt_one",
        bindingId: "binding_one",
        conversationKind: "slack",
        db: harness.db,
        deliveryId: "delivery_reconcile",
        dispatchId: "dispatch_reconcile",
        idempotencyKey: "idempotency_reconcile",
        nowMs: 1000,
        onBehalfOfDisplayName: "Two",
        onBehalfOfProfileId: "profile_two",
        onBehalfOfUserId: "user_two",
        organizationId: "org_one",
        profileId: "agent_one",
        slackChannelId: "channel_one",
        slackTeamId: "team_one",
        slackThreadTs: "1000.0001",
        spaceId: "slack:team_one:channel_one:1000.0001",
        status: "submitted",
        triggerMessageId: "trigger_one",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "idempotency_reconcile",
        nowMs: 1100,
        submissionId: "submission_reconcile",
        workerRequestId: "worker_request_one",
      });
      await markRemoteAgentNativeDeliveryCompleted({
        db: harness.db,
        nowMs: 1200,
        publishedSignalId: "1000.0002",
        submissionId: "submission_reconcile",
      });

      await expect(
        reconcileLinkedSlackNativeDeliveryInbox({
          db: harness.db,
          nowMs: 1300,
          resolveSourceTarget: () =>
            Promise.reject(
              new Error("Slack permalink temporarily unavailable")
            ),
        })
      ).resolves.toEqual({ attempted: 1, errors: 1, projected: 0 });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_items",
        })
      ).toEqual({ count: 0 });
      await expect(
        reconcileLinkedSlackNativeDeliveryInbox({
          db: harness.db,
          nowMs: 1400,
          resolveSourceTarget: async () => SLACK_INBOX_SOURCE_TARGET,
        })
      ).resolves.toEqual({ attempted: 1, errors: 0, projected: 1 });
      await expect(
        reconcileLinkedSlackNativeDeliveryInbox({
          db: harness.db,
          nowMs: 1500,
          resolveSourceTarget: async () => SLACK_INBOX_SOURCE_TARGET,
        })
      ).resolves.toEqual({ attempted: 0, errors: 0, projected: 0 });
      expect(
        harness.queryFirst<{
          recipient_user_id: string;
          source_key: string;
        }>({
          sql: "SELECT recipient_user_id, source_key FROM inbox_items",
        })
      ).toEqual({
        recipient_user_id: "user_two",
        source_key: "delivery_reconcile:terminal",
      });
    } finally {
      harness.close();
    }
  });

  it("suppresses permanently missing recipients without starving later deliveries", async () => {
    const harness = createInboxHarness({ nativeDeliveryLedger: true });
    try {
      for (let index = 0; index < 100; index += 1) {
        insertTerminalSlackDelivery(harness, {
          deliveryId: `delivery_missing_${index.toString().padStart(3, "0")}`,
          recipientUserId: `deleted_user_${index.toString().padStart(3, "0")}`,
          updatedAtMs: 1000 + index,
        });
      }
      insertTerminalSlackDelivery(harness, {
        deliveryId: "delivery_valid_after_missing_page",
        recipientUserId: "user_two",
        updatedAtMs: 2000,
      });

      await expect(
        reconcileLinkedSlackNativeDeliveryInbox({
          db: harness.db,
          nowMs: 3000,
          resolveSourceTarget: async () => SLACK_INBOX_SOURCE_TARGET,
        })
      ).resolves.toEqual({
        attempted: 100,
        errors: 0,
        projected: 0,
      });
      expect(
        harness.queryFirst<{
          count: number;
          source_rows_changed: number;
        }>({
          sql: `
            SELECT
              count(*) AS count,
              count(*) FILTER (
                WHERE status <> 'completed' OR updated_at_ms <> completed_at_ms
              ) AS source_rows_changed
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE inbox_projection_suppressed_reason = 'recipient_not_found'
              AND inbox_projection_suppressed_at_ms = 3000
          `,
        })
      ).toEqual({ count: 100, source_rows_changed: 0 });
      await expect(
        reconcileLinkedSlackNativeDeliveryInbox({
          db: harness.db,
          nowMs: 4000,
          resolveSourceTarget: async () => SLACK_INBOX_SOURCE_TARGET,
        })
      ).resolves.toEqual({
        attempted: 1,
        errors: 0,
        projected: 1,
      });
      expect(
        harness.queryFirst<{
          recipient_user_id: string;
          source_key: string;
        }>({
          sql: `
            SELECT recipient_user_id, source_key
            FROM inbox_items
          `,
        })
      ).toEqual({
        recipient_user_id: "user_two",
        source_key: "delivery_valid_after_missing_page:terminal",
      });
    } finally {
      harness.close();
    }
  });
});

function insertTerminalSlackDelivery(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    deliveryId: string;
    recipientUserId: string;
    updatedAtMs: number;
  }
): void {
  harness.run({
    params: [
      input.deliveryId,
      `slack:team_one:channel_one:${input.deliveryId}`,
      `trigger_${input.deliveryId}`,
      `dispatch_${input.deliveryId}`,
      `idempotency_${input.deliveryId}`,
      input.recipientUserId,
      input.updatedAtMs,
      input.updatedAtMs,
      input.updatedAtMs,
    ],
    sql: `
      INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
        delivery_id,
        organization_id,
        conversation_kind,
        space_id,
        profile_id,
        binding_id,
        trigger_message_id,
        dispatch_id,
        idempotency_key,
        status,
        on_behalf_of_user_id,
        slack_team_id,
        slack_channel_id,
        slack_thread_ts,
        created_at_ms,
        updated_at_ms,
        completed_at_ms
      ) VALUES (
        ?, 'org_one', 'slack', ?, 'agent_one', 'binding_one', ?, ?, ?,
        'completed', ?, 'team_one', 'channel_one', '1000.0001', ?, ?, ?
      )
    `,
  });
}

function createInboxHarness(options: { nativeDeliveryLedger?: boolean } = {}) {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `,
  });
  applyDrizzleMigrationsForTables(harness, [
    "inbox_items",
    "inbox_email_deliveries",
  ]);
  if (options.nativeDeliveryLedger) {
    applyDrizzleMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
  }
  harness.run({
    params: ["org_one", "One", "one", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: ["user_one", "One", "one@example.test"],
    sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
  });
  harness.run({
    params: ["user_two", "Two", "two@example.test"],
    sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
  });
  return harness;
}
