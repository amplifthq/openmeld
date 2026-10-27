import * as z from "../../lazy-zod";
import {
  agentProfileIdSchema,
  profileWorkspaceModeSchema,
  profileWorkspaceReadResultSchema,
  profileWorkspaceWriteSchema,
} from "../protocol/profile";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import { runtimeTransportModeSchema } from "./controller-contract";
import { conversationExecutionStateSchema } from "./conversation-execution-state";
import {
  localAgentSetupRequestSchema,
  localAgentSetupStateSchema,
} from "./local-agent-setup";
import {
  localAgentUpdateRequestSchema,
  localAgentUpdateStateSchema,
} from "./local-agent-update";
import { providerDispatchRuntimeContextSchema } from "./provider-runtime-context";

export const OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION = 1 as const;

export const openMeldDaemonControlPlaneCommandSchema = z.enum([
  "status",
  "health",
  "history",
  "interrupt",
  "cancel",
  "conversation_execution_status",
  "request_agent_activity_sync",
  "sync_route_catalog",
  "set_local_agent_enabled",
  "set_profile_workspace",
  "service_update_readiness",
  "account_control_capabilities",
  "shutdown",
]);

export const openMeldDaemonHealthStateSchema = z.enum([
  "ok",
  "degraded",
  "down",
]);

export const openMeldDaemonRuntimeHealthStateSchema = z.enum([
  "healthy",
  "idle",
  "suspect",
  "down",
]);

export const openMeldDaemonControlTargetSelectorSchema = z.discriminatedUnion(
  "by",
  [
    z.strictObject({
      by: z.literal("dispatch"),
      dispatchId: z.string().min(1),
    }),
    z.strictObject({
      by: z.literal("task"),
      taskId: z.string().min(1),
    }),
  ]
);

export const openMeldDaemonInterruptRequestPayloadSchema = z.strictObject({
  runtimeCoordinatorExecutionId: z.string().min(1).optional(),
  target: openMeldDaemonControlTargetSelectorSchema,
  mode: z.enum(["graceful", "force"]).optional(),
  reason: z.string().min(1).optional(),
});

export const openMeldDaemonCancelRequestPayloadSchema = z.strictObject({
  runtimeCoordinatorExecutionId: z.string().min(1).optional(),
  target: openMeldDaemonControlTargetSelectorSchema,
  reason: z.string().min(1).optional(),
});

export const openMeldDaemonShutdownRequestPayloadSchema = z.strictObject({
  accountAdmissionId: z.string().uuid().optional(),
  mode: z.enum(["graceful", "force"]).default("graceful"),
  gracePeriodMs: z.number().int().nonnegative().default(5000),
});

export const openMeldDaemonServiceUpdateReadinessPayloadSchema = z.strictObject(
  {
    acceptedWakeCount: z.number().int().nonnegative(),
    safeToSwitch: z.boolean(),
    unacknowledgedResultCount: z.number().int().nonnegative(),
  }
);

export const openMeldDaemonConversationExecutionControllerLaunchStatusSchema =
  z.enum(["missing", "disabled", "repair_required", "ready"]);

const nullableAgentControllerRefSchema = z.union([z.string().min(1), z.null()]);
const nullableNonEmptyStringSchema = z.union([z.string().min(1), z.null()]);

export const openMeldDaemonConversationExecutionStatusRequestPayloadSchema =
  z.strictObject({
    boundAgentControllerRef: nullableAgentControllerRefSchema,
    agentControllerConversationId: nullableNonEmptyStringSchema,
    agentControllerRef: z.string().min(1),
    spaceId: nonEmptyTrimmedStringFromUnknown,
    targetProfileId: agentProfileIdSchema,
    transportMode: runtimeTransportModeSchema,
    validate: z.boolean(),
  });

export const openMeldDaemonSyncRouteCatalogRequestPayloadSchema =
  z.strictObject({
    reason: z.string().min(1),
  });

export const openMeldDaemonRequestAgentActivitySyncRequestPayloadSchema =
  z.strictObject({
    reason: z.string().trim().min(1).max(128),
  });

export const openMeldDaemonSetLocalAgentEnabledRequestPayloadSchema =
  z.strictObject({
    agentId: z.string().trim().min(1).max(256),
    enabled: z.boolean(),
  });

export const localAgentInstallationOptionSchema = z.strictObject({
  installationId: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256),
  details: z.string().trim().min(1).max(256),
  selected: z.boolean(),
});

