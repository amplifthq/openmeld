import type * as z from "zod/v4";

export type WakeDeviceWait = z.infer<
  typeof import("../../schemas/protocol/wake-device-wait").wakeDeviceWaitSchema
>;
export type WakeDeviceWaitTarget = z.infer<
  typeof import("../../schemas/protocol/wake-device-wait").wakeDeviceWaitTargetSchema
>;
export type WakeDeviceWaitAccessRequest = z.infer<
  typeof import("../../schemas/protocol/wake-device-wait").wakeDeviceWaitAccessRequestSchema
>;
export type WakeDeviceWaitAccessResponse = z.infer<
  typeof import("../../schemas/protocol/wake-device-wait").wakeDeviceWaitAccessResponseSchema
>;
