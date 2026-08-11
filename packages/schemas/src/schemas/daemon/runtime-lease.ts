import { z } from "zod/v4";
import { daemonServiceControllerSchema } from "./service-contract";

export const DAEMON_RUNTIME_LEASE_SCHEMA_VERSION = 1 as const;

export const daemonRuntimeLeaseModeSchema = z.enum([
  "foreground",
  "background",
]);

export const daemonRuntimeLeaseSchema = z.strictObject({
  schema: z.literal("openmeld-daemon-runtime-lease-v1"),
  v: z.literal(DAEMON_RUNTIME_LEASE_SCHEMA_VERSION),
  generation: z.int().nonnegative(),
  bundleId: z.string().min(1),
  pid: z.int().positive(),
  mode: daemonRuntimeLeaseModeSchema,
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  heartbeatAt: z.string().nullable(),
  serviceController: daemonServiceControllerSchema,
  managedBySystemService: z.boolean(),
});