export const openMeldDaemonManageLocalAgentInstallationRequestPayloadSchema =
  z.discriminatedUnion("operation", [
    z.strictObject({
      agentId: z.literal("grok-bot"),
      operation: z.literal("read_setup"),
    }),
    localAgentSetupRequestSchema.extend({
      agentId: z.literal("grok-bot"),
      operation: z.literal("setup"),
    }),
    z.strictObject({
      agentId: z.string().trim().min(1).max(256),
      operation: z.literal("list"),
    }),
    z.strictObject({
      agentId: z.string().trim().min(1).max(256),
      installationId: z.string().trim().min(1).max(256),
      operation: z.literal("select"),
    }),
    z.strictObject({
      agentId: z.string().trim().min(1).max(256),
      operation: z.literal("read_update"),
    }),
    localAgentUpdateRequestSchema.extend({
      agentId: z.string().trim().min(1).max(256),
      operation: z.literal("update"),
    }),
  ]);

export const openMeldDaemonSetProfileWorkspaceRequestPayloadSchema =
  profileWorkspaceWriteSchema.safeExtend({
    targetProfileId: agentProfileIdSchema,
  });

export const openMeldDaemonReadProfileWorkspaceRequestPayloadSchema =
  z.strictObject({ targetProfileId: agentProfileIdSchema });

