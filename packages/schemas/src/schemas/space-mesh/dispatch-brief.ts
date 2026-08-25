import * as z from "zod/v4";
import { trimmedStringFromUnknown } from "../protocol/shared";
import { continuitySchema } from "./continuity";

const briefLineSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1)
);

export const dispatchBriefSchema = z.strictObject({
  activatedBy: briefLineSchema,
  sourceMessage: briefLineSchema,
  replyTarget: briefLineSchema,
  continuity: continuitySchema,
  whatYouCanDoNow: briefLineSchema,
});
