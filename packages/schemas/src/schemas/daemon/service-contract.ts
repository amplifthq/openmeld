import { z } from "zod/v4";

export const DAEMON_SERVICE_CONTRACT_SCHEMA_VERSION = 1 as const;

export const daemonServiceLaneSchema = z.enum(["prod", "dev-local", "canary"]);

export const daemonServiceDesiredStateSchema = z.enum([
  "stopped",
  "background",
]);

export const daemonServiceControllerSchema = z.enum([
  "launchd",
  "systemd",
  "windows-service",
  "legacy-detached",
  "unknown",
]);

export const daemonServiceContractSchema = z.strictObject({
  schema: z.literal("openmeld-daemon-service-contract-v1"),
  v: z.literal(DAEMON_SERVICE_CONTRACT_SCHEMA_VERSION),
  lane: daemonServiceLaneSchema,
  daemonVersion: z.string().min(1),
  bundleId: z.string().min(1),
  desiredState: daemonServiceDesiredStateSchema,
  serviceController: daemonServiceControllerSchema,
  autoStart: z.boolean(),
  gatewayUrl: z.string().min(1),
  ownerUserId: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  deviceId: z.string().min(1),
  connectedComputerId: z.string().min(1).optional(),
  heartbeatMs: z.int().positive(),
  generation: z.int().positive(),
  updatedAt: z.string().min(1),
});
