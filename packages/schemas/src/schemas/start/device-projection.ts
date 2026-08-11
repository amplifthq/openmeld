import { z } from "zod/v4";
import { daemonServiceLaneSchema } from "../daemon/service-contract";
import {
  localAgentCatalogEntrySchema,
  localAgentCatalogLaunchStatusSchema,
  localAgentCatalogSchema,
  localAgentCatalogSelectableReasonSchema,
} from "../runtime/local-agent-catalog";
import {
  START_BOUNDED_ID_SCHEMA,
  START_BOUNDED_VERSION_SCHEMA,
  START_ISO_DATE_TIME_SCHEMA,
  startReplyReadinessSummarySchema,
} from "./shared";

export const startBackgroundHelperInstallStatusSchema = z.enum([
  "not_installed",
  "installed_current",
  "installed_outdated",
  "unknown",
]);

export const startBackgroundHelperRuntimeStatusSchema = z.enum([
  "running",
  "stale",
  "not_running",
  "unknown",
]);

export const startBackgroundHelperExecutionCompatibilityStatusSchema = z.enum([
  "compatible",
  "update_required",
]);

export const startBackgroundHelperExecutionCompatibilityReasonCodeSchema =
  z.enum([
    "daemon.runtime_contract.compatible",
    "daemon.runtime_contract.missing",
    "daemon.runtime_contract.mismatch",
    "daemon.runtime_contract.unavailable",
    "daemon.runtime_contract.not_observed",
  ]);

export const startBackgroundHelperExecutionCompatibilitySchema = z.strictObject(
  {
    status: startBackgroundHelperExecutionCompatibilityStatusSchema,
    reasonCode: startBackgroundHelperExecutionCompatibilityReasonCodeSchema,
    expectedEpoch: START_BOUNDED_ID_SCHEMA,
    observedEpoch: z.union([START_BOUNDED_ID_SCHEMA, z.null()]),
    updatedAt: z.union([START_ISO_DATE_TIME_SCHEMA, z.null()]),
  }
);

export const startSkillsReadinessStatusSchema = z.enum([
  "up_to_date",
  "action_required",
  "no_targets",
  "unknown",
]);

export const startDeviceAgentSelectableReasonSchema =
  localAgentCatalogSelectableReasonSchema;
export const startDeviceAgentLaunchStatusSchema =
  localAgentCatalogLaunchStatusSchema;

export const startBackgroundHelperProjectionSchema = z.strictObject({
  installStatus: startBackgroundHelperInstallStatusSchema,
  runtimeStatus: startBackgroundHelperRuntimeStatusSchema,
  installedVersion: z.union([START_BOUNDED_VERSION_SCHEMA, z.null()]),
  expectedVersion: START_BOUNDED_VERSION_SCHEMA,
  executionCompatibility:
    startBackgroundHelperExecutionCompatibilitySchema.optional(),
});

export const startSkillsReadinessSummarySchema = z.strictObject({
  upToDate: z.number().int().min(0),
  outdated: z.number().int().min(0),
  missing: z.number().int().min(0),
  externalConflict: z.number().int().min(0),
});

export const startSkillsReadinessProjectionSchema = z
  .strictObject({
    status: startSkillsReadinessStatusSchema,
    targetCount: z.number().int().min(0),
    summary: startSkillsReadinessSummarySchema,
  })
  .superRefine((value, ctx) => {
    const accountedTotal =
      value.summary.upToDate +
      value.summary.outdated +
      value.summary.missing +
      value.summary.externalConflict;
    if (accountedTotal !== value.targetCount) {
      ctx.addIssue({
        code: "custom",
        message: "skills readiness summary counts must add up to targetCount",
        path: ["summary"],
      });
    }
  });

export const startDeviceAgentCatalogEntrySchema = localAgentCatalogEntrySchema;
export const startDeviceAgentCatalogSchema = localAgentCatalogSchema;

// TODO(2026-05-15): Keep this projection setup-only while consumers migrate to
// Local Runtime and Prepare Session facts. Do not use deviceAgentCatalog or
// deviceReplyReadiness from this Start projection as reply-readiness truth.
export const startDeviceProjectionSchema = z.strictObject({
  deviceId: START_BOUNDED_ID_SCHEMA,
  runtimeLane: daemonServiceLaneSchema,
  observedAt: START_ISO_DATE_TIME_SCHEMA,
  backgroundHelper: startBackgroundHelperProjectionSchema,
  skillsReadiness: startSkillsReadinessProjectionSchema,
  deviceAgentCatalog: startDeviceAgentCatalogSchema,
  deviceReplyReadiness: startReplyReadinessSummarySchema,
});
