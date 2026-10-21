import * as z from "../../lazy-zod";
export const OPENMELD_EXECUTION_ADMISSION_HEADER =
  "x-openmeld-execution-admission";
export const OPENMELD_ADMISSION_EVIDENCE_HEADER =
  "x-openmeld-admission-evidence";

import { agentProfileWorkRecoveryActionKindSchema } from "../agent-profile-work-recovery";
import {
  executionRecoveryDestinationSchema,
  executionRecoveryIdentitySchema,
} from "../http/execution-recovery";
import {
  LOCAL_AGENT_REASONING_MAX_CHARS,
  localAgentReasoningStateSchema,
} from "../http/local-agent-reasoning";
import { organizationProtectedInformationSchema } from "../http/organization-information-protection";
import { permissionModeAdvisorySchema } from "../http/permission-mode-advisor";
import { spaceMentionLabelSchema } from "../http/space-mention-label";
import { spacePasswordSchema } from "../http/space-password";
import { postSpaceWakeStopResponseSchema } from "../http/space-wake-stop";
import {
  localComponentsStatusSchema,
  openMeldToolsControlCapabilitySchema,
  openMeldToolsControlRequestSchema,
  openMeldToolsControlResultSchema,
} from "../local-components";
import {
  agentInteractionPendingSummarySchema,
  agentInteractionRequestSchema,
  agentInteractionResponseSchema,
} from "../protocol/agent-interaction";
import {
  AGENT_STREAM_SNAPSHOT_MAX_CHARS,
  agentStreamToolPartSchema,
} from "../protocol/agent-stream";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import {
  MAX_PROFILE_NAME_LENGTH,
  MAX_TEXT_LENGTH,
} from "../protocol/constants";
import {
  executionContextDiagnosticsSchema,
  executionContextTaskSchema,
} from "../protocol/execution-context";
import { messageEnvelopeSchema } from "../protocol/message-envelope";
import {
  agentProfileIdSchema,
  profileHandleSchema,
  profileWorkspaceWriteSchema,
} from "../protocol/profile";
import { profileFolderOperationSchema } from "../protocol/profile-folders";
import { targetWakeLifecycleIdentitySchema } from "../protocol/target-wake-lifecycle";
import { workingLanguageGuidanceSchema } from "../runtime/working-language";
import { spaceContractSchema } from "../space-mesh/space-contract";
import { spaceThreadContextSchema } from "../space-mesh/space-thread";
import { agentControllerRefSchema } from "./agent-controller-ref";
import { executionHostObservationSchema } from "./computer-care";
import {
  openMeldDaemonCancelPayloadSchema,
  openMeldDaemonCancelRequestPayloadSchema,
  openMeldDaemonInterruptPayloadSchema,
  openMeldDaemonInterruptRequestPayloadSchema,
  openMeldDaemonManageLocalAgentInstallationPayloadSchema,
  openMeldDaemonManageLocalAgentInstallationRequestPayloadSchema,
  openMeldDaemonReadProfileWorkspacePayloadSchema,
  openMeldDaemonReadProfileWorkspaceRequestPayloadSchema,
  openMeldDaemonSetLocalAgentEnabledPayloadSchema,
  openMeldDaemonSetLocalAgentEnabledRequestPayloadSchema,
  openMeldDaemonSetProfileWorkspacePayloadSchema,
  openMeldDaemonSetProfileWorkspaceRequestPayloadSchema,
  openMeldDaemonSyncRouteCatalogPayloadSchema,
  openMeldDaemonSyncRouteCatalogRequestPayloadSchema,
  skippedDaemonProfileSchema,
} from "./control-plane";
import {
  runtimeAgentControllerConversationIdMappingSpecSchema,
  runtimeDispatchPolicySchema,
  runtimeStreamingModeSchema,
  runtimeTransportModeSchema,
} from "./controller-contract";
import {
  openMeldDaemonAcceptedDispatchSnapshotSchema,
  openMeldDaemonDispatchContinuitySnapshotSchema,
  openMeldDaemonDispatchControllerSnapshotSchema,
  openMeldDaemonDispatchDeliveryRecoveryReasonSchema,
  openMeldDaemonDispatchReplyToSnapshotSchema,
  openMeldDaemonDispatchRulesSnapshotSchema,
  openMeldDaemonDispatchSourceSignalSnapshotSchema,
} from "./dispatch-queue";
import {
  runtimeTransportDeliveryExecutionIdentitySchema,
  runtimeTransportResultIdentityEchoSchema,
  runtimeTransportRuntimeEvidenceIdentityEchoSchema,
} from "./execution-identity";
import { localFolderPickerRuntimeCapabilitySchema } from "./local-folder-picker";
import {
  openMeldDaemonManageProfileFoldersPayloadSchema,
  openMeldDaemonManageProfileFoldersRequestPayloadSchema,
  profileFolderProjectionRecordSchema,
} from "./profile-folder-control";
import { daemonRuntimeAdapterCapabilitySnapshotSchema } from "./provider-runtime-capability";
import { runtimeCoordinatorExecutionRecordSchema } from "./runtime-coordinator-execution";
import {
  runtimeCoordinatorExecutionTokenEchoSchema,
  runtimeCoordinatorExecutionTokenEnvelopeSchema,
} from "./runtime-coordinator-execution-token";
import { runtimeTransportAdmissionEvidenceSchema } from "./runtime-transport-admission-evidence";
import { runtimeTransportStopCauseSchema } from "./runtime-transport-stop-cause";
import { daemonServiceLaneSchema } from "./service-contract";
import { openMeldDaemonTaskResultEnvelopeSchema } from "./task-result";

export const RUNTIME_TRANSPORT_SCHEMA_VERSION = 1 as const;
export const CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH =
  "runtime-transport-epoch-2026-09-project-work-v1" as const;

export const daemonRuntimeContractSchema = z.strictObject({
  epoch: z.string().min(1),
});

export const daemonRuntimeContractReasonCodeSchema = z.enum([
  "daemon.runtime_contract.compatible",
  "daemon.runtime_contract.missing",
  "daemon.runtime_contract.mismatch",
]);

export const daemonExecutionCompatibilitySchema = z.strictObject({
  status: z.enum(["compatible", "update_required"]),
  expectedEpoch: z.string().min(1),
  observedEpoch: z.union([z.string().min(1), z.null()]),
  reasonCode: daemonRuntimeContractReasonCodeSchema,
});

export const runtimeTransportAgentProfileExecutionStateRequestSchema =
  z.strictObject({
    ownerUserId: z.string().trim().min(1).max(256),
    targetProfileId: agentProfileIdSchema,
  });

export const runtimeTransportAgentProfileExecutionStateResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("active") }),
    z.strictObject({ status: z.literal("inactive") }),
    z.strictObject({
      reasonCode: z.string().trim().min(1).max(256),
      status: z.literal("unavailable"),
    }),
  ]);

const runtimeTransportAgentProfileWorkReferenceSchema = z.strictObject({
  sourceSignalId: z.string().trim().min(1).max(512),
  spaceId: z.string().trim().min(1).max(512),
});

export const runtimeTransportAgentProfileWorkRecoveryActionSchema =
  agentProfileWorkRecoveryActionKindSchema;

export const runtimeTransportAgentProfileWorkRecoveryReadRequestSchema =
  z.strictObject({
    ownerUserId: z.string().trim().min(1).max(256),
    targetProfileId: agentProfileIdSchema,
  });

export const runtimeTransportAgentProfileWorkRecoveryReadResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      action: runtimeTransportAgentProfileWorkRecoveryActionSchema,
      authorizedContinuationClientMessageId: clientMessageIdSchema.nullable(),
      forkInterruptedConversation: z.boolean().optional(),
      automaticForkEligible: z.boolean().optional(),
      requesterRecoveryScope: z
        .strictObject({
          profileId: z.string().min(1),
          spaceId: z.string().min(1),
          canFork: z.boolean(),
        })
        .optional(),
      interruptedClientMessageId: clientMessageIdSchema,
      interruptedDispatchId: z.string().trim().min(1).max(512),
      // Older owner shards omit these exact-source fields during a rolling Core
      // deployment. Current writers always include both; callers must defer side
      // effects until both exist.
      interruptedTargetWakeLifecycleId: z
        .string()
        .trim()
        .min(1)
        .max(512)
        .optional(),
      interruptedSourceSignalId: z.string().trim().min(1).max(512).optional(),
      // Whether the attempt this work would replace is safely out of the way.
      // `not_started` means no execution was ever created for it, `withdrawn`
      // means the computer acknowledged that its attempt is gone, and
      // `awaiting_withdrawal` means Core cannot yet prove either. Older owner
      // shards omit it during a rolling Core deployment, so callers must defer
      // replacement work rather than assume the attempt was retired.
      interruptedLocalAttempt: z
        .enum(["awaiting_withdrawal", "not_started", "withdrawn"])
        .optional(),
      spaceId: z.string().trim().min(1).max(512),
      status: z.literal("available"),
    }),
    z.strictObject({ status: z.literal("not_pending") }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]);

export const runtimeTransportAgentProfileOperationalContextSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      reasonCode: z.string().trim().min(1).max(256),
      status: z.literal("checking"),
    }),
    z.strictObject({
      status: z.literal("idle"),
      waitingCount: z.literal(0),
    }),
    z.strictObject({
      currentWorkReference:
        runtimeTransportAgentProfileWorkReferenceSchema.optional(),
      queuedWorkReferences: z
        .array(runtimeTransportAgentProfileWorkReferenceSchema)
        .max(50)
        .optional(),
      status: z.literal("working"),
      waitingCount: z.number().int().min(0).max(50),
    }),
    z.strictObject({
      currentWorkReference:
        runtimeTransportAgentProfileWorkReferenceSchema.optional(),
      queuedWorkReferences: z
        .array(runtimeTransportAgentProfileWorkReferenceSchema)
        .max(50)
        .optional(),
      recoveryAction:
        runtimeTransportAgentProfileWorkRecoveryActionSchema.optional(),
      recoveryTargetWakeLifecycleId: z
        .string()
        .trim()
        .min(1)
        .max(512)
        .optional(),
      status: z.literal("paused"),
      waitingCount: z.number().int().min(0).max(50),
    }),
  ]);

export const runtimeTransportAgentProfileOperationalContextsRequestSchema =
  z.strictObject({
    includeWorkReferences: z.boolean(),
    ownerUserId: z.string().trim().min(1).max(256),
    targetProfileIds: z.array(agentProfileIdSchema).min(1).max(100),
  });

export const runtimeTransportAgentProfileOperationalContextsResponseSchema =
  z.strictObject({
    contexts: z
      .array(
        z.strictObject({
          operationalContext:
            runtimeTransportAgentProfileOperationalContextSchema,
          targetProfileId: agentProfileIdSchema,
        })
      )
      .max(100),
  });

const runtimeTransportAgentProfileWorkRecoveryTargetSchema = z.strictObject({
  ownerUserId: z.string().trim().min(1).max(256),
  targetProfileId: agentProfileIdSchema,
});

