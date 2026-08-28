import type * as zod from "zod/v4";
import * as z from "../lazy-zod";

export const LOCAL_COMPONENTS_SCHEMA_VERSION = 1 as const;

const nonEmptyStringSchema = z.string().trim().min(1);
const nullableNonEmptyStringSchema = nonEmptyStringSchema.nullable();

export const localComponentStatusSchema = z.enum([
  "ok",
  "update_available",
  "update_required",
]);

export const localComponentUpdatePolicySchema = z.enum([
  "ok",
  "available",
  "required",
]);

export const localComponentUpdateStatusSchema = z.enum([
  "current",
  "update_available",
  "update_required",
  "unknown",
]);

export const openMeldToolsUpdateOperationPhaseSchema = z.enum([
  "waiting_for_work",
  "updating",
  "updated",
  "restored",
  "needs_help",
]);

export const openMeldToolsUpdateRequestSourceSchema = z.enum([
  "automatic",
  "center_agent",
  "cli",
  "web",
]);

export const openMeldToolsUpdateOperationSchema = z.strictObject({
  operationId: nonEmptyStringSchema,
  phase: openMeldToolsUpdateOperationPhaseSchema,
  requestSource: openMeldToolsUpdateRequestSourceSchema,
  requestedAt: z.iso.datetime({ offset: true }),
  targetVersion: nonEmptyStringSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  urgency: z.enum(["available", "required"]),
});

export const openMeldToolsMaintenanceProjectionSchema = z.strictObject({
  automaticUpdatesEnabled: z.boolean(),
  status: z.enum(["ready", "needs_help"]),
});

export const openMeldToolsControlCapabilitySchema = z.strictObject({
  requestUpdate: z.literal(true).optional(),
  setAutomaticUpdates: z.literal(true).optional(),
});

export const openMeldToolsUpdateRequestResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("disabled") }),
    z.strictObject({ status: z.literal("unavailable") }),
    z.strictObject({
      currentVersion: nonEmptyStringSchema,
      status: z.literal("current"),
    }),
    z.strictObject({
      operation: openMeldToolsUpdateOperationSchema,
      status: z.enum(["started", "already_running"]),
    }),
  ]
);

export const openMeldToolsMaintenanceMutationResultSchema = z.strictObject({
  automaticUpdatesEnabled: z.boolean(),
  status: z.enum(["updated", "unchanged"]),
});

export const openMeldToolsControlRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      operation: z.literal("request_update"),
      requestSource: z.enum(["center_agent", "web"]),
    }),
    z.strictObject({
      automaticUpdatesEnabled: z.boolean(),
      operation: z.literal("set_automatic_updates"),
      requestSource: z.enum(["center_agent", "web"]),
    }),
  ]
);

export const openMeldToolsControlResultSchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      operation: z.literal("request_update"),
      result: openMeldToolsUpdateRequestResultSchema,
    }),
    z.strictObject({
      operation: z.literal("set_automatic_updates"),
      result: openMeldToolsMaintenanceMutationResultSchema,
    }),
  ]
);

export const openMeldToolsUpdateAttemptSchema = z.strictObject({
  v: z.literal(1),
  attempts: z.number().int().nonnegative(),
  errorMessage: nullableNonEmptyStringSchema,
  operation: openMeldToolsUpdateOperationSchema,
});

export const localSetupActionSchema = z.enum([
  "none",
  "connect_service",
  "reconnect_service",
  "update_service",
  "connect_local_agent",
  "update_skills",
  "update_cli",
]);

export const localSetupEntrypointSchema = z.literal("setup");

export const localComponentsManifestSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_COMPONENTS_SCHEMA_VERSION),
  openMeldReleaseVersion: nonEmptyStringSchema,
  cli: z.strictObject({
    packageVersion: nonEmptyStringSchema,
    commandContractVersion: nonEmptyStringSchema,
  }),
  service: z.strictObject({
    bundleHash: nullableNonEmptyStringSchema,
    bundleVersion: nonEmptyStringSchema,
    runtimeContractEpoch: nonEmptyStringSchema,
    serviceContractVersion: nonEmptyStringSchema,
  }),
  skills: z.strictObject({
    bundleHash: nullableNonEmptyStringSchema,
    skillContractVersion: nonEmptyStringSchema,
    skillIds: z.array(nonEmptyStringSchema),
  }),
});

export const localComponentsReleaseManifestSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_COMPONENTS_SCHEMA_VERSION),
  updatedAt: z.iso.datetime({ offset: true }),
  components: z.strictObject({
    cli: z.strictObject({
      packageVersion: nonEmptyStringSchema,
      commandContractVersion: nonEmptyStringSchema,
      updatePolicy: localComponentUpdatePolicySchema,
      reason: nonEmptyStringSchema,
    }),
    service: z.strictObject({
      bundleHash: nullableNonEmptyStringSchema,
      bundleVersion: nonEmptyStringSchema,
      runtimeContractEpoch: nonEmptyStringSchema,
      serviceContractVersion: nonEmptyStringSchema,
      updatePolicy: localComponentUpdatePolicySchema,
      reason: nonEmptyStringSchema,
    }),
    skills: z.strictObject({
      bundleHash: nullableNonEmptyStringSchema,
      skillContractVersion: nonEmptyStringSchema,
      skillIds: z.array(nonEmptyStringSchema),
      updatePolicy: localComponentUpdatePolicySchema,
      reason: nonEmptyStringSchema,
    }),
  }),
});

export const installedLocalComponentsSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_COMPONENTS_SCHEMA_VERSION),
  installedAt: z.iso.datetime({ offset: true }),
  source: z.enum(["setup", "repair", "manual"]),
  manifest: localComponentsManifestSchema,
});

export const localComponentProjectionSchema = z.strictObject({
  reasonCodes: z.array(nonEmptyStringSchema),
  status: localComponentStatusSchema,
});

export const localCliComponentProjectionSchema =
  localComponentProjectionSchema.extend({
    commandContractVersion: nonEmptyStringSchema,
    latestPackageVersion: nullableNonEmptyStringSchema,
    packageVersion: nonEmptyStringSchema,
    requiredCommandContractVersion: nullableNonEmptyStringSchema,
  });

export const localServiceComponentProjectionSchema =
  localComponentProjectionSchema.extend({
    expectedBundleHash: nullableNonEmptyStringSchema,
    expectedBundleVersion: nonEmptyStringSchema,
    installedBundleHash: nullableNonEmptyStringSchema,
    installedBundleVersion: nullableNonEmptyStringSchema,
    runtimeContractEpoch: nonEmptyStringSchema,
    serviceContractVersion: nonEmptyStringSchema,
  });

export const localSkillsComponentProjectionSchema =
  localComponentProjectionSchema.extend({
    expectedBundleHash: nullableNonEmptyStringSchema,
    installedBundleHash: nullableNonEmptyStringSchema,
    skillContractVersion: nonEmptyStringSchema,
    targetCount: z.number().int().nonnegative(),
  });

export const localComponentsStatusSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_COMPONENTS_SCHEMA_VERSION),
  generatedAt: z.iso.datetime({ offset: true }),
  entrypoint: localSetupEntrypointSchema,
  summaryLabel: nonEmptyStringSchema,
  summaryDescription: nonEmptyStringSchema,
  setupAction: localSetupActionSchema,
  setupActionLabel: nonEmptyStringSchema,
  setupActionDescription: nonEmptyStringSchema,
  maintenance: openMeldToolsMaintenanceProjectionSchema.optional(),
  updateOperation: openMeldToolsUpdateOperationSchema.optional(),
  cli: localCliComponentProjectionSchema,
  service: localServiceComponentProjectionSchema,
  skills: localSkillsComponentProjectionSchema,
});

export const localServiceComponentUpdateProjectionSchema = z.strictObject({
  installedVersion: nullableNonEmptyStringSchema,
  latestVersion: nullableNonEmptyStringSchema,
  reasonCodes: z.array(nonEmptyStringSchema),
  requiredVersion: nullableNonEmptyStringSchema,
  status: localComponentUpdateStatusSchema,
  updatePolicy: localComponentUpdatePolicySchema,
  wakeBlocked: z.boolean(),
});

export const localCliComponentUpdateProjectionSchema = z.strictObject({
  commandContractVersion: nullableNonEmptyStringSchema,
  installedPackageVersion: nullableNonEmptyStringSchema,
  latestPackageVersion: nullableNonEmptyStringSchema,
  reasonCodes: z.array(nonEmptyStringSchema),
  requiredCommandContractVersion: nullableNonEmptyStringSchema,
  status: localComponentUpdateStatusSchema,
  updatePolicy: localComponentUpdatePolicySchema,
  wakeBlocked: z.boolean(),
});

