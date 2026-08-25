import * as z from "zod/v4";
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

const centerAgentSlackTeammateInvitationOutcomeSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(256).nullable(),
  status: z.enum([
    "already_claimed",
    "already_member",
    "delivered",
    "failed",
    "manual_invite_required",
    "not_found",
    "outcome_unknown",
  ]),
  targetSlackUserId: slackIdSchema,
});

export const centerAgentInviteSlackTeammatesRpcResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      manualInviteUrl: z.url().max(2048).nullable(),
      organizationName: z.string().trim().min(1).max(256),
      outcomes: z
        .array(centerAgentSlackTeammateInvitationOutcomeSchema)
        .min(1)
        .max(10),
      status: z.literal("completed"),
    }),
    z.strictObject({
      reason: z.string().trim().min(1).max(500),
      status: z.literal("unavailable"),
    }),
  ]);
