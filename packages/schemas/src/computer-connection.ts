import { z } from "zod/v4";
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

export const desktopComputerConnectionRequestSchema =
  createPrepareSessionRequestSchema
    .pick({
      humanProfileId: true,
      targetSpaceId: true,
    })
    .extend({
      expectedAccount: computerConnectionIntentSchema.shape.expectedAccount,
    });

export const desktopComputerConnectionResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("failed"),
      message: z.string().min(1),
      diagnosticId: z.string().min(1),
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