export const MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS = 100;

export const runtimeTransportAgentProfileWorkUsageAvailableRequestSchema =
  z.strictObject({
    ownerUserId: z.string().trim().min(1).max(256),
    targetProfileIds: z
      .array(agentProfileIdSchema)
      .min(1)
      .max(MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS),
  });

export const runtimeTransportAgentProfileWorkUsageAvailableResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      changedProfileIds: z
        .array(agentProfileIdSchema)
        .max(MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS),
      continuationProfileIds: z
        .array(agentProfileIdSchema)
        .max(MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS)
        .default([]),
      status: z.literal("updated"),
    }),
    z.strictObject({
      changedProfileIds: z.tuple([]),
      continuationProfileIds: z.tuple([]).default([]),
      status: z.literal("unavailable"),
    }),
  ]);

export const runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema =
  runtimeTransportAgentProfileWorkRecoveryTargetSchema.extend({
    continuationClientMessageId: clientMessageIdSchema,
    currentAgentControllerRef: agentControllerRefSchema,
    currentBindingId: z.string().trim().min(1).max(512),
    currentConfigurationRevision: z.number().int().positive(),
    currentDefaultProjectId: z.string().trim().min(1).nullable().optional(),
    expectedInterruptedTargetWakeLifecycleId: z.string().trim().min(1).max(512),
    forkInterruptedConversation: z.boolean().optional(),
    requireAutomaticForkEligibility: z.literal(true).optional(),
    requesterProfileId: z.string().min(1).optional(),
    requireAcceptedExecutionTargetRevision: z.literal(true),
  });

export const runtimeTransportAgentProfileWorkContinuationAuthorizeResponseSchema =
  z.strictObject({
    status: z.enum([
      "authorized",
      "needs_attention",
      "not_pending",
      "unavailable",
    ]),
  });

export const runtimeTransportAgentProfileWorkContinuationNeedsAttentionRequestSchema =
  runtimeTransportAgentProfileWorkRecoveryTargetSchema.extend({
    expectedInterruptedTargetWakeLifecycleId: z.string().trim().min(1).max(512),
  });

export const runtimeTransportAgentProfileWorkContinuationNeedsAttentionResponseSchema =
  z.strictObject({
    status: z.enum(["marked", "not_pending", "unavailable"]),
  });

export const runtimeTransportAgentProfileWorkHandoffRequestSchema =
  runtimeTransportAgentProfileWorkRecoveryTargetSchema.extend({
    sourceDispatchId: z.string().trim().min(1).max(512),
    sourceTargetWakeLifecycleId: z.string().trim().min(1).max(512),
    successorDispatchId: z.string().trim().min(1).max(512),
    successorExecutionContextId: z.string().trim().min(1).max(512).optional(),
    successorTargetWakeLifecycleId: z.string().trim().min(1).max(512),
  });

export const runtimeTransportAgentProfileWorkHandoffResponseSchema =
  z.strictObject({
    status: z.enum([
      "already_handed_off",
      "handed_off",
      "source_not_occupied",
      "successor_conflict",
      "unavailable",
    ]),
  });

export const runtimeTransportAgentProfileWorkQueueApproveRequestSchema =
  runtimeTransportAgentProfileWorkRecoveryTargetSchema.extend({
    expectedInterruptedTargetWakeLifecycleId: z.string().trim().min(1).max(512),
  });

export const runtimeTransportAgentProfileWorkQueueApproveResponseSchema =
  z.strictObject({
    status: z.enum(["approved", "not_pending", "unavailable"]),
  });

export const runtimeTransportAgentProfileWorkSkipRequestSchema =
  runtimeTransportAgentProfileWorkRecoveryTargetSchema.extend({
    expectedInterruptedTargetWakeLifecycleId: z.string().trim().min(1).max(512),
    requesterProfileId: z.string().min(1).optional(),
  });

export const runtimeTransportAgentProfileWorkSkipResponseSchema =
  z.strictObject({
    status: z.enum(["skipped", "not_pending", "unavailable"]),
  });

export const runtimeTransportAgentProfileWorkLocalAttemptWithdrawalRequestSchema =
  runtimeTransportAgentProfileWorkRecoveryTargetSchema.extend({
    expectedInterruptedTargetWakeLifecycleId: z.string().trim().min(1).max(512),
  });

// `requested` means the withdrawal was asked for again and is still
// unconfirmed; it is not a claim that the attempt stopped. `not_started` and
// `withdrawn` are the two answers that leave nothing outstanding.
export const runtimeTransportAgentProfileWorkLocalAttemptWithdrawalResponseSchema =
  z.strictObject({
    status: z.enum([
      "not_pending",
      "not_started",
      "requested",
      "unavailable",
      "withdrawn",
    ]),
  });

export const runtimeTransportAgentProfileExecutionTargetMutationRequestSchema =
  z.strictObject({
    operationId: z.string().trim().min(1).max(256),
    ownerUserId: z.string().trim().min(1).max(256),
    targetProfileId: agentProfileIdSchema,
  });

// Names the harness whose Binding conversation is written: a harness without
// Execution Context support keeps that conversation after Context activation.
// Optional so a caller that omits it keeps the frozen-association fence.
export const runtimeTransportAgentProfileLegacyConversationMutationRequestSchema =
  runtimeTransportAgentProfileExecutionTargetMutationRequestSchema.extend({
    agentControllerRef: agentControllerRefSchema.optional(),
  });

export const runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      expiresAtMs: z.number().int().nonnegative(),
      operationId: z.string().trim().min(1).max(256),
      status: z.literal("acquired"),
    }),
    z.strictObject({
      reasonCode: z.string().trim().min(1).max(256),
      status: z.literal("blocked"),
    }),
    z.strictObject({
      reasonCode: z.string().trim().min(1).max(256),
      status: z.literal("unavailable"),
    }),
  ]);

export const runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("released") }),
    z.strictObject({ status: z.literal("not_owner") }),
  ]);

export const runtimeTransportErrorCodeSchema = z.enum([
  "daemon.session.reject_conflict",
  "daemon.session.not_found",
  "daemon.session.connection_replaced",
  "daemon.session.stale_lease",
  "daemon.profile.offline",
  "daemon.profile.pending_first_report",
  "daemon.profile.configuration_not_synced",
  "daemon.runtime_contract.missing",
  "daemon.runtime_contract.mismatch",
  "daemon.delivery.timeout",
  "daemon.delivery.start_timeout",
  "daemon.delivery.execution_stalled",
  "daemon.delivery.finalization_timeout",
  "daemon.result.conflict",
  "daemon.result.identity_mismatch",
  "daemon.result.inbox_unavailable",
  "daemon.result.finalization_unavailable",
  "space.agent_reply.context_changed",
  "core.transport_restarting",
  "execution_token_authority_missing",
  "execution_token_expired",
  "execution_token_mismatch",
  "execution_token_missing",
  "execution_token_revoked",
  "execution_token_scope_mismatch",
  "execution_token_superseded",
  "execution_token_terminal_late",
  "execution_token_unknown",
  "runtime_coordinator.execution_id_missing",
  "runtime_coordinator.execution_id_mismatch",
  "runtime_coordinator.head_execution_link_unavailable",
  "runtime_coordinator.pre_agent_stop_requested",
  "runtime_coordinator.execution_token_authority_unavailable",
  "runtime_coordinator.execution_token_scope_mismatch",
  "runtime_coordinator.execution_token_unavailable",
  "runtime_coordinator.execution_context_mismatch",
  "runtime_coordinator.execution_context_unavailable",
]);

export const runtimeTransportLeaseSchema = z.strictObject({
  profileId: z.string().min(1),
  leaseEpoch: z.number().int().positive(),
});

export const runtimeTransportBaseCapabilitiesSchema = z.strictObject({
  executionHost: executionHostObservationSchema.optional(),
  agentReplyContextReview: z.literal(true).optional(),
  informationProtectionPrompt: z.literal(true).optional(),
  workingLanguagePrompt: z.literal(true).optional(),
  // The Service renders Core's permission-mode advisory block in the task prompt.
  permissionModeAdvisoryPrompt: z.literal(true).optional(),
  verifiedRequesterContext: z.literal(true).optional(),
  // The Service runs a Wake marked separateRequesterConversation in a
  // conversation of its own (member-agent-program.md §4.3).
  requesterConversationIsolation: z.literal(true).optional(),
  localAgentInteraction: z.literal(true).optional(),
  profileConfigurationRevision: z.literal(true).optional(),
  localComponents: localComponentsStatusSchema.optional(),
  openMeldToolsControl: openMeldToolsControlCapabilitySchema.optional(),
  localAgentControl: z
    .strictObject({
      cancel: z.literal(true).optional(),
      interrupt: z.literal(true).optional(),
      manageInstallations: z.literal(true).optional(),
      manageInstallationsSafely: z.literal(true).optional(),
      updateInstallations: z.literal(true).optional(),
      setupInstallations: z.literal(true).optional(),
      forkSession: z.literal(true).optional(),
      refreshCatalog: z.literal(true).optional(),
      resumeControllerConversation: z.literal(true).optional(),
      setEnabled: z.literal(true).optional(),
      setProfileWorkspace: z.literal(true).optional(),
      readProfileWorkspace: z.literal(true).optional(),
      initializeProfileWorkspace: z.literal(true).optional(),
      manageProfileFolders: z.literal(true).optional(),
      repairProfileFolders: z.literal(true).optional(),
    })
    .optional(),
  localProjectControl: z
    .strictObject({
      connectCandidate: z.literal(true).optional(),
      connectDeclaredPath: z.literal(true).optional(),
      discoverProjects: z.literal(true).optional(),
      readConnections: z.literal(true).optional(),
      moveConnection: z.literal(true).optional(),
      removeConnection: z.literal(true).optional(),
      removeMissingConnections: z.literal(true).optional(),
      setDefaultConnection: z.literal(true).optional(),
    })
    .optional(),
  runtimeAdapters: z
    .array(daemonRuntimeAdapterCapabilitySnapshotSchema)
    .min(1)
    .optional(),
});

export const runtimeTransportCapabilitiesSchema =
  runtimeTransportBaseCapabilitiesSchema.extend({
    localExecutionInput: z.literal(true).optional(),
    spaceWorkHandoff: z.literal(true).optional(),
    sessionHistory: z.literal(true).optional(),
    computerPower: z.literal(true).optional(),
    computerFileAccess: z
      .strictObject({
        readPolicy: z.literal(true).optional(),
        updatePolicy: z.literal(true).optional(),
      })
      .optional(),
    localFolderPicker: localFolderPickerRuntimeCapabilitySchema.optional(),
  });

const localWakeRouteWorkingFolderObservationIdentityShape = {
  bindingId: z.string().min(1),
  configurationRevision: z.number().int().positive(),
  observedAtMs: z.number().int().nonnegative(),
  profileId: z.string().min(1),
} as const;
const localProjectBindingGenerationSchema = z.string().trim().min(1);
const defaultProjectIdSchema = z.string().trim().min(1);

