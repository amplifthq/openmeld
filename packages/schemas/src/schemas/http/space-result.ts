import { z } from "zod/v4";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import { dispatchResultSchema } from "../space-mesh/dispatch-result";

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
