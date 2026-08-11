import type { z } from "zod/v4";

type ConversationCompactionMarkerSchema =
  typeof import("../../schemas/protocol/conversation-compaction")["conversationCompactionMarkerSchema"];

export type ConversationCompactionMarker =
  z.infer<ConversationCompactionMarkerSchema>;
