import { z } from "zod/v4";

export const OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA =
  "openmeld-daemon-service-update-job-v1" as const;

export const daemonServiceUpdatePreparedBundleSchema = z.strictObject({
  v: z.literal(2),
  schema: z.literal("openmeld-daemon-active-bundle-v2"),
  bundleId: z.string().min(1),
  daemonVersion: z.string().min(1),
  entryScriptRelativePath: z.string().min(1),
  bundleFormat: z.enum(["legacy_linked_v1", "self_contained_v1", "binary_v1"]),
  sourceEntryScriptPath: z.string().min(1),
  sourcePackageRootPath: z.string().min(1),
  sourceDistRootPath: z.string().min(1),
  sourceDistFingerprint: z.string().min(1).nullable().optional(),
  sourceKind: z.enum(["workspace", "package_install", "npx_cache", "unknown"]),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const daemonServiceUpdateJobSchema = z.strictObject({
  v: z.literal(1),
  schema: z.literal(OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA),
  attempts: z.number().int().nonnegative(),
  desiredState: z.enum(["background", "stopped"]),
  errorMessage: z.string().min(1).nullable(),
  jobId: z.string().min(1),
  preparedBundle: daemonServiceUpdatePreparedBundleSchema,
  requestedAt: z.iso.datetime({ offset: true }),
  status: z.enum(["scheduled", "running", "completed", "failed"]),
  targetVersion: z.string().min(1),
  updatedAt: z.iso.datetime({ offset: true }),
  urgency: z.enum(["available", "required"]),
});