export const localWakeRouteWorkingFolderReasonCodeSchema = z.enum([
  "project.local_connection.missing",
  "project.local_connection.folder_missing",
  "project.local_connection.invalid",
  "profile.workspace.missing",
  "profile.workspace.invalid",
]);

export const localWakeRouteWorkingFolderObservationSchema = z.union([
  z.strictObject({
    ...localWakeRouteWorkingFolderObservationIdentityShape,
    defaultProjectId: defaultProjectIdSchema,
    localProjectBindingGeneration: localProjectBindingGenerationSchema,
    reasonCode: z.null(),
    source: z.literal("default_project"),
    status: z.literal("ready"),
  }),
  z.strictObject({
    ...localWakeRouteWorkingFolderObservationIdentityShape,
    defaultProjectId: defaultProjectIdSchema,
    localProjectBindingGeneration: z.null(),
    reasonCode: z.literal("project.local_connection.missing"),
    source: z.literal("default_project"),
    status: z.literal("missing"),
  }),
  z.strictObject({
    ...localWakeRouteWorkingFolderObservationIdentityShape,
    defaultProjectId: defaultProjectIdSchema,
    localProjectBindingGeneration: localProjectBindingGenerationSchema,
    reasonCode: z.literal("project.local_connection.folder_missing"),
    source: z.literal("default_project"),
    status: z.literal("missing"),
  }),
  z.strictObject({
    ...localWakeRouteWorkingFolderObservationIdentityShape,
    defaultProjectId: defaultProjectIdSchema,
    localProjectBindingGeneration: localProjectBindingGenerationSchema,
    reasonCode: z.literal("project.local_connection.invalid"),
    source: z.literal("default_project"),
    status: z.literal("invalid"),
  }),
  z.strictObject({
    ...localWakeRouteWorkingFolderObservationIdentityShape,
    defaultProjectId: z.null(),
    localProjectBindingGeneration: z.null(),
    reasonCode: z.null(),
    source: z.literal("profile_workspace"),
    status: z.literal("ready"),
  }),
  z.strictObject({
    ...localWakeRouteWorkingFolderObservationIdentityShape,
    defaultProjectId: z.null(),
    localProjectBindingGeneration: z.null(),
    reasonCode: z.literal("profile.workspace.missing"),
    source: z.literal("profile_workspace"),
    status: z.literal("missing"),
  }),
  z.strictObject({
    ...localWakeRouteWorkingFolderObservationIdentityShape,
    defaultProjectId: z.null(),
    localProjectBindingGeneration: z.null(),
    reasonCode: z.literal("profile.workspace.invalid"),
    source: z.literal("profile_workspace"),
    status: z.literal("invalid"),
  }),
]);

const localWakeRouteReportBaseShape = {
  reportedAtMs: z.number().int().nonnegative(),
  daemonSessionId: z.string().min(1),
  deviceId: z.string().min(1),
  lane: daemonServiceLaneSchema,
  serviceVersion: z.string().trim().min(1).nullable().optional(),
  includedProfileIds: z.array(z.string().min(1)).max(512),
  profileConfigurationRevisions: z
    .array(
      z.strictObject({
        bindingId: z.string().min(1),
        configurationRevision: z.number().int().positive(),
        profileId: z.string().min(1),
      })
    )
    .max(512)
    .optional(),
  skippedProfiles: z.array(skippedDaemonProfileSchema).max(512),
} as const;

const legacyLocalWakeRouteReportSchema = z.strictObject(
  localWakeRouteReportBaseShape
);
const v4LocalWakeRouteReportSchema = z.strictObject({
  ...localWakeRouteReportBaseShape,
  expectedRoutesContractVersion: z.literal("v4"),
  workingFolderObservations: z
    .array(localWakeRouteWorkingFolderObservationSchema)
    .max(512),
});

export const localWakeRouteReportSchema = z.union([
  legacyLocalWakeRouteReportSchema,
  v4LocalWakeRouteReportSchema,
]);

export const runtimeTransportRejectedProfileRegistrationSchema = z.strictObject(
  {
    profileId: z.string().min(1),
    reasonCode: runtimeTransportErrorCodeSchema,
    rejectedAtMs: z.number().int().nonnegative(),
    daemonSessionId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    serviceVersion: z.string().trim().min(1).nullable().optional(),
  }
);

export const runtimeTransportRegisterSessionRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  ownerUserId: z.string().min(1),
  deviceId: z.string().min(1),
  lane: daemonServiceLaneSchema,
  daemonSessionId: z.string().min(1),
  serviceVersion: z.string().trim().min(1).optional(),
  connectionGeneration: z.number().int().positive(),
  profileIds: z.array(z.string().min(1)).max(512),
  localWakeRouteReport: localWakeRouteReportSchema.optional(),
  capabilities: runtimeTransportCapabilitiesSchema,
  runtimeContract: daemonRuntimeContractSchema.optional(),
  connectedAtMs: z.number().int().nonnegative(),
});

export const runtimeTransportRegisterSessionResponseSchema = z.strictObject({
  executionAdmissionConfirmation: z.literal(true).optional(),
  computerCare: z.literal(true).optional(),
  admissionEvidence: z.literal(true).optional(),
  ok: z.boolean(),
  connectionGeneration: z.number().int().positive(),
  acceptedLeases: z.array(runtimeTransportLeaseSchema),
  rejectedProfiles: z.array(
    z.strictObject({
      profileId: z.string().min(1),
      reasonCode: runtimeTransportErrorCodeSchema,
    })
  ),
});

export const runtimeTransportHeartbeatRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  ownerUserId: z.string().min(1),
  deviceId: z.string().min(1),
  lane: daemonServiceLaneSchema,
  daemonSessionId: z.string().min(1),
  acceptingDispatches: z.boolean().optional(),
  admissionEvidence: runtimeTransportAdmissionEvidenceSchema.optional(),
  stopCause: runtimeTransportStopCauseSchema.optional(),
  serviceVersion: z.string().trim().min(1).optional(),
  leases: z.array(runtimeTransportLeaseSchema).max(512),
  capabilities: runtimeTransportCapabilitiesSchema.optional(),
  runtimeContract: daemonRuntimeContractSchema.optional(),
  sentAtMs: z.number().int().nonnegative(),
});

export const runtimeTransportHeartbeatResponseSchema = z.strictObject({
  ok: z.boolean(),
  serverNowMs: z.number().int().nonnegative(),
  staleLeases: z.array(runtimeTransportLeaseSchema),
  reasonCode: runtimeTransportErrorCodeSchema.optional(),
});

export const runtimeTransportRouteCatalogChangedReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(100);

export const runtimeTransportRouteCatalogChangedFramePayloadSchema =
  z.strictObject({
    reason: runtimeTransportRouteCatalogChangedReasonSchema,
  });

export const runtimeTransportNotifyRouteCatalogChangedRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    reason: runtimeTransportRouteCatalogChangedReasonSchema,
    // When the caller knows exactly which profiles a catalog change affects
    // (e.g. one binding write), the readiness invalidation narrows to them
    // instead of every profile in the owner's sessions. Absent means the
    // caller cannot scope the change and the full fan-out is kept.
    affectedProfileIds: z.array(z.string().trim().min(1)).max(200).optional(),
  });

export const runtimeTransportNotifyRouteCatalogChangedResponseSchema =
  z.strictObject({
    ok: z.boolean(),
    notifiedSessions: z.number().int().nonnegative(),
  });

export const runtimeTransportLookupOwnerServiceRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  ownerUserId: z.string().min(1),
});

const runtimeTransportLiveSessionSchema = z.strictObject({
  daemonSessionId: z.string().min(1),
  deviceId: z.string().min(1),
  lane: daemonServiceLaneSchema,
  serviceVersion: z.string().trim().min(1).nullable().optional(),
  connectionGeneration: z.number().int().positive(),
  lastHeartbeatMs: z.number().int().nonnegative(),
  capabilities: runtimeTransportCapabilitiesSchema,
  executionCompatibility: daemonExecutionCompatibilitySchema,
});

export const runtimeTransportLookupOwnerServiceResponseSchema =
  z.discriminatedUnion("online", [
    z.strictObject({
      online: z.literal(true),
      sessions: z.array(runtimeTransportLiveSessionSchema).min(1),
    }),
    z.strictObject({
      online: z.literal(false),
      reasonCode: runtimeTransportErrorCodeSchema,
    }),
  ]);

export const runtimeTransportSocketDisconnectClassSchema = z.enum([
  "abnormal_socket_close",
  "normal_shutdown",
  "possible_deploy_or_edge_restart",
]);

export const runtimeTransportSocketCloseReasonCodeSchema = z.enum([
  "abnormal_closure",
  "going_away",
  "normal_closure",
  "other",
  "socket_error",
]);

export const runtimeTransportSocketDisconnectRateBucketSchema = z.strictObject({
  hourStartMs: z.number().int().nonnegative(),
  disconnectClass: runtimeTransportSocketDisconnectClassSchema,
  deployAdjacentReason: z.string().trim().min(1).max(100).nullable(),
  count: z.number().int().positive(),
  firstObservedAtMs: z.number().int().nonnegative(),
  lastObservedAtMs: z.number().int().nonnegative(),
});

export const runtimeTransportSessionDisconnectDiagnosticSchema = z.strictObject(
  {
    closeCode: z.number().int().nonnegative().max(4999),
    closeReasonCode: runtimeTransportSocketCloseReasonCodeSchema,
    connectedAtMs: z.number().int().nonnegative(),
    connectionGeneration: z.number().int().positive(),
    daemonSessionId: z.string().min(1).max(128),
    deployAdjacentReason: z.string().trim().min(1).max(100).nullable(),
    deviceId: z.string().min(1).max(128),
    disconnectedAtMs: z.number().int().nonnegative(),
    disconnectClass: runtimeTransportSocketDisconnectClassSchema,
    durationMs: z.number().int().nonnegative(),
    heartbeatAgeMs: z.number().int().nonnegative(),
    lane: daemonServiceLaneSchema,
    lastHeartbeatMs: z.number().int().nonnegative(),
    profileCount: z.number().int().nonnegative(),
    profileIds: z.array(z.string().min(1).max(128)).max(20),
    serviceVersion: z.string().trim().min(1).max(64).nullable(),
    wasClean: z.boolean(),
  }
);

export const runtimeTransportDisconnectRatesResponseSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      ok: z.literal(true),
      ownerUserId: z.string().min(1).nullable(),
      windowMs: z.number().int().nonnegative(),
      buckets: z.array(runtimeTransportSocketDisconnectRateBucketSchema),
      recentSessions: z
        .array(runtimeTransportSessionDisconnectDiagnosticSchema)
        .max(20)
        .optional(),
    }),
    z.strictObject({
      ok: z.literal(false),
      reasonCode: z.string().trim().min(1),
      buckets: z
        .array(runtimeTransportSocketDisconnectRateBucketSchema)
        .length(0),
      recentSessions: z
        .array(runtimeTransportSessionDisconnectDiagnosticSchema)
        .length(0)
        .optional(),
    }),
  ]);

