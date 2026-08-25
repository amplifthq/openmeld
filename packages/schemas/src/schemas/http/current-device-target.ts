import * as z from "zod/v4";
import { daemonServiceLaneSchema } from "../daemon/service-contract";
import { START_BOUNDED_ID_SCHEMA } from "../start/shared";

export const currentDeviceTargetDeviceIdSchema = START_BOUNDED_ID_SCHEMA;

export const currentDeviceTargetResolvedSchema = z.strictObject({
  availability: z.literal("resolved"),
  connectedComputerId: START_BOUNDED_ID_SCHEMA.optional(),
  deviceId: currentDeviceTargetDeviceIdSchema,
  runtimeLane: daemonServiceLaneSchema,
});

export const currentDeviceTargetMissingSchema = z.strictObject({
  availability: z.literal("missing"),
  reasonCodes: z.array(z.string().trim().min(1).max(256)).optional(),
});

export const currentDeviceTargetResponseSchema = z.discriminatedUnion(
  "availability",
  [currentDeviceTargetResolvedSchema, currentDeviceTargetMissingSchema]
);

export const localRuntimeEnrollmentBodySchema = z.strictObject({
  connectedComputerId: START_BOUNDED_ID_SCHEMA.optional(),
  runtimeLane: daemonServiceLaneSchema,
});

export const localRuntimeEnrollmentResponseSchema = z.strictObject({
  connectedComputerId: START_BOUNDED_ID_SCHEMA.optional(),
  deviceId: currentDeviceTargetDeviceIdSchema,
  runtimeLane: daemonServiceLaneSchema,
});

export const forgetCurrentComputerStatusSchema = z.enum([
  "forgotten",
  "already_missing",
]);

export const forgetCurrentComputerResponseSchema = z.strictObject({
  status: forgetCurrentComputerStatusSchema,
  forgottenDeviceId: START_BOUNDED_ID_SCHEMA.nullable(),
  currentDeviceTarget: currentDeviceTargetMissingSchema,
});

export const forgetComputerRouteParamsSchema = z.strictObject({
  deviceId: currentDeviceTargetDeviceIdSchema,
});

export const forgetComputerResponseSchema = z.strictObject({
  status: forgetCurrentComputerStatusSchema,
  forgottenDeviceId: START_BOUNDED_ID_SCHEMA.nullable(),
  currentDeviceTarget: currentDeviceTargetResponseSchema,
});
