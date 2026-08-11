import { z } from "zod/v4";
import {
  daemonExecutionCompatibilitySchema,
  localWakeRouteReportSchema,
  runtimeTransportCapabilitiesSchema,
  runtimeTransportErrorCodeSchema,
  runtimeTransportLookupRouteOwnerServiceEvidenceSchema,
  runtimeTransportRejectedProfileRegistrationSchema,
} from "../daemon/runtime-transport";
import { daemonServiceLaneSchema } from "../daemon/service-contract";

export const daemonRouteObservationRouteSchema = z.discriminatedUnion(
  "online",
  [
    z.strictObject({
      online: z.literal(true),
      daemonSessionId: z.string().min(1),
      deviceId: z.string().min(1),
      lane: daemonServiceLaneSchema,
      serviceVersion: z.string().trim().min(1).nullable().optional(),
      connectionGeneration: z.number().int().positive(),
      leaseEpoch: z.number().int().positive(),
      lastHeartbeatMs: z.number().int().nonnegative(),
      capabilities: runtimeTransportCapabilitiesSchema,
      executionCompatibility: daemonExecutionCompatibilitySchema,
      localWakeRouteReport: localWakeRouteReportSchema.optional(),
    }),
    z.strictObject({
      online: z.literal(false),
      reasonCode: runtimeTransportErrorCodeSchema,
      lastHeartbeatMs: z.number().int().nonnegative().optional(),
      ownerService:
        runtimeTransportLookupRouteOwnerServiceEvidenceSchema.optional(),
      executionCompatibility: daemonExecutionCompatibilitySchema.optional(),
      localWakeRouteReport: localWakeRouteReportSchema.optional(),
      rejectedProfileRegistration:
        runtimeTransportRejectedProfileRegistrationSchema.optional(),
    }),
  ]
);

export const daemonRouteObservationResponseSchema = z.strictObject({
  observedAt: z.string().trim().min(1),
  profileId: z.string().trim().min(1),
  route: daemonRouteObservationRouteSchema,
});
