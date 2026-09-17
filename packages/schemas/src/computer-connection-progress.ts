import * as z from "zod/v4";

export const computerConnectionProgressPhaseSchema = z.enum([
  "checking",
  "downloading",
  "verifying",
  "installing",
  "waiting_for_confirmation",
  "switching_account",
  "waiting_for_current_work",
  "connecting_service",
  "confirming",
  "connected",
  "restoring",
  "needs_attention",
]);
export type ComputerConnectionProgressPhase = z.infer<
  typeof computerConnectionProgressPhaseSchema
>;

export const computerConnectionProgressMeasurementSchema = z.strictObject({
  unit: z.literal("bytes"),
  value: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  transferAttempt: z.number().int().positive(),
});

export const computerConnectionProgressObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  prepareSessionId: z.string().min(1).max(256).nullable(),
  sequence: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  observedAt: z.string().datetime(),
  phase: computerConnectionProgressPhaseSchema,
  state: z.enum(["active", "completed", "failed"]),
  code: z.string().min(1).max(256),
  measurement: computerConnectionProgressMeasurementSchema.optional(),
  detail: z.string().min(1).max(512).optional(),
});
export type ComputerConnectionProgressObservation = z.infer<
  typeof computerConnectionProgressObservationSchema
>;
