import type { z } from "zod/v4";

type SlackWelcomeInteractionRpcInputSchema =
  typeof import("../../schemas/runtime/slack-welcome-interaction")["slackWelcomeInteractionRpcInputSchema"];
type SlackWelcomeInteractionRpcResponseSchema =
  typeof import("../../schemas/runtime/slack-welcome-interaction")["slackWelcomeInteractionRpcResponseSchema"];
type CenterAgentInviteSlackTeammatesRpcInputSchema =
  typeof import("../../schemas/runtime/slack-welcome-interaction")["centerAgentInviteSlackTeammatesRpcInputSchema"];
type CenterAgentInviteSlackTeammatesRpcResponseSchema =
  typeof import("../../schemas/runtime/slack-welcome-interaction")["centerAgentInviteSlackTeammatesRpcResponseSchema"];

export type SlackWelcomeInteractionRpcInput =
  z.infer<SlackWelcomeInteractionRpcInputSchema>;
export type SlackWelcomeInteractionRpcResponse =
  z.infer<SlackWelcomeInteractionRpcResponseSchema>;
export type CenterAgentInviteSlackTeammatesRpcInput =
  z.infer<CenterAgentInviteSlackTeammatesRpcInputSchema>;
export type CenterAgentInviteSlackTeammatesRpcResponse =
  z.infer<CenterAgentInviteSlackTeammatesRpcResponseSchema>;
