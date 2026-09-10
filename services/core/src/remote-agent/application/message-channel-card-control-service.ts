import { messageChannelCardControlSchema } from "@openmeld/schemas";
import type { NormalizedMessageChannelEvent } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../infrastructure/d1/native-delivery-ledger-repo";
import type { MessageChannelTurnParticipant } from "./message-channel-turn-resolution";
import { requestRemoteAgentWorkerCancellation } from "./native-delivery-cancellation-service";

export async function processMessageChannelCardControl(input: {
  db: D1Database;
  env: CoreBindings;
  event: Extract<NormalizedMessageChannelEvent, { kind: "card_action" }>;
  organizationId: string;
  participant: MessageChannelTurnParticipant;
  nowMs: number;
}): Promise<
  | { reasonCode: string; status: "ignored" | "rejected" }
  | {
      status: "continue";
      event: Extract<NormalizedMessageChannelEvent, { kind: "card_action" }>;
    }
> {
  let value: unknown;
  try {
    value = JSON.parse(input.event.actionValue ?? "null");
  } catch {
    return reject("invalid");
  }
  const parsed = messageChannelCardControlSchema.safeParse(value);
  if (!parsed.success) {
    return reject("invalid");
  }
  const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: parsed.data.deliveryId,
  });
  const source = delivery?.messageChannelLocator;
  const clicked = input.event.locator;
  if (
    !(delivery && source) ||
    source.provider === "slack" ||
    clicked.provider === "slack" ||
    delivery.organizationId !== input.organizationId ||
    delivery.conversationKind !== "message_channel" ||
    source.provider !== clicked.provider ||
    source.connectionId !== clicked.connectionId ||
    source.appId !== clicked.appId ||
    source.tenantKey !== clicked.tenantKey ||
    source.chatId !== clicked.chatId ||
    delivery.providerProgressMessageId !== clicked.rootMessageId
  ) {
    return reject("target_mismatch");
  }
  if (
    input.participant.kind !== "member" ||
    input.participant.member.userId !== delivery.onBehalfOfUserId
  ) {
    return reject("requester_required");
  }
  if (
    input.nowMs - delivery.createdAtMs > 86_400_000 ||
    input.event.occurredAtMs < delivery.createdAtMs
  ) {
    return reject("expired");
  }
  if (parsed.data.action === "reply") {
    if (
      delivery.status !== "completed" ||
      delivery.finalPublicationState !== "published"
    ) {
      return reject("not_finished");
    }
    // Form input is a new user message, never approval or a privileged operation.
    // Restore the durable source destination instead of treating the card as a new thread.
    return {
      status: "continue",
      event: {
        ...input.event,
        actionId: await buildFollowUpOperationId(
          delivery.deliveryId,
          parsed.data.text
        ),
        actionName: "openmeld.center_agent.submit",
        actionValue: parsed.data.text,
        locator: source,
      },
    };
  }
  if (
    delivery.finalPublicationState ||
    !["accepted", "retry_observed", "submitted"].includes(delivery.status)
  ) {
    return {
      reasonCode: "message_channel.control.already_finished",
      status: "ignored",
    };
  }
  if (!delivery.submissionId) {
    return reject("not_started");
  }
  const outcome = await requestRemoteAgentWorkerCancellation({
    delivery,
    env: input.env,
    submissionId: delivery.submissionId,
    reason: "Stopped by the requester from the conversation card.",
  });
  return {
    status: "ignored",
    reasonCode: `message_channel.control.${outcome.status}`,
  };
}

function reject(reason: string): { reasonCode: string; status: "rejected" } {
  return {
    status: "rejected",
    reasonCode: `message_channel.control.${reason}`,
  };
}

async function buildFollowUpOperationId(
  deliveryId: string,
  text: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([deliveryId, text]))
  );
  return `card-reply:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
