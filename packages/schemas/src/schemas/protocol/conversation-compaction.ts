import { z } from "zod/v4";

export const conversationCompactionMarkerSchema = z.strictObject({
  completedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  count: z.number().int().positive().max(100),
  v: z.literal(1),
});
