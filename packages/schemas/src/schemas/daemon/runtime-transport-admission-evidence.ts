import * as z from "zod/v4";

// Diagnostic evidence for the last local admission transition. It never
// grants a dispatch or changes the current Wakeability verdict.
export const runtimeTransportAdmissionEvidenceSchema = z.strictObject({
  acceptingDispatches: z.boolean(),
  connectionGeneration: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  changedAtMs: z.number().int().nonnegative(),
  reasonCode: z.enum([
    "connection_initializing",
    "connection_replaced",
    "host_configure_failed",
    "host_unavailable",
    "host_health_unconfirmed",
    "host_draining",
    "startup_replay_pending",
    "host_ready",
    "controlled_stop",
    "unknown",
  ]),
  detailCode: z
    .string()
    .regex(/^[a-z][a-z0-9_.-]{0,79}$/u)
    .optional(),
});
