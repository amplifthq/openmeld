import * as z from "zod/v4";
import { signalEnvelopeSchema } from "../protocol/envelope";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import { dispatchResultSchema } from "../space-mesh/dispatch-result";
import { spaceDispatchTraceFinalVisibleOutcomeSchema } from "./space-dispatch-trace";

const optionalSelectorSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());

export const getSpaceDispatchResultInputSchema = z
  .strictObject({
    spaceId: nonEmptyTrimmedStringFromUnknown,
    dispatchId: optionalSelectorSchema,
    resultRef: optionalSelectorSchema,
  })
  .superRefine((value, ctx) => {
    const selectorCount =
      Number(typeof value.dispatchId === "string") +
      Number(typeof value.resultRef === "string");
    if (selectorCount !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "exactly one of dispatchId or resultRef is required",
        path: ["dispatchId"],
      });
    }
  });

export const getSpaceDispatchResultResponseSchema = dispatchResultSchema;

// Base published result. CLI adds the existing messageReadProjection decoration,
// as it does for archived results. The archived HTTP response stays unchanged.
export const spacePublishedDispatchResultSchema = z
  .strictObject({
    source: z.literal("published_message"),
    spaceId: z.string().min(1),
    dispatchId: z.string().min(1),
    outcome: spaceDispatchTraceFinalVisibleOutcomeSchema,
    signal: signalEnvelopeSchema,
  })
  .superRefine((value, context) => {
    if (
      !value.outcome.delivered ||
      value.outcome.signalId !== value.signal.id ||
      value.spaceId !== value.signal.spaceId
    ) {
      context.addIssue({
        code: "custom",
        message: "Published result must match the delivered Space signal",
        path: ["signal"],
      });
    }
  });
