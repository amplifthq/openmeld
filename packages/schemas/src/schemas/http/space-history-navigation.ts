import * as z from "zod/v4";

export const spaceHistoryNavigationQuerySchema = z.strictObject({
  startSignalId: z.string().min(1).max(200).optional(),
  endSignalId: z.string().min(1).max(200).optional(),
});

export const spaceHistoryNavigationSchema = z.object({
  entries: z
    .array(
      z.object({
        signalId: z.string(),
        endSignalId: z.string(),
        startAt: z.number(),
        endAt: z.number(),
        count: z.number().int().positive(),
        author: z.string(),
        preview: z.string().max(360),
      })
    )
    .max(48),
  total: z.number().int().nonnegative(),
});
