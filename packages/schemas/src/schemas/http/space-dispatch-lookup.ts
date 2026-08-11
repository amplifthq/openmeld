import { z } from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import {
  spaceDispatchTraceAttemptStatusSchema,
  spaceDispatchTraceDispatchStatusSchema,
} from "./space-dispatch-trace";

const optionalSelectorSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());
const optionalClientMessageIdSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, clientMessageIdSchema.optional());

export const getSpaceDispatchLookupInputSchema = z
  .strictObject({
    spaceId: nonEmptyTrimmedStringFromUnknown,
    sourceSignalId: optionalSelectorSchema,
    clientMessageId: optionalClientMessageIdSchema,
    targetProfileId: optionalSelectorSchema,
  })
  .superRefine((value, context) => {
    const selectorCount =
      Number(value.sourceSignalId !== undefined) +
      Number(value.clientMessageId !== undefined);
    if (selectorCount === 1) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "exactly one of sourceSignalId or clientMessageId is required",
      path: ["sourceSignalId"],
    });
  });

export const spaceDispatchLookupMatchSchema = z.strictObject({
  dispatchId: z.string().trim().min(1),
  sourceSignalId: z.string().trim().min(1),
  targetProfileId: z.string().trim().min(1),
  status: spaceDispatchTraceDispatchStatusSchema,
  attemptCount: z.int().min(0),
  latestAttemptId: z.string().trim().min(1).nullable(),
  latestAttemptStatus: spaceDispatchTraceAttemptStatusSchema.nullable(),
  latestAttemptErrorCode: z.string().trim().min(1).nullable(),
  latestAttemptErrorMessage: z.string().trim().min(1).nullable(),
});

export const getSpaceDispatchLookupResponseSchema = z.strictObject({
  query: z.strictObject({
    spaceId: z.string().trim().min(1),
    sourceSignalId: z.string().trim().min(1).nullable(),
    clientMessageId: clientMessageIdSchema.nullable(),
    targetProfileId: z.string().trim().min(1).nullable(),
  }),
  matches: z.array(spaceDispatchLookupMatchSchema),
});
