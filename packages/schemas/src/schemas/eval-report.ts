import * as z from "zod/v4";

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const rateSchema = z.number().min(0).max(1);

export const evalSpaceSignalMetricsInputSchema = z
  .strictObject({
    spaceId: z.string().trim().min(1),
    periodStartMs: nonnegativeIntegerSchema,
    periodEndMs: nonnegativeIntegerSchema,
  })
  .refine((input) => input.periodEndMs > input.periodStartMs, {
    message: "periodEndMs must be greater than periodStartMs",
    path: ["periodEndMs"],
  });

export const evalSpaceSignalMetricsSchema = z.strictObject({
  spaceId: z.string().trim().min(1),
  silentCount: nonnegativeIntegerSchema,
  replyCount: nonnegativeIntegerSchema,
  staleReplyCount: nonnegativeIntegerSchema,
});

export const organizationWeeklyEvalMetricsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  wakeTotal: nonnegativeIntegerSchema,
  closureCount: nonnegativeIntegerSchema,
  closureRate: rateSchema,
  failureCount: nonnegativeIntegerSchema,
  failureRate: rateSchema,
  silentCount: nonnegativeIntegerSchema,
  silentRate: rateSchema,
  replyCount: nonnegativeIntegerSchema,
  staleReplyCount: nonnegativeIntegerSchema,
  stalenessRate: rateSchema,
  concurrencyOverlap: nonnegativeIntegerSchema,
});
