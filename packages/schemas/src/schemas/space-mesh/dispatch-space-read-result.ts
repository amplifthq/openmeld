import * as z from "zod/v4";

export const dispatchSpaceReadResultRequestSchema = z.strictObject({
  resultId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
  query: z.string().min(1).max(256).optional(),
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
    search: z
      .strictObject({
        resultId: z.string().uuid(),
        query: z.string(),
        nextOffset: z.number().int().positive().nullable(),
        matches: z
          .array(
            z.strictObject({
              matchOffset: z.number().int().nonnegative(),
              excerpt: dispatchSpaceReadResultPageSchema,
            })
          )
          .max(2),
      })
      .optional(),
  })
  .refine(
    (value) =>
      [value.result, value.page, value.search].filter(
        (item) => item !== undefined
      ).length === 1,
    {
      message:
        "A read returns a complete result, a continuation page, or a search excerpt.",
    }
  );
