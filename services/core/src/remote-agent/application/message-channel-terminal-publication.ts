import type { SpaceMessageAttachment } from "@openmeld/schemas/types";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../../runtime-transport/application/runtime-coordinator-authority";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";
import type {
  MessageChannelProviderAdapter,
  MessageChannelPublicationResult,
} from "./message-channel-adapters";
import { splitMessageChannelCardSegment } from "./message-channel-card-segmentation";
import type { MessageChannelPublicationTarget } from "./message-channel-publication-target";
import { projectMessageChannelTerminalContent } from "./message-channel-terminal-content";

export type MessageChannelTerminalPublicationResult =
  | {
      providerProgressSequence: number | null;
      resultId: string;
      status: "published";
    }
  | {
      providerProgressSequence: number | null;
      reasonCode: string;
      status: "outcome_unknown";
    }
  | {
      reasonCode: string;
      retryAfterMs?: number;
      status: "failed";
    };

export async function publishMessageChannelTerminalResult(input: {
  attachments: readonly SpaceMessageAttachment[];
  delivery: RemoteAgentNativeDeliveryRecord;
  failureCode?: string;
  target: MessageChannelPublicationTarget;
  text: string;
}): Promise<MessageChannelTerminalPublicationResult> {
  const content = projectMessageChannelTerminalContent({
    attachments: input.attachments,
    text: input.text,
  });
  if (requiresMessageChannelFinalCardMutation(input.delivery)) {
    return await finalizeCard({
      delivery: input.delivery,
      failureCode: input.failureCode,
      target: input.target,
      text: content.text,
    });
  }
  const publication = input.failureCode
    ? await input.target.adapter.publishFailure({
        connection: input.target.connection,
        failureCode: input.failureCode,
        locator: input.target.locator,
        providerPublicationIdempotencyKey:
          input.target.providerPublicationIdempotencyKey,
        text: content.text,
      })
    : await input.target.adapter.publishReply({
        attachments: content.attachments,
        connection: input.target.connection,
        locator: input.target.locator,
        providerPublicationIdempotencyKey:
          input.target.providerPublicationIdempotencyKey,
        text: content.text,
      });
  return normalizeStandalonePublication(publication);
}

export function requiresMessageChannelFinalCardMutation(
  delivery: RemoteAgentNativeDeliveryRecord
): boolean {
  return (
    delivery.providerProgressState === "send_claimed" ||
    delivery.providerProgressState === "send_outcome_unknown" ||
    delivery.providerProgressState === "sent" ||
    delivery.providerProgressState === "update_claimed" ||
    delivery.providerProgressState === "rollover_finalize_claimed" ||
    delivery.providerProgressState === "rollover_finalized" ||
    delivery.providerProgressState === "rollover_create_claimed" ||
    delivery.providerProgressState === "rollover_created" ||
    delivery.providerProgressState === "rollover_send_claimed" ||
    delivery.providerProgressState === "rollover_send_outcome_unknown"
  );
}

export function resolveMessageChannelFinalCardSequence(
  delivery: RemoteAgentNativeDeliveryRecord
): number {
  const nextSequence =
    Math.max(
      delivery.providerProgressSequence ?? 0,
      delivery.providerProgressPendingSequence ?? 0
    ) + 1;
  return delivery.finalPublicationProviderProgressSequence ?? nextSequence;
}

async function finalizeCard(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  failureCode?: string;
  target: {
    adapter: MessageChannelProviderAdapter;
    connection: MessageChannelPublicationTarget["connection"];
    locator: MessageChannelPublicationTarget["locator"];
    providerPublicationIdempotencyKey: string;
  };
  text: string;
}): Promise<MessageChannelTerminalPublicationResult> {
  if (
    input.delivery.providerProgressState === "rollover_finalize_claimed" ||
    input.delivery.providerProgressState === "rollover_finalized" ||
    input.delivery.providerProgressState === "rollover_create_claimed" ||
    input.delivery.providerProgressState === "rollover_created" ||
    input.delivery.providerProgressState === "rollover_send_claimed" ||
    input.delivery.providerProgressState === "rollover_send_outcome_unknown"
  ) {
    return {
      providerProgressSequence: input.delivery.providerProgressPendingSequence,
      reasonCode: "message_channel.final_card_rollover_unresolved",
      status: "outcome_unknown",
    };
  }
  const cardId = input.delivery.providerProgressCardId?.trim();
  if (!cardId) {
    return {
      providerProgressSequence: null,
      reasonCode: "message_channel.final_card_identity_missing",
      status: "outcome_unknown",
    };
  }
  const nextSequence =
    Math.max(
      input.delivery.providerProgressSequence ?? 0,
      input.delivery.providerProgressPendingSequence ?? 0
    ) + 1;
  const sequence = resolveMessageChannelFinalCardSequence(input.delivery);
  if (sequence !== nextSequence) {
    return {
      providerProgressSequence: sequence,
      reasonCode: "message_channel.final_card_sequence_changed",
      status: "outcome_unknown",
    };
  }
  const segment = splitMessageChannelCardSegment({
    sourceOffset: input.delivery.providerProgressSourceOffset,
    text: input.text,
  });
  if (segment.tail) {
    return {
      reasonCode: "message_channel.final_card_rollover_required",
      status: "failed",
    };
  }
  let outcome: "completed" | "failed" | "stopped" = "completed";
  if (input.failureCode) {
    outcome =
      input.failureCode ===
        RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE ||
      input.failureCode === "remote_agent.execution_cancelled"
        ? "stopped"
        : "failed";
  }
  const publication = await input.target.adapter.finalizeWorkingCard({
    replyDeliveryId: input.delivery.onBehalfOfUserId
      ? input.delivery.deliveryId
      : undefined,
    cardId,
    connection: input.target.connection,
    locator: input.target.locator,
    providerPublicationIdempotencyKey:
      input.target.providerPublicationIdempotencyKey,
    sequence,
    outcome,
    text: segment.head,
  });
  if (publication.status !== "published") {
    return publication.status === "outcome_unknown"
      ? {
          providerProgressSequence: sequence,
          reasonCode: publication.reasonCode,
          status: "outcome_unknown",
        }
      : publication;
  }
  if (
    input.delivery.providerProgressState === "send_claimed" ||
    input.delivery.providerProgressState === "send_outcome_unknown"
  ) {
    return {
      providerProgressSequence: sequence,
      reasonCode: "message_channel.final_card_visibility_unknown",
      status: "outcome_unknown",
    };
  }
  const resultId = input.delivery.providerProgressMessageId?.trim();
  return resultId
    ? {
        providerProgressSequence: sequence,
        resultId,
        status: "published",
      }
    : {
        providerProgressSequence: sequence,
        reasonCode: "message_channel.final_card_message_identity_missing",
        status: "outcome_unknown",
      };
}

function normalizeStandalonePublication(
  publication: MessageChannelPublicationResult
): MessageChannelTerminalPublicationResult {
  if (publication.status !== "published") {
    return publication.status === "outcome_unknown"
      ? {
          providerProgressSequence: null,
          reasonCode: publication.reasonCode,
          status: "outcome_unknown",
        }
      : publication;
  }
  const resultId = publication.resultId.trim();
  return resultId
    ? {
        providerProgressSequence: null,
        resultId,
        status: "published",
      }
    : {
        providerProgressSequence: null,
        reasonCode: "message_channel.final_publication_result_missing",
        status: "outcome_unknown",
      };
}
