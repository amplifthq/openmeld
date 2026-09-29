import * as z from "zod/v4";

// Negotiated before sending new fields to strict older transport receivers.
export const OPENMELD_COMPUTER_CARE_HEADER = "x-openmeld-computer-care";

export const executionHostUnavailableReasonSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^host\.[a-z0-9_.-]{1,80}$/u),
  message: z.string().trim().min(1).max(300),
  recoveryAction: z.enum([
    "wait_for_previous_work",
    "restart_computer",
    "update_openmeld_tools",
    "open_diagnostics",
  ]),
});

// Supervisor observations only. No process IDs, paths, credentials, or new
// execution authority. Counts are last observed, never proof of safe restart.
export const executionHostObservationSchema = z.strictObject({
  hostInstanceId: z.uuid(),
  observedAtMs: z.number().int().nonnegative().nullable(),
  responsive: z.boolean(),
  admission: z.enum(["open", "draining"]).nullable(),
  activeCount: z.number().int().nonnegative().nullable(),
  pendingCount: z.number().int().nonnegative().nullable(),
  unacknowledgedResultCount: z.number().int().nonnegative().nullable(),
  startupReplayPending: z.boolean().nullable(),
  unavailableReason: executionHostUnavailableReasonSchema.nullable().optional(),
});

export const computerCareObservationSchema = z.strictObject({
  observedAtMs: z.number().int().nonnegative(),
  connection: z.enum(["connected", "unavailable", "unknown"]),
  supervisor: z.enum(["responding", "unknown"]),
  lastHeartbeatAtMs: z.number().int().nonnegative().nullable(),
  executionHost: executionHostObservationSchema.nullable(),
});
