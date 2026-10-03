import * as z from "../../lazy-zod";

/** Recovery evidence for one existing operation, never new action authority. */
export const connectorActionReplayPermissionSchema = z.discriminatedUnion(
  "allowed",
  [
    z.strictObject({
      allowed: z.literal(true),
      remainingWindowMs: z.int().positive().max(86_400_000),
      maxAttempts: z.literal(1),
    }),
    z.strictObject({
      allowed: z.literal(false),
      reason: z.enum([
        "window_unverified",
        "window_expired",
        "already_replayed",
        "operation_in_progress",
        "operation_terminal",
      ]),
    }),
  ]
);
