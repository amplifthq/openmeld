import { z } from "zod/v4";
import { coreReadinessFactsChangedSchema } from "../protocol/core-readiness-facts-changed";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { trimmedStringFromUnknown } from "../protocol/shared";
import {
  MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH,
  signalReplyToSchema,
} from "../protocol/signal-reply-to";

export const spaceStatusSchema = z.enum([
  "working",
  "needs_input",
  "done",
  "blocked",
  "handoff",
]);

export const signalStatusGeneratedBySchema = z.literal("openmeld");

export const signalStatusDataSchema = z.strictObject({
  actorProfileId: openMeldRuntimeProfileIdSchema,
  status: spaceStatusSchema,
  dispatchId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  resultRef: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1))
    .optional(),
  coreReadinessFactsChanged: coreReadinessFactsChangedSchema.optional(),
  replyTo: signalReplyToSchema.optional(),
  targetProfileId: openMeldRuntimeProfileIdSchema.optional(),
  text: z.preprocess(
    trimmedStringFromUnknown,
    z.string().min(1).max(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH)
  ),
  generatedBy: signalStatusGeneratedBySchema,
});

export const signalStatusSchema = z.strictObject({
  type: z.literal("signal.status"),
  data: signalStatusDataSchema,
});
