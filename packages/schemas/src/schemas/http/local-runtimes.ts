import { z } from "zod/v4";
import {
  localAgentInstallationOptionSchema,
  openMeldDaemonSyncRouteCatalogPayloadSchema,
} from "../daemon/control-plane";
import { daemonExecutionCompatibilitySchema } from "../daemon/runtime-transport";
import { daemonServiceLaneSchema } from "../daemon/service-contract";
import {
  localComponentUpdateProjectionSchema,
  openMeldToolsMaintenanceMutationResultSchema,
  openMeldToolsUpdateRequestResultSchema,
} from "../local-components";
import {
  agentProfileIdSchema,
  profileWorkingDirectorySchema,
  profileWorkspaceModeSchema,
} from "../protocol/profile";
import { agentControllerInterfaceSnapshotSchema } from "../runtime/agent-controller-interface";
import { localAgentCatalogWithLifecycleSchema } from "../runtime/local-agent-catalog";
import { START_BOUNDED_ID_SCHEMA } from "../start/shared";
import { prepareReadinessRuntimeIdSchema } from "./prepare-readiness";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const reasonCodeSchema = z.string().trim().min(1).max(256);

export const localRuntimeDisplayNameSourceSchema = z.enum([
  "user",
  "observed",
  "placeholder",
]);

export const localRuntimePlatformFamilySchema = z.enum([
  "macOS",
  "Windows",
  "Linux",
  "Unknown",
]);

export const localRuntimeDeviceTypeSchema = z.enum([
  "laptop",
  "desktop",
  "server",
  "unknown",
]);

export const localRuntimeExecutionTargetCapabilitySchema = z
  .strictObject({
    agentControllerRef: z.string().trim().min(1).max(256),
    agentControllerInterface: agentControllerInterfaceSnapshotSchema
      .nullable()
      .optional(),
    enabled: z.boolean(),
    reasonCodes: z.array(reasonCodeSchema),
    status: z.enum(["ready", "not_ready", "stale", "unknown"]),
  })
  .superRefine((value, context) => {
    if (
      value.agentControllerInterface &&
      value.agentControllerInterface.agentControllerRef !==
        value.agentControllerRef
    ) {
      context.addIssue({
        code: "custom",
        message:
          "agentControllerInterface.agentControllerRef must match capability agentControllerRef",
        path: ["agentControllerInterface", "agentControllerRef"],
      });
    }
  });

export const localRuntimeLocalAgentControlSchema = z.strictObject({
  manageInstallations: z.boolean().optional(),
  refreshCatalog: z.boolean(),
  setEnabled: z.boolean(),
  setProfileWorkspace: z.boolean().optional(),
});

export const localRuntimeLocalProjectControlSchema = z.strictObject({
  connectCandidate: z.boolean(),
  connectDeclaredPath: z.boolean(),
  discoverProjects: z.boolean(),
  moveConnection: z.boolean().optional(),
  removeConnection: z.boolean(),
  removeMissingConnections: z.boolean(),
  setDefaultConnection: z.boolean(),
});

export const localRuntimeComputerFileAccessSchema = z.strictObject({
  readPolicy: z.boolean(),
  updatePolicy: z.boolean(),
});

export const localRuntimeLocalFolderPickerSchema = z.strictObject({
  selectFolders: z.boolean(),
});

export const localRuntimeExecutionTargetStatusSchema = z.enum([
  "ready",
  "partial",
  "not_ready",
  "stale",
  "unknown",
]);

export const localRuntimeExecutionTargetSchema = z.strictObject({
  deviceId: START_BOUNDED_ID_SCHEMA,
  runtimeLane: daemonServiceLaneSchema,
  userFacingCommand: z.enum(["openmeld", "openmeld-dev", "openmeld-canary"]),
  openMeldServiceRuntimeId: prepareReadinessRuntimeIdSchema.nullable(),
  status: localRuntimeExecutionTargetStatusSchema,
  capabilities: z.array(localRuntimeExecutionTargetCapabilitySchema),
  localAgentControl: localRuntimeLocalAgentControlSchema,
  localProjectControl: localRuntimeLocalProjectControlSchema.optional(),
  localAgentCatalog: localAgentCatalogWithLifecycleSchema,
  reasonCodes: z.array(reasonCodeSchema),
  lastObservedAtMs: z.number().int().nonnegative().nullable(),
  isCurrent: z.boolean(),
});

