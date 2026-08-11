import type { z } from "zod/v4";

type GetSpaceConversationStateInputSchema =
  typeof import("../../schemas/http/space-conversation-state")["getSpaceConversationStateInputSchema"];
type GetSpaceConversationStateResponseSchema =
  typeof import("../../schemas/http/space-conversation-state")["getSpaceConversationStateResponseSchema"];

export type GetSpaceConversationStateInput =
  z.infer<GetSpaceConversationStateInputSchema>;
export type GetSpaceConversationStateResponse =
  z.infer<GetSpaceConversationStateResponseSchema>;
