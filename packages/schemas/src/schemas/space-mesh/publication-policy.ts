import { z } from "zod/v4";

export const spacePublicationModeSchema = z.enum([
  "collaboration",
  "raw_context_sharing",
]);

export const spaceAllowedActionSchema = z.enum([
  "post_message",
  "post_status",
  "stay_silent",
]);

export const spaceAllowedActionsSchema = z
  .array(spaceAllowedActionSchema)
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "allowedActions must contain at least one action",
      });
      return;
    }
    if (new Set(value).size !== value.length) {
      ctx.addIssue({
        code: "custom",
        message: "allowedActions must not contain duplicates",
      });
    }
  });
