import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/space-agent-interaction");

export type RespondToSpaceAgentInteractionBody = z.infer<
  Schemas["respondToSpaceAgentInteractionBodySchema"]
>;
export type RespondToSpaceAgentInteractionInput = z.infer<
  Schemas["respondToSpaceAgentInteractionInputSchema"]
>;
export type RespondToSpaceAgentInteractionResponse = z.infer<
  Schemas["respondToSpaceAgentInteractionResponseSchema"]
>;
