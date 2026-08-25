import * as z from "zod/v4";
import {
  openMeldToolsUpdateOperationPhaseSchema,
  openMeldToolsUpdateRequestSourceSchema,
} from "../local-components";

export const OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA =
  "openmeld-daemon-service-update-job-v2" as const;

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

const daemonServiceUpdateJobBodySchema = z.strictObject({
  attempts: z.number().int().nonnegative(),
  desiredState: z.enum(["background", "stopped"]),
  errorMessage: z.string().min(1).nullable(),
  jobId: z.string().min(1),
  preparedBundle: daemonServiceUpdatePreparedBundleSchema,
  requestedAt: z.iso.datetime({ offset: true }),
  targetVersion: z.string().min(1),
  updatedAt: z.iso.datetime({ offset: true }),
  urgency: z.enum(["available", "required"]),
});

export const daemonServiceUpdateJobV1Schema =
  daemonServiceUpdateJobBodySchema.extend({
    v: z.literal(1),
    schema: z.literal("openmeld-daemon-service-update-job-v1"),
    status: z.enum(["scheduled", "running", "completed", "failed"]),
  });

export const daemonServiceUpdateJobSchema =
  daemonServiceUpdateJobBodySchema.extend({
    v: z.literal(2),
    schema: z.literal(OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA),
    phase: openMeldToolsUpdateOperationPhaseSchema,
    requestSource: openMeldToolsUpdateRequestSourceSchema,
  });

export const storedDaemonServiceUpdateJobSchema = z.discriminatedUnion("v", [
  daemonServiceUpdateJobV1Schema,
  daemonServiceUpdateJobSchema,
]);