export const runtimeTransportSetLocalAgentEnabledRequestSchema = z.strictObject(
  {
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    agentId: z.string().trim().min(1).max(256),
    enabled: z.boolean(),
  }
);

export const runtimeTransportSetLocalAgentEnabledResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("accepted"),
      payload: openMeldDaemonSetLocalAgentEnabledPayloadSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const runtimeTransportManageLocalAgentInstallationRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    request: openMeldDaemonManageLocalAgentInstallationRequestPayloadSchema,
  });

export const runtimeTransportManageLocalAgentInstallationResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("accepted"),
      payload: openMeldDaemonManageLocalAgentInstallationPayloadSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const runtimeTransportOpenMeldToolsControlRequestSchema = z.strictObject(
  {
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    requestId: z.string().min(1),
    request: openMeldToolsControlRequestSchema,
  }
);

export const runtimeTransportOpenMeldToolsControlResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("accepted"),
      result: openMeldToolsControlResultSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const runtimeTransportRefreshLocalAgentCatalogRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    reason: z.string().trim().min(1).max(120),
  });

export const runtimeTransportRefreshLocalAgentCatalogResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("accepted"),
      payload: openMeldDaemonSyncRouteCatalogPayloadSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const runtimeTransportSetProfileWorkspaceRequestSchema =
  profileWorkspaceWriteSchema.safeExtend({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    targetProfileId: agentProfileIdSchema,
  });

export const runtimeTransportSetProfileWorkspaceResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("accepted"),
      payload: openMeldDaemonSetProfileWorkspacePayloadSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const runtimeTransportReadProfileWorkspaceRequestSchema = z.strictObject(
  {
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    targetProfileId: agentProfileIdSchema,
  }
);

export const runtimeTransportReadProfileWorkspaceResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("accepted"),
      payload: openMeldDaemonReadProfileWorkspacePayloadSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const runtimeTransportManageProfileFoldersRequestSchema = z.strictObject(
  {
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    targetProfileId: agentProfileIdSchema,
    operation: profileFolderOperationSchema,
  }
);

export const runtimeTransportManageProfileFoldersResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("accepted"),
      payload: openMeldDaemonManageProfileFoldersPayloadSchema,
      record: profileFolderProjectionRecordSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

export const runtimeTransportReadProfileFolderProjectionRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    targetProfileId: agentProfileIdSchema,
  });

export const runtimeTransportReadProfileFolderProjectionResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("found"),
      record: profileFolderProjectionRecordSchema,
    }),
    z.strictObject({ status: z.literal("not_recorded") }),
    z.strictObject({
      status: z.literal("rejected"),
      reasonCode: z.string().min(1),
      message: z.string().min(1),
    }),
  ]);

const agentSessionForkOperationSchema = z.strictObject({
  agentControllerRef: agentControllerRefSchema,
  operationId: z.string().trim().min(1).max(256),
  organizationId: z.string().trim().min(1).max(256),
  profileName: z.string().trim().min(1).max(MAX_PROFILE_NAME_LENGTH),
  projectId: z.string().trim().min(1).max(256),
  sourceNativeSessionId: z.string().trim().min(1).max(512),
});

export const runtimeTransportForkAgentSessionRequestSchema =
  agentSessionForkOperationSchema.extend({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().trim().min(1),
    deviceId: z.string().trim().min(1),
    lane: daemonServiceLaneSchema,
  });

export const runtimeTransportForkAgentSessionResultSchema =
  z.discriminatedUnion("status", [
    agentSessionForkOperationSchema.extend({
      childNativeSessionId: z.string().trim().min(1).max(512),
      status: z.literal("completed"),
    }),
    agentSessionForkOperationSchema.extend({
      message: z.string().trim().min(1).max(1000),
      reasonCode: z.string().trim().min(1).max(256),
      status: z.literal("rejected"),
    }),
    agentSessionForkOperationSchema.extend({
      message: z.string().trim().min(1).max(1000),
      reasonCode: z.string().trim().min(1).max(256),
      status: z.literal("outcome_unknown"),
    }),
  ]);

export const runtimeTransportLocalAgentControlForkSessionFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    request: agentSessionForkOperationSchema,
  });

export const runtimeTransportLocalAgentControlSetEnabledFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonSetLocalAgentEnabledRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonManageLocalAgentInstallationRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonSyncRouteCatalogRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonSetProfileWorkspaceRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlReadProfileWorkspaceFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonReadProfileWorkspaceRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlManageProfileFoldersFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonManageProfileFoldersRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlCancelFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonCancelRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlInterruptFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: openMeldDaemonInterruptRequestPayloadSchema,
  });

export const runtimeTransportLocalAgentControlResultFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    payload: z.union([
      openMeldDaemonManageLocalAgentInstallationPayloadSchema,
      openMeldDaemonSetLocalAgentEnabledPayloadSchema,
      openMeldDaemonSetProfileWorkspacePayloadSchema,
      openMeldDaemonReadProfileWorkspacePayloadSchema,
      openMeldDaemonManageProfileFoldersPayloadSchema,
      openMeldDaemonSyncRouteCatalogPayloadSchema,
      openMeldDaemonCancelPayloadSchema,
      openMeldDaemonInterruptPayloadSchema,
      runtimeTransportForkAgentSessionResultSchema,
    ]),
  });

export const runtimeTransportOpenMeldToolsControlFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    request: openMeldToolsControlRequestSchema,
  });

export const runtimeTransportOpenMeldToolsControlResultFramePayloadSchema =
  z.strictObject({
    requestId: z.string().min(1),
    result: openMeldToolsControlResultSchema,
  });

export const runtimeTransportInspectExecutionRecoveryRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().trim().min(1),
    identity: executionRecoveryIdentitySchema,
    destination: executionRecoveryDestinationSchema,
  });

export const runtimeTransportInspectExecutionRecoveryResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("available"),
      exactAssociationVerified: z.literal(true),
      serviceSupportsResume: z.literal(true),
      identity: executionRecoveryIdentitySchema,
      reasonCode: z.literal(
        "execution_recovery.exact_controller_conversation_available"
      ),
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      exactAssociationVerified: z.boolean(),
      identity: executionRecoveryIdentitySchema.nullable(),
      serviceSupportsResume: z.boolean(),
      reasonCode: z.string().trim().min(1),
    }),
  ]);

export const runtimeTransportResumeControllerConversationRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    identity: executionRecoveryIdentitySchema,
    destination: executionRecoveryDestinationSchema,
    providerRuntimeWorkingDirectory: z.string().trim().min(1).max(4096),
  });

export const runtimeTransportResumeControllerConversationFramePayloadSchema =
  z.strictObject({
    requestId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    identity: executionRecoveryIdentitySchema,
    destination: executionRecoveryDestinationSchema,
    providerRuntimeWorkingDirectory: z.string().trim().min(1).max(4096),
    sourceEventId: z.string().trim().min(1),
    transportMode: runtimeTransportModeSchema,
  });

export const runtimeTransportResumeControllerConversationResultSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("completed"),
      operationId: z.string().trim().min(1),
      identity: executionRecoveryIdentitySchema,
      destination: executionRecoveryDestinationSchema,
      output: z.string().trim().min(1),
      agentControllerConversationId: z.string().trim().min(1),
    }),
    z.strictObject({
      status: z.enum(["outcome_unknown", "rejected"]),
      operationId: z.string().trim().min(1),
      identity: executionRecoveryIdentitySchema,
      destination: executionRecoveryDestinationSchema,
      reasonCode: z.string().trim().min(1),
      message: z.string().trim().min(1),
    }),
  ]);

export const runtimeTransportResumeControllerConversationResultFramePayloadSchema =
  z.strictObject({
    requestId: z.string().trim().min(1),
    result: runtimeTransportResumeControllerConversationResultSchema,
  });

export const runtimeTransportResumeControllerConversationResponseSchema =
  runtimeTransportResumeControllerConversationResultSchema;

export const runtimeTransportLookupRouteRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  ownerUserId: z.string().min(1),
  profileId: z.string().min(1),
});

export const runtimeTransportLookupRouteOwnerServiceEvidenceSchema =
  z.strictObject({
    daemonSessionId: z.string().min(1),
    deviceId: z.string().min(1),
    lane: daemonServiceLaneSchema,
    serviceVersion: z.string().trim().min(1).nullable().optional(),
    connectionGeneration: z.number().int().positive(),
    lastHeartbeatMs: z.number().int().nonnegative(),
    capabilities: runtimeTransportCapabilitiesSchema,
    executionCompatibility: daemonExecutionCompatibilitySchema,
  });

export const runtimeTransportLookupRouteResponseSchema = z.discriminatedUnion(
  "online",
  [
    z.strictObject({
      online: z.literal(true),
      acceptingDispatches: z.boolean().optional(),
      stopCause: runtimeTransportStopCauseSchema.optional(),
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
      // ServiceRuntime liveness evidence: present iff the lease is still fresh
      // (the socket may be mid-replacement), absent once the lease is reaped
      // past the TTL. This heartbeat/lease signal is the liveness evidence used
      // by Wake availability projections: a fresh lease with a missing socket
      // stays Checking; a reaped lease or missing heartbeat is stable Offline.
      // Socket delivery evidence and delivery-disconnect timestamps are
      // diagnostic/restoration evidence only; they do not decide Wake
      // availability.
      lastHeartbeatMs: z.number().int().nonnegative().optional(),
      // Fresh owner-service evidence is separate from a per-profile route lease.
      // It means the owner's OpenMeld Service is online, but this profile has not
      // produced its first route lease/report yet. Readiness maps that to
      // pending/checking only when downstream service alignment also matches.
      ownerService:
        runtimeTransportLookupRouteOwnerServiceEvidenceSchema.optional(),
      executionCompatibility: daemonExecutionCompatibilitySchema.optional(),
      localWakeRouteReport: localWakeRouteReportSchema.optional(),
      rejectedProfileRegistration:
        runtimeTransportRejectedProfileRegistrationSchema.optional(),
    }),
  ]
);

export const runtimeTransportLookupRoutesBatchRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  ownerUserId: z.string().min(1),
  profileIds: z.array(z.string().min(1)).min(1).max(100),
});

export const runtimeTransportLookupRoutesBatchResponseSchema = z.strictObject({
  routes: z.record(z.string(), runtimeTransportLookupRouteResponseSchema),
});