export const localRuntimeConnectionStatusSchema = z.enum([
  "connected",
  "legacy_disconnected",
]);

export const localRuntimeComputerSchema = z.strictObject({
  connectedComputerId: START_BOUNDED_ID_SCHEMA.optional(),
  connectionStatus: localRuntimeConnectionStatusSchema.optional(),
  deviceId: START_BOUNDED_ID_SCHEMA,
  deviceDisplayName: z.string().min(1),
  deviceDisplayNameSource: localRuntimeDisplayNameSourceSchema,
  platformFamily: localRuntimePlatformFamilySchema,
  osVersion: z.string().trim().min(1).max(120).nullable(),
  deviceType: localRuntimeDeviceTypeSchema,
  firstSeenAtMs: z.number().int().nonnegative(),
  lastObservedAtMs: z.number().int().nonnegative().nullable(),
  isCurrent: z.boolean(),
  computerFileAccess: localRuntimeComputerFileAccessSchema.optional(),
  localFolderPicker: localRuntimeLocalFolderPickerSchema.optional(),
  legacyDeviceIds: z.array(START_BOUNDED_ID_SCHEMA).optional(),
  executionTargets: z.array(localRuntimeExecutionTargetSchema),
});

export const localRuntimeLegacyDeviceEvidenceSchema = z.strictObject({
  connectionStatus: z.literal("legacy_disconnected"),
  deviceId: START_BOUNDED_ID_SCHEMA,
  deviceDisplayName: z.string().min(1),
  deviceDisplayNameSource: localRuntimeDisplayNameSourceSchema,
  platformFamily: localRuntimePlatformFamilySchema,
  osVersion: z.string().trim().min(1).max(120).nullable(),
  deviceType: localRuntimeDeviceTypeSchema,
  firstSeenAtMs: z.number().int().nonnegative(),
  lastObservedAtMs: z.number().int().nonnegative().nullable(),
  executionTargets: z.array(localRuntimeExecutionTargetSchema),
});

export const localRuntimesConnectionIdentityAdoptionSchema = z.enum([
  "safe_legacy_current",
]);

export const localRuntimesQuerySchema = z.strictObject({
  connectionIdentityAdoption:
    localRuntimesConnectionIdentityAdoptionSchema.optional(),
  includeUsageLimits: z.literal("true").optional(),
});

export const localRuntimesResponseSchema = z.strictObject({
  currentConnectedComputerId: START_BOUNDED_ID_SCHEMA.nullable().optional(),
  currentDeviceId: START_BOUNDED_ID_SCHEMA.nullable(),
  currentRuntimeLane: daemonServiceLaneSchema.nullable(),
  localRuntimes: z.array(localRuntimeComputerSchema),
  legacyDeviceEvidence: z
    .array(localRuntimeLegacyDeviceEvidenceSchema)
    .optional(),
});

export const setLocalRuntimeDisplayNameBodySchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80).nullable(),
});

export const setCurrentLocalAgentEnabledRouteParamsSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(256),
});

export const setCurrentLocalAgentEnabledBodySchema = z.strictObject({
  enabled: z.boolean(),
});

export const currentLocalAgentInstallationsRouteParamsSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(256),
});

export const selectCurrentLocalAgentInstallationBodySchema = z.strictObject({
  installationId: z.string().trim().min(1).max(256),
});

export const setCurrentOpenMeldToolsMaintenanceBodySchema = z.strictObject({
  automaticUpdatesEnabled: z.boolean(),
});

export const setCurrentOpenMeldToolsMaintenanceResponseSchema =
  openMeldToolsMaintenanceMutationResultSchema;

export const requestCurrentOpenMeldToolsUpdateResponseSchema =
  openMeldToolsUpdateRequestResultSchema;

export const currentLocalAgentInstallationsResponseSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(256),
  installations: z.array(localAgentInstallationOptionSchema),
  selectedInstallationId: z.string().trim().min(1).max(256).nullable(),
});

export const setCurrentAgentProfileWorkspaceRouteParamsSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
});

