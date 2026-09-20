import * as z from "zod/v4";

// Negotiated before sending new fields to strict older transport receivers.
export const OPENMELD_COMPUTER_CARE_HEADER = "x-openmeld-computer-care";

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
});

export const computerCareObservationSchema = z.strictObject({
  observedAtMs: z.number().int().nonnegative(),
  connection: z.enum(["connected", "unavailable", "unknown"]),
  supervisor: z.enum(["responding", "unknown"]),
  lastHeartbeatAtMs: z.number().int().nonnegative().nullable(),
  executionHost: executionHostObservationSchema.nullable(),
});
