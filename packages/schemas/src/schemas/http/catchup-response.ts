import * as z from "zod/v4";

const pagedCatchupSchema = z.strictObject({
  personalHistoryDeletedAt: z.number().int().nonnegative().optional(),
  signals: z.array(z.unknown()),
  nextCursor: z
    .union([z.string().refine((value) => value.trim().length > 0), z.null()])
    .optional(),
});

/**
 * Canonical catch-up response shape across Core/Gateway/CLI.
 * `nextCursor` is nullable; invalid cursor types fail fast.
 */
export const catchupResponseSchema = pagedCatchupSchema.transform((value) => {
  const nextCursor = value.nextCursor ?? null;

  return {
    ...(value.personalHistoryDeletedAt === undefined
      ? {}
      : { personalHistoryDeletedAt: value.personalHistoryDeletedAt }),
    signals: value.signals,
    nextCursor,
  };
});
