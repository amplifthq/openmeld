import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

const nonnegativeCountSchema = z.number().int().nonnegative();
const positiveLimitSchema = z.number().int().positive();

// This is a new opt-in endpoint contract. Keep its response strict and deploy
// the Web -> Gateway -> Core consumer/producer chain in one release batch.
export const organizationUsageOverviewResponseSchema = z.strictObject({
  centerAgentWakes: z.strictObject({
    dailyLimit: positiveLimitSchema,
    resetsAt: z.iso.datetime({ offset: true }),
    usedToday: nonnegativeCountSchema,
  }),
  routines: z.strictObject({
    count: nonnegativeCountSchema,
    limit: positiveLimitSchema,
  }),
});

export const organizationUsageOverviewRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