export const runtimeTransportDispatchSourceSignalSchema = z.strictObject({
  profileId: z.string().min(1).nullable(),
  profileKind: z.enum(["agent", "human", "system"]).nullable(),
  profileHandle: profileHandleSchema.optional(),
  profileMentionLabel: spaceMentionLabelSchema.optional(),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export const runtimeTransportDeliverDispatchPayloadSchema = z.strictObject({
  // Core identity/delegation projection for this Wake, never a permission grant.
  requesterIsAgentOwner: z.boolean().optional(),
  // A colleague's Wake on a harness without Execution Contexts: never resume
  // or record the Binding or ledger conversation (§4.3). Core sends it only
  // to a Service that declares requesterConversationIsolation.
  separateRequesterConversation: z.literal(true).optional(),
  runtimeCoordinatorExecutionId:
    runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId,
  executionToken: runtimeCoordinatorExecutionTokenEnvelopeSchema.optional(),
  attemptId: z.string().min(1),
  dispatchId: z.string().min(1),
  executionIdentity: runtimeTransportDeliveryExecutionIdentitySchema,
  taskId: z.string().min(1),
  spaceId: z.string().min(1),
  sourceEventId: z.string().min(1),
  sourceClientMessageId: z.string().min(1).max(200).nullable().optional(),
  sourceSignal: runtimeTransportDispatchSourceSignalSchema,
  targetProfileId: z.string().min(1),
  defaultProjectId: z.string().trim().min(1).optional(),
  organizationProtectedInformation:
    organizationProtectedInformationSchema.optional(),
  workingLanguage: workingLanguageGuidanceSchema.optional(),
  // Only for a Wake Core verified as owner-requested; never a permission grant.
  permissionModeAdvisory: permissionModeAdvisorySchema.optional(),
  dispatchContractVersion: z.number().int().positive(),
  dispatchPolicy: runtimeDispatchPolicySchema,
  controllerSnapshot: openMeldDaemonDispatchControllerSnapshotSchema,
  contextIdMappingSpec:
    runtimeAgentControllerConversationIdMappingSpecSchema.nullable(),
  dispatchRulesSnapshot: openMeldDaemonDispatchRulesSnapshotSchema,
  spaceContractSnapshot: spaceContractSchema.optional(),
  continuitySnapshot: openMeldDaemonDispatchContinuitySnapshotSchema.optional(),
  enqueuedAtMs: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1),
  spacePassword: spacePasswordSchema.optional(),
  targetProfileName: z.string().min(1).max(MAX_PROFILE_NAME_LENGTH).optional(),
  targetProfileMentionLabel: spaceMentionLabelSchema.optional(),
  targetProfileIsCenterAgent: z.boolean().optional(),
  agentControllerConversationId: z.string().trim().min(1).optional(),
  executionContext: executionContextTaskSchema.optional(),
  deliveryRecoveryReason:
    openMeldDaemonDispatchDeliveryRecoveryReasonSchema.optional(),
  dispatchChainId: z.string().min(1).optional(),
  autoRelayDepth: z.number().int().nonnegative().optional(),
  visitedProfileIds: z.array(z.string().min(1)).max(256).optional(),
  visitedProfileIdsHash: z.string().min(1).optional(),
  transportMode: runtimeTransportModeSchema.nullable().optional(),
  streamingMode: runtimeStreamingModeSchema.optional(),
  sourceSignalSnapshot:
    openMeldDaemonDispatchSourceSignalSnapshotSchema.optional(),
  sourceMessageEnvelope: messageEnvelopeSchema.optional(),
  replyToSnapshot: openMeldDaemonDispatchReplyToSnapshotSchema.optional(),
  threadContext: spaceThreadContextSchema.optional(),
  spaceNameSnapshot: z.string().min(1).nullable().optional(),
});

export const runtimeTransportDeliverDispatchRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  dispatchId: z.string().min(1),
  attemptId: z.string().min(1),
  ownerUserId: z.string().min(1),
  profileId: z.string().min(1),
  daemonSessionId: z.string().min(1),
  connectionGeneration: z.number().int().positive(),
  leaseEpoch: z.number().int().positive(),
  deliveryRecoveryReason:
    openMeldDaemonDispatchDeliveryRecoveryReasonSchema.optional(),
  payload: runtimeTransportDeliverDispatchPayloadSchema,
});

export const runtimeTransportDeliverDispatchResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      accepted: z.literal(true),
      status: z.literal("delivered"),
    }),
    z.strictObject({
      accepted: z.literal(true),
      status: z.literal("already_pending"),
      existingAttemptId: z.string().min(1),
    }),
    z.strictObject({
      accepted: z.literal(true),
      status: z.literal("already_completed"),
      completedAttemptId: z.string().min(1),
    }),
    z.strictObject({
      accepted: z.literal(false),
      status: z.literal("rejected"),
      reasonCode: runtimeTransportErrorCodeSchema,
    }),
  ]);

export const runtimeTransportWaitDispatchResultRequestSchema = z.strictObject({
  dispatchId: z.string().min(1),
  attemptId: z.string().min(1),
  daemonSessionId: z.string().min(1),
  connectionGeneration: z.number().int().positive(),
  leaseEpoch: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(),
});

const runtimeCoordinatorDecisionReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(160);

export const runtimeTransportRuntimeCoordinatorDecisionEventKindSchema = z.enum(
  ["owner_conflict", "reclaim", "retry", "timeout"]
);

export const runtimeTransportRuntimeCoordinatorDecisionTriggerSchema = z.enum([
  "alarm",
  "daemon",
  "queue",
]);

export const runtimeTransportRuntimeCoordinatorDecisionRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape
        .runtimeCoordinatorExecutionId,
    dispatchId: z.string().min(1),
    spaceId: z.string().min(1),
    targetProfileId: z.string().min(1),
    sourceClientMessageId: z.string().min(1).max(200).nullable(),
    attemptId: z.string().min(1).nullable().optional(),
    claimDecision: z
      .enum([
        "continue_existing",
        "reset_existing",
        "claim_recovery",
        "claim_existing_inside_window",
        "reclaim_stale_dispatching",
        "reclaim_stale_queued",
      ])
      .optional(),
    eventKind: runtimeTransportRuntimeCoordinatorDecisionEventKindSchema,
    idempotencyKey: z.string().min(1).max(512),
    observedRunId: z.string().min(1).nullable().optional(),
    reasonCode: runtimeCoordinatorDecisionReasonCodeSchema.optional(),
    trigger: runtimeTransportRuntimeCoordinatorDecisionTriggerSchema,
  });

export const runtimeTransportRuntimeCoordinatorDecisionResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      ok: z.literal(true),
      status: z.enum(["already_recorded", "recorded"]),
      action: z.enum([
        "diagnostic_only",
        "keep_waiting",
        "owner_conflict_terminal",
        "redeliver_current_run",
        "redelivery_deferred",
        "reclaim_blocked",
        "retry_blocked",
        "retry_run_issued",
        "terminal_failed",
        "timeout_terminal",
      ]),
      reasonCode: runtimeCoordinatorDecisionReasonCodeSchema,
      runtimeCoordinatorExecutionId:
        runtimeCoordinatorExecutionRecordSchema.shape
          .runtimeCoordinatorExecutionId,
    }),
    z.strictObject({
      ok: z.literal(false),
      status: z.literal("retry_later"),
      reasonCode: runtimeCoordinatorDecisionReasonCodeSchema,
      runtimeCoordinatorExecutionId:
        runtimeCoordinatorExecutionRecordSchema.shape
          .runtimeCoordinatorExecutionId,
    }),
  ]);

export const runtimeTransportRuntimeCoordinatorWakeStopRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape
        .runtimeCoordinatorExecutionId,
    dispatchId: z.string().min(1),
    spaceId: z.string().min(1),
    sourceClientMessageId: z.string().min(1).max(200).nullable(),
    targetProfileId: z.string().min(1),
    reason: z.string().trim().min(1).max(512).optional(),
  });

export const runtimeTransportRuntimeCoordinatorWakeStopResponseSchema =
  postSpaceWakeStopResponseSchema;

export const runtimeTransportDeletedAgentProfileWakeCancellationRequestSchema =
  z.strictObject({
    ownerUserId: z.string().trim().min(1).max(256),
    targetProfileId: agentProfileIdSchema,
  });

export const runtimeTransportRuntimeCoordinatorHeadPreAgentStopReasonCodeSchema =
  z.enum(["runtime_coordinator.pre_agent_stop_requested"]);

export const runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    dispatchId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(512),
    reason: z.string().trim().min(1).max(512).optional(),
    targetProfileMentionLabel: spaceMentionLabelSchema.optional(),
    targetProfileName: z
      .string()
      .min(1)
      .max(MAX_PROFILE_NAME_LENGTH)
      .optional(),
    targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
  });

export const runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      ok: z.literal(true),
      primaryDispatchId: z.string().min(1),
      publicationIntentId: z.string().min(1).max(4096),
      reasonCode:
        runtimeTransportRuntimeCoordinatorHeadPreAgentStopReasonCodeSchema,
      runtimeCoordinatorExecutionId: z.null(),
      status: z.enum(["stopped_before_execution", "already_stopped"]),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
    z.strictObject({
      ok: z.literal(false),
      primaryDispatchId: z.string().min(1).nullable(),
      publicationIntentId: z.string().min(1).max(4096).nullable(),
      reasonCode: z.string().min(1).max(160),
      runtimeCoordinatorExecutionId:
        runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.nullable(),
      status: z.enum(["conflict", "execution_linked", "retry_later"]),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
  ]);

export const runtimeTransportDeletedAgentProfileWakeCancellationResponseSchema =
  z.strictObject({
    executionStopOutcomes: z.array(
      runtimeTransportRuntimeCoordinatorWakeStopResponseSchema
    ),
    headStopOutcomes: z.array(
      runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema
    ),
    status: z.enum([
      "inactive",
      "cancellation_requested",
      "partially_requested",
      "unavailable",
    ]),
    targetProfileId: agentProfileIdSchema,
  });

export const runtimeTransportRuntimeCoordinatorHeadAcceptActionSchema = z.enum([
  "create_execution",
  "skip_duplicate",
  "wait_in_queue",
]);

export const runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    dispatchId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(512),
    acceptedDispatchSnapshot:
      openMeldDaemonAcceptedDispatchSnapshotSchema.optional(),
    targetProfileMentionLabel: spaceMentionLabelSchema.optional(),
    targetProfileName: z
      .string()
      .min(1)
      .max(MAX_PROFILE_NAME_LENGTH)
      .optional(),
    targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
  });

export const runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      executionContext: executionContextTaskSchema.optional(),
      acceptedDispatchSnapshot:
        openMeldDaemonAcceptedDispatchSnapshotSchema.optional(),
      action: runtimeTransportRuntimeCoordinatorHeadAcceptActionSchema,
      ok: z.literal(true),
      primaryDispatchId: z.string().min(1),
      reasonCode: z.string().min(1).max(160),
      runtimeCoordinatorExecutionId:
        runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.nullable(),
      status: z.enum([
        "accepted",
        "already_accepted",
        "execution_linked",
        "publication_intent_ready",
        "stopped_before_execution",
      ]),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
    z.strictObject({
      acceptedDispatchSnapshot:
        openMeldDaemonAcceptedDispatchSnapshotSchema.optional(),
      action: z.literal("wait_in_queue"),
      ok: z.literal(true),
      primaryDispatchId: z.string().min(1),
      queuePosition: z.number().int().positive().max(50),
      reasonCode: z.literal("agent_profile_work_coordinator.queued"),
      runtimeCoordinatorExecutionId: z.null(),
      status: z.literal("queued"),
      targetWakeLifecycleId: z.string().min(1).max(2048),
      waitingCount: z.number().int().positive().max(50),
    }),
    z.strictObject({
      ok: z.literal(false),
      primaryDispatchId: z.string().min(1).nullable(),
      reasonCode: z.string().min(1).max(160),
      status: z.enum(["conflict", "retry_later"]),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
    z.strictObject({
      ok: z.literal(false),
      primaryDispatchId: z.null(),
      reasonCode: z.literal("agent_profile_work_coordinator.queue_full"),
      status: z.literal("queue_full"),
      targetWakeLifecycleId: z.string().min(1).max(2048),
      waitingCount: z.literal(50),
    }),
  ]);

