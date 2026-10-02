import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

const nonnegativeCountSchema = z.number().int().nonnegative();
const positiveLimitSchema = z.number().int().positive();

// This is a new opt-in endpoint contract. Keep its response strict and deploy
// the Web -> Gateway -> Core consumer/producer chain in one release batch.
export const organizationUsageOverviewResponseSchema = z.strictObject({
  aiSpend: z.strictObject({
    dailyLimitNanoUsd: nonnegativeCountSchema.nullable(),
    resetsAt: z.iso.datetime({ offset: true }),
    usedNanoUsd: nonnegativeCountSchema,
    missingCostRequests: nonnegativeCountSchema,
    exhausted: z.boolean(),
  }),
  routines: z.strictObject({
    count: nonnegativeCountSchema,
    limit: positiveLimitSchema,
  }),
});

export const organizationUsageOverviewRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
