import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./schemas/daemon/profile-identity";
import { daemonServiceLaneSchema } from "./schemas/daemon/service-contract";

export const COMPUTER_POWER_CAPABILITY_HEADER = "x-openmeld-computer-power";
export const computerPowerRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read") }),
  z.strictObject({
    operation: z.literal("update"),
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  }),
]);
export const computerPowerStateSchema = z.strictObject({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  active: z.boolean(),
  supported: z.boolean(),
  problem: z.string().nullable(),
});
export const computerPowerResultSchema = z.union([
  computerPowerStateSchema,
  z.strictObject({
    status: z.literal("rejected"),
    code: z.string(),
    message: z.string(),
  }),
]);
export const computerPowerTargetSchema = z.strictObject({
  deviceId: z.string().min(1),
  runtimeLane: daemonServiceLaneSchema,
});
export const computerPowerRpcInputSchema = computerPowerTargetSchema.extend({
  context: openMeldRequestContextSchema,
  request: computerPowerRequestSchema,
});
export const computerPowerTransportSchema = z.strictObject({
  ownerUserId: z.string().min(1),
  deviceId: z.string().min(1),
  lane: daemonServiceLaneSchema,
  requestId: z.string().min(1),
  request: computerPowerRequestSchema,
});
export const computerPowerRequestFrameSchema = z.strictObject({
  v: z.literal(1),
  code: z.literal("daemon.computer_power.request"),
  payload: z.strictObject({
    requestId: z.string().min(1),
    deviceId: z.string().min(1),
    request: computerPowerRequestSchema,
  }),
});
export const computerPowerResultFrameSchema = z.strictObject({
  v: z.literal(1),
  code: z.literal("daemon.computer_power.request_result"),
  payload: z.strictObject({
    requestId: z.string().min(1),
    result: computerPowerResultSchema,
  }),
});
export type ComputerPowerState = z.infer<typeof computerPowerStateSchema>;
export type ComputerPowerRequest = z.infer<typeof computerPowerRequestSchema>;
export type ComputerPowerRpcInput = z.infer<typeof computerPowerRpcInputSchema>;