export const runtimeTransportRuntimeCoordinatorHeadLifecycleStatusSchema =
  z.enum([
    "accepted",
    "execution_linked",
    "publication_intent_ready",
    "queued",
    "stopped_before_execution",
    "waiting",
  ]);

export const runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema =
  z.string().trim().min(1).max(160);

export const runtimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategorySchema =
  z.enum([
    "space_access_unavailable",
    "binding_required",
    "agent_profile_unavailable",
    "local_agent_unavailable",
    "local_connection_mismatch",
    "provider_access_unavailable",
    "provider_usage_unavailable",
    "service_not_connected",
    "update_required",
    "wake_route_registration_pending",
    "workspace_unavailable",
  ]);

export const runtimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryActionSchema =
  z.enum([
    "send_new_wake",
    "set_up_agent_binding",
    "enable_agent_binding",
    "repair_agent_binding",
    "authorize_agent_binding_for_organization",
    "check_status",
    "connect_local_agent",
    "enable_local_agent",
    "reconnect_agent_binding",
    "review_agent_settings",
    "start_or_restart_openmeld_service",
    "update_openmeld_service",
    "wait_for_usage_report",
    "wait_for_usage_reset",
    "wait_for_wake_route_report",
  ]);

export const runtimeTransportRuntimeCoordinatorHeadNoExecutionDecisionSourceSchema =
  z.enum([
    "dispatch_preflight",
    "dispatch_delivery_pre_execution",
    "runtime_coordinator_head_waiting_deadline",
  ]);

export const runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    ownerUserId: z.string().min(1),
    dispatchId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(512),
    decisionSource:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionDecisionSourceSchema.optional(),
    reasonCode:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema,
    publicationCategory:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategorySchema,
    userRecoveryAction:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryActionSchema,
    targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
  });

export const runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      ok: z.literal(true),
      primaryDispatchId: z.string().min(1),
      publicationIntentId: z.string().min(1).max(4096),
      reasonCode:
        runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema,
      runtimeCoordinatorExecutionId: z.null(),
      status: z.enum(["publication_intent_ready", "already_recorded"]),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
    z.strictObject({
      ok: z.literal(false),
      primaryDispatchId: z.string().min(1).nullable(),
      publicationIntentId: z.string().min(1).max(4096).nullable(),
      reasonCode: z.string().min(1).max(160),
      runtimeCoordinatorExecutionId: z.null(),
      status: z.enum(["conflict", "retry_later"]),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
  ]);

export const runtimeTransportRuntimeCoordinatorHeadWaitingReasonCodeSchema =
  z.enum([
    "wake.device_wait.access_check_unavailable",
    "daemon.service.draining",
    "daemon.profile.offline",
    "daemon.profile.pending_first_report",
    "wake.device_wait.readiness_checking",
  ]);

export const runtimeTransportRuntimeCoordinatorHeadWaitingCategorySchema =
  z.enum([
    "space_access_unavailable",
    "service_not_connected",
    "wake_route_registration_pending",
    "local_agent_unavailable",
  ]);

export const runtimeTransportRuntimeCoordinatorHeadWaitingRecoveryActionSchema =
  z.enum([
    "start_or_restart_openmeld_service",
    "wait_for_wake_route_report",
    "check_status",
  ]);

const runtimeCoordinatorOfflineWaitingDecisionShape = {
  reasonCode: z.literal("daemon.profile.offline"),
  userRecoveryAction: z.literal("start_or_restart_openmeld_service"),
  waitingCategory: z.literal("service_not_connected"),
} as const;

const runtimeCoordinatorPendingFirstReportWaitingDecisionShape = {
  reasonCode: z.literal("daemon.profile.pending_first_report"),
  userRecoveryAction: z.literal("wait_for_wake_route_report"),
  waitingCategory: z.literal("wake_route_registration_pending"),
} as const;

const runtimeCoordinatorReadinessWaitingDecisionShape = {
  reasonCode: z.enum([
    "wake.device_wait.readiness_checking",
    "daemon.service.draining",
  ]),
  userRecoveryAction: z.literal("check_status"),
  waitingCategory: z.literal("local_agent_unavailable"),
} as const;

const runtimeCoordinatorAccessWaitingDecisionShape = {
  reasonCode: z.literal("wake.device_wait.access_check_unavailable"),
  userRecoveryAction: z.literal("check_status"),
  waitingCategory: z.literal("space_access_unavailable"),
} as const;

const runtimeCoordinatorHeadWaitingBoundaryCommonShape = {
  deadlineAtMs: z.number().int().nonnegative(),
  deadlineOutcome: z.literal("publication_intent_ready"),
  observedAtMs: z.number().int().nonnegative(),
  softDeadlineAtMs: z.number().int().nonnegative(),
  triggerOwner: z.literal("runtime_coordinator"),
  waitingSinceMs: z.number().int().nonnegative(),
} as const;

const runtimeTransportRuntimeCoordinatorHeadWaitingBoundarySchema =
  z.discriminatedUnion("reasonCode", [
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingBoundaryCommonShape,
      ...runtimeCoordinatorAccessWaitingDecisionShape,
      trigger: z.literal("space_access_rechecked"),
      userVisibleState: z.literal("waiting_for_space_access"),
      waitingFor: z.literal("space_access_check"),
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingBoundaryCommonShape,
      ...runtimeCoordinatorReadinessWaitingDecisionShape,
      trigger: z.literal("agent_readiness_reported"),
      userVisibleState: z.literal("waiting_for_agent_readiness"),
      waitingFor: z.literal("agent_readiness_report"),
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingBoundaryCommonShape,
      ...runtimeCoordinatorOfflineWaitingDecisionShape,
      trigger: z.literal("openmeld_service_route_connected"),
      userVisibleState: z.literal("waiting_for_openmeld_service"),
      waitingFor: z.literal("openmeld_service_route_connection"),
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingBoundaryCommonShape,
      ...runtimeCoordinatorPendingFirstReportWaitingDecisionShape,
      trigger: z.literal("wake_route_reported"),
      userVisibleState: z.literal("waiting_for_wake_route_report"),
      waitingFor: z.literal("wake_route_report"),
    }),
  ]);

const runtimeCoordinatorHeadWaitingRequestCommonShape = {
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  ownerUserId: z.string().min(1),
  dispatchId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(512),
  observedAtMs: z.number().int().nonnegative(),
  targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
} as const;

export const runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema =
  z.discriminatedUnion("reasonCode", [
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingRequestCommonShape,
      ...runtimeCoordinatorAccessWaitingDecisionShape,
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingRequestCommonShape,
      ...runtimeCoordinatorReadinessWaitingDecisionShape,
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingRequestCommonShape,
      ...runtimeCoordinatorOfflineWaitingDecisionShape,
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingRequestCommonShape,
      ...runtimeCoordinatorPendingFirstReportWaitingDecisionShape,
    }),
  ]);

const runtimeCoordinatorHeadWaitingResponseCommonShape = {
  deadlineAtMs: z.number().int().nonnegative(),
  nextTriggerAtMs: z.number().int().nonnegative(),
  ok: z.literal(true),
  primaryDispatchId: z.string().min(1),
  runtimeCoordinatorExecutionId: z.null(),
  softDeadlineAtMs: z.number().int().nonnegative(),
  status: z.literal("waiting"),
  targetWakeLifecycleId: z.string().min(1).max(2048),
} as const;

export const runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema =
  z.union([
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingResponseCommonShape,
      ...runtimeCoordinatorAccessWaitingDecisionShape,
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingResponseCommonShape,
      ...runtimeCoordinatorReadinessWaitingDecisionShape,
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingResponseCommonShape,
      ...runtimeCoordinatorOfflineWaitingDecisionShape,
    }),
    z.strictObject({
      ...runtimeCoordinatorHeadWaitingResponseCommonShape,
      ...runtimeCoordinatorPendingFirstReportWaitingDecisionShape,
    }),
    z.strictObject({
      ok: z.literal(true),
      primaryDispatchId: z.string().min(1),
      publicationIntentId: z.string().min(1).max(4096),
      reasonCode:
        runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema,
      runtimeCoordinatorExecutionId: z.null(),
      status: z.literal("publication_intent_ready"),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
    z.strictObject({
      ok: z.literal(false),
      primaryDispatchId: z.string().min(1).nullable(),
      reasonCode: z.string().min(1).max(160),
      runtimeCoordinatorExecutionId: z.null(),
      status: z.enum(["conflict", "retry_later"]),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
  ]);

const runtimeTransportRuntimeCoordinatorHeadNoExecutionDecisionTraceSchema =
  z.strictObject({
    decidedAtMs: z.int().min(0),
    publicationCategory:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategorySchema,
    reasonCode:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema,
    source:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionDecisionSourceSchema,
    userRecoveryAction:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryActionSchema,
  });

const runtimeTransportRuntimeCoordinatorHeadPublicationIntentTraceSchema =
  z.union([
    z.strictObject({
      intentId: z.string().min(1).max(4096),
      kind: z.literal("no_execution_failure"),
      publicationCategory:
        runtimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategorySchema,
      readyAtMs: z.int().min(0),
      reasonCode:
        runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema,
      status: z.literal("ready_for_phase_6"),
      userRecoveryAction:
        runtimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryActionSchema,
    }),
    z.strictObject({
      intentId: z.string().min(1).max(4096),
      kind: z.literal("stopped_notice"),
      readyAtMs: z.int().min(0),
      reasonCode:
        runtimeTransportRuntimeCoordinatorHeadPreAgentStopReasonCodeSchema,
      status: z.literal("ready_for_phase_6"),
    }),
  ]);

const runtimeTransportRuntimeCoordinatorHeadPublicationOutcomeTraceSchema =
  z.strictObject({
    failurePublicationCommandId: z.string().min(1).max(4096),
    finalMessageKind: z
      .enum(["failure_notice", "status", "success_reply", "unknown"])
      .nullable(),
    observedAtMs: z.int().min(0),
    publicationErrorCode: z.string().min(1).max(160).nullable(),
    publishedSignalId: z.string().min(1).nullable(),
    status: z.enum([
      "failure_published",
      "already_final",
      "failure_publication_failed",
    ]),
  });

const runtimeTransportRuntimeCoordinatorHeadPublicationExhaustionTraceSchema =
  z.strictObject({
    attemptCount: z.int().positive(),
    exhaustedAtMs: z.int().min(0),
    lastFailureAtMs: z.int().min(0),
    lastReasonCode: z.string().min(1).max(160),
    reasonCode: z.literal("runtime_coordinator.publication_retry_exhausted"),
    status: z.literal("publication_exhausted"),
  });

const runtimeTransportRuntimeCoordinatorHeadTargetDisplayTraceSchema =
  z.strictObject({
    targetProfileMentionLabel: spaceMentionLabelSchema.nullable(),
    targetProfileName: z
      .string()
      .min(1)
      .max(MAX_PROFILE_NAME_LENGTH)
      .nullable(),
  });

export const runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRecordSchema =
  z.strictObject({
    createdAtMs: z.int().min(0),
    duplicateDispatchCount: z.int().min(0),
    executionLinkedAtMs: z.int().min(0).nullable(),
    modelVersion: z.literal("openmeld.runtime_coordinator.head_lifecycle.v1"),
    noExecutionDecision: z.union([
      runtimeTransportRuntimeCoordinatorHeadNoExecutionDecisionTraceSchema,
      z.null(),
    ]),
    ownerUserId: z.string().min(1),
    primaryDispatchId: z.string().min(1),
    publicationIntent: z.union([
      runtimeTransportRuntimeCoordinatorHeadPublicationIntentTraceSchema,
      z.null(),
    ]),
    publicationExhaustion:
      runtimeTransportRuntimeCoordinatorHeadPublicationExhaustionTraceSchema.optional(),
    publicationOutcome:
      runtimeTransportRuntimeCoordinatorHeadPublicationOutcomeTraceSchema.optional(),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.nullable(),
    status: runtimeTransportRuntimeCoordinatorHeadLifecycleStatusSchema,
    targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
    targetWakeLifecycleId: z.string().min(1).max(2048),
    targetDisplay:
      runtimeTransportRuntimeCoordinatorHeadTargetDisplayTraceSchema.optional(),
    updatedAtMs: z.int().min(0),
    waitingBoundary: z.union([
      runtimeTransportRuntimeCoordinatorHeadWaitingBoundarySchema,
      z.null(),
    ]),
  });

export const runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
  });

