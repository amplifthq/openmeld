import { buildMessageChannelConversationId } from "@openmeld/schemas";
import type { NormalizedMessageChannelEvent } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { processMessageChannelCardControl } from "../src/remote-agent/application/message-channel-card-control-service";
import type { MessageChannelTurnParticipant } from "../src/remote-agent/application/message-channel-turn-resolution";
import {
  readRemoteAgentNativeDeliveryByDeliveryId,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("native card execution controls", () => {
  it.each([
    "feishu",
    "lark",
  ] as const)("authorizes the requester and lets the %s execution owner finalize cancellation", async (provider) => {
    const harness = createSqliteD1Harness();
    try {
      applyDrizzleMigrationForTable(
        harness,
        "openMeldRemoteAgent_native_delivery_ledger"
      );
      const locator = {
        provider,
        connectionId: "connection",
        appId: "app",
        tenantKey: "tenant",
        chatId: "chat",
        rootMessageId: "source-message",
        threadId: null,
      };
      const conversationId = buildMessageChannelConversationId(locator);
      const delivery = await upsertRemoteAgentNativeDeliveryRecord({
        db: harness.db,
        conversationKind: "message_channel",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey: "source",
        organizationId: "org",
        spaceId: conversationId,
        profileId: "agent",
        bindingId: "binding",
        triggerMessageId: "source-message",
        dispatchId: "dispatch",
        idempotencyKey: "source",
        onBehalfOfUserId: "member",
        onBehalfOfProfileId: "human",
        onBehalfOfDisplayName: "Casey",
        attemptId: null,
        status: "submitted",
        nowMs: 1000,
      });
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET submission_id = 'submission', status = 'accepted', accepted_at_ms = 1000, provider_progress_message_id = 'card-message' WHERE delivery_id = ?",
        params: [delivery.deliveryId],
      });
      const cancelExecution = vi.fn().mockResolvedValue({
        status: "cancellation_requested",
        execution: {
          v: 1,
          organizationId: "org",
          spaceId: conversationId,
          submissionId: "submission",
          idempotencyKey: "source",
          status: "cancellation_requested",
          acceptedAtMs: 1000,
          lastProgressAtMs: 2000,
          lastProgressKind: "cancellation_requested",
          completedAtMs: null,
          cancellationReason: "Stopped by requester",
        },
      });
      const env = {
        OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
      } as unknown as CoreBindings;
      const participant: MessageChannelTurnParticipant = {
        kind: "member",
        member: {
          userId: "member",
          humanProfileId: "human",
          memberCount: 1,
          memberId: "membership",
          organizationId: "org",
          organizationName: "Smoke",
          organizationPersonal: false,
          organizationSlug: "smoke",
          role: "owner",
          userDisplayName: "Casey",
          userEmail: "casey@example.com",
        },
      };
      const event: Extract<
        NormalizedMessageChannelEvent,
        { kind: "card_action" }
      > = {
        kind: "card_action",
        actionId: "click",
        actionName: "openmeld.center_agent.control",
        actionValue: JSON.stringify({
          v: 1,
          action: "stop",
          deliveryId: delivery.deliveryId,
        }),
        locator: { ...locator, rootMessageId: "card-message" },
        senderId: "ou_member",
        occurredAtMs: 2000,
      };
      const input = {
        db: harness.db,
        env,
        participant,
        event,
        organizationId: "org",
        nowMs: 2000,
      };
      expect(
        await processMessageChannelCardControl({
          ...input,
          participant: {
            ...participant,
            member: { ...participant.member, userId: "another-member" },
          },
        })
      ).toMatchObject({
        status: "rejected",
        reasonCode: "message_channel.control.requester_required",
      });
      expect(
        await processMessageChannelCardControl({
          ...input,
          event: {
            ...event,
            locator: {
              ...locator,
              rootMessageId: "card-message",
              chatId: "another-chat",
            },
          },
        })
      ).toMatchObject({ status: "rejected" });
      expect(
        await processMessageChannelCardControl({
          ...input,
          event: {
            ...event,
            locator: { ...event.locator, rootMessageId: "old-card" },
          },
        })
      ).toMatchObject({ status: "rejected" });
      expect(cancelExecution).not.toHaveBeenCalled();
      expect(await processMessageChannelCardControl(input)).toMatchObject({
        reasonCode: "message_channel.control.cancellation_requested",
      });
      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: "submission",
          idempotencyKey: "source",
          organizationId: "org",
        })
      );
      expect(
        (
          await readRemoteAgentNativeDeliveryByDeliveryId({
            db: harness.db,
            deliveryId: delivery.deliveryId,
          })
        )?.status
      ).toBe("accepted");
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET status = 'completed' WHERE delivery_id = ?",
        params: [delivery.deliveryId],
      });
      expect(await processMessageChannelCardControl(input)).toMatchObject({
        reasonCode: "message_channel.control.already_finished",
      });
      expect(cancelExecution).toHaveBeenCalledTimes(1);
      const replyEvent = {
        ...event,
        actionValue: JSON.stringify({
          v: 1,
          action: "reply",
          deliveryId: delivery.deliveryId,
          text: "Summarize the result as a table.",
        }),
      };
      expect(
        await processMessageChannelCardControl({ ...input, event: replyEvent })
      ).toMatchObject({ reasonCode: "message_channel.control.not_finished" });
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET final_publication_state = 'published' WHERE delivery_id = ?",
        params: [delivery.deliveryId],
      });
      const reply = await processMessageChannelCardControl({
        ...input,
        event: replyEvent,
      });
      expect(reply).toMatchObject({
        status: "continue",
        event: {
          locator,
          actionName: "openmeld.center_agent.submit",
          actionValue: "Summarize the result as a table.",
        },
      });
      expect(
        await processMessageChannelCardControl({
          ...input,
          event: { ...replyEvent, actionId: "double-click" },
        })
      ).toEqual(reply);
      expect(
        await processMessageChannelCardControl({
          ...input,
          event: replyEvent,
          nowMs: 1000 + 86_400_001,
        })
      ).toMatchObject({ reasonCode: "message_channel.control.expired" });
    } finally {
      harness.close();
    }
  });
});
