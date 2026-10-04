import { messageChannelCardHistorySchema } from "@openmeld/schemas";
import type { MessageChannelCardHistory } from "@openmeld/schemas/types";

export type { MessageChannelCardHistory } from "@openmeld/schemas/types";

export function parseMessageChannelCardHistory(
  value: string | null | undefined
): MessageChannelCardHistory | null {
  if (value == null) {
    return null;
  }
  const parsed = messageChannelCardHistorySchema.parse(JSON.parse(value));
  if (
    new Set(parsed.cards.map((card) => card.cardId)).size !==
    parsed.cards.length
  ) {
    throw new Error(
      "Message Channel card history contains duplicate identities."
    );
  }
  return parsed;
}
