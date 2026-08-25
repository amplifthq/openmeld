import * as z from "zod/v4";

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const reasonCodeSchema = z.string().trim().min(1).max(256);

export const prepareReadinessRouteParamsSchema = z.strictObject({
  deviceId: boundedIdentifierSchema,
});

export const getPrepareReadinessQuerySchema = z.strictObject({
  agentControllerRefs: z.array(z.string().trim().min(1).max(256)).optional(),
  lane: boundedIdentifierSchema,
  openMeldServiceRuntimeId: z.string().trim().min(1).max(512).optional(),
});

export const prepareReadinessRuntimeIdSchema = z.strictObject({
  source: z.literal("runtime_registry_authority"),
  value: z.string().trim().min(1).max(512),
});

export const prepareReadinessDisplayStateSchema = z.enum([
  "ready",
  "pending",
  "unavailable",
  "needs_prepare",
  "needs_repair",
  "stale",
  "unknown",
]);

export const prepareReadinessRunnableCapabilitySchema = z.strictObject({
  agentControllerRef: z.string().trim().min(1).max(256),
  expiresAtMs: z.int().nonnegative(),
  observedAtMs: z.int().nonnegative(),
  reasonCodes: z.array(reasonCodeSchema),
  status: z.literal("ready"),
});

export const prepareReadinessNonRunnableCapabilitySchema = z.strictObject({
  agentControllerRef: z.string().trim().min(1).max(256),
  expiresAtMs: z.int().nonnegative().optional(),
  observedAtMs: z.int().nonnegative().optional(),
  reasonCodes: z.array(reasonCodeSchema),
  status: z.enum([
    "disabled",
    "invalid",
    "missing",
    "stale",
    "unavailable",
    "unknown",
  ]),
});

export const prepareReadinessProjectionSchema = z.strictObject({
  allRunnableCapabilitiesPrepared: z
    .strictObject({
      status: z.enum(["prepared", "not_prepared", "partial", "unknown"]),
    })
    .optional(),
  projectionStatus: prepareReadinessDisplayStateSchema,
  reasonCodes: z.array(reasonCodeSchema),
  serviceReadiness: z
    .strictObject({
      status: z.enum([
        "running",
        "starting",
        "not_running",
        "not_installed",
        "needs_repair",
        "unavailable",
        "unknown",
      ]),
    })
    .optional(),
});

export const prepareReadinessSummarySchema = z.strictObject({
  displayState: prepareReadinessDisplayStateSchema,
  ready: z.boolean(),
  reasonCodes: z.array(reasonCodeSchema),
});

export const getPrepareReadinessResponseSchema = z
  .strictObject({
    agentControllerReportsRead: z.boolean(),
    nonRunnableCapabilities: z.array(
      prepareReadinessNonRunnableCapabilitySchema
    ),
    projection: prepareReadinessProjectionSchema,
    reason: z
      .enum([
        "openmeld_service_runtime_identity_invalid",
        "openmeld_service_runtime_id_invalid",
        "openmeld_service_runtime_id_mismatch",
        "runtime_lookup_conflict",
        "runtime_missing",
        "runtime_not_ready",
      ])
      .optional(),
    runnableCapabilities: z.array(prepareReadinessRunnableCapabilitySchema),
    openMeldServiceRuntimeId: prepareReadinessRuntimeIdSchema.optional(),
    status: z.enum(["not_ready", "ready"]),
    summary: prepareReadinessSummarySchema,
  })
  .superRefine((value, context) => {
    if (value.status === "ready" && !value.openMeldServiceRuntimeId) {
      context.addIssue({
        code: "custom",
        message:
          "ready prepare readiness response requires authority openMeldServiceRuntimeId evidence",
        path: ["openMeldServiceRuntimeId"],
      });
    }
  });
