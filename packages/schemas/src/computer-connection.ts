import * as z from "zod/v4";
import {
  createPrepareSessionRequestSchema,
  prepareSessionSnapshotSchema,
} from "./schemas/prepare/session";

// A review identity is not a credential. The CLI compares it again under its
// existing account transition lock before accepting an independent session.
export const computerConnectionIntentSchema = z.strictObject({
  expectedAccount: z.string().trim().min(1).max(256),
  previousSessionIdentity: z.string().min(1).max(128),
});

export type ComputerConnectionIntent = z.infer<
  typeof computerConnectionIntentSchema
>;

const computerSetupVerboseOutputSchema = z.object({
  type: z.string(),
  code: z.string().min(1).max(256),
  text: z.string().optional(),
  message: z.string().optional(),
  data: z.object({ state: z.string().optional() }).optional(),
});

// Both envelopes are emitted by the CLI's existing Agent View presenter.
export const computerSetupOutputSchema = z.union([
  computerSetupVerboseOutputSchema,
  z
    .object({
      t: z.string(),
      c: z.string().min(1).max(256),
      x: z.string().optional(),
      m: z.string().optional(),
      d: computerSetupVerboseOutputSchema.shape.data,
    })
    .transform((event) => ({
      type: event.t,
      code: event.c,
      text: event.x,
      message: event.m,
      data: event.d,
    })),
]);

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

export const desktopComputerConnectionProgressSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedAccount: computerConnectionIntentSchema.shape.expectedAccount,
  operationId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  prepareSessionId: z.string().min(1).max(256).nullable(),
  sequence: z.number().int().nonnegative(),
  observedAt: z.string().datetime(),
  phase: computerConnectionProgressPhaseSchema,
  state: z.enum(["active", "completed", "failed"]),
  code: z.string().min(1).max(256),
  measurement: computerConnectionProgressMeasurementSchema.optional(),
  detail: z.string().min(1).max(512).optional(),
});
export type DesktopComputerConnectionProgress = z.infer<
  typeof desktopComputerConnectionProgressSchema
>;

export const computerConnectionReviewSchema = z.strictObject({
  protocol: z.literal("computer-connection-v1"),
  previousSessionIdentity: z.string().min(1).max(128),
  account: z
    .strictObject({
      id: z.string().min(1).max(256),
      email: z.string().max(512).nullable(),
    })
    .nullable(),
  existingConnection: z
    .strictObject({
      deviceId: z.string().min(1),
      runtimeLane: z.enum(["prod", "dev-local", "canary"]),
    })
    .nullable(),
});

export const desktopComputerDisconnectRequestSchema = z.strictObject({
  expectedAccount: computerConnectionIntentSchema.shape.expectedAccount,
});
export type DesktopComputerDisconnectRequest = z.infer<
  typeof desktopComputerDisconnectRequestSchema
>;

export const desktopComputerConnectionRequestSchema =
  createPrepareSessionRequestSchema
    .pick({
      humanProfileId: true,
      targetSpaceId: true,
      sourceNavigationAction: true,
      connectedComputerId: true,
    })
    .extend({
      expectedAccount: computerConnectionIntentSchema.shape.expectedAccount,
      resetThisComputer: z.boolean().optional(),
    });

export const desktopComputerConnectionResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("failed"),
      message: z.string().min(1),
      diagnosticId: z.string().min(1),
      diagnosticsPath: z.string().min(1).optional(),
    }),
    z.strictObject({
      status: z.literal("reused"),
      connection:
        computerConnectionReviewSchema.shape.existingConnection.unwrap(),
    }),
    z.strictObject({
      status: z.literal("completed"),
      snapshot: prepareSessionSnapshotSchema,
    }),
    z.strictObject({ status: z.literal("cancelled") }),
  ]
);
export type DesktopComputerConnectionRequest = z.infer<
  typeof desktopComputerConnectionRequestSchema
>;
export type DesktopComputerConnectionResult = z.infer<
  typeof desktopComputerConnectionResultSchema
>;
