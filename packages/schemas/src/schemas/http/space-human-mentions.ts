import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { MAX_PROFILE_NAME_LENGTH } from "../protocol/constants";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";

export const MAX_ORGANIZATION_MENTION_TARGETS = 25;

/** Display facts only. Neither scope grants membership or content access. */
export const spaceHumanMentionTargetSchema = z.strictObject({
  profileId: openMeldRuntimeProfileIdSchema,
  profileName: z.string().trim().min(1).max(MAX_PROFILE_NAME_LENGTH),
  scope: z.enum(["space", "organization"]),
});

export const remoteAgentResolveReplyMentionsRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  mentionProfileIds: z
    .array(openMeldRuntimeProfileIdSchema)
    .max(MAX_ORGANIZATION_MENTION_TARGETS),
});

export const remoteAgentResolveReplyMentionsResponseSchema = z.strictObject({
  spaceId: z.string().min(1),
  targets: z.array(spaceHumanMentionTargetSchema).max(25),
});
