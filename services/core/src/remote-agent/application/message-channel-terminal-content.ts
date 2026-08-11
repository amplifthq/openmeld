import { MAX_TEXT_LENGTH } from "@openmeld/schemas";
import type { SpaceMessageAttachment } from "@openmeld/schemas/types";

const MESSAGE_CHANNEL_ATTACHMENT_DELIVERY_NOTICE =
  "\n\n_OpenMeld generated an image, but this channel cannot deliver generated images yet._";
const MESSAGE_CHANNEL_ATTACHMENTS_DELIVERY_NOTICE =
  "\n\n_OpenMeld generated images, but this channel cannot deliver generated images yet._";

export const MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS =
  MAX_TEXT_LENGTH +
  Math.max(
    MESSAGE_CHANNEL_ATTACHMENT_DELIVERY_NOTICE.length,
    MESSAGE_CHANNEL_ATTACHMENTS_DELIVERY_NOTICE.length
  );

export function projectMessageChannelTerminalContent(input: {
  attachments: readonly SpaceMessageAttachment[];
  text: string;
}): {
  attachments: readonly SpaceMessageAttachment[];
  text: string;
} {
  if (input.attachments.length === 0) {
    return input;
  }
  const attachmentNotice =
    input.attachments.length === 1
      ? MESSAGE_CHANNEL_ATTACHMENT_DELIVERY_NOTICE
      : MESSAGE_CHANNEL_ATTACHMENTS_DELIVERY_NOTICE;
  return {
    attachments: [],
    text: `${input.text}${attachmentNotice}`,
  };
}