export const setCurrentAgentProfileWorkspaceBodySchema = z
  .strictObject({
    workspaceMode: profileWorkspaceModeSchema,
    workspacePath: profileWorkingDirectorySchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.workspaceMode === "custom" && !value.workspacePath) {
      context.addIssue({
        code: "custom",
        message: "workspacePath is required for a custom profile workspace",
        path: ["workspacePath"],
      });
    }
    if (value.workspaceMode === "openmeld_managed" && value.workspacePath) {
      context.addIssue({
        code: "custom",
        message:
          "workspacePath must be omitted for an OpenMeld-managed profile workspace",
        path: ["workspacePath"],
      });
    }
  });

export const setCurrentLocalAgentEnabledResponseSchema = z.strictObject({
  agentId: z.string().trim().min(1).max(256),
  changed: z.boolean(),
  enabled: z.boolean(),
  localRuntimes: localRuntimesResponseSchema,
  reportSyncStatus: z.enum(["submitted", "skipped", "failed"]),
  status: z.enum(["updated", "unchanged"]),
});

export const selectCurrentLocalAgentInstallationResponseSchema =
  currentLocalAgentInstallationsResponseSchema.extend({
    changed: z.boolean(),
    localRuntimes: localRuntimesResponseSchema,
    reportSyncStatus: z.enum(["submitted", "skipped", "failed"]),
    status: z.enum(["updated", "unchanged"]),
  });

export const setCurrentAgentProfileWorkspaceResponseSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
  status: z.literal("updated"),
  workspaceMode: profileWorkspaceModeSchema,
  workspacePath: z.string().min(1),
});

export const refreshCurrentLocalAgentCatalogResponseSchema = z.strictObject({
  localRuntimes: localRuntimesResponseSchema,
  sync: openMeldDaemonSyncRouteCatalogPayloadSchema,
});

export const localRuntimeReplyReadinessStatusSchema = z.enum([
  "ready",
  "blocked",
  "checking",
  "unknown",
]);

export const localRuntimeReplyReadinessPrimaryBlockerSchema = z.enum([
  "none",
  "current_runtime_missing",
  "agent_controller_report_not_ready",
  "agent_controller_report_stale",
  "agent_controller_report_unknown",
  "service_not_connected",
  "service_update_required",
  "service_unavailable",
]);

export const localRuntimeReplyReadinessNextActionSchema = z.enum([
  "none",
  "connect_service",
  "reconnect_service",
  "run_setup",
  "check_status",
  "update_service",
]);

export const currentLocalRuntimeReplyReadinessResponseSchema = z.strictObject({
  canReplyFromThisComputer: z.boolean(),
  generatedAt: ISO_DATE_TIME_SCHEMA,
  message: z.string().trim().min(1).max(500),
  nextAction: localRuntimeReplyReadinessNextActionSchema,
  primaryBlocker: localRuntimeReplyReadinessPrimaryBlockerSchema,
  status: localRuntimeReplyReadinessStatusSchema,
  currentTarget: z.discriminatedUnion("availability", [
    z.strictObject({
      availability: z.literal("missing"),
    }),
    z.strictObject({
      availability: z.literal("resolved"),
      deviceId: START_BOUNDED_ID_SCHEMA,
      runtimeLane: daemonServiceLaneSchema,
    }),
  ]),
  runtime: z.strictObject({
    deviceDisplayName: z.string().trim().min(1).nullable(),
    deviceId: START_BOUNDED_ID_SCHEMA.nullable(),
    executionTargetStatus: localRuntimeExecutionTargetStatusSchema.nullable(),
    lastObservedAtMs: z.number().int().nonnegative().nullable(),
    reasonCodes: z.array(reasonCodeSchema),
    openMeldServiceRuntimeId: prepareReadinessRuntimeIdSchema.nullable(),
    runtimeLane: daemonServiceLaneSchema.nullable(),
  }),
  service: z.strictObject({
    connected: z.boolean(),
    executionCompatibility: daemonExecutionCompatibilitySchema.nullable(),
    matchingCurrentRuntime: z.boolean(),
    reasonCodes: z.array(reasonCodeSchema),
    sessionDeviceId: START_BOUNDED_ID_SCHEMA.nullable(),
    sessionLane: daemonServiceLaneSchema.nullable(),
  }),
  localComponents: localComponentUpdateProjectionSchema,
});
