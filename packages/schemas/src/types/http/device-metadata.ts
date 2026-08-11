import type { z } from "zod/v4";

type ObservedDeviceMetadataSchema =
  typeof import("../../schemas/http/device-metadata")["observedDeviceMetadataSchema"];
type WriteCurrentDeviceObservedMetadataBodySchema =
  typeof import("../../schemas/http/device-metadata")["writeCurrentDeviceObservedMetadataBodySchema"];
type WriteCurrentDeviceObservedMetadataResponseSchema =
  typeof import("../../schemas/http/device-metadata")["writeCurrentDeviceObservedMetadataResponseSchema"];

export type ObservedDeviceMetadata = z.infer<ObservedDeviceMetadataSchema>;
export type WriteCurrentDeviceObservedMetadataBody =
  z.infer<WriteCurrentDeviceObservedMetadataBodySchema>;
export type WriteCurrentDeviceObservedMetadataResponse =
  z.infer<WriteCurrentDeviceObservedMetadataResponseSchema>;
