import { z } from "zod/v4";
import { spaceMessageFileReferencesSchema } from "../http/space-files";
import { messageEnvelopeSchema } from "../protocol/message-envelope";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { trimmedStringFromUnknown } from "../protocol/shared";
import { MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH } from "../protocol/signal-reply-to";
import { spaceStatusSchema } from "./signal-status";
import { spaceThreadActionRefSchema } from "./space-thread";

export const SPACE_UPDATES_DEFAULT_LIMIT = 20;
export const SPACE_UPDATES_MAX_LIMIT = 200;

const signalIdRefSchema = z.strictObject({
  signalId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
});

export const openMeldSpaceActionReplyToSchema = z.union([
  z.literal("current"),
  signalIdRefSchema,
]);

export const openMeldSpaceActionReadUpdatesFromSchema = z.union([
  z.literal("last_public_reply"),
  signalIdRefSchema,
]);

export const openMeldSpaceActionReadResultBySchema = z.union([
  z.strictObject({
    resultRef: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  }),
  z.strictObject({
    dispatchId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  }),
]);

export const openMeldSpacePostMessageActionSchema = z.strictObject({
  type: z.literal("post_message"),
  observedThroughSignalId: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1))
    .optional(),
  messageEnvelope: messageEnvelopeSchema,
  files: spaceMessageFileReferencesSchema.optional(),
  thread: spaceThreadActionRefSchema.optional(),
  saveResult: z.boolean().optional(),
});

export const openMeldSpacePostStatusActionSchema = z.strictObject({
  type: z.literal("post_status"),
  status: spaceStatusSchema,
  targetProfileId: openMeldRuntimeProfileIdSchema.optional(),
  text: z.preprocess(
    trimmedStringFromUnknown,
    z.string().min(1).max(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH)
  ),
  replyTo: openMeldSpaceActionReplyToSchema.optional(),
  thread: spaceThreadActionRefSchema.optional(),
  saveResult: z.boolean().optional(),
});

export const openMeldSpaceStaySilentActionSchema = z.strictObject({
  type: z.literal("stay_silent"),
  reason: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  saveResult: z.boolean().optional(),
});

export const openMeldSpaceReadUpdatesActionSchema = z.strictObject({
  type: z.literal("read_updates"),
  from: openMeldSpaceActionReadUpdatesFromSchema,
  thread: spaceThreadActionRefSchema.optional(),
  limit: z
    .number()
    .int()
    .finite()
    .positive()
    .max(SPACE_UPDATES_MAX_LIMIT)
    .optional(),
});

export const openMeldSpaceReadResultActionSchema = z.strictObject({
  type: z.literal("read_result"),
  by: openMeldSpaceActionReadResultBySchema,
});

export const openMeldSpaceActionSchema = z.union([
  openMeldSpacePostMessageActionSchema,
  openMeldSpacePostStatusActionSchema,
  openMeldSpaceStaySilentActionSchema,
  openMeldSpaceReadUpdatesActionSchema,
  openMeldSpaceReadResultActionSchema,
]);

export const openMeldSpaceEgressActionSchema = z.union([
  openMeldSpacePostMessageActionSchema,
  openMeldSpacePostStatusActionSchema,
  openMeldSpaceStaySilentActionSchema,
]);
