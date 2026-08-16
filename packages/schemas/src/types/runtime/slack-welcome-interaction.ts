import type { z } from "zod/v4";

type SlackWelcomeInteractionRpcInputSchema =
  typeof import("../../schemas/runtime/slack-welcome-interaction")["slackWelcomeInteractionRpcInputSchema"];
type SlackWelcomeInteractionRpcResponseSchema =
  typeof import("../../schemas/runtime/slack-welcome-interaction")["slackWelcomeInteractionRpcResponseSchema"];

export type SlackWelcomeInteractionRpcInput =
  z.infer<SlackWelcomeInteractionRpcInputSchema>;
export type SlackWelcomeInteractionRpcResponse =
  z.infer<SlackWelcomeInteractionRpcResponseSchema>;
