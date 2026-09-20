import * as z from "zod/v4";
import { agentProfileIdSchema } from "./profile";

export const MAX_WAKE_DEVICE_WAIT_MS = 7 * 24 * 60 * 60_000;
export const DEFAULT_WAKE_DEVICE_WAIT_MS = 24 * 60 * 60_000;
export const RUNTIME_COORDINATOR_DEVICE_WAITING_REASON_CODE =
  "runtime_coordinator.device_waiting";

// These are target selectors, never execution or filesystem authority.
export const wakeDeviceWaitTargetSchema = z.strictObject({
  bindingId: z.string().trim().min(1).max(512),
  openMeldServiceRuntimeId: z.string().trim().min(1).max(512),
});

export const wakeDeviceWaitSchema = wakeDeviceWaitTargetSchema.extend({
  deadlineAtMs: z.number().int().nonnegative(),
  targetProfileId: agentProfileIdSchema,
});

export const wakeDeviceWaitAccessRequestSchema = z.strictObject({
  dispatchId: z.string().trim().min(1),
  sourceSignalId: z.string().trim().min(1),
  spaceId: z.string().trim().min(1),
  targetProfileId: agentProfileIdSchema,
});
export const wakeDeviceWaitAccessResponseSchema = z.strictObject({
  allowed: z.boolean(),
});