export const runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema =
  z.discriminatedUnion("readStatus", [
    z.strictObject({
      executionContext: executionContextDiagnosticsSchema.optional(),
      lifecycle:
        runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRecordSchema,
      ok: z.literal(true),
      readStatus: z.literal("found"),
    }),
    z.strictObject({
      executionContext: executionContextDiagnosticsSchema.optional(),
      ok: z.literal(true),
      readStatus: z.literal("missing"),
      reasonCode: z.literal("runtime_coordinator.head_lifecycle_not_found"),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
    z.strictObject({
      executionContext: executionContextDiagnosticsSchema.optional(),
      ok: z.literal(false),
      readStatus: z.literal("authority_unavailable"),
      reasonCode: z.string().min(1).max(160),
      targetWakeLifecycleId: z.string().min(1).max(2048),
    }),
  ]);

export const runtimeTransportPreExecutionHandoffReasonCodeSchema = z.enum([
  "daemon.profile.offline",
]);

export const runtimeTransportPreExecutionHandoffRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  attemptId: z.string().min(1).nullable().optional(),
  autoRelayDepth: z.number().int().nonnegative().optional(),
  dispatchChainId: z.string().min(1).nullable().optional(),
  dispatchId: z.string().min(1),
  firstSeenAtMs: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(512),
  observedAtMs: z.number().int().nonnegative(),
  reasonCode: runtimeTransportPreExecutionHandoffReasonCodeSchema,
  sourceClientMessageId: z.string().min(1).max(200).nullable().optional(),
  sourceEventId: z.string().min(1),
  spaceId: z.string().min(1),
  spacePassword: spacePasswordSchema.optional(),
  targetProfileId: z.string().min(1),
  targetProfileMentionLabel: spaceMentionLabelSchema.optional(),
  targetProfileName: z.string().min(1).max(MAX_PROFILE_NAME_LENGTH).optional(),
  taskId: z.string().min(1),
  threadContext: spaceThreadContextSchema.optional(),
  visitedProfileIds: z.array(z.string().min(1)).max(256).optional(),
  visitedProfileIdsHash: z.string().min(1).nullable().optional(),
});

export const runtimeTransportPreExecutionHandoffResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      deadlineAtMs: z.number().int().nonnegative(),
      nextAlarmAtMs: z.number().int().nonnegative(),
      ok: z.literal(true),
      reasonCode: runtimeTransportPreExecutionHandoffReasonCodeSchema,
      status: z.literal("waiting_for_recovery"),
    }),
    z.strictObject({
      deadlineAtMs: z.number().int().nonnegative(),
      ok: z.literal(true),
      publishedSignalId: z.string().min(1),
      reasonCode: runtimeTransportPreExecutionHandoffReasonCodeSchema,
      resultRef: z.string().min(1),
      status: z.literal("failure_published"),
    }),
    z.strictObject({
      deadlineAtMs: z.number().int().nonnegative(),
      nextPublicationRetryAtMs: z.number().int().nonnegative(),
      ok: z.literal(true),
      publicationErrorCode: z.string().min(1),
      reasonCode: runtimeTransportPreExecutionHandoffReasonCodeSchema,
      resultRef: z.string().min(1),
      status: z.literal("failure_publication_retry_scheduled"),
    }),
    z.strictObject({
      deadlineAtMs: z.number().int().nonnegative(),
      ok: z.literal(true),
      reasonCode: runtimeTransportPreExecutionHandoffReasonCodeSchema,
      status: z.literal("handoff_recovered"),
    }),
    z.strictObject({
      deadlineAtMs: z.number().int().nonnegative(),
      ok: z.literal(true),
      reasonCode: runtimeTransportPreExecutionHandoffReasonCodeSchema,
      status: z.literal("legacy_evidence_only"),
    }),
    z.strictObject({
      ok: z.literal(false),
      reasonCode: z.string().min(1),
      status: z.literal("retry_later"),
    }),
  ]);

export const runtimeTransportDispatchLifecyclePhaseSchema = z.enum([
  "accepted_local",
  "running",
  "completed_local",
]);

export const runtimeTransportAgentControllerConversationOccupancySchema =
  z.strictObject({
    agentControllerConversationId: z.string().trim().min(1),
    contractVersion: z.literal(1),
    state: z.enum(["available", "occupied"]),
  });

export const runtimeTransportDispatchLocalQueueWaitReasonSchema = z.enum([
  "workspace_conflict",
  "agent_profile_concurrency",
  "agent_controller_maintenance",
  "global_concurrency",
  "local_execution_lane_concurrency",
  "none",
]);

export const runtimeTransportDispatchLocalQueueDiagnosticsSchema =
  z.strictObject({
    activeForLane: z.number().int().nonnegative(),
    activeGlobal: z.number().int().nonnegative(),
    globalConcurrency: z.number().int().positive(),
    queueDepth: z.number().int().nonnegative(),
    queueMax: z.number().int().positive(),
    queuePosition: z.union([z.number().int().positive(), z.null()]),
    status: z.enum(["queued", "starting_runtime"]),
    waitReason: runtimeTransportDispatchLocalQueueWaitReasonSchema,
  });

export const runtimeTransportDispatchLifecycleRequestSchema = z.strictObject({
  acknowledgementId: z.string().uuid().optional(),
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  runtimeCoordinatorExecutionId:
    runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.optional(),
  executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema.optional(),
  dispatchId: z.string().min(1),
  attemptId: z.string().min(1),
  daemonSessionId: z.string().min(1),
  connectionGeneration: z.number().int().positive(),
  leaseEpoch: z.number().int().positive(),
  phase: runtimeTransportDispatchLifecyclePhaseSchema,
  lifecycleAtMs: z.number().int().nonnegative(),
  agentControllerConversationOccupancy:
    runtimeTransportAgentControllerConversationOccupancySchema.optional(),
  localQueue: runtimeTransportDispatchLocalQueueDiagnosticsSchema.optional(),
});

export const runtimeTransportDispatchLifecycleAcknowledgementSchema =
  z.strictObject({
    acknowledgementId: z.string().uuid(),
    dispatchId: z.string().min(1),
    attemptId: z.string().min(1),
    connectionGeneration: z.number().int().positive(),
    accepted: z.boolean(),
    validForMs: z.number().int().nonnegative(),
    reasonCode: z.string().min(1).nullable(),
  });

export const runtimeTransportDispatchRuntimeEvidencePhaseSchema = z.enum([
  "received",
  "claimed",
  "runtime_started",
  "first_output",
  "completed",
  "failed",
]);

export const runtimeTransportDispatchRuntimeEvidenceRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.optional(),
    executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema.optional(),
    dispatchId: z.string().min(1),
    attemptId: z.string().min(1),
    executionIdentityEcho: runtimeTransportRuntimeEvidenceIdentityEchoSchema,
    daemonSessionId: z.string().min(1),
    connectionGeneration: z.number().int().positive(),
    leaseEpoch: z.number().int().positive(),
    phase: runtimeTransportDispatchRuntimeEvidencePhaseSchema,
    evidenceAtMs: z.number().int().nonnegative(),
    taskId: z.string().min(1),
    spaceId: z.string().min(1),
    sourceSignalId: z.string().min(1),
    sourceClientMessageId: z.string().min(1).max(200).nullable().optional(),
    targetProfileId: z.string().min(1),
    // Legacy diagnostic input accepted for older local services only.
    claimLeaseId: z.string().min(1).optional(),
    durationMs: z.number().finite().nonnegative().optional(),
    reasonCode: z.string().trim().min(1).max(160).optional(),
    errorName: z.string().trim().min(1).max(160).optional(),
  });

export const LOCAL_AGENT_TOOL_ACTIVITY_NAMES = [
  "agent_run_command",
  "agent_read_files",
  "agent_edit_files",
  "agent_search_files",
  "agent_search_web",
  "agent_open_webpage",
  "agent_delegate_task",
  "agent_work_with_image",
  "agent_use_tool",
] as const;

export const localAgentToolActivityNameSchema = z.enum(
  LOCAL_AGENT_TOOL_ACTIVITY_NAMES
);

const localAgentStreamToolPartSchema = agentStreamToolPartSchema.extend({
  toolName: localAgentToolActivityNameSchema,
});

export const runtimeTransportDispatchToolActivityRequestSchema = z.strictObject(
  {
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.optional(),
    executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema.optional(),
    dispatchId: z.string().min(1),
    attemptId: z.string().min(1),
    executionIdentityEcho: runtimeTransportRuntimeEvidenceIdentityEchoSchema,
    daemonSessionId: z.string().min(1),
    connectionGeneration: z.number().int().positive(),
    leaseEpoch: z.number().int().positive(),
    sequence: z.number().int().positive(),
    observedAtMs: z.number().int().nonnegative(),
    taskId: z.string().min(1),
    spaceId: z.string().min(1),
    sourceSignalId: z.string().min(1),
    targetProfileId: z.string().min(1),
    part: localAgentStreamToolPartSchema,
  }
);

