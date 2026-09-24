import * as z from "zod/v4";

export const dispatchSpaceReadResultRequestSchema = z.strictObject({
  resultId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
});

/** A byte cursor addresses one immutable JSON snapshot, not a local file. */
export const dispatchSpaceReadResultPageSchema = z.strictObject({
  resultId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().positive().nullable(),
  totalBytes: z.number().int().positive(),
  text: z.string(),
});

export const dispatchSpaceReadResultSchema = z
  .strictObject({
    result: z.record(z.string(), z.unknown()).optional(),
    page: dispatchSpaceReadResultPageSchema.optional(),
  })
  .refine(
    (value) => (value.result !== undefined) !== (value.page !== undefined),
    {
      message:
        "A read returns either the complete result or one continuation page.",
    }
  );