export const openMeldDaemonReadProfileWorkspacePayloadSchema =
  z.discriminatedUnion("accepted", [
    z.strictObject({
      accepted: z.literal(true),
      targetProfileId: agentProfileIdSchema,
      status: z.literal("read"),
      workspace: profileWorkspaceReadResultSchema,
    }),
    z.strictObject({
      accepted: z.literal(false),
      targetProfileId: agentProfileIdSchema,
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const openMeldDaemonConversationExecutionRuntimeWorkspaceReadySchema =
  z.strictObject({
    configPath: z.string().min(1),
    configuredWorkspacePath: z.string().min(1),
    fingerprint: z.string().min(1),
    path: z.string().min(1),
    reasonCode: z.null(),
    reasonText: z.null(),
    runtimeContext: providerDispatchRuntimeContextSchema,
    status: z.literal("ready"),
    workspaceMode: profileWorkspaceModeSchema,
  });

export const openMeldDaemonConversationExecutionRuntimeWorkspaceMissingSchema =
  z.strictObject({
    configPath: z.string().min(1),
    configuredWorkspacePath: z.null(),
    fingerprint: z.null(),
    path: z.null(),
    reasonCode: z.literal("workspace.missing"),
    reasonText: z.string().min(1),
    runtimeContext: z.null(),
    status: z.literal("missing"),
    workspaceMode: z.null(),
  });

export const openMeldDaemonConversationExecutionRuntimeWorkspaceInvalidSchema =
  z.strictObject({
    configPath: z.string().min(1),
    configuredWorkspacePath: z.union([z.string().min(1), z.null()]),
    fingerprint: z.null(),
    path: z.null(),
    reasonCode: z.literal("workspace.invalid"),
    reasonText: z.string().min(1),
    runtimeContext: z.null(),
    status: z.literal("invalid"),
    workspaceMode: z.union([profileWorkspaceModeSchema, z.null()]),
  });

export const openMeldDaemonConversationExecutionRuntimeWorkspaceSchema =
  z.discriminatedUnion("status", [
    openMeldDaemonConversationExecutionRuntimeWorkspaceReadySchema,
    openMeldDaemonConversationExecutionRuntimeWorkspaceMissingSchema,
    openMeldDaemonConversationExecutionRuntimeWorkspaceInvalidSchema,
  ]);

export const openMeldDaemonConversationExecutionLocalRuntimeContextStatusSchema =
  z.enum(["missing", "mismatch", "ready"]);

export const openMeldDaemonProviderConversationProofStatusSchema = z.enum([
  "failed",
  "not_applicable",
  "not_run",
  "passed",
]);

export const openMeldDaemonProviderConversationProofProviderSchema = z.enum([
  "codex",
  "claude-code",
  "openclaw",
]);

export const openMeldDaemonProviderConversationProofMethodSchema = z.enum([
  "codex_app_server_thread_resume",
  "codex_app_server_thread_read",
]);

export const openMeldDaemonProviderConversationProofSchema = z.strictObject({
  agentControllerConversationId: nullableNonEmptyStringSchema,
  checkedAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
  errorCode: nullableNonEmptyStringSchema,
  errorMessage: nullableNonEmptyStringSchema,
  errorType: nullableNonEmptyStringSchema,
  expiresAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
  intrusive: z.literal(false),
  method: z.union([
    openMeldDaemonProviderConversationProofMethodSchema,
    z.null(),
  ]),
  provider: z.union([
    openMeldDaemonProviderConversationProofProviderSchema,
    z.null(),
  ]),
  status: openMeldDaemonProviderConversationProofStatusSchema,
  transportMode: z.union([runtimeTransportModeSchema, z.null()]),
});

export const openMeldDaemonConversationExecutionStatusPayloadSchema =
  z.strictObject({
    agentContextLookupKey: z.string().min(1),
    controllerLaunchStatus:
      openMeldDaemonConversationExecutionControllerLaunchStatusSchema,
    executionState: conversationExecutionStateSchema.nullable(),
    localRuntimeContext: z.strictObject({
      agentContextLookupKey: z.string().min(1),
      runtimeWorkspaceFingerprint: nullableNonEmptyStringSchema,
      status:
        openMeldDaemonConversationExecutionLocalRuntimeContextStatusSchema,
    }),
    providerConversationProof: openMeldDaemonProviderConversationProofSchema,
    runtimeWorkspace: openMeldDaemonConversationExecutionRuntimeWorkspaceSchema,
  });

export const openMeldDaemonSyncRouteCatalogStatusSchema = z.enum([
  "changed",
  "registered",
  "unchanged",
  "failed",
  "deferred",
]);

export const DAEMON_PROFILE_SKIP_REASON_VALUES = [
  "model.retired",
  "model.unavailable",
  "projection.missing",
  "controller.registry.disabled",
  "controller.launch.needs_repair",
  "runtime.adapter.unsupported",
  "controller.binding.disabled",
  "controller.binding.incomplete",
  "profile.status.inactive",
  "profile.binding.read_unavailable",
  "profile.binding.unbound",
  "workspace.missing",
  "workspace.invalid",
] as const;

export const daemonProfileSkipReasonSchema = z.enum(
  DAEMON_PROFILE_SKIP_REASON_VALUES
);

export const skippedDaemonProfileSchema = z.strictObject({
  profileId: agentProfileIdSchema,
  profileName: nullableNonEmptyStringSchema,
  skipReason: daemonProfileSkipReasonSchema,
});

export const openMeldDaemonSyncRouteCatalogPayloadSchema = z.strictObject({
  accepted: z.boolean(),
  syncStatus: openMeldDaemonSyncRouteCatalogStatusSchema,
  profileIds: z.array(agentProfileIdSchema),
  addedProfileIds: z.array(agentProfileIdSchema).optional(),
  keptProfileIds: z.array(agentProfileIdSchema).optional(),
  removedProfileIds: z.array(agentProfileIdSchema).optional(),
  skippedProfiles: z.array(skippedDaemonProfileSchema).optional(),
  note: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
});

export const openMeldDaemonRequestAgentActivitySyncPayloadSchema =
  z.strictObject({
    accepted: z.boolean(),
  });

export const openMeldDaemonSetLocalAgentEnabledPayloadSchema = z.strictObject({
  accepted: z.boolean(),
  agentControllerRef: z.string().min(1).optional(),
  agentId: z.string().trim().min(1).max(256),
  changed: z.boolean(),
  enabled: z.boolean(),
  message: z.string().min(1).optional(),
  reasonCode: z.string().min(1).optional(),
  reportSyncStatus: z.enum(["submitted", "skipped", "failed"]),
  status: z.enum(["updated", "unchanged", "rejected"]),
});

export const openMeldDaemonManageLocalAgentInstallationPayloadSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      accepted: z.literal(true),
      agentId: z.literal("grok-bot"),
      status: z.literal("setup_state"),
      setup: localAgentSetupStateSchema,
    }),
    z.strictObject({
      accepted: z.literal(true),
      agentId: z.string().trim().min(1).max(256),
      status: z.literal("update_state"),
      update: localAgentUpdateStateSchema,
    }),
    z.strictObject({
      accepted: z.literal(true),
      agentControllerRef: z.string().min(1),
      agentId: z.string().trim().min(1).max(256),
      changed: z.boolean(),
      installations: z.array(localAgentInstallationOptionSchema),
      reportSyncStatus: z.enum(["submitted", "skipped", "failed"]),
      selectionStatus: z
        .enum(["available", "blocked_by_work", "operation_in_progress"])
        .optional(),
      selectedInstallationId: z.string().trim().min(1).max(256).nullable(),
      status: z.enum(["listed", "updated", "unchanged"]),
    }),
    z.strictObject({
      accepted: z.literal(false),
      agentId: z.string().trim().min(1).max(256),
      changed: z.literal(false),
      installations: z.array(localAgentInstallationOptionSchema),
      message: z.string().min(1).optional(),
      reasonCode: z.string().min(1).optional(),
      reportSyncStatus: z.literal("failed"),
      selectionStatus: z
        .enum(["available", "blocked_by_work", "operation_in_progress"])
        .optional(),
      selectedInstallationId: z.string().trim().min(1).max(256).nullable(),
      status: z.literal("rejected"),
    }),
  ]);

