import * as z from "zod/v4";
import {
  localRuntimeDeviceTypeSchema,
  localRuntimePlatformFamilySchema,
} from "./local-runtimes";

export const observedDeviceTypeSchema = localRuntimeDeviceTypeSchema;

export const observedDeviceMetadataSchema = z.strictObject({
  observedDisplayName: z.string().trim().min(1).max(200).nullable(),
  platformFamily: localRuntimePlatformFamilySchema,
  osVersion: z.string().trim().min(1).max(120).nullable(),
  deviceType: observedDeviceTypeSchema,
  observedAtMs: z.number().int().nonnegative(),
});

export const writeCurrentDeviceObservedMetadataBodySchema = z.strictObject({
  metadata: observedDeviceMetadataSchema,
});

export const writeCurrentDeviceObservedMetadataResponseSchema =
  writeCurrentDeviceObservedMetadataBodySchema;
