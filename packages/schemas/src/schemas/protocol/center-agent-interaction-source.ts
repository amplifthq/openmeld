import { z } from "zod/v4";

export const CENTER_AGENT_INTERACTION_CLIENT_MAX_CHARS = 80;
export const CENTER_AGENT_INTERACTION_SESSION_ID_MAX_CHARS = 512;

/**
 * Describes the authenticated client's carrier for a Center Agent request.
 * This is attribution and trace context only. It never grants identity,
 * membership, data access, or execution authority.
 */
export const centerAgentInteractionSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    client: z
      .string()
      .trim()
      .min(1)
      .max(CENTER_AGENT_INTERACTION_CLIENT_MAX_CHARS),
    kind: z.literal("local_agent"),
    sessionId: z
      .string()
      .trim()
      .min(1)
      .max(CENTER_AGENT_INTERACTION_SESSION_ID_MAX_CHARS)
      .optional(),
  }),
]);