export const openMeldDaemonSetProfileWorkspacePayloadSchema =
  z.discriminatedUnion("accepted", [
    z.strictObject({
      accepted: z.literal(true),
      targetProfileId: agentProfileIdSchema,
      status: z.literal("updated"),
      workspaceMode: profileWorkspaceModeSchema,
      workspacePath: z.string().min(1),
    }),
    z.strictObject({
      accepted: z.literal(false),
      targetProfileId: agentProfileIdSchema,
      message: z.string().min(1).optional(),
      reasonCode: z.string().min(1).optional(),
      status: z.literal("rejected"),
    }),
  ]);

const openMeldDaemonControlPlaneRequestBaseSchema = z.strictObject({
  v: z.literal(OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION),
  requestId: z.string().min(1).optional(),
  authToken: z.string().min(1).optional(),
});

export const openMeldDaemonControlPlaneRequestSchema = z.discriminatedUnion(
  "command",
  [
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("account_control_capabilities"),
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("status"),
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("health"),
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("history"),
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("interrupt"),
      payload: openMeldDaemonInterruptRequestPayloadSchema,
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("cancel"),
      payload: openMeldDaemonCancelRequestPayloadSchema,
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("conversation_execution_status"),
      payload: openMeldDaemonConversationExecutionStatusRequestPayloadSchema,
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("sync_route_catalog"),
      payload: openMeldDaemonSyncRouteCatalogRequestPayloadSchema,
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("request_agent_activity_sync"),
      payload: openMeldDaemonRequestAgentActivitySyncRequestPayloadSchema,
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("set_local_agent_enabled"),
      payload: openMeldDaemonSetLocalAgentEnabledRequestPayloadSchema,
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("set_profile_workspace"),
      payload: openMeldDaemonSetProfileWorkspaceRequestPayloadSchema,
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("service_update_readiness"),
    }),
    openMeldDaemonControlPlaneRequestBaseSchema.extend({
      command: z.literal("shutdown"),
      payload: openMeldDaemonShutdownRequestPayloadSchema.optional(),
    }),
  ]
);

export const openMeldDaemonStatusPayloadSchema = z.strictObject({
  installed: z.boolean(),
  running: z.boolean(),
  daemonVersion: z.string().min(1),
  runtimeRoot: z.string().min(1),
  checkedAt: z.string().min(1),
});

export const openMeldDaemonHealthPayloadSchema = z.strictObject({
  // External health contract (stable for cross-module automation).
  state: openMeldDaemonHealthStateSchema,
  // Internal runtime state projection for daemon diagnostics.
  runtimeState: openMeldDaemonRuntimeHealthStateSchema.optional(),
  reasonCode: z.string().min(1),
  checkedAt: z.string().min(1),
});

