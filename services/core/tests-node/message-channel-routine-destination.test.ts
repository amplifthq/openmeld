import { buildMessageChannelConversationId } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  claimRemoteAgentRoutineNativeDelivery,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { requireMessageChannelRoutineOrigin } from "../src/routines/message-channel-routine-destination";
import {
  claimRoutineOccurrenceAndAdvance,
  readRoutineRunRecord,
} from "../src/routines/routine-repository";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Message Channel Routine destinations", () => {
  it.each([
    "feishu",
    "lark",
  ] as const)("freezes the %s destination and atomically admits one delivery", async (provider) => {
    const harness = createSqliteD1Harness();
    try {
      harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
      harness.run({ sql: "INSERT INTO organizations VALUES ('org')" });
      for (const table of [
        "routines",
        "routine_runs",
        "openMeldRemoteAgent_native_delivery_ledger",
      ]) {
        applyDrizzleMigrationForTable(harness, table);
      }
      const locator = {
        provider,
        connectionId: "connection",
        appId: "cli_app",
        tenantKey: "tenant",
        chatId: "oc_chat",
        rootMessageId: "om_root",
        threadId: "omt_thread",
      };
      const conversationId = buildMessageChannelConversationId(locator);
      harness.run({
        sql: `INSERT INTO routines (id, organization_id, name, instructions, schedule_kind, cron_expression, timezone, destination_kind, message_channel_destination_json, status, next_due_at, created_by_user_id, updated_by_user_id, created_at_ms, updated_at_ms) VALUES ('routine', 'org', 'Report', 'Send the report here', 'cron', '0 9 * * *', 'America/New_York', 'message_channel', ?, 'enabled', 1000, 'member', 'member', 0, 0)`,
        params: [JSON.stringify({ conversationId, locator })],
      });
      await claimRoutineOccurrenceAndAdvance({
        db: harness.db,
        routineId: "routine",
        organizationId: "org",
        runId: "run",
        scheduledFor: 1000,
        nowMs: 1000,
        nextDueAt: 2000,
        status: "claimed",
      });
      harness.run({
        sql: "UPDATE routines SET message_channel_destination_json = ? WHERE id = 'routine'",
        params: [
          JSON.stringify({
            conversationId: "changed",
            locator: { ...locator, chatId: "another_chat" },
          }),
        ],
      });
      expect(
        (await readRoutineRunRecord({ db: harness.db, runId: "run" }))
          ?.messageChannelLocator
      ).toEqual(locator);
      const claim = {
        db: harness.db,
        bindingId: "binding",
        conversationKind: "message_channel" as const,
        messageChannelLocator: locator,
        nowMs: 1001,
        organizationId: "org",
        onBehalfOfUserId: "member",
        onBehalfOfProfileId: "human",
        onBehalfOfDisplayName: "Casey",
        profileId: "agent",
        routineId: "routine",
        routineName: "Report",
        runId: "run",
        slackChannelId: null,
        slackTeamId: null,
        slackThreadTs: null,
        spaceId: conversationId,
        workerSubmitRequest: null,
      };
      const first = await claimRemoteAgentRoutineNativeDelivery(claim);
      expect(first.status).toBe("claimed");
      expect(first.delivery?.messageChannelLocator).toEqual(locator);
      // The provider reply API requires a UUID, not OpenMeld's prefixed Run ID.
      expect(first.delivery?.providerPublicationIdempotencyKey).toEqual(
        expect.stringMatching(
          "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        )
      );
      const duplicate = await claimRemoteAgentRoutineNativeDelivery(claim);
      expect(duplicate.status).toBe("lost_race");
      expect(duplicate.delivery?.providerPublicationIdempotencyKey).toBe(
        first.delivery?.providerPublicationIdempotencyKey
      );
    } finally {
      harness.close();
    }
  });

  it("rejects another member or conversation as a Routine origin", async () => {
    const harness = createSqliteD1Harness();
    try {
      applyDrizzleMigrationForTable(
        harness,
        "openMeldRemoteAgent_native_delivery_ledger"
      );
      const locator = {
        provider: "feishu" as const,
        connectionId: "connection",
        appId: "cli_app",
        tenantKey: "tenant",
        chatId: "oc_chat",
        rootMessageId: "om_root",
        threadId: null,
      };
      const delivery = await upsertRemoteAgentNativeDeliveryRecord({
        db: harness.db,
        conversationKind: "message_channel",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey: "source",
        organizationId: "org",
        spaceId: buildMessageChannelConversationId(locator),
        profileId: "agent",
        bindingId: "binding",
        triggerMessageId: "om_root",
        dispatchId: "dispatch",
        idempotencyKey: "source",
        onBehalfOfUserId: "member",
        onBehalfOfProfileId: "human",
        onBehalfOfDisplayName: "Casey",
        attemptId: null,
        status: "submitted",
        nowMs: 1000,
      });
      const input = {
        db: harness.db,
        organizationId: "org",
        userId: "member",
        locator,
        sourceNativeDeliveryId: delivery.deliveryId,
      };
      await expect(
        requireMessageChannelRoutineOrigin(input)
      ).resolves.toBeUndefined();
      await expect(
        requireMessageChannelRoutineOrigin({ ...input, userId: "other" })
      ).rejects.toThrow();
      await expect(
        requireMessageChannelRoutineOrigin({
          ...input,
          locator: { ...locator, chatId: "another" },
        })
      ).rejects.toThrow();
      await expect(
        requireMessageChannelRoutineOrigin({
          ...input,
          organizationId: "other-org",
        })
      ).rejects.toThrow();
    } finally {
      harness.close();
    }
  });
});
