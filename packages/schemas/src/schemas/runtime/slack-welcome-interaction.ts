import { z } from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentVerifiedMemberToolSpeakerSchema } from "../http/center-agent-speaker";

const slackIdSchema = z.string().trim().min(1).max(128);
const slackInteractionPresentationContextSchema = {
  gatewayRequestId: z.uuid().optional(),
  interactionReceivedAtMs: z.number().int().nonnegative().optional(),
};

export const slackWelcomeInteractionRpcInputSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("open_teammate_invite_modal"),
      ...slackInteractionPresentationContextSchema,
      slackTeamId: slackIdSchema,
      slackUserId: slackIdSchema,
      triggerId: z.string().trim().min(1).max(512),
    }),
    z.strictObject({
      action: z.literal("open_channel_introduction_modal"),
      ...slackInteractionPresentationContextSchema,
      slackTeamId: slackIdSchema,
      slackUserId: slackIdSchema,
      triggerId: z.string().trim().min(1).max(512),
    }),
    z.strictObject({
      action: z.literal("submit_teammate_invites"),
      interactionId: slackIdSchema,
      slackTeamId: slackIdSchema,
      slackUserId: slackIdSchema,
      targetSlackUserIds: z
        .array(slackIdSchema)
        .min(1)
        .max(10)
        .transform((values) => [...new Set(values)]),
    }),
    z.strictObject({
      action: z.literal("submit_channel_introductions"),
      interactionId: slackIdSchema,
      slackTeamId: slackIdSchema,
      slackUserId: slackIdSchema,
      targetSlackChannelIds: z
        .array(slackIdSchema)
        .min(1)
        .max(5)
        .transform((values) => [...new Set(values)]),
    }),
  ]
);

export const slackWelcomeInteractionRpcResponseSchema = z.strictObject({
  handled: z.literal(true),
});

export const centerAgentInviteSlackTeammatesRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  interactionId: slackIdSchema,
  slackTeamId: slackIdSchema,
  slackUserId: slackIdSchema,
  speakerMember: centerAgentVerifiedMemberToolSpeakerSchema,
  targetSlackUserIds: z
    .array(slackIdSchema)
    .min(1)
    .max(10)
    .transform((values) => [...new Set(values)]),
});

export const centerAgentInviteSlackTeammatesRpcResponseSchema =
  slackWelcomeInteractionRpcResponseSchema;