export const openMeldDaemonHistoryEntrySchema = z.strictObject({
  id: z.string().min(1),
  ts: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const openMeldDaemonHistoryPayloadSchema = z.strictObject({
  entries: z.array(openMeldDaemonHistoryEntrySchema),
  nextCursor: z.string().min(1).optional(),
});

export const openMeldDaemonInterruptPayloadSchema = z.strictObject({
  accepted: z.boolean(),
  target: openMeldDaemonControlTargetSelectorSchema,
  resolvedDispatchId: z.string().min(1).optional(),
  resolvedRuntimeCoordinatorExecutionId: z.string().min(1).optional(),
  resolvedTaskId: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  reasonCode: z.string().min(1).optional(),
});

/**
 * What accepting a cancellation established, carried on `reasonCode`.
 *
 * `accepted` alone only means the control request was taken: an adapter can
 * register a stop signal before the provider turn is acknowledged, and
 * interrupting a started turn is a request, not a completion barrier. Work that
 * replaces the attempt needs `adapter.cancel.withdrawn_before_start`.
 *
 * This rides the existing free-form reason code on purpose. These payloads are
 * strict objects, so a Service that emitted a new key would have its whole
 * frame rejected by a Core that predates it, and local components can reach a
 * user before the matching Core deploy.
 */
export const OPENMELD_DAEMON_CANCEL_WITHDRAWN_BEFORE_START_REASON_CODE =
  "adapter.cancel.withdrawn_before_start" as const;
export const OPENMELD_DAEMON_CANCEL_STOP_REQUESTED_AFTER_START_REASON_CODE =
  "adapter.cancel.stop_requested_after_start" as const;

export const openMeldDaemonCancelPayloadSchema = z.strictObject({
  accepted: z.boolean(),
  target: openMeldDaemonControlTargetSelectorSchema,
  resolvedDispatchId: z.string().min(1).optional(),
  resolvedRuntimeCoordinatorExecutionId: z.string().min(1).optional(),
  resolvedTaskId: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  reasonCode: z.string().min(1).optional(),
});

export const openMeldDaemonControlPlaneErrorPayloadSchema = z.strictObject({
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  note: z.string().min(1).optional(),
});

export const openMeldDaemonShutdownPayloadSchema = z.strictObject({
  accepted: z.boolean(),
  mode: z.enum(["graceful", "force"]),
  gracePeriodMs: z.number().int().nonnegative(),
});

const openMeldDaemonControlPlaneResponseBaseSchema = z.strictObject({
  v: z.literal(OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION),
  requestId: z.string().min(1).optional(),
});

export const openMeldDaemonStatusResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.status"),
    payload: openMeldDaemonStatusPayloadSchema,
  });

export const openMeldDaemonHealthResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.health"),
    payload: openMeldDaemonHealthPayloadSchema,
  });

export const openMeldDaemonHistoryResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.history"),
    payload: openMeldDaemonHistoryPayloadSchema,
  });

export const openMeldDaemonInterruptResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.interrupt"),
    payload: openMeldDaemonInterruptPayloadSchema,
  });

export const openMeldDaemonCancelResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.cancel"),
    payload: openMeldDaemonCancelPayloadSchema,
  });

export const openMeldDaemonConversationExecutionStatusResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.conversation_execution_status"),
    payload: openMeldDaemonConversationExecutionStatusPayloadSchema,
  });

export const openMeldDaemonSyncRouteCatalogResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.sync_route_catalog"),
    payload: openMeldDaemonSyncRouteCatalogPayloadSchema,
  });

export const openMeldDaemonRequestAgentActivitySyncResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.agent_activity_sync_requested"),
    payload: openMeldDaemonRequestAgentActivitySyncPayloadSchema,
  });

export const openMeldDaemonSetLocalAgentEnabledResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.set_local_agent_enabled"),
    payload: openMeldDaemonSetLocalAgentEnabledPayloadSchema,
  });

export const openMeldDaemonSetProfileWorkspaceResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.set_profile_workspace"),
    payload: openMeldDaemonSetProfileWorkspacePayloadSchema,
  });

export const openMeldDaemonShutdownResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.shutdown"),
    payload: openMeldDaemonShutdownPayloadSchema,
  });

export const openMeldDaemonServiceUpdateReadinessResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.update_readiness"),
    payload: openMeldDaemonServiceUpdateReadinessPayloadSchema,
  });

export const openMeldDaemonControlPlaneErrorResponseSchema =
  openMeldDaemonControlPlaneResponseBaseSchema.extend({
    code: z.literal("service.error"),
    payload: openMeldDaemonControlPlaneErrorPayloadSchema,
  });

export const openMeldDaemonControlPlaneResponseSchema = z.discriminatedUnion(
  "code",
  [
    openMeldDaemonControlPlaneResponseBaseSchema.extend({
      code: z.literal("service.account_control_capabilities"),
      payload: z.strictObject({ supported: z.boolean() }),
    }),
    openMeldDaemonStatusResponseSchema,
    openMeldDaemonHealthResponseSchema,
    openMeldDaemonHistoryResponseSchema,
    openMeldDaemonInterruptResponseSchema,
    openMeldDaemonCancelResponseSchema,
    openMeldDaemonConversationExecutionStatusResponseSchema,
    openMeldDaemonSyncRouteCatalogResponseSchema,
    openMeldDaemonRequestAgentActivitySyncResponseSchema,
    openMeldDaemonSetLocalAgentEnabledResponseSchema,
    openMeldDaemonSetProfileWorkspaceResponseSchema,
    openMeldDaemonServiceUpdateReadinessResponseSchema,
    openMeldDaemonShutdownResponseSchema,
    openMeldDaemonControlPlaneErrorResponseSchema,
  ]
);
