import type { MessageChannelCardHistory } from "../infrastructure/d1/message-channel-card-history";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";
import type { MessageChannelCardMutationResult } from "./message-channel-adapters";
import {
  hashMessageChannelCardText,
  MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS,
  splitMessageChannelCardSegment,
} from "./message-channel-card-segmentation";
import type { MessageChannelPublicationTarget } from "./message-channel-publication-target";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

const REPLACED_CARD_TEXT =
  "This draft section was replaced. See the updated response below.";
const LEGACY_REPLACEMENT_NOTICE =
  "This response replaces all earlier draft cards for this request.\n\n";

export function projectMessageChannelCardRevision(
  delivery: RemoteAgentNativeDeliveryRecord,
  snapshot: string
) {
  if (snapshot.length > MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS) {
    throw new Error("Message Channel response exceeds its total text budget.");
  }
  const history: MessageChannelCardHistory =
    delivery.providerProgressCardHistory ?? {
      v: 1,
      firstIndex: delivery.providerProgressRolloverIndex,
      cards: [],
      ...(delivery.providerProgressRolloverIndex > 0
        ? { legacySuperseded: true }
        : {}),
    };
  if (
    history.firstIndex + history.cards.length >
      delivery.providerProgressRolloverIndex ||
    history.cards.some(
      (card) => card.cardId === delivery.providerProgressCardId
    )
  ) {
    throw new Error(
      "Message Channel card history disagrees with the active card."
    );
  }
  const legacySuperseded =
    history.legacySuperseded ||
    history.firstIndex + history.cards.length <
      delivery.providerProgressRolloverIndex;
  const text = legacySuperseded
    ? LEGACY_REPLACEMENT_NOTICE + snapshot
    : snapshot;
  let sourceOffset = 0;
  const previous = history.cards.map((card) => {
    const segment = splitMessageChannelCardSegment({ sourceOffset, text });
    // Keep the last answer segment in the active card. Surplus old cards
    // become explicit supersession notices, not empty or misleading drafts.
    if (!segment.tail) {
      return { ...card, text: REPLACED_CARD_TEXT };
    }
    sourceOffset = segment.sourceEnd;
    return { ...card, text: segment.head };
  });
  return {
    history: {
      ...history,
      ...(legacySuperseded ? { legacySuperseded: true } : {}),
    },
    previous,
    sourceOffset,
    text,
    active: splitMessageChannelCardSegment({ sourceOffset, text }),
  };
}

export async function revisePreviousMessageChannelCards(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  revision: ReturnType<typeof projectMessageChannelCardRevision>;
  target: MessageChannelPublicationTarget;
  sequence: number;
  providerPublicationIdempotencyKey: string;
  force?: boolean;
}): Promise<{
  result: MessageChannelCardMutationResult;
  history: MessageChannelCardHistory;
  revised: boolean;
}> {
  const cards: MessageChannelCardHistory["cards"] = [];
  let revised = false;
  for (const card of input.revision.previous) {
    const textHash = await hashMessageChannelCardText(card.text);
    if (input.force || textHash !== card.textHash) {
      revised = true;
      const key = await buildMessageChannelProviderPublicationUuid({
        deliveryId: input.delivery.deliveryId,
        provider: input.target.locator.provider,
        publicationKind: `card-revision:${input.providerPublicationIdempotencyKey}:${card.cardId}:${textHash}`,
      });
      const result = await input.target.adapter.finalizeWorkingCard({
        cardId: card.cardId,
        connection: input.target.connection,
        locator: input.target.locator,
        providerPublicationIdempotencyKey: key,
        sequence: input.sequence,
        outcome: "continued",
        text: card.text,
      });
      if (result.status !== "published") {
        // The caller owns the claim and decides whether a partially applied
        // progress correction must remain frozen. Preserve provider evidence,
        // including a known rejection's retry delay, for terminal publication.
        return {
          result,
          history: input.revision.history,
          revised,
        };
      }
    }
    cards.push({ cardId: card.cardId, textHash });
  }
  const { pendingSnapshot: _pending, ...history } = input.revision.history;
  return {
    result: { status: "published" },
    history: { ...history, cards },
    revised,
  };
}
