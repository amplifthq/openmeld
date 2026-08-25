import * as z from "zod/v4";
import { MAX_PROFILE_NAME_LENGTH } from "./constants";
import { openMeldRuntimeProfileIdSchema } from "./profile";
import { trimmedStringFromUnknown } from "./shared";

export const MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH = 120 as const;

export const signalReplyToSchema = z.strictObject({
  signalId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  profileId: openMeldRuntimeProfileIdSchema,
  profileKind: z.enum(["human", "agent", "system"]).nullable(),
  profileName: z.preprocess(
    trimmedStringFromUnknown,
    z.string().min(1).max(MAX_PROFILE_NAME_LENGTH)
  ),
  previewText: z.preprocess(
    trimmedStringFromUnknown,
    z.string().min(1).max(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH)
  ),
});
