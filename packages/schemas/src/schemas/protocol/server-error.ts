import * as z from "zod/v4";
import { clientMessageIdSchema } from "./client-message-id";
import { nonEmptyTrimmedStringFromUnknown } from "./shared";

export const serverErrorFrameSchema = z.object({
  error: nonEmptyTrimmedStringFromUnknown,
  requestId: nonEmptyTrimmedStringFromUnknown.optional(),
  clientMessageId: clientMessageIdSchema.optional(),
});