export const localSkillsComponentUpdateProjectionSchema = z.strictObject({
  expectedBundleHash: nullableNonEmptyStringSchema,
  expectedTargetCount: z.number().int().nonnegative(),
  installedBundleHash: nullableNonEmptyStringSchema,
  reasonCodes: z.array(nonEmptyStringSchema),
  skillContractVersion: nullableNonEmptyStringSchema,
  status: localComponentUpdateStatusSchema,
  targetCount: z.number().int().nonnegative().nullable(),
  updatePolicy: localComponentUpdatePolicySchema,
  wakeBlocked: z.boolean(),
});

export const localComponentUpdateProjectionSchema = z.strictObject({
  schemaVersion: z.literal(LOCAL_COMPONENTS_SCHEMA_VERSION),
  generatedAt: z.iso.datetime({ offset: true }),
  setupAction: localSetupActionSchema,
  setupActionLabel: nonEmptyStringSchema,
  setupActionDescription: nonEmptyStringSchema,
  humanSetupCommand: nonEmptyStringSchema,
  agentSetupCommand: nonEmptyStringSchema,
  maintenance: openMeldToolsMaintenanceProjectionSchema.optional(),
  updateOperation: openMeldToolsUpdateOperationSchema.optional(),
  cli: localCliComponentUpdateProjectionSchema,
  service: localServiceComponentUpdateProjectionSchema,
  skills: localSkillsComponentUpdateProjectionSchema,
});

export function formatLocalSetupActionLabel(
  action: zod.infer<typeof localSetupActionSchema>
): string {
  switch (action) {
    case "connect_service":
      return "Connect OpenMeld Service";
    case "reconnect_service":
      return "Reconnect OpenMeld Service";
    case "update_service":
      return "Update OpenMeld Service";
    case "connect_local_agent":
      return "Connect local agent";
    case "update_skills":
      return "Update OpenMeld skills";
    case "update_cli":
      return "Update OpenMeld CLI";
    case "none":
      return "Everything is up to date";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function formatLocalComponentsSummaryLabel(input: {
  cliStatus: zod.infer<typeof localComponentStatusSchema>;
  setupAction: zod.infer<typeof localSetupActionSchema>;
}): string {
  if (input.setupAction !== "none") {
    return formatLocalSetupActionLabel(input.setupAction);
  }
  switch (input.cliStatus) {
    case "update_required":
      return "Update OpenMeld CLI";
    case "update_available":
      return "OpenMeld CLI update available";
    case "ok":
      return "Everything is up to date";
    default: {
      const exhaustive: never = input.cliStatus;
      return exhaustive;
    }
  }
}

export function formatLocalComponentsSummaryDescription(input: {
  cliStatus: zod.infer<typeof localComponentStatusSchema>;
  setupAction: zod.infer<typeof localSetupActionSchema>;
}): string {
  if (input.setupAction !== "none") {
    return formatLocalSetupActionDescription(input.setupAction);
  }
  switch (input.cliStatus) {
    case "update_required":
      return "Update OpenMeld CLI before running this setup flow.";
    case "update_available":
      return "OpenMeld CLI can be updated, but this setup flow can continue.";
    case "ok":
      return "OpenMeld local components are aligned for this computer.";
    default: {
      const exhaustive: never = input.cliStatus;
      return exhaustive;
    }
  }
}

export function formatLocalSetupActionDescription(
  action: zod.infer<typeof localSetupActionSchema>
): string {
  switch (action) {
    case "connect_service":
      return "Connect this computer to OpenMeld so local agents can reply in Spaces.";
    case "reconnect_service":
      return "Reconnect OpenMeld Service for the current OpenMeld account on this computer.";
    case "update_service":
      return "Update OpenMeld Service through setup on this computer.";
    case "connect_local_agent":
      return "Connect this Agent Profile to a local agent runtime on this computer.";
    case "update_skills":
      return "Update OpenMeld skills through setup on this computer.";
    case "update_cli":
      return "Update OpenMeld CLI before running this setup flow.";
    case "none":
      return "OpenMeld local components are aligned for this computer.";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