export const runtimeTransportDispatchReasoningRequestSchema =
  runtimeTransportDispatchToolActivityRequestSchema
    .omit({ part: true })
    .extend({
      thinkingSnapshot: z.string().max(LOCAL_AGENT_REASONING_MAX_CHARS),
      reasoningState: localAgentReasoningStateSchema,
    });

export const runtimeTransportDispatchProgressRequestSchema =
  runtimeTransportDispatchToolActivityRequestSchema
    .omit({ part: true })
    .extend({
      progressSnapshot: z
        .string()
        .trim()
        .min(1)
        .max(32 * 1024),
    });

export const runtimeTransportDispatchReplyRequestSchema =
  runtimeTransportDispatchToolActivityRequestSchema
    .omit({ part: true })
    .extend({
      placement: z.enum(["conversation", "thread"]).optional(),
      textSnapshot: z.string().max(AGENT_STREAM_SNAPSHOT_MAX_CHARS),
    });

export const runtimeTransportDispatchInteractionRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  runtimeCoordinatorExecutionId:
    runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId,
  executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema,
  dispatchId: z.string().min(1),
  attemptId: z.string().min(1),
  executionIdentityEcho: runtimeTransportRuntimeEvidenceIdentityEchoSchema,
  daemonSessionId: z.string().min(1),
  connectionGeneration: z.number().int().positive(),
  leaseEpoch: z.number().int().positive(),
  taskId: z.string().min(1),
  interaction: agentInteractionRequestSchema,
});

export const runtimeTransportDispatchInteractionResponseFramePayloadSchema =
  z.strictObject({
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape
        .runtimeCoordinatorExecutionId,
    dispatchId: z.string().min(1),
    attemptId: z.string().min(1),
    interactionId: z.string().trim().min(1).max(256),
    response: agentInteractionResponseSchema,
    respondedAtMs: z.number().int().nonnegative(),
  });

export const runtimeTransportDispatchInteractionDeliveredRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape
        .runtimeCoordinatorExecutionId,
    executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema,
    dispatchId: z.string().min(1),
    attemptId: z.string().min(1),
    executionIdentityEcho: runtimeTransportRuntimeEvidenceIdentityEchoSchema,
    daemonSessionId: z.string().min(1),
    connectionGeneration: z.number().int().positive(),
    leaseEpoch: z.number().int().positive(),
    interactionId: z.string().trim().min(1).max(256),
    deliveredAtMs: z.number().int().nonnegative(),
  });

export const runtimeTransportRuntimeCoordinatorReadInteractionRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    actorOwnerUserId: z.string().min(1),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape
        .runtimeCoordinatorExecutionId,
  });

// Frozen: Space and the Runtime Transport Hub are separate Durable Objects and
// can briefly run different Core builds, so this body never gains a field.
export const runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema =
  z.strictObject({
    pendingInteraction: agentInteractionPendingSummarySchema.nullable(),
  });

// Served only at the revision read path. A reader that gets anything else
// (an older Hub answers that path with not_found) falls back to the frozen
// read above and keeps the lifecycle revision.
export const runtimeTransportRuntimeCoordinatorReadInteractionRevisionResponseSchema =
  z.strictObject({
    pendingInteraction: agentInteractionPendingSummarySchema.nullable(),
    // Core time of this execution's latest interaction change: a request
    // reaching Core, an answer, or an expiry. Wake progress revisions include
    // it so a newer interaction state outranks an older equal-lifecycle copy.
    interactionUpdatedAtMs: z.number().int().nonnegative().nullable(),
  });

export const runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema =
  z.strictObject({
    v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
    actorOwnerUserId: z.string().min(1),
    runtimeCoordinatorExecutionId:
      runtimeCoordinatorExecutionRecordSchema.shape
        .runtimeCoordinatorExecutionId,
    interactionId: z.string().trim().min(1).max(256),
    response: agentInteractionResponseSchema,
  });

export const runtimeTransportRuntimeCoordinatorRespondInteractionResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      ok: z.literal(true),
      status: z.enum(["accepted", "already_resolved"]),
      respondedAtMs: z.number().int().nonnegative(),
    }),
    z.strictObject({
      ok: z.literal(false),
      status: z.enum([
        "expired",
        "interaction_mismatch",
        "not_found",
        "owner_mismatch",
        "response_invalid",
        "retry_later",
      ]),
      message: z.string().trim().min(1).max(1000),
    }),
  ]);

const nullableLifecyclePhaseTimestampSchema = z.union([
  z.number().int().nonnegative(),
  z.null(),
]);

export const runtimeTransportDispatchLifecycleSnapshotSchema = z.strictObject({
  phase: z.enum([
    "starting",
    "accepted_local",
    "running",
    "completed_local",
    "result_received",
  ]),
  createdAtMs: z.number().int().nonnegative(),
  acceptedLocalAtMs: nullableLifecyclePhaseTimestampSchema,
  runningAtMs: nullableLifecyclePhaseTimestampSchema,
  completedLocalAtMs: nullableLifecyclePhaseTimestampSchema,
  lastLifecycleAtMs: z.number().int().nonnegative(),
});

export const runtimeTransportWaitDispatchResultResponseSchema =
  z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("completed"),
      lifecycle: runtimeTransportDispatchLifecycleSnapshotSchema.optional(),
      taskResult: openMeldDaemonTaskResultEnvelopeSchema,
    }),
    z.strictObject({
      state: z.literal("pending"),
      lifecycle: runtimeTransportDispatchLifecycleSnapshotSchema,
    }),
    z.strictObject({
      state: z.literal("failed"),
      lifecycle: runtimeTransportDispatchLifecycleSnapshotSchema.optional(),
      reasonCode: runtimeTransportErrorCodeSchema,
    }),
  ]);

export const runtimeTransportSubmitTaskResultRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  runtimeCoordinatorExecutionId:
    runtimeCoordinatorExecutionRecordSchema.shape.runtimeCoordinatorExecutionId.optional(),
  executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema.optional(),
  dispatchId: z.string().min(1),
  attemptId: z.string().min(1).optional(),
  executionIdentityEcho: runtimeTransportResultIdentityEchoSchema,
  daemonSessionId: z.string().min(1),
  connectionGeneration: z.number().int().positive(),
  leaseEpoch: z.number().int().positive(),
  taskResult: openMeldDaemonTaskResultEnvelopeSchema,
});

export const runtimeTransportSubmitTaskResultResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      ok: z.literal(true),
      status: z.literal("accepted"),
    }),
    z.strictObject({
      ok: z.literal(false),
      status: z.literal("review_required"),
      reasonCode: z.literal("space.agent_reply.context_changed"),
    }),
    z.strictObject({
      ok: z.literal(false),
      status: z.literal("retry_later"),
      reasonCode: runtimeTransportErrorCodeSchema,
    }),
    z.strictObject({
      ok: z.literal(false),
      status: z.literal("rejected_terminal"),
      reasonCode: runtimeTransportErrorCodeSchema,
    }),
  ]);

export const runtimeTransportDispatchPreviewRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  dispatchId: z.string().min(1),
  attemptId: z.string().min(1),
  daemonSessionId: z.string().min(1),
  connectionGeneration: z.number().int().positive(),
  leaseEpoch: z.number().int().positive(),
  previewText: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export const runtimeTransportDispatchPreviewEndRequestSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  dispatchId: z.string().min(1),
  attemptId: z.string().min(1),
  daemonSessionId: z.string().min(1),
  connectionGeneration: z.number().int().positive(),
  leaseEpoch: z.number().int().positive(),
  targetProfileName: z.string().min(1).max(MAX_PROFILE_NAME_LENGTH).optional(),
});

export const daemonStreamCodeSchema = z.enum([
  "daemon.computer_power.request",
  "daemon.computer_power.request_result",
  "daemon.computer_file_access.read_policy",
  "daemon.session_history.request",
  "daemon.session_history.request_result",
  "daemon.computer_file_access.read_policy_result",
  "daemon.computer_file_access.update_policy",
  "daemon.computer_file_access.update_policy_result",
  "daemon.local_folder_picker.select_folders",
  "daemon.local_folder_picker.select_folders_result",
  "daemon.session.register",
  "daemon.session.heartbeat",
  "daemon.dispatch.deliver",
  "daemon.dispatch.lifecycle",
  "daemon.dispatch.lifecycle_acknowledged",
  "daemon.dispatch.runtime_evidence",
  "daemon.dispatch.tool_activity",
  "daemon.dispatch.reasoning",
  "daemon.dispatch.progress",
  "daemon.dispatch.reply",
  "daemon.reasoning.preferences",
  "daemon.dispatch.interaction_request",
  "daemon.dispatch.interaction_response",
  "daemon.dispatch.interaction_delivered",
  "daemon.dispatch.preview",
  "daemon.dispatch.preview_end",
  "daemon.dispatch.accepted",
  "daemon.dispatch.result",
  "daemon.route_catalog.changed",
  "daemon.local_agent_control.cancel",
  "daemon.local_agent_control.interrupt",
  "daemon.execution_input.request",
  "daemon.execution_input.result",
  "daemon.local_agent_control.fork_session",
  "daemon.local_agent_control.manage_installation",
  "daemon.local_agent_control.refresh_catalog",
  "daemon.local_agent_control.set_enabled",
  "daemon.local_agent_control.set_profile_workspace",
  "daemon.local_agent_control.read_profile_workspace",
  "daemon.local_agent_control.manage_profile_folders",
  "daemon.local_agent_control.result",
  "daemon.openmeld_tools_control.request",
  "daemon.openmeld_tools_control.result",
  "daemon.execution_recovery.resume_controller_conversation",
  "daemon.execution_recovery.resume_controller_conversation_result",
  "daemon.local_project_control.discover_projects",
  "daemon.local_project_control.discover_projects_result",
  "daemon.local_project_control.connect_candidate",
  "daemon.local_project_control.connect_candidate_result",
  "daemon.local_project_control.connect_declared_path",
  "daemon.local_project_control.connect_declared_path_result",
  "daemon.local_project_control.set_default_connection",
  "daemon.local_project_control.set_default_connection_result",
  "daemon.local_project_control.remove_connection",
  "daemon.local_project_control.remove_connection_result",
  "daemon.local_project_control.remove_missing_connections",
  "daemon.local_project_control.remove_missing_connections_result",
  "daemon.error",
]);

export const daemonStreamFrameSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  code: daemonStreamCodeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const daemonStreamErrorFrameCodeSchema =
  runtimeTransportErrorCodeSchema.or(
    z.union([
      z.literal("schema.invalid"),
      z.literal("schema.invalid.runtime_response"),
    ])
  );

export const daemonStreamErrorFrameSchema = z.strictObject({
  v: z.literal(RUNTIME_TRANSPORT_SCHEMA_VERSION),
  code: z.literal("daemon.error"),
  payload: z.strictObject({
    code: daemonStreamErrorFrameCodeSchema,
    message: z.string().min(1),
  }),
});
