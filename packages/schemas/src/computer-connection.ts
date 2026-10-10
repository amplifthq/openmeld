import * as z from "zod/v4";
import {
  computerConnectionProgressObservationSchema,
  computerConnectionProgressPhaseSchema,
} from "./computer-connection-progress";
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
  data: z
    .object({
      state: z.string().optional(),
      phase: computerConnectionProgressPhaseSchema.optional(),
    })
    .optional(),
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
export type ComputerSetupOutput = z.infer<typeof computerSetupOutputSchema>;

export const desktopComputerConnectionProgressSchema =
  computerConnectionProgressObservationSchema.extend({
    expectedAccount: computerConnectionIntentSchema.shape.expectedAccount,
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
  expectedConnection: computerConnectionReviewSchema.shape.existingConnection
    .unwrap()
    .optional(),
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
      serviceAction: z.literal("update_service").optional(),
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

export const desktopComputerConnectionOperationSchema = z.strictObject({
  operationId: z.string().min(1).max(128),
  request: desktopComputerConnectionRequestSchema,
  status: z.enum(["pending", "settled"]),
  progress: desktopComputerConnectionProgressSchema.nullable(),
  result: desktopComputerConnectionResultSchema.nullable(),
  errorMessage: z.string().min(1).max(4096).nullable(),
});
export type DesktopComputerConnectionOperation = z.infer<
  typeof desktopComputerConnectionOperationSchema
>;

export const desktopComputerDisconnectPhaseSchema = z.enum([
  "checking",
  "waiting_for_confirmation",
  "disconnecting",
]);
export type DesktopComputerDisconnectPhase = z.infer<
  typeof desktopComputerDisconnectPhaseSchema
>;

export const desktopComputerDisconnectResultSchema = z.union([
  z.strictObject({ status: z.literal("disconnected") }),
  z.strictObject({ status: z.literal("cancelled") }),
  z.strictObject({
    status: z.enum(["connection_changed", "failed", "unconfirmed"]),
    code: z.string().min(1).max(256),
    message: z.string().min(1).max(4096),
    diagnosticId: z.string().min(1).max(128).optional(),
    diagnosticsPath: z.string().min(1).max(4096).optional(),
  }),
]);
export type DesktopComputerDisconnectResult = z.infer<
  typeof desktopComputerDisconnectResultSchema
>;

export const desktopComputerDisconnectOperationSchema = z.strictObject({
  kind: z.literal("disconnect"),
  operationId: desktopComputerConnectionOperationSchema.shape.operationId,
  request: desktopComputerDisconnectRequestSchema,
  status: z.enum(["pending", "settled"]),
  phase: desktopComputerDisconnectPhaseSchema,
  result: desktopComputerDisconnectResultSchema.nullable(),
});
export type DesktopComputerDisconnectOperation = z.infer<
  typeof desktopComputerDisconnectOperationSchema
>;

// One native operation owner. The original connect-only observer continues to
// validate its original schema; newer observers also understand Disconnect.
export const desktopComputerOperationSchema = z.union([
  desktopComputerConnectionOperationSchema,
  desktopComputerDisconnectOperationSchema,
]);
export type DesktopComputerOperation = z.infer<
  typeof desktopComputerOperationSchema
>;
