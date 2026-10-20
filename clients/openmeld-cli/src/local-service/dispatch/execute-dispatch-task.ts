import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AdapterComputerFileAccessBoundary,
  AdapterDispatchContextDelta,
  AdapterDispatchExecutionMode,
  AdapterInstructionPrompt,
  AdapterInteractionCallback,
  AdapterInteractionRequest,
  AdapterRuntimeEvent,
  AdapterToolActivityEvent,
} from "@openmeld/adapter-core";
import { DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV } from "@openmeld/adapter-core";
import {
  renderTaskKnowledgeIndex,
  TASK_KNOWLEDGE_GUIDANCE,
} from "@openmeld/agent-runtime";
import type { RuntimeTaskResult } from "@openmeld/local-execution";
import {
  assertLegacyAgentContextAssociation,
  buildAgentContextLookupKey,
  buildRuntimeWorkspaceFingerprint,
  commitResolvedAgentContext,
  DEFAULT_TASK_LIFECYCLE_HEARTBEAT_INTERVAL_MS,
  loadLedgerState,
  resolveConversationExecutionStateByLookupKey,
  runRuntimeTask,
  seedLegacyAgentContext,
  withLedgerStateTransaction,
} from "@openmeld/local-execution";
import {
  createSerialAgentInteractionCallback,
  type DispatchContinuityObservation,
  type InflightTaskControlRegistry,
  type LocalDaemonAdapterContainer,
  type LocalExecutionSlotDiagnostics,
  type LocalExecutionSlotSharedFolderSession,
  type LocalExecutionSlots,
  type LocalExecutionSlotTaskResult,
  mergeOpenClawGatewayVisibility as mergeOpenClawGatewayVisibilityInternal,
  normalizeDispatchPostMessageAction,
  normalizeDispatchThreadAction,
  type OpenClawGatewayVisibility,
  type PendingAgentInteractionRegistry,
  resolveCompatibleAgentContextMatch,
  resolveCompatibleConversationExecutionState,
  resolveDispatchContinuityObservation,
  resolveDispatchQueueLogMeta,
  resolveLatestScopedConversationExecutionState,
  syncRuntimeEventToInflightTaskControlRegistry,
} from "@openmeld/local-service";
import {
  AGENT_INTERACTION_DEFAULT_TIMEOUT_MS,
  AGENT_INTERACTION_SCHEMA_VERSION,
  agentInteractionRequestSchema,
  runtimeCoordinatorExecutionTokenEnvelopeSchema,
  runtimeTransportDeliverDispatchRequestSchema,
  runtimeTransportDeliveryExecutionIdentitySchema,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  AgentControllerConversationResumePlan,
  AgentInteractionRequest,
  BootstrapTemplateFacts,
  ConversationExecutionState,
  DispatchExecution,
  ExecutionContextCompletion,
  LocalRuntimeContextPlan,
  OpenMeldDaemonTaskResultPayload,
  ProviderDispatchRuntimeContext,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeTransportAgentControllerConversationOccupancy,
  RuntimeTransportDeliverDispatchRequest,
  RuntimeTransportDeliveryExecutionIdentity,
  RuntimeTransportDispatchLocalQueueDiagnostics,
  RuntimeTransportDispatchRuntimeEvidencePhase,
  RuntimeTransportResultIdentityEcho,
  RuntimeTransportRuntimeEvidenceIdentityEcho,
} from "@openmeld/schemas/types";
import { resolveSpacePublicationRequirement } from "@openmeld/space-mesh";
import { recordOpenMeldCreatedLocalAgentSession } from "../../agent-activity/session-inventory-origin-store";
import { resolveBuiltinAgentControllerDefinition } from "../../agents/builtin-agent-controller-definitions";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../../config/openmeld-request-context";
import { emitDaemonDispatchJournalEvent } from "../../local-service/dispatch/daemon-dispatch-journal";
import {
  type DispatchRuntimePreparation,
  prepareDispatchRuntimeExecution,
  resolveDispatchWorkingFolderRuntimeContext,
  resolveForkSourceWorkingDirectory,
} from "../../local-service/execution/dispatch-runtime-preparation";
import { toTaskExecutionError as toTaskExecutionErrorInternal } from "../../local-service/execution/task-execution-error";
import { readProfileFolderDisplayName } from "../../profile-workspace/folders";
import { buildDispatchOwnedRuntimeEnv } from "../../runtime/dispatch-owned-runtime";
import { DISPATCH_SPACE_ACTION_CLI_FALLBACK_COMMAND } from "../../runtime/dispatch-runtime-env";
import {
  createDispatchSpaceActionContext,
  type DispatchSpaceActionContext,
  type DispatchSpaceActionRecord,
  type DispatchSpaceActionRecordReadResult,
  OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
  readDispatchSpaceActionContextForReceiptFromEnv,
  readDispatchSpaceActionRecord,
  supersedeDispatchSpaceActionRecordForReconsideration,
} from "../../runtime/dispatch-space-action-context";
import { startDispatchSpaceProgressRelay } from "../../runtime/dispatch-space-progress-relay";
import type { Presenter } from "../../runtime/presenter/types";
import {
  createDispatchSpaceTools,
  type DispatchPublicProgressResult,
} from "../../space/action-mcp-server";
import { readTaskKnowledge } from "../../space/dispatch-knowledge-read";
import { resolveProviderRuntimeDispatchContinuation } from "../continuation/provider-runtime-continuation";
import {
  mayRecoverWorkingFolder,
  resolveRecoveredLedgerConversation,
  resolveWorkingFolderRecovery,
} from "../continuation/working-folder-recovery";
import {
  emitRunLine,
  normalizeOptionalText,
  toErrorMessage,
} from "../core/logger";
import type {
  CurrentDaemonSocketRef,
  DaemonFrameSink,
  DaemonProfileRouteConfig,
  DispatchSharedFolderSession,
  InflightDispatchMeta,
  LedgerPaths,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import {
  type ClaudeProjectContainerRuntime,
  prepareClaudeProjectContainer,
} from "../file-access/claude-project-container";
import { resolveComputerFileAccessAdmission } from "../file-access/computer-file-access-admission";
import { applyComputerFileAccessAwareness } from "../file-access/computer-file-access-prompt";
import { readComputerFileAccessPolicy } from "../file-access/computer-file-access-store";
import { prepareDispatchWorkHandoff } from "../file-access/dispatch-work-handoff";
import { probeAgentControllerUsageObservationAuth } from "../inventory/agent-controller-interface";
import { recordRuntimeProviderUsageLimits } from "../inventory/runtime-provider-usage-limits";
import {
  buildRuntimeRouteTargets,
  resolveLocalRuntimeControllerSupport,
} from "../routing/resolve-controller-support";
import { createLedgerIo } from "../state/ledger-io";
import {
  resolveColleagueLedgerScopeId,
  resolveDispatchBindingConversationId,
} from "./colleague-conversation";
import {
  attachAgentReplyObservation,
  coordinateDispatchAgentReply,
  type DispatchAgentReplyObservation,
  readDispatchAgentReplyObservation,
} from "./dispatch-agent-reply-observation";
import { settleAgentReplyProposals } from "./dispatch-agent-reply-settlement";
import { createDispatchAiUsageCollector } from "./dispatch-ai-usage";
import {
  type DispatchImageAttachmentPreparation,
  downloadDispatchImageAttachment,
  materializeDispatchImageAttachments,
} from "./dispatch-image-attachments";
import {
  type DispatchResultOutboxSettlement,
  enqueueDispatchResultOutboxRecord,
} from "./dispatch-result-outbox";
import {
  applyDispatchSkillInstructions,
  ensureDispatchControllerOpenMeldSkill,
} from "./ensure-dispatch-controller-openmeld-skill";
import {
  markBootstrapInjectedContext as markBootstrapInjectedContextInternal,
  reconcileBootstrapInjectedContextAfterDispatch as reconcileBootstrapInjectedContextAfterDispatchInternal,
  resolveBootstrapPlan as resolveBootstrapPlanInternal,
  rollbackBootstrapExecutionStateAfterDispatchFailure as rollbackBootstrapExecutionStateAfterDispatchFailureInternal,
} from "./execute-dispatch-bootstrap-plan";
import {
  areSameAgentControllerConversationRef,
  normalizeOptionalContextId,
  resolveCurrentConversationPolicy,
  resolveDispatchContextDeltaFromRuntimeResult,
  resolveDispatchContextIdForAgentControllerConversation,
  resolveObservedDispatchAgentControllerConversation,
  resolvePlannedAgentControllerConversation,
} from "./execute-dispatch-conversation";
import { upsertConversationExecutionStateForLookupKey } from "./execute-dispatch-conversation-state";
import {
  buildResultDispatchJournalMetadata,
  buildRuntimeObservationPayload,
  emitContinuityWarningIfNeeded,
  emitDispatchLocalPhaseJournalEvent,
  emitProviderRuntimePhaseLine,
  emitRuntimeObservationSummaryLine,
  resolveAdapterTelemetry,
  summarizeTaskResultPayload,
} from "./execute-dispatch-observation";
import {
  buildInvalidStructuredActionOutputPreview,
  buildStructuredActionRepairPrompt as buildStructuredActionRepairPromptInternal,
  coerceRuntimeResultToStructuredActionFailure as coerceRuntimeResultToStructuredActionFailureInternal,
  resolveStructuredActionOutputFallback,
  resolveStructuredActionRepairContinuation as resolveStructuredActionRepairContinuationInternal,
  resolveStructuredActionRepairPreviousOutput,
  resolveStructuredActionRequirementFailure as resolveStructuredActionRequirementFailureInternal,
} from "./execute-dispatch-structured-action-repair";
import type {
  BootstrapPlan,
  DispatchBootstrapContextPhase,
  DispatchCorrelation,
  DispatchLifecyclePhase,
  DispatchPromptTrace,
  DispatchRejectionPayloadInput,
  DispatchRuntimeCompletion,
  DispatchSendTargetReferenceLoadResult,
  ParsedDispatchTask,
  StructuredActionFailureDiagnostics,
  StructuredActionRepairResult,
  SupportedRuntimeControllerSupport,
} from "./execute-dispatch-types";
import {
  assertExecutionContextAdmittedFolder,
  type ExecutionContextFolderAdmission,
  needsExecutionContextFolderAdmission,
  resolveExecutionContextAdmissionWithoutFolder,
  resolveExecutionContextFolderAdmission,
  runInLocalAdmissionOrder,
} from "./execution-context-folder-admission";
import {
  captureExecutionContextCompletion,
  executionContextFileAccessBoundary,
  executionContextLedgerPolicy,
  executionContextResourceClaim,
  executionContextWorkingDirectory,
  prepareExecutionContextConversation,
  resolveQueuedFolderRoots,
} from "./execution-context-session";
import {
  deriveExecutionContextComputerFileAccessPolicy,
  type ExecutionContextWorkspace,
  type ExecutionContextWorkspaceUse,
  markExecutionContextWorkspaceInUse,
  prepareExecutionContextWorkspace,
  releaseExecutionContextWorkspace,
} from "./execution-context-workspace";
import {
  appendNonOwnerAudienceGuidance,
  buildDispatchBootstrapTemplateFacts,
  buildDispatchCorrelation,
  buildDispatchPromptPlan,
  buildDispatchSessionTitle,
  type DispatchPromptPlan,
  parseDispatchTask,
  resolveBootstrapSpaceOwnerProfileId,
  resolveBootstrapTargetProfileContext,
  resolveDispatchMentionSourceContext,
} from "./parse-dispatch-task";
import { buildDispatchPromptTrace } from "./prompt-trace";
import { createDispatchPublicProgressReporter } from "./public-progress-stream";
import {
  createReasoningStream,
  routeReasoningEvents,
} from "./reasoning-stream";
import {
  buildFailedTaskResultPayload,
  resolveDispatchResultPayload,
  sendDispatchInteractionRequestFrame,
  sendDispatchLifecycleFrame,
  sendDispatchPreviewEndFrame,
  sendDispatchPreviewFrame,
  sendDispatchProgressFrame,
  sendDispatchReasoningFrame,
  sendDispatchReplyFrame,
  sendDispatchRuntimeEvidenceFrame,
  sendDispatchToolActivityFrame,
} from "./send-dispatch-result";
import { resolveDispatchSendTargetReference } from "./send-target-reference";
import { watchSpaceActionReply } from "./space-action-reply-stream";

export const markBootstrapInjectedContext =
  markBootstrapInjectedContextInternal;
export const reconcileBootstrapInjectedContextAfterDispatch =
  reconcileBootstrapInjectedContextAfterDispatchInternal;
export const resolveBootstrapPlan = resolveBootstrapPlanInternal;
export const rollbackBootstrapExecutionStateAfterDispatchFailure =
  rollbackBootstrapExecutionStateAfterDispatchFailureInternal;
export const buildStructuredActionRepairPrompt =
  buildStructuredActionRepairPromptInternal;
export const coerceRuntimeResultToStructuredActionFailure =
  coerceRuntimeResultToStructuredActionFailureInternal;
export const resolveStructuredActionRepairContinuation =
  resolveStructuredActionRepairContinuationInternal;
export const resolveStructuredActionRequirementFailure =
  resolveStructuredActionRequirementFailureInternal;

const CLI_SPACE_ACTION_RECORD_POLL_INTERVAL_MS = 25;
const CLI_SPACE_ACTION_RECORD_RUNTIME_COMPLETION_GRACE_MS = 1500;
const AGENT_CONTROLLER_OCCUPANCY_KEEPALIVE_REASSERT_INTERVALS = 4;

// OPENMELD_SERVICE_THIN_CORE: temporary dispatch execution shell.
// Keep new local-service execution helpers outside this file. This file still
// orchestrates delivery intake, runtime preparation, Space Action handling, and
// result evidence until those slices are split one by one.
type EnqueueDispatchDeliverFrameInput = Parameters<
  typeof enqueueDispatchDeliverFrame
>[0];

export function enqueueDispatchDeliverFrame(input: {
  computerFileAccessStorePath: string;
  contextStore: Map<string, string>;
  currentSocketRef?: CurrentDaemonSocketRef;
  daemonSessionId: string;
  localExecutionSlots: LocalExecutionSlots;
  inflightDispatchMetaByTaskId: Map<string, InflightDispatchMeta>;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  ledgerPaths: LedgerPaths;
  leasesByProfileId: Map<string, number>;
  localAdapterContainer: LocalDaemonAdapterContainer;
  payload: Record<string, unknown>;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  requestCurrentWorkingFolderFactRefresh?: () => void;
  presenter: Presenter;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  socket: DaemonFrameSink;
}): void {
  // OPENMELD_SERVICE_THIN_CORE: RuntimeCoordinator task intake.
  // The daemon may accept, queue, and execute a token-backed local task, then
  // report evidence. RuntimeCoordinator and Space still own final outcome.
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT local-service-execution
  // OpenMeld Service carries an accepted Wake to the bound local runtime. It is not
  // the owner of Space truth or final publication.
  const currentSocketRef = input.currentSocketRef ?? {
    connectionGeneration: normalizePositiveInteger(
      input.payload.connectionGeneration
    ),
    socket: input.socket,
  };
  const parsedDeliver = runtimeTransportDeliverDispatchRequestSchema.safeParse(
    input.payload
  );
  if (!parsedDeliver.success) {
    reportInvalidDeliverRequest({
      currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      issues: parsedDeliver.error.issues,
      ledgerPaths: input.ledgerPaths,
      payload: input.payload,
      presenter: input.presenter,
    });
    return;
  }
  const deliverRequest = parsedDeliver.data;
  const correlation = buildDispatchCorrelation({
    deliverRequest,
    parsedTask: null,
  });
  const parsedQueueTask = parseDispatchTaskForQueue({
    deliverRequest,
    routeByProfileId: input.routeByProfileId,
  });
  const queueLogMeta = resolveDispatchQueueLogMeta({
    parsedTask: parsedQueueTask,
    profileId: deliverRequest.profileId,
    runtimeAdapterId: resolveQueueRuntimeAdapterId({
      localAdapterContainer: input.localAdapterContainer,
      parsedTask: parsedQueueTask,
    }),
  });
  emitDispatchRuntimeEvidenceTransition({
    currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest,
    phase: "received",
    presenter: input.presenter,
  });
  const deliveredContext = deliverRequest.payload.executionContext;
  runInLocalAdmissionOrder({
    order: input.localExecutionSlots,
    prepare: needsExecutionContextFolderAdmission(deliveredContext)
      ? () =>
          resolveExecutionContextFolderAdmission({
            context: deliveredContext,
            resolveFolder: async () => {
              if (!parsedQueueTask) {
                throw new Error("dispatch task is invalid");
              }
              return (
                await resolveDispatchWorkingFolderRuntimeContext({
                  ledgerRootPath: input.ledgerPaths.rootDirPath,
                  controllerSnapshot: deliverRequest.payload.controllerSnapshot,
                  defaultProjectId: parsedQueueTask.defaultProjectId,
                  defaultProjectIdWasProvided: Object.hasOwn(
                    deliverRequest.payload,
                    "defaultProjectId"
                  ),
                  executionContext: parsedQueueTask.executionContext,
                  ownerUserId: input.profileOwnerUserId,
                  executionIdentity: parsedQueueTask.executionIdentity,
                  routeConfig:
                    input.routeByProfileId.get(deliverRequest.profileId) ??
                    null,
                  targetProfileId: parsedQueueTask.targetProfileId,
                })
              ).providerRuntimeWorkingDirectory;
            },
          })
      : null,
    ready: () =>
      resolveExecutionContextAdmissionWithoutFolder(deliveredContext),
    admit: (admission) =>
      admitDispatchDeliverFrame(input, {
        admission,
        correlation,
        currentSocketRef,
        deliverRequest,
        parsedQueueTask,
        queueLogMeta,
      }),
    onError: (error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_admission_failed",
        text: `local execution slot could not admit task ${correlation.taskId} for ${queueLogMeta.targetLabel}`,
        payload: {
          dispatchId: correlation.dispatchId,
          error: error instanceof Error ? error.message : String(error),
          taskId: correlation.taskId,
        },
      });
    },
  });
}

/**
 * The shared roots of a task without an Execution Context: the Profile's
 * current folder, or unknown when an OpenCode continuation may recover another
 * working folder during preparation.
 */
function resolveQueuedLegacyFolderRoots(
  input: EnqueueDispatchDeliverFrameInput,
  queued: {
    deliverRequest: RuntimeTransportDeliverDispatchRequest;
    parsedQueueTask: ReturnType<typeof parseDispatchTaskForQueue>;
  }
): string[] | null {
  const { deliverRequest, parsedQueueTask } = queued;
  return parsedQueueTask &&
    !mayRecoverWorkingFolder({
      agentControllerRef: parsedQueueTask.agentControllerRef,
      nativeSessionId: parsedQueueTask.agentControllerConversationId,
      hasExecutionContext: Boolean(parsedQueueTask.executionContext),
    })
    ? resolveQueuedFolderRoots(
        input.routeByProfileId.get(deliverRequest.profileId)
      )
    : null;
}

function admitDispatchDeliverFrame(
  input: EnqueueDispatchDeliverFrameInput,
  admitted: {
    admission: ExecutionContextFolderAdmission;
    correlation: ReturnType<typeof buildDispatchCorrelation>;
    currentSocketRef: CurrentDaemonSocketRef;
    deliverRequest: RuntimeTransportDeliverDispatchRequest;
    parsedQueueTask: ReturnType<typeof parseDispatchTaskForQueue>;
    queueLogMeta: ReturnType<typeof resolveDispatchQueueLogMeta>;
  }
): void {
  const {
    admission,
    correlation,
    currentSocketRef,
    deliverRequest,
    parsedQueueTask,
    queueLogMeta,
  } = admitted;
  const { pendingAgentInteractionRegistry } = input;
  const admittedDeliverRequest: RuntimeTransportDeliverDispatchRequest =
    admission.context
      ? {
          ...deliverRequest,
          payload: {
            ...deliverRequest.payload,
            executionContext: admission.context,
          },
        }
      : deliverRequest;
  const enqueueResult = input.localExecutionSlots.request({
    executionContextId: admission.context?.id ?? null,
    ...(admission.folderLabel ? { folderLabel: admission.folderLabel } : {}),
    resourceClaim: executionContextResourceClaim({
      context: admission.context,
      currentFolderRoots: admission.context
        ? (admission.folderRoots ?? null)
        : resolveQueuedLegacyFolderRoots(input, {
            deliverRequest,
            parsedQueueTask,
          }),
    }),
    adapterId: queueLogMeta.adapterId,
    attemptId: correlation.attemptId,
    controllerKey: queueLogMeta.controllerKey,
    dispatchId: correlation.dispatchId,
    executionTokenRunId: deliverRequest.payload.executionToken?.runId ?? null,
    localExecutionLaneKey: queueLogMeta.localExecutionLaneKey,
    onQueued: (event) => {
      const localQueue = toRuntimeTransportDispatchLocalQueueDiagnostics(
        event.localQueue
      );
      emitDispatchLifecycleTransition({
        attemptId: correlation.attemptId,
        connectionGeneration: deliverRequest.connectionGeneration,
        currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        dispatchId: correlation.dispatchId,
        leaseEpoch: deliverRequest.leaseEpoch,
        localQueue,
        phase: "accepted_local",
        presenter: input.presenter,
        executionTokenEcho:
          toRuntimeCoordinatorExecutionTokenEcho(deliverRequest),
        runtimeCoordinatorExecutionId:
          deliverRequest.payload.runtimeCoordinatorExecutionId,
        taskId: correlation.taskId,
      });
      return startDispatchLifecycleKeepalive({
        attemptId: correlation.attemptId,
        connectionGeneration: deliverRequest.connectionGeneration,
        currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        dispatchId: correlation.dispatchId,
        leaseEpoch: deliverRequest.leaseEpoch,
        localQueue,
        phase: "accepted_local",
        presenter: input.presenter,
        executionTokenEcho:
          toRuntimeCoordinatorExecutionTokenEcho(deliverRequest),
        runtimeCoordinatorExecutionId:
          deliverRequest.payload.runtimeCoordinatorExecutionId,
        taskId: correlation.taskId,
      });
    },
    profileId: deliverRequest.profileId,
    runtimeCoordinatorExecutionId:
      deliverRequest.payload.runtimeCoordinatorExecutionId ?? null,
    spaceId: queueLogMeta.spaceId,
    taskId: correlation.taskId,
    targetLabel: queueLogMeta.targetLabel,
    transportMode: queueLogMeta.transportMode,
    run: async () => {
      return await handleDispatchDeliverFrame({
        computerFileAccessStorePath: input.computerFileAccessStorePath,
        contextStore: input.contextStore,
        currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        deliverRequest: admittedDeliverRequest,
        executionContextAdmission: admission,
        readSharedFolderSessions: () =>
          input.localExecutionSlots.getSharedFolderSessions(correlation.taskId),
        inflightDispatchMetaByTaskId: input.inflightDispatchMetaByTaskId,
        inflightTaskControlRegistry: input.inflightTaskControlRegistry,
        pendingAgentInteractionRegistry,
        ledgerPaths: input.ledgerPaths,
        leasesByProfileId: input.leasesByProfileId,
        localAdapterContainer: input.localAdapterContainer,
        profileOwnerName: input.profileOwnerName,
        profileOwnerUserId: input.profileOwnerUserId,
        requestCurrentWorkingFolderFactRefresh:
          input.requestCurrentWorkingFolderFactRefresh,
        presenter: input.presenter,
        routeByProfileId: input.routeByProfileId,
        socket: input.socket,
      });
    },
  });
  function handleRejectedLocalExecutionSlot(
    rejected: Exclude<
      ReturnType<LocalExecutionSlots["request"]>,
      { accepted: true }
    >
  ): void {
    if (rejected.reason === "service.draining") {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_deferred",
        text: `deferred task ${correlation.taskId} because the local service is draining`,
        payload: {
          adapterId: queueLogMeta.adapterId,
          activeForLane: rejected.snapshot.activeForLane,
          activeGlobal: rejected.snapshot.activeGlobal,
          controllerKey: queueLogMeta.controllerKey,
          dispatchId: correlation.dispatchId,
          durationMs: null,
          errorCode: "daemon.service.draining",
          globalConcurrency: rejected.snapshot.limits.globalConcurrency,
          localExecutionLaneKey: queueLogMeta.localExecutionLaneKey,
          profileId: deliverRequest.profileId,
          queueDepth: rejected.snapshot.queueDepth,
          queueMax: rejected.snapshot.limits.queueMax,
          result: "deferred",
          spaceId: queueLogMeta.spaceId,
          step: "deferred",
          taskId: correlation.taskId,
          targetLabel: queueLogMeta.targetLabel,
          transportMode: queueLogMeta.transportMode,
        },
      });
      return;
    }
    const queueRejectErrorCode =
      rejected.reason === "task.owner_conflict"
        ? "runtime.task.local_owner_conflict"
        : "queue.full";
    const queueRejectMessage =
      rejected.reason === "task.owner_conflict"
        ? `${queueRejectErrorCode}: local task owner conflict for task ${correlation.taskId}; activeOwner=${rejected.activeOwner.dispatchId}/${rejected.activeOwner.attemptId}`
        : `queue.full: local execution slot queue is full (queueMax=${String(rejected.snapshot.limits.queueMax)}, pending=${String(rejected.snapshot.queueDepth)})`;
    const queueRejectPayload = buildFailedTaskResultPayload({
      attemptId: correlation.attemptId,
      agentControllerRef: correlation.agentControllerRef,
      errorCode: queueRejectErrorCode,
      errorMessage: queueRejectMessage,
      errorType:
        rejected.reason === "task.owner_conflict" ? "internal" : "policy",
      localOwnerConflict:
        rejected.reason === "task.owner_conflict"
          ? {
              activeAttemptId: rejected.activeOwner.attemptId,
              activeDispatchId: rejected.activeOwner.dispatchId,
              activeExecutionTokenRunId:
                rejected.activeOwner.executionTokenRunId,
              activeRuntimeCoordinatorExecutionId:
                rejected.activeOwner.runtimeCoordinatorExecutionId,
              activeTaskId: rejected.activeOwner.taskId,
              reason: "task.owner_conflict",
              rejectedAttemptId: correlation.attemptId,
              rejectedDispatchId: correlation.dispatchId,
              rejectedExecutionTokenRunId:
                deliverRequest.payload.executionToken?.runId ?? null,
              rejectedRuntimeCoordinatorExecutionId:
                deliverRequest.payload.runtimeCoordinatorExecutionId ?? null,
              rejectedTaskId: correlation.taskId,
            }
          : null,
      sourceEventId: correlation.sourceEventId,
      suppressPublicOutcome: rejected.reason === "task.owner_conflict",
      targetProfileId: correlation.targetProfileId,
      taskId: correlation.taskId,
    });
    enqueueDispatchResultOutboxRecord({
      attemptId: correlation.attemptId,
      connectionGeneration: deliverRequest.connectionGeneration,
      currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      dispatchId: correlation.dispatchId,
      executionIdentityEcho:
        toRuntimeTransportResultIdentityEcho(deliverRequest),
      executionTokenEcho:
        toRuntimeCoordinatorExecutionTokenEcho(deliverRequest),
      ledgerPaths: input.ledgerPaths,
      leaseEpoch: deliverRequest.leaseEpoch,
      payload: queueRejectPayload,
      presenter: input.presenter,
      runtimeCoordinatorExecutionId:
        deliverRequest.payload.runtimeCoordinatorExecutionId,
      taskId: correlation.taskId,
    });
    emitDaemonDispatchJournalEvent({
      attemptId: correlation.attemptId,
      connectionGeneration: deliverRequest.connectionGeneration,
      daemonSessionId: input.daemonSessionId,
      dispatchId: correlation.dispatchId,
      leaseEpoch: deliverRequest.leaseEpoch,
      metadata: buildResultDispatchJournalMetadata(queueRejectPayload),
      profileId: deliverRequest.profileId,
      result: queueRejectPayload.status,
      taskId: correlation.taskId,
      type: "dispatch.result.queued",
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.local_execution_slot_rejected",
      text: `local execution slot rejected task ${correlation.taskId} for ${queueLogMeta.targetLabel}: ${rejected.reason}`,
      payload: {
        adapterId: queueLogMeta.adapterId,
        activeForLane: rejected.snapshot.activeForLane,
        activeGlobal: rejected.snapshot.activeGlobal,
        controllerKey: queueLogMeta.controllerKey,
        dispatchId: correlation.dispatchId,
        durationMs: null,
        errorCode: queueRejectErrorCode,
        globalConcurrency: rejected.snapshot.limits.globalConcurrency,
        localExecutionLaneKey: queueLogMeta.localExecutionLaneKey,
        profileId: deliverRequest.profileId,
        queueDepth: rejected.snapshot.queueDepth,
        queueMax: rejected.snapshot.limits.queueMax,
        result: "failed",
        spaceId: queueLogMeta.spaceId,
        step: "rejected",
        taskId: correlation.taskId,
        targetLabel: queueLogMeta.targetLabel,
        transportMode: queueLogMeta.transportMode,
        ...(rejected.reason === "task.owner_conflict"
          ? {
              activeOwnerAttemptId: rejected.activeOwner.attemptId,
              activeOwnerDispatchId: rejected.activeOwner.dispatchId,
            }
          : {}),
      },
    });
    emitDispatchRuntimeEvidenceTransition({
      currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      deliverRequest,
      phase: "failed",
      presenter: input.presenter,
      reasonCode: queueRejectErrorCode,
    });
  }
  if (!enqueueResult.accepted) {
    handleRejectedLocalExecutionSlot(enqueueResult);
    return;
  }
  if (enqueueResult.deduped) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.local_execution_slot_deduped",
      text: `local execution slot deduped attempt ${correlation.attemptId} for task ${correlation.taskId}`,
      payload: {
        adapterId: queueLogMeta.adapterId,
        attemptId: correlation.attemptId,
        controllerKey: queueLogMeta.controllerKey,
        dispatchId: correlation.dispatchId,
        queueDepth: enqueueResult.snapshot.queueDepth,
        taskId: correlation.taskId,
        targetLabel: queueLogMeta.targetLabel,
      },
    });
    return;
  }
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.local_execution_slot_accepted",
    text: `local execution slot accepted task ${correlation.taskId} for ${queueLogMeta.targetLabel}`,
    payload: {
      adapterId: queueLogMeta.adapterId,
      activeForLane: enqueueResult.snapshot.activeForLane,
      activeGlobal: enqueueResult.snapshot.activeGlobal,
      connectionGeneration: deliverRequest.connectionGeneration,
      controllerKey: queueLogMeta.controllerKey,
      deliveryRecoveryReason: deliverRequest.deliveryRecoveryReason ?? null,
      dispatchId: correlation.dispatchId,
      durationMs: null,
      errorCode: null,
      globalConcurrency: enqueueResult.snapshot.limits.globalConcurrency,
      localExecutionLaneKey: queueLogMeta.localExecutionLaneKey,
      profileId: deliverRequest.profileId,
      queueDepth: enqueueResult.snapshot.queueDepth,
      queueMax: enqueueResult.snapshot.limits.queueMax,
      result: null,
      spaceId: queueLogMeta.spaceId,
      step: "enqueued",
      taskId: correlation.taskId,
      targetLabel: queueLogMeta.targetLabel,
      transportMode: queueLogMeta.transportMode,
    },
  });
}

function parseDispatchTaskForQueue(input: {
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
}): ParsedDispatchTask | null {
  return parseDispatchTask({
    deliverRequest: input.deliverRequest,
    fallbackRouteConfig:
      input.routeByProfileId.get(input.deliverRequest.profileId) ?? null,
  });
}

function resolveQueueRuntimeAdapterId(input: {
  localAdapterContainer: LocalDaemonAdapterContainer;
  parsedTask: ParsedDispatchTask | null;
}): string | null {
  if (!input.parsedTask) {
    return null;
  }
  const support = resolveLocalRuntimeControllerSupport({
    agentControllerRef: input.parsedTask.agentControllerRef,
    localAdapterContainer: input.localAdapterContainer,
  });
  return support.supported === true
    ? support.runtimeAdapterMatch.adapterId
    : null;
}

function reportInvalidDeliverRequest(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  issues: readonly { message: string; path: readonly unknown[] }[];
  ledgerPaths: LedgerPaths;
  payload: Record<string, unknown>;
  presenter: Presenter;
}): void {
  const identity = resolveInvalidDeliverRequestIdentity({
    fallbackDaemonSessionId: input.daemonSessionId,
    payload: input.payload,
  });
  const issues = summarizeDeliverParseIssues(input.issues);
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.deliver_payload_invalid",
    text: `deliver payload rejected before queueing for dispatch ${identity?.dispatchId ?? "unknown"}`,
    payload: {
      dispatchId: identity?.dispatchId ?? null,
      issues,
      result: "failed",
      taskId: identity?.taskId ?? null,
    },
  });

  if (!identity) {
    return;
  }

  const resultPayload = buildFailedTaskResultPayload({
    attemptId: identity.attemptId,
    agentControllerRef: identity.agentControllerRef,
    errorCode: "schema.invalid",
    errorMessage: buildInvalidDeliverRequestErrorMessage(issues),
    errorType: "config",
    sourceEventId: identity.sourceEventId,
    targetProfileId: identity.targetProfileId,
    taskId: identity.taskId,
  });
  try {
    enqueueDispatchResultOutboxRecord({
      attemptId: identity.attemptId,
      connectionGeneration: identity.connectionGeneration,
      currentSocketRef: input.currentSocketRef,
      daemonSessionId: identity.daemonSessionId,
      dispatchId: identity.dispatchId,
      executionIdentityEcho: identity.executionIdentityEcho,
      executionTokenEcho: identity.executionTokenEcho,
      ledgerPaths: input.ledgerPaths,
      leaseEpoch: identity.leaseEpoch,
      payload: resultPayload,
      presenter: input.presenter,
      runtimeCoordinatorExecutionId: identity.runtimeCoordinatorExecutionId,
      taskId: identity.taskId,
    });
    emitDaemonDispatchJournalEvent({
      attemptId: identity.attemptId,
      connectionGeneration: identity.connectionGeneration,
      daemonSessionId: identity.daemonSessionId,
      dispatchId: identity.dispatchId,
      leaseEpoch: identity.leaseEpoch,
      metadata: {
        ...buildResultDispatchJournalMetadata(resultPayload),
        parseIssues: issues,
      },
      profileId: identity.targetProfileId,
      result: resultPayload.status,
      taskId: identity.taskId,
      type: "dispatch.result.queued",
    });
  } catch (error) {
    emitDaemonDispatchJournalEvent({
      attemptId: identity.attemptId,
      connectionGeneration: identity.connectionGeneration,
      daemonSessionId: identity.daemonSessionId,
      dispatchId: identity.dispatchId,
      leaseEpoch: identity.leaseEpoch,
      metadata: {
        ...buildResultDispatchJournalMetadata(resultPayload),
        errorMessage: toErrorMessage(error),
        parseIssues: issues,
      },
      profileId: identity.targetProfileId,
      result: resultPayload.status,
      taskId: identity.taskId,
      type: "dispatch.result.send_failed",
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.invalid_deliver_result_send_failed",
      text: `failed to send invalid deliver result for dispatch ${identity.dispatchId}: ${toErrorMessage(error)}`,
      payload: {
        dispatchId: identity.dispatchId,
        errorMessage: toErrorMessage(error),
        result: "failed",
        taskId: identity.taskId,
      },
    });
  }
}

function resolveInvalidDeliverRequestIdentity(input: {
  fallbackDaemonSessionId: string;
  payload: Record<string, unknown>;
}): {
  attemptId: string;
  connectionGeneration: number;
  agentControllerRef: string | null;
  daemonSessionId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportResultIdentityEcho;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho | null;
  leaseEpoch: number;
  runtimeCoordinatorExecutionId: string | null;
  sourceEventId: string;
  targetProfileId: string;
  taskId: string;
} | null {
  const taskPayload = toRecord(input.payload.payload);
  const controllerSnapshot = toRecord(taskPayload?.controllerSnapshot);
  const executionIdentity =
    runtimeTransportDeliveryExecutionIdentitySchema.safeParse(
      taskPayload?.executionIdentity
    );
  const attemptId =
    normalizeOptionalText(input.payload.attemptId) ??
    normalizeOptionalText(taskPayload?.attemptId);
  const connectionGeneration = normalizePositiveInteger(
    input.payload.connectionGeneration
  );
  const daemonSessionId =
    normalizeOptionalText(input.payload.daemonSessionId) ??
    input.fallbackDaemonSessionId;
  const dispatchId =
    normalizeOptionalText(input.payload.dispatchId) ??
    normalizeOptionalText(taskPayload?.dispatchId);
  const leaseEpoch = normalizePositiveInteger(input.payload.leaseEpoch);
  const sourceEventId = normalizeOptionalText(taskPayload?.sourceEventId);
  const targetProfileId =
    normalizeOptionalText(taskPayload?.targetProfileId) ??
    normalizeOptionalText(input.payload.profileId);
  const taskId = normalizeOptionalText(taskPayload?.taskId);
  const runtimeCoordinatorExecutionId = normalizeOptionalText(
    taskPayload?.runtimeCoordinatorExecutionId
  );
  const executionTokenEcho = resolveRuntimeCoordinatorExecutionTokenEchoFromRaw(
    taskPayload?.executionToken
  );

  if (
    !(
      attemptId &&
      connectionGeneration &&
      daemonSessionId &&
      dispatchId &&
      executionIdentity.success &&
      leaseEpoch &&
      sourceEventId &&
      targetProfileId &&
      taskId
    )
  ) {
    return null;
  }

  return {
    attemptId,
    connectionGeneration,
    agentControllerRef:
      normalizeOptionalText(controllerSnapshot?.agentControllerRef) ?? null,
    daemonSessionId,
    dispatchId,
    executionIdentityEcho:
      toRuntimeTransportResultIdentityEchoFromDeliveryIdentity(
        executionIdentity.data
      ),
    executionTokenEcho,
    leaseEpoch,
    runtimeCoordinatorExecutionId,
    sourceEventId,
    targetProfileId,
    taskId,
  };
}

function summarizeDeliverParseIssues(
  issues: readonly { message: string; path: readonly unknown[] }[]
): Array<{ message: string; path: string }> {
  return issues.slice(0, 8).map((issue) => ({
    message: issue.message,
    path: issue.path.map((part) => String(part)).join("."),
  }));
}

function buildInvalidDeliverRequestErrorMessage(
  issues: readonly { message: string; path: string }[]
): string {
  const firstIssue = issues[0];
  if (!firstIssue) {
    return "schema.invalid: daemon deliver payload is invalid";
  }
  const path = firstIssue.path || "payload";
  return `schema.invalid: daemon deliver payload is invalid at ${path}: ${firstIssue.message}`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export async function handleDispatchDeliverFrame(input: {
  computerFileAccessStorePath: string;
  contextStore: Map<string, string>;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  /** The folder this task was admitted with; absent for direct callers. */
  executionContextAdmission?: Pick<
    ExecutionContextFolderAdmission,
    "folderKey" | "workspaceChosen"
  >;
  inflightDispatchMetaByTaskId: Map<string, InflightDispatchMeta>;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  ledgerPaths: LedgerPaths;
  leasesByProfileId: Map<string, number>;
  localAdapterContainer: LocalDaemonAdapterContainer;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  /** Direct-edit Sessions already running in this task's folder. */
  readSharedFolderSessions?: () => LocalExecutionSlotSharedFolderSession[];
  requestCurrentWorkingFolderFactRefresh?: () => void;
  presenter: Presenter;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  socket: DaemonFrameSink;
}): Promise<LocalExecutionSlotTaskResult> {
  const { currentSocketRef } = input;
  emitDispatchLocalPhaseJournalEvent({
    deliverRequest: input.deliverRequest,
    metadata: {
      source: "local_execution_slot_task",
    },
    parsedTask: null,
    phase: "task_started",
    result: "started",
  });
  const validatedDispatchInput = resolveValidatedDispatchDeliveryInput({
    currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    ledgerPaths: input.ledgerPaths,
    leasesByProfileId: input.leasesByProfileId,
    localAdapterContainer: input.localAdapterContainer,
    presenter: input.presenter,
    routeByProfileId: input.routeByProfileId,
    socket: input.socket,
  });
  if (validatedDispatchInput.status === "rejected") {
    return validatedDispatchInput.result;
  }
  const { parsedTask, routeConfig, runtimeControllerSupport } =
    validatedDispatchInput;
  const unsupportedControllerResult = maybeRejectUnsupportedController({
    currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    ledgerPaths: input.ledgerPaths,
    parsedTask,
    presenter: input.presenter,
    runtimeControllerSupport,
    socket: input.socket,
  });
  if (unsupportedControllerResult) {
    emitDispatchRuntimeEvidenceTransition({
      currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      deliverRequest: input.deliverRequest,
      parsedTask,
      phase: "failed",
      presenter: input.presenter,
      reasonCode: "controller.kind.unsupported",
    });
    return unsupportedControllerResult;
  }
  assertSupportedRuntimeControllerSupport(runtimeControllerSupport);
  const { pendingAgentInteractionRegistry } = input;
  const onInteractionRequest: AdapterInteractionCallback =
    createSerialAgentInteractionCallback(
      async (request) =>
        await requestDispatchAgentInteraction({
          currentSocketRef,
          daemonSessionId: input.daemonSessionId,
          deliverRequest: input.deliverRequest,
          parsedTask,
          pendingAgentInteractionRegistry,
          presenter: input.presenter,
          request,
          leasesByProfileId: input.leasesByProfileId,
        })
    );
  emitDispatchLocalPhaseJournalEvent({
    deliverRequest: input.deliverRequest,
    metadata: {
      agentControllerRef: parsedTask.agentControllerRef,
      source: "dispatch_preflight",
      streamingMode: parsedTask.streamingMode,
      transportMode: parsedTask.transportMode,
    },
    parsedTask,
    phase: "preflight_ready",
    result: "ready",
  });

  let resultPayload: OpenMeldDaemonTaskResultPayload;
  let continuityObservation: DispatchContinuityObservation | null = null;
  let dispatchExecution: DispatchExecution | null = null;
  let resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
  let resolvedSpaceActionProvenance:
    | OpenMeldDaemonTaskResultPayload["spaceActionProvenance"]
    | undefined;
  let contextLookupKey = "";
  let currentExecutionState: ConversationExecutionState | null = null;
  let existingContextId: string | null = null;
  let latestScopedExecutionState: ConversationExecutionState | null = null;
  let ledgerIo: ReturnType<typeof createLedgerIo> | null = null;
  const currentConversationPolicy =
    resolveCurrentConversationPolicy(routeConfig);
  const bootstrapContext = await resolveDispatchBootstrapContext({
    onPhase: (phase, metadata) => {
      emitDispatchLocalPhaseJournalEvent({
        deliverRequest: input.deliverRequest,
        metadata,
        parsedTask,
        phase,
        result: "ready",
      });
    },
    profileOwnerName: input.profileOwnerName,
    profileOwnerUserId: input.profileOwnerUserId,
    parsedTask,
  });
  let localRuntimeContextPlan: LocalRuntimeContextPlan | null = null;
  let agentControllerConversationResumePlan: AgentControllerConversationResumePlan | null =
    null;
  let contextIdForDispatch: string | null = null;
  let effectiveAgentControllerConversationId: string | null = null;
  let bootstrapPlan: BootstrapPlan | null = null;
  let plannedAgentControllerConversation: AgentControllerConversationRef | null =
    null;
  let observedProviderConversationId: string | null = null;
  let runtimePromptPlan: DispatchPromptPlan | null = null;
  let runtimePromptTrace: DispatchPromptTrace | null = null;
  let settledResultSummary: LocalExecutionSlotTaskResult | null = null;
  const providerAdmissionOwnsRunningLifecycle =
    resolveBuiltinAgentControllerDefinition(
      runtimeControllerSupport.runtimeAdapterMatch.agentId
    )?.executionAdmission === "provider_turn_accepted";
  let runtimeLifecyclePhase: Extract<
    DispatchLifecyclePhase,
    "accepted_local" | "running"
  > = resolveInitialDispatchLifecyclePhase({
    providerAdmissionOwnsRunningLifecycle,
  });
  const lifecycleKeepalive = {
    stop: null as (() => void) | null,
  };
  let firstOutputEvidenceSent = false;
  input.inflightTaskControlRegistry.registerTask({
    adapterId: runtimeControllerSupport.runtimeAdapterMatch.adapterId,
    agentControllerPermissionMode:
      routeConfig?.agentControllerPermissionMode ?? null,
    dispatchId: parsedTask.dispatchId,
    runtimeCoordinatorExecutionId: parsedTask.runtimeCoordinatorExecutionId,
    attemptId: parsedTask.attemptId,
    runtimeCoordinatorRunId: parsedTask.executionTokenEcho.runId,
    targetProfileId: parsedTask.targetProfileId,
    taskId: parsedTask.taskId,
  });
  const runtimeStartedAtMs = Date.now();
  let agentToolActivitySequence = 0;
  let spaceActionReplyStream:
    | ReturnType<typeof watchSpaceActionReply>
    | undefined;
  const reportPublicProgress = createDispatchPublicProgressReporter({
    publish: (progressSnapshot) => {
      const socket = currentSocketRef.socket;
      if (!socket || (socket.bufferedAmount ?? 0) > 64 * 1024) {
        return false;
      }
      sendDispatchProgressFrame({
        socket,
        progressSnapshot,
        observedAtMs: Date.now(),
        sequence: ++agentToolActivitySequence,
        attemptId: parsedTask.attemptId,
        dispatchId: parsedTask.dispatchId,
        daemonSessionId: input.daemonSessionId,
        connectionGeneration: resolveCurrentConnectionGeneration({
          currentSocketRef,
          fallbackConnectionGeneration:
            input.deliverRequest.connectionGeneration,
        }),
        executionIdentityEcho: toRuntimeTransportRuntimeEvidenceIdentityEcho(
          input.deliverRequest
        ),
        executionTokenEcho: parsedTask.executionTokenEcho,
        leaseEpoch: input.deliverRequest.leaseEpoch,
        runtimeCoordinatorExecutionId: parsedTask.runtimeCoordinatorExecutionId,
        sourceSignalId: parsedTask.sourceEventId,
        spaceId: parsedTask.spaceId,
        targetProfileId: parsedTask.targetProfileId,
        taskId: parsedTask.taskId,
      });
      return true;
    },
  });
  let firstReasoningMs: number | undefined;
  const sendReasoning = (
    thinkingSnapshot: string,
    observedAtMs: number,
    status: "streaming" | "waiting" | "disabled" = "streaming"
  ) => {
    const socket = currentSocketRef.socket;
    if (
      runtimeControllerSupport.runtimeAdapterMatch.adapterId === "openclaw" ||
      !socket ||
      currentSocketRef.reasoningStreamEnabled === undefined ||
      (status === "streaming" && (socket.bufferedAmount ?? 0) > 64 * 1024)
    ) {
      return;
    }
    try {
      sendDispatchReasoningFrame({
        socket,
        thinkingSnapshot,
        observedAtMs,
        reasoningState: {
          status,
          ...(firstReasoningMs !== undefined
            ? { firstOutputMs: firstReasoningMs }
            : {}),
        },
        sequence: ++agentToolActivitySequence,
        attemptId: parsedTask.attemptId,
        dispatchId: parsedTask.dispatchId,
        daemonSessionId: input.daemonSessionId,
        connectionGeneration: resolveCurrentConnectionGeneration({
          currentSocketRef,
          fallbackConnectionGeneration:
            input.deliverRequest.connectionGeneration,
        }),
        executionIdentityEcho: toRuntimeTransportRuntimeEvidenceIdentityEcho(
          input.deliverRequest
        ),
        executionTokenEcho: parsedTask.executionTokenEcho,
        leaseEpoch: input.deliverRequest.leaseEpoch,
        runtimeCoordinatorExecutionId: parsedTask.runtimeCoordinatorExecutionId,
        sourceSignalId: parsedTask.sourceEventId,
        spaceId: parsedTask.spaceId,
        targetProfileId: parsedTask.targetProfileId,
        taskId: parsedTask.taskId,
      });
    } catch {
      // Live delivery is best effort; never log its content or fail the run.
    }
  };
  const reasoningStream = createReasoningStream({
    enabled: () =>
      currentSocketRef.reasoningStreamEnabled === true &&
      currentSocketRef.socket !== null,
    send: sendReasoning,
  });
  const clearReasoning = () => {
    reasoningStream.clear();
    sendReasoning(
      "",
      Date.now(),
      currentSocketRef.reasoningStreamEnabled ? "waiting" : "disabled"
    );
  };
  currentSocketRef.reasoningPreferenceListeners ??= new Set();
  currentSocketRef.reasoningPreferenceListeners.add(clearReasoning);
  const observeReasoning = (
    event: Extract<AdapterRuntimeEvent, { phase: "reasoning" }>
  ) => {
    if (firstReasoningMs === undefined && event.text.length > 0) {
      firstReasoningMs = Math.max(0, event.tsMs - runtimeStartedAtMs);
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.reasoning_first_output",
        text: "Local Agent produced its first reasoning output.",
        payload: {
          dispatchId: parsedTask.dispatchId,
          firstOutputMs: firstReasoningMs,
        },
      });
    }
    reasoningStream.observe(event);
  };
  const daemonWorkingDirectory = process.cwd();
  let dispatchRuntimeContext: ProviderDispatchRuntimeContext | null = null;
  let effectiveRuntimeContext: ProviderDispatchRuntimeContext | null = null;
  let runtimeEnvOverrides: Record<string, string | undefined> | undefined;
  let runtimeOpenClawGatewayVisibility: OpenClawGatewayVisibility | null = null;
  let computerFileAccessBoundary: AdapterComputerFileAccessBoundary | null =
    null;
  let runtimeOpenClawBinding:
    | OpenMeldDaemonTaskResultPayload["openClawBinding"]
    | undefined;
  let agentControllerConversationOverride:
    | OpenMeldDaemonTaskResultPayload["agentControllerConversation"]
    | null = null;
  let dispatchSpaceActionContext: DispatchSpaceActionContext | null = null;
  let nativeQuiescence: Promise<void> | undefined;
  let workspaceUse: ExecutionContextWorkspaceUse | null = null;
  let claudeProjectRuntime: ClaudeProjectContainerRuntime | null = null;
  const workspaceProcesses = new Map<number | null, boolean>();
  const observeWorkspaceProcess = (event: AdapterRuntimeEvent) =>
    observeExecutionContextWorkspaceProcess(workspaceProcesses, event);
  let completedTurnId: string | null = null;
  let completedTurnConversationId: string | null = null;
  let completedNativeResult: RuntimeTaskResult | null = null;
  const aiUsage = createDispatchAiUsageCollector();
  let executionContextCompletion: ExecutionContextCompletion | undefined;
  const invalidStateStrategy = executionContextLedgerPolicy(
    parsedTask.executionContext
  );

  try {
    await currentSocketRef.confirmExecutionAdmission?.(input.deliverRequest);
    dispatchRuntimeContext = await resolveDispatchWorkingFolderRuntimeContext({
      ledgerRootPath: input.ledgerPaths.rootDirPath,
      controllerSnapshot: input.deliverRequest.payload.controllerSnapshot,
      defaultProjectId: parsedTask.defaultProjectId,
      defaultProjectIdWasProvided: Object.hasOwn(
        input.deliverRequest.payload,
        "defaultProjectId"
      ),
      executionContext: parsedTask.executionContext,
      ownerUserId: input.profileOwnerUserId,
      executionIdentity: parsedTask.executionIdentity,
      onCurrentWorkingFolderFactRejected:
        input.requestCurrentWorkingFolderFactRefresh,
      routeConfig,
      targetProfileId: parsedTask.targetProfileId,
    });
    dispatchRuntimeContext = {
      providerRuntimeWorkingDirectory:
        await assertExecutionContextAdmittedFolder({
          admission: input.executionContextAdmission,
          context: parsedTask.executionContext,
          workingDirectory:
            dispatchRuntimeContext.providerRuntimeWorkingDirectory,
        }),
    };
    const folderRecovery = await resolveWorkingFolderRecovery({
      agentControllerRef: parsedTask.agentControllerRef,
      nativeSessionId: parsedTask.agentControllerConversationId,
      hasExecutionContext: Boolean(parsedTask.executionContext),
      workingDirectory: dispatchRuntimeContext.providerRuntimeWorkingDirectory,
      policy: await readComputerFileAccessPolicy(
        input.computerFileAccessStorePath
      ),
      onInteractionRequest,
    });
    dispatchRuntimeContext = {
      providerRuntimeWorkingDirectory: folderRecovery.workingDirectory,
    };
    await currentSocketRef.confirmExecutionAdmission?.(input.deliverRequest);
    const skillPreflight = await ensureDispatchControllerOpenMeldSkill({
      agentControllerRef: parsedTask.agentControllerRef,
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.skill_preflight",
      text: "OpenMeld Skill checked for this local agent",
      payload: {
        agentId: skillPreflight.agentId,
        status: skillPreflight.status,
        reason: skillPreflight.reason,
      },
    });
    const runtimePreparation = await prepareDispatchRuntimeExecution({
      agentControllerRef: parsedTask.agentControllerRef,
      daemonWorkingDirectory,
      dispatchRuntimeContext,
      profileName: bootstrapContext.targetProfileName,
      targetProfileId: parsedTask.targetProfileId,
    });
    effectiveRuntimeContext = runtimePreparation.effectiveRuntimeContext;
    const originalWorkingDirectory =
      effectiveRuntimeContext.providerRuntimeWorkingDirectory;
    await verifyDispatchLegacyContextAssociation({
      parsedTask,
      ledgerPaths: input.ledgerPaths,
      originalWorkingDirectory,
    });
    const taskWorkspace = await prepareDispatchTaskWorkspace({
      parsedTask,
      ledgerRootPath: input.ledgerPaths.rootDirPath,
      currentWorkingDirectory: originalWorkingDirectory,
      computerFileAccessStorePath: input.computerFileAccessStorePath,
    });
    const handoffWorkingDirectory = await prepareDispatchWorkHandoff({
      task: parsedTask,
      ownerUserId: input.profileOwnerUserId,
      workingDirectory: taskWorkspace.workingDirectory,
    });
    effectiveRuntimeContext = {
      providerRuntimeWorkingDirectory: handoffWorkingDirectory,
    };
    runtimePreparation.effectiveRuntimeContext = effectiveRuntimeContext;
    claudeProjectRuntime = await prepareDispatchClaudeProjectContainer({
      parsedTask,
      taskWorkspace,
      workingDirectory: handoffWorkingDirectory,
    });
    computerFileAccessBoundary = await resolveDispatchComputerFileAccess({
      claudeProjectRuntime,
      computerFileAccessStorePath: input.computerFileAccessStorePath,
      onInteractionRequest,
      parsedTask,
      presenter: input.presenter,
      routeConfig,
      runtimeControllerSupport,
      runtimePreparation,
      taskWorkspace,
    });
    // First real consumer of the send target reference: the network load has
    // been running concurrently with the local runtime preparation above.
    const [sendTargetReference, imageAttachmentPreparation] = await Promise.all(
      [
        bootstrapContext.sendTargetReferencePromise,
        materializeDispatchImageAttachments({
          agentControllerRef: parsedTask.agentControllerRef,
          attachments: parsedTask.attachments,
          downloadAttachment: ({ attachmentId, spaceId }) =>
            downloadDispatchImageAttachment({
              attachmentId,
              ownerName: input.profileOwnerName,
              ownerUserId: input.profileOwnerUserId,
              spaceId,
              spacePassword: parsedTask.spacePassword,
              targetProfileId: parsedTask.targetProfileId,
              targetProfileName: bootstrapContext.targetProfileName,
            }),
          providerRuntimeWorkingDirectory:
            effectiveRuntimeContext.providerRuntimeWorkingDirectory,
          spaceId: parsedTask.spaceId,
          taskId: parsedTask.taskId,
        }),
      ]
    );
    emitSendTargetReferenceLoadFailureIfNeeded({
      parsedTask,
      presenter: input.presenter,
      sendTargetReference,
    });
    emitDispatchImageAttachmentPreparation({
      parsedTask,
      preparation: imageAttachmentPreparation,
      presenter: input.presenter,
    });
    const spaceActionRuntimeContext = createDispatchSpaceActionRuntimeContext({
      bootstrapContext,
      claudeProjectRuntime,
      ledgerRootPath: input.ledgerPaths.rootDirPath,
      parsedTask,
      runtimePreparation,
      sendTargetReference,
      taskWorkspace,
    });
    dispatchSpaceActionContext =
      spaceActionRuntimeContext.dispatchSpaceActionContext;
    spaceActionReplyStream = watchSpaceActionReply({
      context: dispatchSpaceActionContext,
      connection: () => currentSocketRef.socket,
      onSendError: () =>
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.reply_draft_send_failed",
          text: "The public reply draft could not be sent; final delivery remains pending.",
          payload: {
            dispatchId: parsedTask.dispatchId,
            taskId: parsedTask.taskId,
          },
        }),
      publish: (textSnapshot, placement) => {
        const socket = currentSocketRef.socket;
        if (!socket || (socket.bufferedAmount ?? 0) > 64 * 1024) {
          return false;
        }
        sendDispatchReplyFrame({
          socket,
          textSnapshot,
          ...(placement ? { placement } : {}),
          observedAtMs: Date.now(),
          sequence: ++agentToolActivitySequence,
          attemptId: parsedTask.attemptId,
          dispatchId: parsedTask.dispatchId,
          daemonSessionId: input.daemonSessionId,
          connectionGeneration: resolveCurrentConnectionGeneration({
            currentSocketRef,
            fallbackConnectionGeneration:
              input.deliverRequest.connectionGeneration,
          }),
          executionIdentityEcho: toRuntimeTransportRuntimeEvidenceIdentityEcho(
            input.deliverRequest
          ),
          executionTokenEcho: parsedTask.executionTokenEcho,
          leaseEpoch: input.deliverRequest.leaseEpoch,
          runtimeCoordinatorExecutionId:
            parsedTask.runtimeCoordinatorExecutionId,
          sourceSignalId: parsedTask.sourceEventId,
          spaceId: parsedTask.spaceId,
          targetProfileId: parsedTask.targetProfileId,
          taskId: parsedTask.taskId,
        });
        return true;
      },
    });
    runtimeEnvOverrides = spaceActionRuntimeContext.runtimeEnvOverrides;
    runtimeOpenClawGatewayVisibility =
      runtimePreparation.runtimeOpenClawGatewayVisibility;
    const activeRuntimeContext = effectiveRuntimeContext;
    emitDispatchLocalPhaseJournalEvent({
      deliverRequest: input.deliverRequest,
      metadata: {
        agentControllerRef: parsedTask.agentControllerRef,
        providerRuntimePreparationKind:
          runtimePreparation.runtimePreparationDetails.kind,
        runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
          activeRuntimeContext.providerRuntimeWorkingDirectory
        ),
        source: "dispatch_runtime_context",
      },
      parsedTask,
      phase: "runtime_context_ready",
      result: "ready",
    });
    const dispatchLedgerContext = await loadDispatchLedgerContext({
      contextStore: input.contextStore,
      ledgerPaths: input.ledgerPaths,
      parsedTask,
      originalWorkingDirectory,
      runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        activeRuntimeContext.providerRuntimeWorkingDirectory
      ),
    });
    contextLookupKey = dispatchLedgerContext.contextLookupKey;
    const recoveredConversation = resolveRecoveredLedgerConversation({
      startNewConversation: folderRecovery.startNewConversation,
      bindingConversationId: resolveDispatchBindingConversationId(parsedTask),
      currentExecutionState: dispatchLedgerContext.currentExecutionState,
      existingContextId: dispatchLedgerContext.existingContextId,
    });
    currentExecutionState = recoveredConversation.currentExecutionState;
    existingContextId = recoveredConversation.existingContextId;
    effectiveAgentControllerConversationId =
      resolveEffectiveAgentControllerConversationId({
        agentControllerConversationId:
          recoveredConversation.bindingConversationId,
        existingContextId,
      });
    workspaceUse = await markExecutionContextWorkspaceInUse({
      attemptId: parsedTask.attemptId,
      context: parsedTask.executionContext,
      containerRuntime: claudeProjectRuntime,
      dispatchId: parsedTask.dispatchId,
      ledgerRootPath: input.ledgerPaths.rootDirPath,
    });
    runtimeEnvOverrides = {
      ...runtimeEnvOverrides,
      OPENMELD_PROCESS_SUPERVISION_ID: workspaceUse?.processSupervisionId,
    };
    effectiveAgentControllerConversationId =
      await prepareExecutionContextConversation({
        computerFileAccessBoundary,
        unscopedNativeConversationId: effectiveAgentControllerConversationId,
        context: parsedTask.executionContext,
        currentWorkingDirectory: originalWorkingDirectory,
        forkSourceWorkingDirectory: await resolveForkSourceWorkingDirectory({
          executionContext: parsedTask.executionContext,
          ownerUserId: input.profileOwnerUserId,
          routeConfig,
          targetProfileId: parsedTask.targetProfileId,
        }),
        workingDirectory: activeRuntimeContext.providerRuntimeWorkingDirectory,
        existingNativeConversationId: existingContextId,
        ledgerRootPath: input.ledgerPaths.rootDirPath,
        agentControllerRef: parsedTask.agentControllerRef,
        launchContract: routeConfig?.launchContract,
        onRuntimeEvent: observeWorkspaceProcess,
        processSupervisionId: workspaceUse?.processSupervisionId,
      });
    latestScopedExecutionState =
      dispatchLedgerContext.latestScopedExecutionState;
    ledgerIo = dispatchLedgerContext.ledgerIo;
    input.inflightDispatchMetaByTaskId.set(parsedTask.taskId, {
      agentContextLookupKey: contextLookupKey,
    });
    const runtimeContinuation = resolveProviderRuntimeDispatchContinuation({
      separateConversationScopeId: resolveColleagueLedgerScopeId(parsedTask),
      agentControllerConversationId: effectiveAgentControllerConversationId,
      agentControllerRef: parsedTask.agentControllerRef,
      currentPolicy: currentConversationPolicy,
      existingContextId,
      executionState: currentExecutionState,
      latestKnownRuntimeWorkspaceFingerprint:
        latestScopedExecutionState?.runtimeWorkspaceFingerprint ?? null,
      runtimeContext: activeRuntimeContext,
      runtimePreparationDetails: runtimePreparation.runtimePreparationDetails,
      spaceId: parsedTask.spaceId,
      spaceNameSnapshot: parsedTask.spaceNameSnapshot,
      transportMode: parsedTask.transportMode,
    });
    localRuntimeContextPlan = runtimeContinuation.localRuntimeContextPlan;
    agentControllerConversationResumePlan =
      runtimeContinuation.agentControllerConversationResumePlan;
    runtimeOpenClawBinding =
      runtimeContinuation.taskResultProviderFacts.openClawBinding;
    contextIdForDispatch =
      resolveDispatchContextIdForAgentControllerConversation({
        agentControllerConversationId: effectiveAgentControllerConversationId,
        agentControllerConversationOverride:
          runtimeContinuation.agentControllerConversationOverride,
        agentControllerConversationResumePlan,
      });
    plannedAgentControllerConversation =
      resolvePlannedAgentControllerConversation({
        agentControllerConversationId: contextIdForDispatch,
        agentControllerRef: parsedTask.agentControllerRef,
      });
    observedProviderConversationId = contextIdForDispatch;
    bootstrapPlan = resolveBootstrapPlan({
      bootstrapTemplateFacts: bootstrapContext.bootstrapTemplateFacts,
      executionState: currentExecutionState,
      localRuntimeContextPlan,
      nowMs: Date.now(),
    });
    emitDispatchLocalPhaseJournalEvent({
      deliverRequest: input.deliverRequest,
      metadata: {
        bootstrapReason: bootstrapPlan.reason,
        bootstrapShouldInject: bootstrapPlan.shouldInject,
        existingContextPresent: existingContextId !== null,
        localRuntimeContextStatus: localRuntimeContextPlan.status,
        source: "dispatch_ledger_context",
        agentControllerConversationResumeStatus:
          agentControllerConversationResumePlan.status,
      },
      parsedTask,
      phase: "ledger_context_ready",
      result: "ready",
    });
    const baseRuntimePromptPlan = applyDispatchSkillInstructions(
      buildDispatchRuntimePrompt({
        workingFolderDisplayName:
          await resolveNonOwnerWorkingFolderDisplayName(parsedTask),
        bootstrapContext,
        imageAttachmentPreparation,
        parsedTask,
        profileOwnerName: input.profileOwnerName,
        profileOwnerUserId: input.profileOwnerUserId,
        sendTargetReference,
        sharedFolderSessions: toDispatchSharedFolderSessions(
          input.readSharedFolderSessions,
          parsedTask
        ),
        shouldInjectBootstrap: bootstrapPlan.shouldInject,
        taskWorkspace,
      }),
      skillPreflight
    );
    runtimePromptPlan = computerFileAccessBoundary
      ? applyComputerFileAccessAwareness({
          policy: computerFileAccessBoundary,
          promptPlan: baseRuntimePromptPlan,
        })
      : baseRuntimePromptPlan;
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.bootstrap_context",
      text: `bootstrap context prepared for ${parsedTask.spaceId}/${parsedTask.targetProfileId}`,
      payload: {
        activationTargetCount:
          parsedTask.sourceMessageEnvelope?.activationTargets.length ?? 0,
        dispatchId: parsedTask.dispatchId,
        dispatchTriggerSource: parsedTask.dispatchTriggerSource,
        messageEnvelopePresent: parsedTask.sourceMessageEnvelope !== null,
        referenceTargetCount:
          parsedTask.sourceMessageEnvelope?.referenceTargets.length ?? 0,
        sourceEventId: parsedTask.sourceEventId,
        targetProfileId: parsedTask.targetProfileId,
      },
    });
    runtimePromptTrace = buildDispatchPromptTrace({
      prompt: runtimePromptPlan.fallbackPrompt,
      protectedInformation: parsedTask.organizationProtectedInformation,
    });
    await prepareBootstrapExecutionStateIfNeeded({
      bootstrapPlan,
      bootstrapTemplateFacts: bootstrapContext.bootstrapTemplateFacts,
      contextIdForDispatch,
      contextLookupKey,
      currentExecutionState,
      effectiveRuntimeWorkingDirectory:
        activeRuntimeContext.providerRuntimeWorkingDirectory,
      ledgerIo,
      ledgerPaths: input.ledgerPaths,
      parsedTask,
      presenter: input.presenter,
    });
    agentControllerConversationOverride =
      runtimeContinuation.agentControllerConversationOverride;
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.runtime_started",
      text: `runtime started for task ${parsedTask.taskId}`,
      payload: {
        attemptId: parsedTask.attemptId,
        agentControllerRef: parsedTask.agentControllerRef,
        deliveryRecoveryReason: parsedTask.deliveryRecoveryReason,
        dispatchId: parsedTask.dispatchId,
        existingContextId: contextIdForDispatch,
        localRuntimeContextReason: localRuntimeContextPlan.reason,
        localRuntimeContextStatus: localRuntimeContextPlan.status,
        daemonWorkingDirectory,
        providerRuntimeWorkingDirectory:
          activeRuntimeContext.providerRuntimeWorkingDirectory,
        spaceId: parsedTask.spaceId,
        streamingMode: parsedTask.streamingMode,
        targetProfileId: parsedTask.targetProfileId,
        taskId: parsedTask.taskId,
        transportMode: parsedTask.transportMode,
        agentControllerConversationResumeStatus:
          agentControllerConversationResumePlan.status,
        ...(agentControllerConversationResumePlan.status === "blocked"
          ? {
              agentControllerConversationResumeReason:
                agentControllerConversationResumePlan.reason,
            }
          : {}),
      },
    });
    emitDispatchRuntimeEvidenceTransition({
      currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      deliverRequest: input.deliverRequest,
      parsedTask,
      phase: "runtime_started",
      presenter: input.presenter,
    });
    const transitionDispatchLifecycle = (inputLifecycle: {
      agentControllerConversationOccupancy?: RuntimeTransportAgentControllerConversationOccupancy | null;
      phase: Extract<DispatchLifecyclePhase, "accepted_local" | "running">;
    }): void => {
      runtimeLifecyclePhase = inputLifecycle.phase;
      lifecycleKeepalive.stop?.();
      emitDispatchLifecycleTransition({
        agentControllerConversationOccupancy:
          inputLifecycle.agentControllerConversationOccupancy ?? null,
        attemptId: parsedTask.attemptId,
        connectionGeneration: input.deliverRequest.connectionGeneration,
        currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        dispatchId: parsedTask.dispatchId,
        leaseEpoch: input.deliverRequest.leaseEpoch,
        phase: runtimeLifecyclePhase,
        presenter: input.presenter,
        executionTokenEcho: parsedTask.executionTokenEcho,
        runtimeCoordinatorExecutionId: parsedTask.runtimeCoordinatorExecutionId,
        taskId: parsedTask.taskId,
      });
      // The Service socket already proves carrier liveness. Before a native
      // turn is accepted, repeating accepted_local would falsely refresh the
      // coordinator's execution-progress watchdog. Occupied waits retain their
      // existing, explicitly non-progressing occupancy keepalive contract.
      if (
        runtimeLifecyclePhase === "accepted_local" &&
        inputLifecycle.agentControllerConversationOccupancy?.state !==
          "occupied"
      ) {
        lifecycleKeepalive.stop = null;
        return;
      }
      lifecycleKeepalive.stop = startDispatchLifecycleKeepalive({
        agentControllerConversationOccupancy:
          inputLifecycle.agentControllerConversationOccupancy ?? null,
        attemptId: parsedTask.attemptId,
        connectionGeneration: input.deliverRequest.connectionGeneration,
        currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        dispatchId: parsedTask.dispatchId,
        leaseEpoch: input.deliverRequest.leaseEpoch,
        phase: runtimeLifecyclePhase,
        presenter: input.presenter,
        executionTokenEcho: parsedTask.executionTokenEcho,
        runtimeCoordinatorExecutionId: parsedTask.runtimeCoordinatorExecutionId,
        taskId: parsedTask.taskId,
      });
    };
    transitionDispatchLifecycle({ phase: runtimeLifecyclePhase });
    emitDispatchLocalPhaseJournalEvent({
      deliverRequest: input.deliverRequest,
      metadata: {
        agentControllerRef: parsedTask.agentControllerRef,
        localRuntimeContextStatus: localRuntimeContextPlan.status,
        streamingMode: parsedTask.streamingMode,
        transportMode: parsedTask.transportMode,
        agentControllerConversationResumeStatus:
          agentControllerConversationResumePlan.status,
      },
      parsedTask,
      phase: "runtime_invocation_started",
      result: "started",
    });
    const providerConversationLedgerIo = ledgerIo;
    if (!providerConversationLedgerIo) {
      throw new DaemonServiceRunError({
        code: "dispatch.ledger.unavailable",
        message:
          "dispatch.ledger.unavailable: dispatch ledger is not initialized",
      });
    }
    let recordedOpenMeldCreatedSessionId: string | null = null;
    const recordProviderConversationObservation = (observation: {
      agentControllerConversationId: string | null | undefined;
      agentControllerConversation?: AgentControllerConversationRef | null;
      source: "runtime_event" | "runtime_result";
    }): string | null => {
      const agentControllerConversationId = normalizeOptionalContextId(
        observation.agentControllerConversationId
      );
      if (!agentControllerConversationId) {
        return null;
      }
      observedProviderConversationId = agentControllerConversationId;
      if (recordedOpenMeldCreatedSessionId !== agentControllerConversationId) {
        recordedOpenMeldCreatedSessionId = agentControllerConversationId;
        recordOpenMeldCreatedLocalAgentSession({
          agentControllerRef: parsedTask.agentControllerRef,
          nativeSessionId: agentControllerConversationId,
          ...(parsedTask.executionContext?.projectWork
            ? {
                projectAttribution: {
                  organizationId:
                    parsedTask.executionContext.scope.organizationId,
                  ...parsedTask.executionContext.projectWork,
                },
              }
            : {}),
        }).catch((error) => {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.session_inventory_origin_record_failed",
            text: `Session Inventory origin could not be recorded for task ${parsedTask.taskId}`,
            payload: {
              dispatchId: parsedTask.dispatchId,
              errorMessage: toErrorMessage(error),
              targetProfileId: parsedTask.targetProfileId,
              taskId: parsedTask.taskId,
            },
          });
        });
      }
      const persistProviderConversationObservation = withLedgerStateTransaction(
        {
          invalidStateStrategy,
          io: providerConversationLedgerIo,
          mutate: (state) => ({
            nextState: commitResolvedAgentContext({
              state,
              agentContextLookupKey: contextLookupKey,
              agentControllerConversationId,
              agentControllerRef: parsedTask.agentControllerRef,
              spaceId: parsedTask.spaceId,
              targetProfileId: parsedTask.targetProfileId,
              transportMode: parsedTask.transportMode,
              runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
                activeRuntimeContext.providerRuntimeWorkingDirectory
              ),
              taskId: parsedTask.taskId,
              nowMs: Date.now(),
            }),
            value: undefined,
          }),
          paths: input.ledgerPaths,
        }
      );
      persistProviderConversationObservation.catch((error) => {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.provider_conversation_observation_ignored",
          text: `provider conversation observation could not be persisted for task ${parsedTask.taskId}`,
          payload: {
            dispatchId: parsedTask.dispatchId,
            errorMessage: toErrorMessage(error),
            source: observation.source,
            targetProfileId: parsedTask.targetProfileId,
            taskId: parsedTask.taskId,
          },
        });
      });
      return agentControllerConversationId;
    };
    let usageObservationAuthPromise: ReturnType<
      typeof probeAgentControllerUsageObservationAuth
    > | null = null;
    const syncAgentControllerConversationOccupancyLifecycle = (
      event: AdapterRuntimeEvent
    ) => {
      if (
        event.phase !== "agent_controller_conversation_available" &&
        event.phase !== "agent_controller_conversation_occupied"
      ) {
        return;
      }
      const occupancy = {
        agentControllerConversationId: event.agentControllerConversationId,
        contractVersion: event.contractVersion,
        state:
          event.phase === "agent_controller_conversation_occupied"
            ? ("occupied" as const)
            : ("available" as const),
      } satisfies RuntimeTransportAgentControllerConversationOccupancy;
      transitionDispatchLifecycle({
        agentControllerConversationOccupancy: occupancy,
        phase: runtimeLifecyclePhase,
      });
    };
    const syncProviderTurnAcceptedLifecycle = (
      event: AdapterRuntimeEvent
    ): void => {
      if (event.phase !== "provider_turn_accepted") {
        return;
      }
      completedTurnId = event.turnId;
      completedTurnConversationId = event.agentControllerConversationId;
      if (
        providerAdmissionOwnsRunningLifecycle &&
        runtimeLifecyclePhase !== "running"
      ) {
        transitionDispatchLifecycle({ phase: "running" });
      }
      emitDispatchLocalPhaseJournalEvent({
        deliverRequest: input.deliverRequest,
        metadata: {
          agentControllerConversationId: event.agentControllerConversationId,
          turnId: event.turnId,
        },
        parsedTask,
        phase: "provider_turn_accepted",
        result: "accepted",
      });
    };
    const onNativeTurnStarted = async () => {
      await currentSocketRef.confirmExecutionAdmission?.(input.deliverRequest);
      completedTurnId = null;
      completedTurnConversationId = null;
      executionContextCompletion = undefined;
      completedNativeResult = null;
    };
    const onNativeTurnCompleted = (result: RuntimeTaskResult) => {
      completedNativeResult = result;
      aiUsage.observe(result.resultPayload.telemetry);
    };
    const onRuntimeEvent = routeReasoningEvents(observeReasoning, (event) => {
      observeWorkspaceProcess(event);
      syncAgentControllerConversationOccupancyLifecycle(event);
      syncProviderTurnAcceptedLifecycle(event);
      if (event.phase === "tool_activity") {
        agentToolActivitySequence += 1;
        emitDispatchAgentToolActivityFrame({
          currentSocketRef,
          daemonSessionId: input.daemonSessionId,
          deliverRequest: input.deliverRequest,
          event,
          parsedTask,
          presenter: input.presenter,
          sequence: agentToolActivitySequence,
        });
      }
      if (event.phase === "provider_conversation_observed") {
        recordProviderConversationObservation({
          agentControllerConversation:
            event.agentControllerConversation ?? null,
          agentControllerConversationId: event.agentControllerConversationId,
          source: "runtime_event",
        });
      }
      if (
        event.phase === "provider_usage_limits_observed" &&
        routeConfig?.launchContract
      ) {
        const agentId = runtimeControllerSupport.runtimeAdapterMatch.adapterId;
        const launchContract = routeConfig.launchContract;
        usageObservationAuthPromise ??=
          probeAgentControllerUsageObservationAuth({
            agentId,
            launchContract,
          });
        const recordUsageLimits = usageObservationAuthPromise.then(
          (authSnapshot) =>
            recordRuntimeProviderUsageLimits({
              agentId,
              authSnapshot,
              launchContract,
              usageAdmission: event.usageAdmission,
              usageAccountKey: event.usageAccountKey,
              usageLimits: event.usageLimits,
            })
        );
        recordUsageLimits
          .then((retained) => {
            if (retained) {
              return;
            }
            emitRunLine({
              presenter: input.presenter,
              code: "daemon.run.provider_usage_limits_observation_ignored",
              text: `provider usage limit observation could not be retained for task ${parsedTask.taskId}`,
              payload: {
                agentControllerRef: parsedTask.agentControllerRef,
                dispatchId: parsedTask.dispatchId,
                observedLimitKeys: event.usageLimits.map((limit) => limit.key),
                reasonCode: "provider_account_unconfirmed",
                targetProfileId: parsedTask.targetProfileId,
                taskId: parsedTask.taskId,
              },
            });
          })
          .catch((error) => {
            emitRunLine({
              presenter: input.presenter,
              code: "daemon.run.provider_usage_limits_observation_ignored",
              text: `provider usage limit observation could not be retained for task ${parsedTask.taskId}`,
              payload: {
                agentControllerRef: parsedTask.agentControllerRef,
                dispatchId: parsedTask.dispatchId,
                errorMessage: toErrorMessage(error),
                observedLimitKeys: event.usageLimits.map((limit) => limit.key),
                targetProfileId: parsedTask.targetProfileId,
                taskId: parsedTask.taskId,
              },
            });
          });
      }
      if (
        !firstOutputEvidenceSent &&
        (event.phase === "first_stdout" || event.phase === "first_stderr")
      ) {
        firstOutputEvidenceSent = true;
        emitDispatchRuntimeEvidenceTransition({
          currentSocketRef,
          daemonSessionId: input.daemonSessionId,
          deliverRequest: input.deliverRequest,
          durationMs: Math.max(0, event.tsMs - runtimeStartedAtMs),
          parsedTask,
          phase: "first_output",
          presenter: input.presenter,
        });
      }
      const controlRegistrySyncResult =
        syncRuntimeEventToInflightTaskControlRegistry({
          event,
          registry: input.inflightTaskControlRegistry,
          taskId: parsedTask.taskId,
        });
      if (controlRegistrySyncResult.updated) {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.control_registry_synced",
          text: `control registry synced for task ${parsedTask.taskId}`,
          payload: {
            dispatchId: parsedTask.dispatchId,
            phase: event.phase,
            processId: controlRegistrySyncResult.processId,
            targetProfileId: parsedTask.targetProfileId,
            taskId: parsedTask.taskId,
          },
        });
      }
      if (event.phase === "process_spawned" || event.phase === "process_exit") {
        emitDispatchLocalPhaseJournalEvent({
          deliverRequest: input.deliverRequest,
          metadata: buildProviderProcessJournalMetadata({
            agentControllerRef: parsedTask.agentControllerRef,
            event,
            runtimeStartedAtMs,
          }),
          parsedTask,
          phase: event.phase,
          result: event.phase === "process_exit" ? "exited" : "spawned",
        });
      }
      emitProviderRuntimePhaseLine({
        agentControllerRef: parsedTask.agentControllerRef,
        dispatchId: parsedTask.dispatchId,
        event,
        presenter: input.presenter,
        runtimeStartedAtMs,
        targetProfileId: parsedTask.targetProfileId,
        taskId: parsedTask.taskId,
      });
    });
    clearReasoning();
    const runtimeExecutionPromise = Promise.resolve(
      runDispatchRuntimeExecution({
        computerFileAccessBoundary,
        contextId: contextIdForDispatch,
        executionMode: "normal",
        io: ledgerIo,
        ledgerPaths: input.ledgerPaths,
        onInteractionRequest,
        onNativeTurnStarted,
        onNativeTurnCompleted,
        onPublicProgress: reportPublicProgress,
        onRuntimeEvent,
        onPreview: (preview) => {
          emitDispatchPreviewFrame({
            attemptId: parsedTask.attemptId,
            connectionGeneration: input.deliverRequest.connectionGeneration,
            currentSocketRef,
            daemonSessionId: input.daemonSessionId,
            dispatchId: parsedTask.dispatchId,
            leaseEpoch: input.deliverRequest.leaseEpoch,
            presenter: input.presenter,
            previewText: preview.text,
            taskId: parsedTask.taskId,
          });
        },
        parsedTask,
        instructionPrompt: runtimePromptPlan,
        prompt: runtimePromptPlan.fallbackPrompt,
        routeConfig,
        runtimeContext: activeRuntimeContext,
        runtimeEnvOverrides,
        runtimeControllerSupport,
        agentControllerConversationOverride,
      })
    );
    const controllerTurnCompletion = runtimeExecutionPromise.then(
      () => undefined,
      () => undefined
    );
    nativeQuiescence = controllerTurnCompletion;
    let runtimeResult = await applyCliSpaceActionRecordIfPresent({
      dispatchSpaceActionContext,
      parsedTask,
      presenter: input.presenter,
      runtimeResult: await runtimeExecutionPromise,
    });
    const structuredSpaceActionOutcome =
      await resolveRuntimeResultStructuredSpaceAction({
        onInteractionRequest,
        onNativeTurnStarted,
        onNativeTurnCompleted,
        onRuntimeEvent,
        computerFileAccessBoundary,
        controllerTurnCompletion,
        inflightTaskControlRegistry: input.inflightTaskControlRegistry,
        ledgerIo,
        ledgerPaths: input.ledgerPaths,
        instructionPrompt: runtimePromptPlan,
        parsedTask,
        profileOwnerName: input.profileOwnerName,
        profileOwnerUserId: input.profileOwnerUserId,
        presenter: input.presenter,
        routeConfig,
        cliEntry: bootstrapContext.cliEntry,
        dispatchSpaceActionContext,
        runtimeResult,
        sendTargetReference,
        runtimeContext: activeRuntimeContext,
        runtimeEnvOverrides,
        runtimeControllerSupport,
        agentControllerConversationOverride,
      });
    runtimeResult = structuredSpaceActionOutcome.runtimeResult;
    resolvedSpaceAction = structuredSpaceActionOutcome.resolvedSpaceAction;
    resolvedSpaceActionProvenance =
      structuredSpaceActionOutcome.resolvedSpaceActionProvenance;
    emitRuntimeObservationSummaryLine({
      agentControllerRef: parsedTask.agentControllerRef,
      dispatchId: parsedTask.dispatchId,
      presenter: input.presenter,
      runtimeResult,
      targetProfileId: parsedTask.targetProfileId,
      taskId: parsedTask.taskId,
    });

    const contextDelta = resolveDispatchContextDeltaFromRuntimeResult(
      runtimeResult.dispatchResult
    );
    const contextHealed =
      contextDelta?.refreshed === true ||
      resolveAdapterTelemetry(runtimeResult.dispatchResult)?.contextHealed ===
        true;
    continuityObservation = resolveDispatchContinuityObservation({
      contextHealed,
      existingContextId: contextIdForDispatch,
      resolvedContextId:
        normalizeOptionalContextId(
          runtimeResult.contextResolution?.agentControllerConversationId ??
            contextDelta?.agentControllerConversationId ??
            null
        ) ?? null,
    });
    await withLedgerStateTransaction({
      invalidStateStrategy,
      io: ledgerIo,
      mutate: (state) => {
        let nextState = state;
        if (contextDelta?.agentControllerConversationId) {
          nextState = commitResolvedAgentContext({
            state: nextState,
            agentContextLookupKey: contextLookupKey,
            agentControllerConversationId:
              contextDelta.agentControllerConversationId,
            agentControllerRef: parsedTask.agentControllerRef,
            spaceId: parsedTask.spaceId,
            targetProfileId: parsedTask.targetProfileId,
            transportMode: parsedTask.transportMode,
            runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
              activeRuntimeContext.providerRuntimeWorkingDirectory
            ),
            taskId: parsedTask.taskId,
            nowMs: Date.now(),
          });
        }
        const nextExecutionState =
          reconcileBootstrapInjectedContextAfterDispatch({
            executionState:
              resolveConversationExecutionStateByLookupKey({
                agentContextLookupKey: contextLookupKey,
                state: nextState,
              }) ?? currentExecutionState,
            bootstrapTemplateFacts: bootstrapContext.bootstrapTemplateFacts,
            continuityObservation,
            contextHealed,
            dispatchedContextId:
              contextDelta?.agentControllerConversationId ?? null,
            effectiveRuntimeWorkingDirectory:
              activeRuntimeContext.providerRuntimeWorkingDirectory,
            nowIso: new Date().toISOString(),
            resolvedAgentControllerConversation:
              contextDelta?.agentControllerConversation ??
              runtimeResult.contextResolution?.agentControllerConversation ??
              null,
            shouldInjectBootstrap: bootstrapPlan?.shouldInject === true,
          });
        if (nextExecutionState) {
          nextState = upsertConversationExecutionStateForLookupKey({
            state: nextState,
            executionState: nextExecutionState,
            replacedLookupKey:
              currentExecutionState?.agentContextLookupKey ?? null,
            targetLookupKey: contextLookupKey,
          });
        }
        return {
          nextState,
          value: nextState,
        };
      },
      paths: input.ledgerPaths,
    });

    emitContextHealedLineIfNeeded({
      contextDelta,
      parsedTask,
      presenter: input.presenter,
    });

    const {
      bootstrapPlan: completedBootstrapPlan,
      ledgerIo: completedLedgerIo,
      localRuntimeContextPlan: completedLocalRuntimeContextPlan,
      runtimePromptPlan: completedRuntimePromptPlan,
    } = requireCompletedDispatchPlans({
      bootstrapPlan,
      ledgerIo,
      localRuntimeContextPlan,
      runtimePromptPlan,
    });
    const completedAgentControllerConversationOverride =
      agentControllerConversationOverride ?? null;
    const buildCurrentResultPayload =
      async (): Promise<OpenMeldDaemonTaskResultPayload> => {
        // A recorded CLI reply is a proposal, not the native turn's completion.
        // Its final usage belongs in the same durable result submission.
        await controllerTurnCompletion;
        const currentContextDelta =
          resolveDispatchContextDeltaFromRuntimeResult(
            runtimeResult.dispatchResult
          );
        const observedAgentControllerConversation =
          resolveObservedDispatchAgentControllerConversation({
            plannedAgentControllerConversation,
            contextDelta: currentContextDelta,
            contextResolution: runtimeResult.contextResolution ?? null,
            agentControllerConversationOverride:
              completedAgentControllerConversationOverride,
          });
        const finalNativeResult =
          completedNativeResult as RuntimeTaskResult | null;
        const nativeConversationId =
          (finalNativeResult
            ? resolveDispatchContextDeltaFromRuntimeResult(
                finalNativeResult.dispatchResult
              )?.agentControllerConversationId
            : null) ??
          finalNativeResult?.contextResolution?.agentControllerConversationId ??
          currentContextDelta?.agentControllerConversationId ??
          runtimeResult.contextResolution?.agentControllerConversationId ??
          observedAgentControllerConversation?.agentControllerConversationId ??
          observedProviderConversationId;
        executionContextCompletion = await captureExecutionContextCompletion({
          context: parsedTask.executionContext,
          reportWorkspace: input.executionContextAdmission?.workspaceChosen,
          nativeConversationId,
          agentControllerRef: parsedTask.agentControllerRef,
          workingDirectory:
            activeRuntimeContext.providerRuntimeWorkingDirectory,
          completedTurnId:
            completedTurnConversationId === nativeConversationId
              ? completedTurnId
              : null,
          providerSucceeded:
            finalNativeResult?.resultPayload.status === "success" ||
            finalNativeResult?.resultPayload.status === "partial_success",
        });
        dispatchExecution = buildDispatchExecution({
          bootstrapPlan: completedBootstrapPlan,
          agentControllerConversationId: effectiveAgentControllerConversationId,
          localRuntimeContextPlan: completedLocalRuntimeContextPlan,
          observedAgentControllerConversation,
          plannedAgentControllerConversation,
        });
        return aiUsage.apply({
          ...resolveDispatchResultPayload({
            attemptId: parsedTask.attemptId,
            contextDelta: currentContextDelta,
            contextResolution: runtimeResult.contextResolution ?? null,
            basePayload: runtimeResult.resultPayload,
            bootstrapTemplateFacts: bootstrapContext.bootstrapTemplateFacts,
            agentControllerRef: parsedTask.agentControllerRef,
            dispatchExecution,
            existingContextId: contextIdForDispatch,
            openClawBinding: runtimeOpenClawBinding,
            openClawGatewayVisibility: runtimeOpenClawGatewayVisibility,
            promptTrace: runtimePromptTrace,
            agentControllerConversationForDispatch:
              observedAgentControllerConversation ??
              plannedAgentControllerConversation,
            workingDirectory:
              activeRuntimeContext.providerRuntimeWorkingDirectory,
            spaceAction: resolvedSpaceAction,
            spaceActionProvenance: resolvedSpaceActionProvenance,
            sourceEventId: parsedTask.sourceEventId,
            targetProfileId: parsedTask.targetProfileId,
            taskId: parsedTask.taskId,
          }),
          executionContextId: parsedTask.executionContext?.id,
          executionContextCompletion,
        });
      };
    resultPayload = await buildCurrentResultPayload();
    const replySettlement = await settleAgentReplyProposals({
      initialResultPayload: resultPayload,
      reconsider: async (agentReplyObservationCursor) => {
        spaceActionReplyStream?.resume();
        const reconsidered = await resolveRuntimeResultStructuredSpaceAction({
          onInteractionRequest,
          onNativeTurnStarted,
          onNativeTurnCompleted,
          onRuntimeEvent,
          agentReplyObservationCursor,
          computerFileAccessBoundary,
          controllerTurnCompletion,
          inflightTaskControlRegistry: input.inflightTaskControlRegistry,
          ledgerIo: completedLedgerIo,
          ledgerPaths: input.ledgerPaths,
          instructionPrompt: completedRuntimePromptPlan,
          parsedTask,
          profileOwnerName: input.profileOwnerName,
          profileOwnerUserId: input.profileOwnerUserId,
          presenter: input.presenter,
          routeConfig,
          cliEntry: bootstrapContext.cliEntry,
          dispatchSpaceActionContext,
          runtimeResult,
          sendTargetReference,
          runtimeContext: activeRuntimeContext,
          runtimeEnvOverrides,
          runtimeControllerSupport,
          agentControllerConversationOverride,
        });
        runtimeResult = reconsidered.runtimeResult;
        resolvedSpaceAction = reconsidered.resolvedSpaceAction;
        resolvedSpaceActionProvenance =
          reconsidered.resolvedSpaceActionProvenance;
        return await buildCurrentResultPayload();
      },
      submit: (payload) => {
        // Core can retire the token before the settlement acknowledgement.
        // Keep the draft quiet until Core requests another authoring turn.
        spaceActionReplyStream?.pause();
        return sendResultAndSummarize({
          attemptId: parsedTask.attemptId,
          connectionGeneration: input.deliverRequest.connectionGeneration,
          currentSocketRef,
          daemonSessionId: input.daemonSessionId,
          dispatchId: parsedTask.dispatchId,
          emitCompletedLifecycle: false,
          executionIdentityEcho: toRuntimeTransportResultIdentityEcho(
            input.deliverRequest
          ),
          executionTokenEcho: parsedTask.executionTokenEcho,
          leaseEpoch: input.deliverRequest.leaseEpoch,
          payload,
          presenter: input.presenter,
          runtimeCoordinatorExecutionId:
            parsedTask.runtimeCoordinatorExecutionId,
          ledgerPaths: input.ledgerPaths,
          taskId: parsedTask.taskId,
          waitForSettlement: true,
        });
      },
    });
    resultPayload = replySettlement.resultPayload;
    settledResultSummary = replySettlement.resultSummary;
    const runtimeObservationPayload = buildRuntimeObservationPayload({
      continuityObservation,
      dispatchId: parsedTask.dispatchId,
      daemonWorkingDirectory,
      deliveryRecoveryReason: parsedTask.deliveryRecoveryReason,
      providerRuntimeWorkingDirectory:
        activeRuntimeContext.providerRuntimeWorkingDirectory,
      resultPayload,
      runtimeResult,
      runtimeStartedAtMs,
      taskId: parsedTask.taskId,
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.runtime_completed",
      text: `runtime completed for task ${parsedTask.taskId}`,
      payload: runtimeObservationPayload,
    });
    emitDispatchLocalPhaseJournalEvent({
      deliverRequest: input.deliverRequest,
      metadata: runtimeObservationPayload,
      parsedTask,
      phase: "runtime_completed",
      result: resultPayload.status,
    });
    emitContinuityWarningIfNeeded({
      continuityObservation,
      parsedTask,
      presenter: input.presenter,
    });
  } catch (error) {
    await rollbackBootstrapExecutionStateAfterFailureIfNeeded({
      bootstrapPlan,
      contextLookupKey,
      currentExecutionState,
      ledgerIo,
      ledgerPaths: input.ledgerPaths,
    });
    const runtimeFailedAtMs = Date.now();
    const typedError = toTaskExecutionErrorInternal(error);
    resultPayload = buildFailedTaskResultPayload({
      attemptId: parsedTask.attemptId,
      agentControllerRef: parsedTask.agentControllerRef,
      errorCode: typedError.errorCode,
      errorMessage: `${typedError.errorCode}: ${typedError.message}`,
      errorType: typedError.errorType,
      openClawBinding: runtimeOpenClawBinding,
      openClawGatewayVisibility: mergeOpenClawGatewayVisibilityInternal({
        primary: typedError.openClawGatewayVisibility,
        fallback: runtimeOpenClawGatewayVisibility,
      }),
      projectFailureContext: typedError.projectFailureContext,
      promptTrace: runtimePromptTrace,
      sourceEventId: parsedTask.sourceEventId,
      targetProfileId: parsedTask.targetProfileId,
      taskId: parsedTask.taskId,
      agentControllerConversation: agentControllerConversationOverride,
      ...(effectiveRuntimeContext
        ? {
            effectiveRuntimeWorkingDirectory:
              effectiveRuntimeContext.providerRuntimeWorkingDirectory,
          }
        : {}),
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.runtime_completed",
      text: `runtime failed for task ${parsedTask.taskId}`,
      payload: {
        attemptId: parsedTask.attemptId,
        daemonWorkingDirectory,
        dispatchId: parsedTask.dispatchId,
        deliveryRecoveryReason: parsedTask.deliveryRecoveryReason,
        errorCode: typedError.errorCode,
        projectFailureContext: typedError.projectFailureContext,
        ...(effectiveRuntimeContext
          ? {
              providerRuntimeWorkingDirectory:
                effectiveRuntimeContext.providerRuntimeWorkingDirectory,
            }
          : {}),
        result: resultPayload.status,
        runtimeDurationMs: runtimeFailedAtMs - runtimeStartedAtMs,
        taskId: parsedTask.taskId,
      },
    });
  } finally {
    spaceActionReplyStream?.stop();
    await nativeQuiescence;
    await releaseDispatchTaskWorkspace({
      workspaceUse,
      parsedTask,
      ledgerRootPath: input.ledgerPaths.rootDirPath,
      workspaceProcesses,
      presenter: input.presenter,
      reportPublicProgress,
    });
    reasoningStream.dispose();
    currentSocketRef.reasoningPreferenceListeners?.delete(clearReasoning);
    lifecycleKeepalive.stop?.();
    lifecycleKeepalive.stop = null;
    input.inflightDispatchMetaByTaskId.delete(parsedTask.taskId);
    input.inflightTaskControlRegistry.removeTask(parsedTask.taskId);
    pendingAgentInteractionRegistry.removeTask(parsedTask.taskId);
  }

  resultPayload = aiUsage.apply({
    ...resultPayload,
    executionContextId: parsedTask.executionContext?.id,
    executionContextCompletion,
  });

  emitDispatchRuntimeEvidenceTransition({
    currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    durationMs: Math.max(0, Date.now() - runtimeStartedAtMs),
    parsedTask,
    phase: resolveRuntimeEvidenceResultPhase(resultPayload),
    presenter: input.presenter,
    reasonCode: resolveRuntimeEvidenceResultReasonCode(resultPayload),
  });

  const resultSummary =
    settledResultSummary ??
    sendResultAndSummarize({
      attemptId: parsedTask.attemptId,
      connectionGeneration: input.deliverRequest.connectionGeneration,
      currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      dispatchId: parsedTask.dispatchId,
      executionIdentityEcho: toRuntimeTransportResultIdentityEcho(
        input.deliverRequest
      ),
      executionTokenEcho: parsedTask.executionTokenEcho,
      leaseEpoch: input.deliverRequest.leaseEpoch,
      payload: resultPayload,
      presenter: input.presenter,
      runtimeCoordinatorExecutionId: parsedTask.runtimeCoordinatorExecutionId,
      ledgerPaths: input.ledgerPaths,
      taskId: parsedTask.taskId,
    }).resultSummary;
  emitDispatchPreviewEndFrame({
    attemptId: parsedTask.attemptId,
    connectionGeneration: input.deliverRequest.connectionGeneration,
    currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    dispatchId: parsedTask.dispatchId,
    leaseEpoch: input.deliverRequest.leaseEpoch,
    presenter: input.presenter,
    taskId: parsedTask.taskId,
  });
  return resultSummary;
}

type ProviderProcessLifecycleEvent = Extract<
  AdapterRuntimeEvent,
  { phase: "process_exit" | "process_spawned" }
>;

function buildProviderProcessJournalMetadata(input: {
  agentControllerRef: string;
  event: ProviderProcessLifecycleEvent;
  runtimeStartedAtMs: number;
}): Record<string, unknown> {
  const lifecycleMetadata =
    input.event.phase === "process_exit"
      ? {
          exitCode: input.event.exitCode,
          exitSignal: input.event.signal,
        }
      : {
          ...(input.event.processLaunchKind
            ? { processLaunchKind: input.event.processLaunchKind }
            : {}),
          ...(input.event.processWorkingDirectoryKind
            ? {
                processWorkingDirectoryKind:
                  input.event.processWorkingDirectoryKind,
              }
            : {}),
        };
  return {
    agentControllerRef: input.agentControllerRef,
    ...lifecycleMetadata,
    phaseTsMs: input.event.tsMs,
    processId: input.event.processId,
    signalTarget: input.event.signalTarget,
    sinceRuntimeStartedMs: Math.max(
      0,
      input.event.tsMs - input.runtimeStartedAtMs
    ),
  };
}

function emitSendTargetReferenceLoadFailureIfNeeded(input: {
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
}): void {
  if (input.sendTargetReference.status !== "failed") {
    return;
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.send_target_reference_load_failed",
    text: `send target reference load failed for task ${input.parsedTask.taskId}`,
    payload: {
      dispatchId: input.parsedTask.dispatchId,
      errorMessage: input.sendTargetReference.errorMessage,
      spaceId: input.parsedTask.spaceId,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });
}

function emitDispatchImageAttachmentPreparation(input: {
  parsedTask: ParsedDispatchTask;
  preparation: DispatchImageAttachmentPreparation;
  presenter: Presenter;
}): void {
  for (const failure of input.preparation.failures) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.attachment_download_failed",
      text: `image attachment unavailable for task ${input.parsedTask.taskId}`,
      payload: {
        attachmentId: failure.attachment.id,
        dispatchId: input.parsedTask.dispatchId,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        mimeType: failure.attachment.mimeType,
        spaceId: input.parsedTask.spaceId,
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
  }
}

async function prepareBootstrapExecutionStateIfNeeded(input: {
  bootstrapPlan: BootstrapPlan;
  bootstrapTemplateFacts: BootstrapTemplateFacts;
  contextIdForDispatch: string | null;
  contextLookupKey: string;
  currentExecutionState: ConversationExecutionState | null;
  effectiveRuntimeWorkingDirectory: string;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  ledgerPaths: LedgerPaths;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
}): Promise<void> {
  if (!input.bootstrapPlan.shouldInject) {
    return;
  }

  await withLedgerStateTransaction({
    invalidStateStrategy: "backup_and_reset",
    io: input.ledgerIo,
    mutate: (state) => {
      const latestExecutionState =
        resolveConversationExecutionStateByLookupKey({
          agentContextLookupKey: input.contextLookupKey,
          state,
        }) ?? input.currentExecutionState;
      const nextState = upsertConversationExecutionStateForLookupKey({
        state,
        executionState: markBootstrapInjectedContext({
          executionState: latestExecutionState,
          agentContextLookupKey: input.contextLookupKey,
          bootstrapTemplateFacts: input.bootstrapTemplateFacts,
          existingContextId: input.contextIdForDispatch,
          effectiveRuntimeWorkingDirectory:
            input.effectiveRuntimeWorkingDirectory,
          nowIso: new Date().toISOString(),
        }),
        replacedLookupKey: latestExecutionState?.agentContextLookupKey ?? null,
        targetLookupKey: input.contextLookupKey,
      });
      return {
        nextState,
        value: nextState,
      };
    },
    paths: input.ledgerPaths,
  });
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.bootstrap_injected",
    text: `bootstrap injected for ${input.parsedTask.spaceId}/${input.parsedTask.targetProfileId}`,
    payload: {
      bootstrapReason: input.bootstrapPlan.reason,
      dispatchId: input.parsedTask.dispatchId,
      spaceId: input.parsedTask.spaceId,
      targetProfileId: input.parsedTask.targetProfileId,
    },
  });
}

function emitContextHealedLineIfNeeded(input: {
  contextDelta: AdapterDispatchContextDelta | null;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
}): void {
  if (input.contextDelta?.refreshed !== true) {
    return;
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.context_healed",
    text: `context healed once for task ${input.parsedTask.taskId}`,
    payload: {
      dispatchId: input.parsedTask.dispatchId,
      taskId: input.parsedTask.taskId,
      targetProfileId: input.parsedTask.targetProfileId,
    },
  });
}

async function rollbackBootstrapExecutionStateAfterFailureIfNeeded(input: {
  bootstrapPlan: BootstrapPlan | null;
  contextLookupKey: string;
  currentExecutionState: ConversationExecutionState | null;
  ledgerIo: ReturnType<typeof createLedgerIo> | null;
  ledgerPaths: LedgerPaths;
}): Promise<void> {
  if (!(input.bootstrapPlan?.shouldInject && input.ledgerIo)) {
    return;
  }

  await withLedgerStateTransaction({
    invalidStateStrategy: "backup_and_reset",
    io: input.ledgerIo,
    mutate: (state) => {
      const nextState = rollbackBootstrapExecutionStateAfterDispatchFailure({
        agentContextLookupKey: input.contextLookupKey,
        executionStateBeforeDispatch: input.currentExecutionState,
        state,
      });
      return {
        nextState,
        value: nextState,
      };
    },
    paths: input.ledgerPaths,
  });
}

async function verifyDispatchLegacyContextAssociation(input: {
  parsedTask: ParsedDispatchTask;
  ledgerPaths: LedgerPaths;
  originalWorkingDirectory: string;
}): Promise<void> {
  const association = input.parsedTask.executionContext?.legacyAssociation;
  if (!association) {
    return;
  }
  const state = await loadLedgerState({
    invalidStateStrategy: "throw",
    io: createLedgerIo(),
    paths: input.ledgerPaths,
  });
  assertLegacyAgentContextAssociation({
    state,
    legacyNativeConversationId: association.nativeConversationId,
    key: {
      spaceId: input.parsedTask.spaceId,
      targetProfileId: input.parsedTask.targetProfileId,
      agentControllerRef: input.parsedTask.agentControllerRef,
      transportMode: input.parsedTask.transportMode,
      runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        input.originalWorkingDirectory
      ),
    },
  });
}

async function loadDispatchLedgerContext(input: {
  contextStore: Map<string, string>;
  ledgerPaths: LedgerPaths;
  parsedTask: ParsedDispatchTask;
  runtimeWorkspaceFingerprint: string;
  originalWorkingDirectory: string;
}): Promise<{
  contextLookupKey: string;
  currentExecutionState: ConversationExecutionState | null;
  existingContextId: string | null;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  latestScopedExecutionState: ConversationExecutionState | null;
}> {
  const keyInput = {
    executionContextId:
      input.parsedTask.executionContext?.id ??
      resolveColleagueLedgerScopeId(input.parsedTask),
    spaceId: input.parsedTask.spaceId,
    targetProfileId: input.parsedTask.targetProfileId,
    agentControllerRef: input.parsedTask.agentControllerRef,
    transportMode: input.parsedTask.transportMode,
    runtimeWorkspaceFingerprint: input.runtimeWorkspaceFingerprint,
  } as const;
  const contextLookupKey = buildAgentContextLookupKey(keyInput);
  const ledgerIo = createLedgerIo();
  const legacyContextId = input.contextStore.get(contextLookupKey) ?? null;
  const {
    currentExecutionState,
    existingContextId,
    latestScopedExecutionState,
  } = await withLedgerStateTransaction({
    invalidStateStrategy: executionContextLedgerPolicy(
      input.parsedTask.executionContext
    ),
    io: ledgerIo,
    mutate: (state) => {
      const scopeInput = {
        agentControllerRef: input.parsedTask.agentControllerRef,
        spaceId: input.parsedTask.spaceId,
        targetProfileId: input.parsedTask.targetProfileId,
        transportMode: input.parsedTask.transportMode,
      } as const;
      assertLegacyAgentContextAssociation({
        state,
        legacyNativeConversationId:
          input.parsedTask.executionContext?.legacyAssociation
            ?.nativeConversationId,
        key: {
          ...scopeInput,
          runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
            input.originalWorkingDirectory
          ),
        },
      });
      const existingAgentContextMatch = resolveCompatibleAgentContextMatch({
        key: keyInput,
        state,
      });
      const seededLedgerState = existingAgentContextMatch
        ? state
        : seedLegacyAgentContext({
            state,
            agentContextLookupKey: contextLookupKey,
            legacyAgentControllerConversationId: legacyContextId,
            agentControllerRef: input.parsedTask.agentControllerRef,
            spaceId: input.parsedTask.spaceId,
            targetProfileId: input.parsedTask.targetProfileId,
            transportMode: input.parsedTask.transportMode,
            runtimeWorkspaceFingerprint: input.runtimeWorkspaceFingerprint,
            taskId: input.parsedTask.taskId,
            nowMs: Date.now(),
          });
      const nextAgentContextMatch = resolveCompatibleAgentContextMatch({
        key: keyInput,
        state: seededLedgerState,
      });
      const existingContextId =
        nextAgentContextMatch?.agentContext.agentControllerConversationId ??
        null;
      const currentExecutionState = resolveCompatibleConversationExecutionState(
        {
          key: keyInput,
          preferredLookupKey:
            nextAgentContextMatch?.agentContextLookupKey ?? null,
          state: seededLedgerState,
        }
      );
      const latestScopedExecutionState = input.parsedTask.executionContext
        ? currentExecutionState
        : (resolveLatestScopedConversationExecutionState({
            scope: scopeInput,
            state: seededLedgerState,
          })?.executionState ?? null);
      return {
        nextState: seededLedgerState,
        value: {
          currentExecutionState,
          existingContextId,
          latestScopedExecutionState,
        },
      };
    },
    paths: input.ledgerPaths,
  });

  return {
    contextLookupKey,
    currentExecutionState,
    existingContextId,
    ledgerIo,
    latestScopedExecutionState,
  };
}

type DispatchBootstrapContext = {
  organizationSkillReleases: NonNullable<
    DispatchSpaceActionContext["organizationSkillReleases"]
  >;
  taskKnowledgeIndex: string;
  bootstrapTemplateFacts: BootstrapTemplateFacts;
  cliEntry: string | null;
  mentionSourceMentionLabel: string | null;
  mentionSourceProfileName: string | null;
  sendTargetReferencePromise: Promise<DispatchSendTargetReferenceLoadResult>;
  spaceGuide: string | null;
  spaceName: string | null;
  spaceOwnerProfileId: string | null;
  spacePurpose: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  targetProfileRole: string | null;
};

async function resolveDispatchBootstrapContext(input: {
  onPhase?: (
    phase: DispatchBootstrapContextPhase,
    metadata: Record<string, unknown>
  ) => void;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  parsedTask: ParsedDispatchTask;
}): Promise<DispatchBootstrapContext> {
  const [
    spaceOwnerProfileId,
    targetProfileContext,
    mentionSourceContext,
    knowledge,
  ] = await Promise.all([
    resolveBootstrapSpaceOwnerProfileId({
      spaceId: input.parsedTask.spaceId,
      targetProfileId: input.parsedTask.targetProfileId,
    }),
    resolveBootstrapTargetProfileContext({
      spaceId: input.parsedTask.spaceId,
      targetProfileId: input.parsedTask.targetProfileId,
      preferredMentionLabel: input.parsedTask.targetProfileMentionLabel,
      preferredProfileName: input.parsedTask.targetProfileName,
    }),
    resolveDispatchMentionSourceContext({
      spaceId: input.parsedTask.spaceId,
      mentionSourceProfileId: input.parsedTask.mentionSourceProfileId,
      preferredMentionLabel: input.parsedTask.mentionSourceProfileMentionLabel,
    }),
    readTaskKnowledge({
      spaceId: input.parsedTask.spaceId,
      targetProfileId: input.parsedTask.targetProfileId,
      ...(input.parsedTask.spacePassword
        ? { spacePassword: input.parsedTask.spacePassword }
        : {}),
      ...(input.parsedTask.workHandoff
        ? { skillSelections: input.parsedTask.workHandoff.skills }
        : {}),
      onRead: (read) => input.onPhase?.("bootstrap_read_completed", read),
    })
      .then((result) => ({ ...result, errorMessage: null }))
      .catch((error: unknown) => ({
        documents: null,
        skills: input.parsedTask.workHandoff?.skills ?? null,
        spaceMeta: null,
        errorMessage: toErrorMessage(error),
      })),
  ]);
  const organizationSkillReleases = knowledge.skills;
  const taskKnowledgeIndex = renderTaskKnowledgeIndex({
    documents: knowledge.documents,
    skills: organizationSkillReleases,
    readHint:
      "Use read_documents without documentId for the full directory, or with documentId for the current approved body. Use read_skills without name for all selected Skills, including omitted entries, or with name for the pinned instructions and resources. Handoff Skills use the existing task materializer. Never replace a selected release with latest or install knowledge into global Skills or repository AGENTS.md.",
  });
  const spaceMetaContext = {
    spaceGuide: normalizeOptionalText(knowledge.spaceMeta?.guide),
    spaceName: normalizeOptionalText(knowledge.spaceMeta?.name),
    spacePurpose: normalizeOptionalText(knowledge.spaceMeta?.purpose),
  };
  input.onPhase?.("bootstrap_context_ready", {
    mentionSourceMentionLabelPresent:
      mentionSourceContext.mentionSourceMentionLabel !== null,
    mentionSourceProfileNamePresent:
      mentionSourceContext.mentionSourceProfileName !== null,
    source: "dispatch_bootstrap_context",
    spaceGuidePresent: spaceMetaContext.spaceGuide !== null,
    spaceMetaError: knowledge.errorMessage,
    spaceMetaStatus: knowledge.spaceMeta ? "loaded" : "failed",
    spaceNamePresent: spaceMetaContext.spaceName !== null,
    spaceOwnerProfilePresent: spaceOwnerProfileId !== null,
    spacePurposePresent: spaceMetaContext.spacePurpose !== null,
    targetProfileMentionLabelPresent:
      targetProfileContext.targetProfileMentionLabel !== null,
    targetProfileNamePresent: targetProfileContext.targetProfileName !== null,
    targetProfileRolePresent: targetProfileContext.targetProfileRole !== null,
  });
  // Deliberately not awaited here: the member-directory load is a network
  // round trip that nothing in local runtime/ledger preparation depends on,
  // so it runs concurrently with that local work and is awaited at its first
  // real consumer. The phase event fires when the load actually resolves.
  // The loader never rejects (it returns a "failed" result), so this floating
  // promise cannot produce an unhandled rejection.
  const sendTargetReferencePromise = resolveDispatchSendTargetReference({
    agentControllerRef: input.parsedTask.agentControllerRef,
    dispatchTask: input.parsedTask,
    profileOwnerName: input.profileOwnerName,
    profileOwnerUserId: input.profileOwnerUserId,
    targetProfileName: targetProfileContext.targetProfileName,
  }).then((sendTargetReference) => {
    input.onPhase?.("send_target_reference_ready", {
      sendTargetReferenceCount:
        sendTargetReference.status === "loaded"
          ? sendTargetReference.projection.length
          : null,
      sendTargetReferenceStatus: sendTargetReference.status,
      source: "dispatch_send_target_reference",
    });
    return sendTargetReference;
  });
  const cliEntry = DISPATCH_SPACE_ACTION_CLI_FALLBACK_COMMAND;
  const bootstrapTemplateFacts = buildDispatchBootstrapTemplateFacts({
    dispatchTriggerSource: input.parsedTask.dispatchTriggerSource,
    mentionSourceProfileId: input.parsedTask.mentionSourceProfileId,
    mentionSourceProfileKind: input.parsedTask.mentionSourceProfileKind,
    ...mentionSourceContext,
    spaceId: input.parsedTask.spaceId,
    spaceGuide: spaceMetaContext.spaceGuide,
    spaceName: spaceMetaContext.spaceName,
    spaceOwnerProfileId,
    spacePurpose: spaceMetaContext.spacePurpose,
    spaceContractSnapshot: input.parsedTask.spaceContractSnapshot,
    ...targetProfileContext,
    targetProfileId: input.parsedTask.targetProfileId,
    cliEntry,
  });

  return {
    bootstrapTemplateFacts,
    taskKnowledgeIndex,
    organizationSkillReleases: organizationSkillReleases ?? [],
    cliEntry,
    mentionSourceMentionLabel:
      mentionSourceContext.mentionSourceMentionLabel ?? null,
    mentionSourceProfileName: mentionSourceContext.mentionSourceProfileName,
    sendTargetReferencePromise,
    spaceGuide: spaceMetaContext.spaceGuide,
    spaceName: spaceMetaContext.spaceName,
    spaceOwnerProfileId,
    spacePurpose: spaceMetaContext.spacePurpose,
    targetProfileMentionLabel: targetProfileContext.targetProfileMentionLabel,
    targetProfileName: targetProfileContext.targetProfileName,
    targetProfileRole: targetProfileContext.targetProfileRole,
  };
}

function toDispatchSharedFolderSessions(
  read: (() => LocalExecutionSlotSharedFolderSession[]) | undefined,
  task: Pick<ParsedDispatchTask, "requesterIsAgentOwner" | "spaceId">
): DispatchSharedFolderSession[] {
  // Context identifiers are owner-only (agent-transport-contract.md).
  const showSessionIds = task.requesterIsAgentOwner === true;
  return (read?.() ?? []).map((session) => ({
    executionContextId: showSessionIds ? session.executionContextId : null,
    sameSpace: session.spaceId === task.spaceId,
    targetLabel: session.targetLabel,
  }));
}

/**
 * Only a task whose root requester is not the owner needs the folder's name
 * in its prompt, so other people can be told about it without its path.
 * Space-only and Project tasks have no user folder to name.
 */
async function resolveNonOwnerWorkingFolderDisplayName(
  task: Pick<
    ParsedDispatchTask,
    "executionContext" | "requesterIsAgentOwner" | "targetProfileId"
  >
): Promise<string | null> {
  const context = task.executionContext;
  if (
    task.requesterIsAgentOwner === true ||
    context?.access === "space_context" ||
    context?.projectWork
  ) {
    return null;
  }
  return await readProfileFolderDisplayName({
    ...(context?.folderId ? { folderId: context.folderId } : {}),
    openMeldProfileId: task.targetProfileId,
  });
}

function buildDispatchRuntimePrompt(input: {
  workingFolderDisplayName: string | null;
  bootstrapContext: DispatchBootstrapContext;
  imageAttachmentPreparation: DispatchImageAttachmentPreparation;
  parsedTask: ParsedDispatchTask;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
  sharedFolderSessions: DispatchSharedFolderSession[];
  shouldInjectBootstrap: boolean;
  taskWorkspace?: ExecutionContextWorkspace;
}): DispatchPromptPlan {
  return buildDispatchPromptPlan({
    sharedFolderSessions: input.sharedFolderSessions,
    workingFolderDisplayName: input.workingFolderDisplayName,
    executionContextAccess: input.parsedTask.executionContext?.access,
    projectWork: input.parsedTask.executionContext?.projectWork,
    callerContext: input.parsedTask.callerContext,
    requesterIsAgentOwner: input.parsedTask.requesterIsAgentOwner,
    permissionModeAdvisory: input.parsedTask.permissionModeAdvisory,
    shouldInjectBootstrap: input.shouldInjectBootstrap,
    shouldInjectCenterAgentRoleTemplate:
      input.parsedTask.targetProfileIsCenterAgent,
    dispatchTriggerSource: input.parsedTask.dispatchTriggerSource,
    imageAttachmentPromptSection:
      input.imageAttachmentPreparation.promptSection,
    spaceFiles: input.parsedTask.files,
    mentionSourceProfileId: input.parsedTask.mentionSourceProfileId,
    mentionSourceProfileKind: input.parsedTask.mentionSourceProfileKind,
    mentionSourceMentionLabel: input.bootstrapContext.mentionSourceMentionLabel,
    mentionSourceProfileName: input.bootstrapContext.mentionSourceProfileName,
    profileOwnerName: input.profileOwnerName,
    profileOwnerUserId: input.profileOwnerUserId,
    organizationProtectedInformation:
      input.parsedTask.organizationProtectedInformation,
    workingLanguage: input.parsedTask.workingLanguage,
    prompt: `${input.bootstrapContext.taskKnowledgeIndex}\n\n${TASK_KNOWLEDGE_GUIDANCE}\n\n${
      input.taskWorkspace?.baseCommit
        ? `${input.parsedTask.prompt}\n\nOpenMeld task workspace: ${JSON.stringify(
            {
              projectId: input.parsedTask.defaultProjectId,
              repositoryName: input.taskWorkspace.sourceWorkingDirectory
                ? basename(input.taskWorkspace.sourceWorkingDirectory)
                : null,
              workingDirectory: input.taskWorkspace.workingDirectory,
              baseCommit: input.taskWorkspace.baseCommit,
            }
          )}\nThis task uses an independent Git worktree with private Git metadata. The starting commit is frozen. Uncommitted and ignored source files were not copied. Make changes in this task worktree; the original checkout is not the task's working directory. Refer to the task and commit in public replies without disclosing private local paths.`
        : input.parsedTask.prompt
    }`,
    recipientExplicitlyAddressedByActivationTargets:
      input.parsedTask.recipientExplicitlyAddressedByActivationTargets,
    sourceSignalId: input.parsedTask.sourceEventId,
    sourceMessageEnvelope: input.parsedTask.sourceMessageEnvelope,
    sendTargetReferenceLines: input.sendTargetReference.referenceLines,
    spaceId: input.parsedTask.spaceId,
    spaceGuide: input.bootstrapContext.spaceGuide,
    spaceName: input.bootstrapContext.spaceName,
    spaceOwnerProfileId: input.bootstrapContext.spaceOwnerProfileId,
    spacePurpose: input.bootstrapContext.spacePurpose,
    targetProfileMentionLabel: input.bootstrapContext.targetProfileMentionLabel,
    targetProfileName: input.bootstrapContext.targetProfileName,
    targetProfileRole: input.bootstrapContext.targetProfileRole,
    cliEntry: input.bootstrapContext.cliEntry,
    continuitySnapshot: input.parsedTask.continuitySnapshot,
    replyToSnapshot: input.parsedTask.replyToSnapshot,
    threadContext: input.parsedTask.threadContext,
    spaceContractSnapshot: input.parsedTask.spaceContractSnapshot,
    targetProfileId: input.parsedTask.targetProfileId,
  });
}

async function prepareDispatchTaskWorkspace(input: {
  parsedTask: ParsedDispatchTask;
  ledgerRootPath: string;
  currentWorkingDirectory: string;
  computerFileAccessStorePath: string;
}): Promise<ExecutionContextWorkspace> {
  const context = input.parsedTask.executionContext;
  if (context && context.access !== "space_context") {
    return await prepareExecutionContextWorkspace({
      context,
      ledgerRootPath: input.ledgerRootPath,
      currentWorkingDirectory: input.currentWorkingDirectory,
      policy: await readComputerFileAccessPolicy(
        input.computerFileAccessStorePath
      ),
    });
  }
  const workingDirectory = await executionContextWorkingDirectory({
    context,
    ledgerRootPath: input.ledgerRootPath,
    currentWorkingDirectory: input.currentWorkingDirectory,
  });
  return { workingDirectory, boundaryRoot: workingDirectory };
}

async function prepareDispatchClaudeProjectContainer(input: {
  parsedTask: ParsedDispatchTask;
  taskWorkspace: ExecutionContextWorkspace;
  workingDirectory: string;
}): Promise<ClaudeProjectContainerRuntime | null> {
  const context = input.parsedTask.executionContext;
  if (
    input.parsedTask.agentControllerRef !== "builtin:claude-code" ||
    context?.permissionSource === "agent_settings" ||
    context?.access !== "workspace" ||
    context.workspace !== "isolated"
  ) {
    return null;
  }
  try {
    return await prepareClaudeProjectContainer({
      boundaryRoot: input.taskWorkspace.boundaryRoot,
      contextId: context.id,
      workspacePath: input.workingDirectory,
    });
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith("claude_project.")
        ? error.message.split(":")[0]
        : "claude_project.isolation_unverified";
    let message =
      "OpenMeld could not verify this task's project container isolation. Check Docker or Podman and try again.";
    if (code === "claude_project.container_runtime_unavailable") {
      message =
        "Start Docker or Podman with a Linux container engine on this computer, then try this project task again.";
    } else if (code === "claude_project.image_unavailable") {
      message =
        "Docker or Podman could not prepare the task image. Check the container engine and try again.";
    }
    throw new DaemonServiceRunError({
      code: code ?? "claude_project.isolation_unverified",
      message,
    });
  }
}

async function releaseDispatchTaskWorkspace(input: {
  workspaceUse: ExecutionContextWorkspaceUse | null;
  parsedTask: ParsedDispatchTask;
  ledgerRootPath: string;
  workspaceProcesses: Map<number | null, boolean>;
  presenter: Presenter;
  reportPublicProgress: (update: string) => unknown;
}): Promise<void> {
  const context = input.parsedTask.executionContext;
  if (!(input.workspaceUse && context)) {
    return;
  }
  try {
    const released = await releaseExecutionContextWorkspace({
      ledgerRootPath: input.ledgerRootPath,
      context,
      use: input.workspaceUse,
      // Codex reports process_spawned synchronously before native work. An
      // empty set after a settled preflight error means no process was started.
      ownedProcessesQuiescent: [...input.workspaceProcesses.values()].every(
        Boolean
      ),
    });
    const audit = released.gitConfigAudit;
    if (
      audit &&
      (audit.restoredSettings ||
        audit.declaredHookInstallers ||
        audit.unverifiedHookSettings)
    ) {
      const notes = [
        ...(audit.restoredSettings
          ? [
              "OpenMeld restored Git settings changed by this task that could run commands or redirect the repository. Branch, remote, user, and submodule settings were kept.",
            ]
          : []),
        ...(audit.declaredHookInstallers
          ? [
              "The repository's declared Git hook installer changed its hooks path. OpenMeld kept this setting.",
            ]
          : []),
        ...(audit.unverifiedHookSettings
          ? [
              "This task changed the Git hooks path. OpenMeld kept it, but could not verify a repository-declared installer. Review it before running Git outside this task.",
            ]
          : []),
      ];
      input.reportPublicProgress(notes.join("\n\n"));
    }
    emitRunLine({
      presenter: input.presenter,
      code: `daemon.run.workspace_${released.status}`,
      text:
        released.status === "released"
          ? "Reclaimed the unchanged task workspace."
          : "Retained the task workspace.",
      payload: { contextId: context.id, ...released },
    });
  } catch (error) {
    input.reportPublicProgress(
      "OpenMeld could not finish checking or cleaning up this task's workspace. The workspace was kept for review."
    );
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.workspace_retained",
      text: "Task workspace cleanup needs reconciliation.",
      payload: { contextId: context.id, errorMessage: toErrorMessage(error) },
    });
  }
}

function observeExecutionContextWorkspaceProcess(
  processes: Map<number | null, boolean>,
  event: AdapterRuntimeEvent
): void {
  if (event.phase === "process_spawned") {
    processes.set(event.processId, false);
  } else if (event.phase === "process_exit") {
    processes.set(event.processId, event.ownedProcessesQuiescent === true);
  }
}

async function resolveDispatchComputerFileAccess(input: {
  claudeProjectRuntime: ClaudeProjectContainerRuntime | null;
  computerFileAccessStorePath: string;
  onInteractionRequest: AdapterInteractionCallback;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  routeConfig: DaemonProfileRouteConfig | null;
  runtimeControllerSupport: SupportedRuntimeControllerSupport;
  runtimePreparation: DispatchRuntimePreparation;
  taskWorkspace?: ExecutionContextWorkspace;
}): Promise<AdapterComputerFileAccessBoundary | null> {
  const policy = deriveExecutionContextComputerFileAccessPolicy({
    context: input.parsedTask.executionContext,
    workspace: input.taskWorkspace,
    policy: await readComputerFileAccessPolicy(
      input.computerFileAccessStorePath
    ),
  });
  const verifier =
    input.runtimeControllerSupport.localAdapterEntry.adapter
      .verifyComputerFileAccessBoundary;
  if (
    input.parsedTask.executionContext &&
    input.parsedTask.executionContext.permissionSource !== "agent_settings"
  ) {
    const context = input.parsedTask.executionContext;
    if (
      input.parsedTask.agentControllerRef === "builtin:claude-code" &&
      context.access === "space_context"
    ) {
      // Claude enforces this with tools: [] and strict dispatch-only MCP in
      // buildClaudeSpaceToolOptions, rather than a filesystem verifier.
      return null;
    }
    if (
      input.parsedTask.agentControllerRef === "builtin:claude-code" &&
      context.access === "workspace" &&
      context.workspace === "isolated" &&
      input.claudeProjectRuntime
    ) {
      return null;
    }
    if (
      input.parsedTask.agentControllerRef !== "builtin:codex" ||
      input.parsedTask.transportMode !== "codex-app-server" ||
      !verifier
    ) {
      throw new Error("execution_context.file_access_unsupported");
    }
    const workingDirectory =
      input.runtimePreparation.effectiveRuntimeContext
        .providerRuntimeWorkingDirectory;
    const boundary = executionContextFileAccessBoundary({
      context,
      workingDirectory,
      policy,
      taskWorkspace: input.taskWorkspace,
      workingCopyId: input.parsedTask.workingCopyId,
    });
    const verification = await verifier({
      boundary,
      workingDirectory,
      executionMode: "normal",
      agentControllerPermissionMode:
        input.routeConfig?.agentControllerPermissionMode,
      launchContract: input.routeConfig?.launchContract ?? null,
      transportMode: input.parsedTask.transportMode,
    });
    if (!verification.supported) {
      throw new Error(
        verification.reasonCode ===
          "computer.file_access.controller_unsupported" &&
          input.routeConfig?.agentControllerPermissionMode ===
            "codex:customConfig"
          ? "execution_context.custom_config_file_access_unverified"
          : "execution_context.file_access_unverified"
      );
    }
    return boundary;
  }
  const admission = await resolveComputerFileAccessAdmission({
    agentControllerPermissionMode:
      input.routeConfig?.agentControllerPermissionMode,
    agentControllerRef: input.parsedTask.agentControllerRef,
    onInteractionRequest: input.onInteractionRequest,
    policy,
    providerRuntimeWorkingDirectory:
      input.runtimePreparation.effectiveRuntimeContext
        .providerRuntimeWorkingDirectory,
    transportMode: input.parsedTask.transportMode,
    ...(verifier
      ? {
          verifyBoundary: async (boundary) => {
            const verification = await verifier({
              agentControllerPermissionMode:
                input.routeConfig?.agentControllerPermissionMode,
              boundary,
              executionMode: "normal",
              launchContract: input.routeConfig?.launchContract ?? null,
              transportMode: input.parsedTask.transportMode,
              workingDirectory:
                input.runtimePreparation.effectiveRuntimeContext
                  .providerRuntimeWorkingDirectory,
            });
            return verification;
          },
        }
      : {}),
  });
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.computer_file_access_resolved",
    text: `Computer file access resolved for task ${input.parsedTask.taskId}`,
    payload: {
      boundaryApplied: admission.boundary !== null,
      bypassedForThisRun: admission.bypassedForThisRun,
      dispatchId: input.parsedTask.dispatchId,
      mode: policy.mode,
      revision: policy.revision,
      taskId: input.parsedTask.taskId,
    },
  });
  return admission.boundary;
}

function createDispatchSpaceActionRuntimeContext(input: {
  bootstrapContext: DispatchBootstrapContext;
  claudeProjectRuntime: ClaudeProjectContainerRuntime | null;
  ledgerRootPath: string;
  parsedTask: ParsedDispatchTask;
  runtimePreparation: DispatchRuntimePreparation;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
  taskWorkspace: ExecutionContextWorkspace;
}): {
  dispatchSpaceActionContext: DispatchSpaceActionContext;
  runtimeEnvOverrides: Record<string, string | undefined> | undefined;
} {
  const contextResult = createDispatchSpaceActionContext({
    executionTokenEcho: input.parsedTask.executionTokenEcho,
    organizationSkillReleases: input.bootstrapContext.organizationSkillReleases,
    ...(input.claudeProjectRuntime && input.parsedTask.executionContext
      ? {
          projectShell: {
            boundaryRoot: input.taskWorkspace.boundaryRoot,
            executionContextId: input.parsedTask.executionContext.id,
            ledgerRootPath: input.ledgerRootPath,
            workspacePath:
              input.runtimePreparation.effectiveRuntimeContext
                .providerRuntimeWorkingDirectory,
            runtime: input.claudeProjectRuntime,
          },
        }
      : {}),
    workingCopyId: input.parsedTask.workingCopyId,
    attemptId: input.parsedTask.attemptId,
    dispatchId: input.parsedTask.dispatchId,
    env: process.env,
    replyToSignalId: input.parsedTask.replyToSnapshot?.signalId ?? null,
    sendTargetReference: input.sendTargetReference,
    sourceEventId: input.parsedTask.sourceEventId,
    spaceContractSnapshot: input.parsedTask.spaceContractSnapshot,
    spaceId: input.parsedTask.spaceId,
    targetProfileId: input.parsedTask.targetProfileId,
    taskId: input.parsedTask.taskId,
  });

  return {
    dispatchSpaceActionContext: contextResult.context,
    runtimeEnvOverrides: {
      ...(input.runtimePreparation.runtimeEnvOverrides ?? {}),
      [OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]: contextResult.contextPath,
    },
  };
}

export function resolveEffectiveAgentControllerConversationId(input: {
  agentControllerConversationId: string | null;
  existingContextId: string | null;
}): string | null {
  const bindingConversationId = normalizeOptionalContextId(
    input.agentControllerConversationId
  );
  if (bindingConversationId) {
    return bindingConversationId;
  }
  return normalizeOptionalContextId(input.existingContextId);
}

async function waitForCliSpaceActionRecord(input: {
  dispatchSpaceActionContext: DispatchSpaceActionContext;
  signal: AbortSignal;
}): Promise<DispatchRuntimeCompletion> {
  while (!input.signal.aborted) {
    const readResult = readDispatchSpaceActionRecord({
      context: input.dispatchSpaceActionContext,
    });
    if (readResult.status === "loaded") {
      return {
        kind: "cli_space_action_recorded",
        record: readResult.record,
      };
    }
    if (readResult.status === "invalid") {
      return {
        kind: "cli_space_action_invalid",
        errorMessage: readResult.errorMessage,
      };
    }
    try {
      await delay(CLI_SPACE_ACTION_RECORD_POLL_INTERVAL_MS, undefined, {
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted) {
        return {
          kind: "cli_space_action_poll_aborted",
        };
      }
      throw error;
    }
  }

  return {
    kind: "cli_space_action_poll_aborted",
  };
}

export async function applyCliSpaceActionRecordIfPresent(input: {
  dispatchSpaceActionContext: DispatchSpaceActionContext | null;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  runtimeResult: RuntimeTaskResult;
}): Promise<RuntimeTaskResult> {
  if (!input.dispatchSpaceActionContext) {
    return input.runtimeResult;
  }
  const readResult = await readCliSpaceActionRecordWithGrace({
    dispatchSpaceActionContext: input.dispatchSpaceActionContext,
    graceMs: CLI_SPACE_ACTION_RECORD_RUNTIME_COMPLETION_GRACE_MS,
  });
  if (readResult.status === "missing") {
    return input.runtimeResult;
  }
  if (readResult.status === "invalid") {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.cli_space_action_invalid",
      text: `CLI OpenMeld Space Action record ignored for task ${input.parsedTask.taskId}`,
      payload: {
        dispatchId: input.parsedTask.dispatchId,
        errorMessage: readResult.errorMessage,
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
    return input.runtimeResult;
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.cli_space_action_recorded",
    text: `CLI OpenMeld Space Action recorded for task ${input.parsedTask.taskId}`,
    payload: {
      command: readResult.record.command,
      dispatchId: input.parsedTask.dispatchId,
      spaceActionType: readResult.record.action.type,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });

  return applyCliSpaceActionRecordToRuntimeResult({
    record: readResult.record,
    runtimeResult: input.runtimeResult,
  });
}

function applyCliSpaceActionRecordToRuntimeResult(input: {
  record: DispatchSpaceActionRecord;
  runtimeResult: RuntimeTaskResult;
}): RuntimeTaskResult {
  return {
    ...input.runtimeResult,
    resultPayload: buildCliSpaceActionSuccessPayload({
      basePayload: input.runtimeResult.resultPayload,
      record: input.record,
    }),
  };
}

function buildCliSpaceActionSuccessPayload(input: {
  basePayload: Pick<
    OpenMeldDaemonTaskResultPayload,
    "agentId" | "attemptId" | "deduped" | "sourceEventId" | "taskId"
  > &
    Partial<
      Pick<
        OpenMeldDaemonTaskResultPayload,
        | "agentControllerConversation"
        | "agentControllerConversationId"
        | "agentControllerRef"
        | "bootstrapTemplateFacts"
        | "dispatchExecution"
        | "effectiveRuntimeWorkingDirectory"
        | "openClawBinding"
        | "openClawGatewayVisibility"
        | "promptTrace"
        | "runtimeWorkspaceFingerprint"
        | "telemetry"
        | "transportMode"
      >
    >;
  record: DispatchSpaceActionRecord;
}): Extract<OpenMeldDaemonTaskResultPayload, { status: "success" }> {
  const output = resolveStructuredActionOutputFallback({
    action: input.record.action,
    cleanedOutput: "",
  });
  return {
    agentId: input.basePayload.agentId,
    attemptId: input.basePayload.attemptId,
    deduped: input.basePayload.deduped,
    sourceEventId: input.basePayload.sourceEventId,
    taskId: input.basePayload.taskId,
    ...(input.basePayload.agentControllerConversation
      ? {
          agentControllerConversation:
            input.basePayload.agentControllerConversation,
        }
      : {}),
    ...(input.basePayload.agentControllerConversationId
      ? {
          agentControllerConversationId:
            input.basePayload.agentControllerConversationId,
        }
      : {}),
    ...(input.basePayload.agentControllerRef
      ? { agentControllerRef: input.basePayload.agentControllerRef }
      : {}),
    ...(input.basePayload.bootstrapTemplateFacts
      ? { bootstrapTemplateFacts: input.basePayload.bootstrapTemplateFacts }
      : {}),
    ...(input.basePayload.dispatchExecution
      ? { dispatchExecution: input.basePayload.dispatchExecution }
      : {}),
    ...(input.basePayload.effectiveRuntimeWorkingDirectory
      ? {
          effectiveRuntimeWorkingDirectory:
            input.basePayload.effectiveRuntimeWorkingDirectory,
        }
      : {}),
    ...(input.basePayload.openClawBinding
      ? { openClawBinding: input.basePayload.openClawBinding }
      : {}),
    ...(input.basePayload.openClawGatewayVisibility
      ? {
          openClawGatewayVisibility:
            input.basePayload.openClawGatewayVisibility,
        }
      : {}),
    ...(input.basePayload.promptTrace
      ? { promptTrace: input.basePayload.promptTrace }
      : {}),
    ...(input.basePayload.runtimeWorkspaceFingerprint
      ? {
          runtimeWorkspaceFingerprint:
            input.basePayload.runtimeWorkspaceFingerprint,
        }
      : {}),
    ...(input.basePayload.telemetry
      ? { telemetry: input.basePayload.telemetry }
      : {}),
    ...(input.basePayload.transportMode
      ? { transportMode: input.basePayload.transportMode }
      : {}),
    output,
    spaceAction: input.record.action,
    spaceActionProvenance: "cli_action",
    status: "success",
  };
}

async function readCliSpaceActionRecordWithGrace(input: {
  dispatchSpaceActionContext: DispatchSpaceActionContext;
  graceMs: number;
}): Promise<DispatchSpaceActionRecordReadResult> {
  const immediateRead = readDispatchSpaceActionRecord({
    context: input.dispatchSpaceActionContext,
  });
  if (immediateRead.status !== "missing" || input.graceMs <= 0) {
    return immediateRead;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), input.graceMs);
  try {
    const completion = await waitForCliSpaceActionRecord({
      dispatchSpaceActionContext: input.dispatchSpaceActionContext,
      signal: abortController.signal,
    });
    if (completion.kind === "cli_space_action_recorded") {
      return {
        record: completion.record,
        status: "loaded",
      };
    }
    if (completion.kind === "cli_space_action_invalid") {
      return {
        errorMessage: completion.errorMessage,
        status: "invalid",
      };
    }
    return { status: "missing" };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRuntimeResultStructuredSpaceAction(input: {
  onInteractionRequest?: Parameters<
    typeof runRuntimeTask
  >[0]["onInteractionRequest"];
  onNativeTurnStarted: () => Promise<void>;
  onNativeTurnCompleted: (result: RuntimeTaskResult) => void;
  onRuntimeEvent?: Parameters<typeof runRuntimeTask>[0]["onRuntimeEvent"];
  agentReplyObservationCursor?: string | null;
  allowConcurrentReplyReconsideration?: boolean;
  cliEntry?: string | null;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary | null;
  controllerTurnCompletion: Promise<void>;
  dispatchSpaceActionContext: DispatchSpaceActionContext | null;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  ledgerPaths: LedgerPaths;
  instructionPrompt?: AdapterInstructionPrompt;
  parsedTask: ParsedDispatchTask;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  presenter: Presenter;
  routeConfig: DaemonProfileRouteConfig | null;
  runtimeResult: RuntimeTaskResult;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
  runtimeContext: ProviderDispatchRuntimeContext;
  runtimeEnvOverrides?: Record<string, string | undefined>;
  runtimeControllerSupport: SupportedRuntimeControllerSupport;
  agentControllerConversationOverride?: AgentControllerConversationRef | null;
}): Promise<{
  runtimeResult: RuntimeTaskResult;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
  resolvedSpaceActionProvenance: OpenMeldDaemonTaskResultPayload["spaceActionProvenance"];
}> {
  let runtimeResult = input.runtimeResult;
  let structuredSpaceActionResolution =
    resolveStructuredSpaceActionFromRuntimePayload(runtimeResult);
  const runtimePayloadSpaceAction = runtimeResult.resultPayload.spaceAction;
  const publicationRequirement = resolveSpacePublicationRequirement(
    input.parsedTask.spaceContractSnapshot
  );
  const requiresStructuredSpaceAction =
    publicationRequirement.requiresExplicitPublicAction;
  let repairFailureDiagnostics: StructuredActionFailureDiagnostics | null =
    null;
  const initialStructuredActionFailure =
    resolveStructuredActionRequirementFailure({
      requiresStructuredSpaceAction,
      resolution: runtimePayloadSpaceAction
        ? { action: runtimePayloadSpaceAction, parseError: null }
        : structuredSpaceActionResolution,
      runtimeResult,
    });

  if (initialStructuredActionFailure?.kind === "preserve_runtime_failure") {
    return {
      runtimeResult,
      resolvedSpaceAction: undefined,
      resolvedSpaceActionProvenance: undefined,
    };
  }

  if (initialStructuredActionFailure?.kind === "repair") {
    const repairResult = await maybeRepairStructuredSpaceAction({
      parsedTask: input.parsedTask,
      presenter: input.presenter,
      dispatchSpaceActionContext: input.dispatchSpaceActionContext,
      runtimeResult,
      sendTargetReference: input.sendTargetReference,
      failureReason: initialStructuredActionFailure.failureReason,
      cliEntry: input.cliEntry,
      runControllerRepair: ({ prompt: repairPrompt, runtimeResult }) => {
        // A repair can start a fresh conversation without the task prompt.
        const prompt = appendNonOwnerAudienceGuidance(
          repairPrompt,
          input.parsedTask
        );
        const repairContinuation = resolveStructuredActionRepairContinuation({
          runtimeResult,
          agentControllerConversationOverride:
            input.agentControllerConversationOverride,
        });
        return runDispatchRuntimeExecution({
          onInteractionRequest: input.onInteractionRequest,
          onNativeTurnStarted: input.onNativeTurnStarted,
          onNativeTurnCompleted: input.onNativeTurnCompleted,
          onRuntimeEvent: input.onRuntimeEvent,
          computerFileAccessBoundary: input.computerFileAccessBoundary,
          contextId: repairContinuation.contextId,
          executionMode: "repair",
          io: input.ledgerIo,
          ledgerPaths: input.ledgerPaths,
          instructionPrompt: input.instructionPrompt
            ? {
                ...input.instructionPrompt,
                userPrompt: prompt,
              }
            : undefined,
          parsedTask: input.parsedTask,
          prompt,
          routeConfig: input.routeConfig,
          runtimeContext: input.runtimeContext,
          runtimeEnvOverrides: {
            ...input.runtimeEnvOverrides,
            [DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV]: "1",
          },
          runtimeControllerSupport: input.runtimeControllerSupport,
          streamingModeOverride: "final",
          agentControllerConversationOverride:
            repairContinuation.agentControllerConversationOverride,
        });
      },
    });
    repairFailureDiagnostics = repairResult.finalFailureDiagnostics;
    if (repairResult.runtimeResult) {
      runtimeResult = repairResult.runtimeResult;
      structuredSpaceActionResolution =
        resolveStructuredSpaceActionFromRuntimePayload(runtimeResult);
    }
  }

  let resolvedSpaceAction =
    runtimeResult.resultPayload.spaceAction ??
    structuredSpaceActionResolution.action;
  const resolvedSpaceActionProvenance = resolveStructuredSpaceActionProvenance({
    runtimeResult,
    resolvedSpaceAction,
  });
  const normalizedAction = normalizeResolvedStructuredSpaceAction({
    parsedTask: input.parsedTask,
    presenter: input.presenter,
    resolvedSpaceAction,
    runtimeResult,
    sendTargetReference: input.sendTargetReference,
    structuredSpaceActionResolution,
  });
  resolvedSpaceAction = normalizedAction.resolvedSpaceAction;

  const finalStructuredActionFailure = normalizedAction.failureReason
    ? {
        failureReason: normalizedAction.failureReason,
        kind: "repair" as const,
      }
    : resolveStructuredActionRequirementFailure({
        requiresStructuredSpaceAction,
        resolution: {
          ...structuredSpaceActionResolution,
          action: resolvedSpaceAction,
          parseError: runtimeResult.resultPayload.spaceAction
            ? null
            : structuredSpaceActionResolution.parseError,
        },
        runtimeResult,
      });
  if (finalStructuredActionFailure?.kind === "preserve_runtime_failure") {
    return {
      runtimeResult,
      resolvedSpaceAction,
      resolvedSpaceActionProvenance,
    };
  }
  if (finalStructuredActionFailure?.kind === "repair") {
    const diagnostics =
      repairFailureDiagnostics ??
      resolveStructuredActionFailureDiagnostics({
        carrierKind: structuredSpaceActionResolution.carrierKind,
        parseError: structuredSpaceActionResolution.parseError,
        publicFailureReason: finalStructuredActionFailure.failureReason,
        repairMode: "required_check",
        runtimeResult,
      });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.structured_action_required_failed",
      text: `OpenMeld Space action requirement failed for task ${input.parsedTask.taskId}`,
      payload: {
        dispatchId: input.parsedTask.dispatchId,
        failureReason: finalStructuredActionFailure.failureReason,
        ...diagnostics,
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
    return {
      runtimeResult: {
        ...runtimeResult,
        resultPayload: coerceRuntimeResultToStructuredActionFailure({
          diagnostics,
          failureReason: finalStructuredActionFailure.failureReason,
          runtimeResult,
        }),
      },
      resolvedSpaceAction: undefined,
      resolvedSpaceActionProvenance: undefined,
    };
  }

  if (
    runtimeResult.resultPayload.status !== "success" &&
    runtimeResult.resultPayload.status !== "partial_success"
  ) {
    return {
      runtimeResult,
      resolvedSpaceAction,
      resolvedSpaceActionProvenance,
    };
  }

  if (
    input.allowConcurrentReplyReconsideration !== false &&
    resolvedSpaceAction?.type === "post_message"
  ) {
    return await coordinateConcurrentAgentReply({
      ...input,
      resolvedSpaceAction,
      resolvedSpaceActionProvenance,
      runtimeResult,
    });
  }

  const shouldPreserveCliActionOutput =
    runtimeResult.resultPayload.spaceActionProvenance === "cli_action";
  const shouldApplyStructuredActionResolution =
    runtimeResult.resultPayload.spaceAction !== resolvedSpaceAction ||
    runtimeResult.resultPayload.spaceActionProvenance !==
      resolvedSpaceActionProvenance ||
    (!shouldPreserveCliActionOutput &&
      typeof structuredSpaceActionResolution.cleanedOutput === "string" &&
      structuredSpaceActionResolution.cleanedOutput !==
        runtimeResult.resultPayload.output);
  if (!shouldApplyStructuredActionResolution) {
    return {
      runtimeResult,
      resolvedSpaceAction,
      resolvedSpaceActionProvenance,
    };
  }

  return {
    runtimeResult: applyStructuredSpaceActionResolutionToRuntimePayload({
      runtimeResult,
      resolution: {
        ...structuredSpaceActionResolution,
        action: resolvedSpaceAction,
        spaceActionProvenance: resolvedSpaceActionProvenance,
      },
    }),
    resolvedSpaceAction,
    resolvedSpaceActionProvenance,
  };
}

async function coordinateConcurrentAgentReply(input: {
  onInteractionRequest?: Parameters<
    typeof runRuntimeTask
  >[0]["onInteractionRequest"];
  onNativeTurnStarted: () => Promise<void>;
  onNativeTurnCompleted: (result: RuntimeTaskResult) => void;
  onRuntimeEvent?: Parameters<typeof runRuntimeTask>[0]["onRuntimeEvent"];
  agentReplyObservationCursor?: string | null;
  cliEntry?: string | null;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary | null;
  controllerTurnCompletion: Promise<void>;
  dispatchSpaceActionContext: DispatchSpaceActionContext | null;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  ledgerPaths: LedgerPaths;
  instructionPrompt?: AdapterInstructionPrompt;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  resolvedSpaceAction: Extract<
    NonNullable<OpenMeldDaemonTaskResultPayload["spaceAction"]>,
    { type: "post_message" }
  >;
  resolvedSpaceActionProvenance: OpenMeldDaemonTaskResultPayload["spaceActionProvenance"];
  routeConfig: DaemonProfileRouteConfig | null;
  runtimeContext: ProviderDispatchRuntimeContext;
  runtimeEnvOverrides?: Record<string, string | undefined>;
  runtimeControllerSupport: SupportedRuntimeControllerSupport;
  runtimeResult: RuntimeTaskResult;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
  agentControllerConversationOverride?: AgentControllerConversationRef | null;
}): Promise<{
  runtimeResult: RuntimeTaskResult;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
  resolvedSpaceActionProvenance: OpenMeldDaemonTaskResultPayload["spaceActionProvenance"];
}> {
  const requestContext = buildOpenMeldRequestContextFromProfileIdentity({
    profileIdentity: {
      ownerUserId: input.profileOwnerUserId,
      profileKind: "agent",
      profileName:
        input.parsedTask.targetProfileName ??
        input.parsedTask.targetProfileMentionLabel ??
        input.parsedTask.targetProfileId,
      openMeldProfileId: input.parsedTask.targetProfileId,
      ...(input.profileOwnerName ? { ownerName: input.profileOwnerName } : {}),
    },
  });
  const readObservation = async (
    observedThroughSignalId: string
  ): Promise<DispatchAgentReplyObservation> => {
    try {
      return await readDispatchAgentReplyObservation({
        currentWakeTargetProfileIds:
          input.parsedTask.sourceMessageEnvelope?.activationTargets,
        requestContext,
        sourceSignalId: observedThroughSignalId,
        spaceId: input.parsedTask.spaceId,
        spacePassword: input.parsedTask.spacePassword,
        threadContext: input.parsedTask.threadContext,
        wakeSourceSignalId: input.parsedTask.sourceEventId,
      });
    } catch (error) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.agent_reply_observation_unavailable",
        text: `Agent reply observation unavailable for task ${input.parsedTask.taskId}`,
        payload: {
          dispatchId: input.parsedTask.dispatchId,
          errorMessage: toErrorMessage(error),
          observedThroughSignalId,
          targetProfileId: input.parsedTask.targetProfileId,
          taskId: input.parsedTask.taskId,
        },
      });
      throw new DaemonServiceRunError({
        code: "dispatch.agent_reply_observation.unavailable",
        message: `OpenMeld could not read the Space context before publishing the Agent reply: ${toErrorMessage(error)}`,
      });
    }
  };
  let observation: DispatchAgentReplyObservation;
  try {
    observation = await readObservation(
      normalizeOptionalText(input.agentReplyObservationCursor) ??
        input.parsedTask.sourceEventId
    );
  } catch (error) {
    if (input.agentReplyObservationCursor) {
      throw error;
    }
    // Preserve the first proposal using only the context actually delivered
    // with the Wake. Space's atomic publication guard still checks this cursor
    // after durable replay and can require review before publishing anything.
    const action = attachAgentReplyObservation({
      action: input.resolvedSpaceAction,
      observedThroughSignalId: input.parsedTask.sourceEventId,
    });
    return {
      resolvedSpaceAction: action,
      resolvedSpaceActionProvenance: input.resolvedSpaceActionProvenance,
      runtimeResult: applyStructuredSpaceActionResolutionToRuntimePayload({
        resolution: {
          action,
          parseError: null,
          spaceActionProvenance: input.resolvedSpaceActionProvenance,
        },
        runtimeResult: input.runtimeResult,
      }),
    };
  }

  const coordinated = await coordinateDispatchAgentReply({
    action: input.resolvedSpaceAction,
    originalWake: {
      sourceSignalId: input.parsedTask.sourceEventId,
      targetProfileId: input.parsedTask.targetProfileId,
      text: input.parsedTask.prompt,
    },
    currentValue: {
      provenance: input.resolvedSpaceActionProvenance,
      runtimeResult: input.runtimeResult,
    },
    observation,
    reconsider: async (reconsiderationPrompt, currentObservation) => {
      const prompt = appendNonOwnerAudienceGuidance(
        reconsiderationPrompt,
        input.parsedTask
      );
      const reconsiderationStartedAtMs = Date.now();
      const recordReconsideration = (result: string) =>
        emitDaemonDispatchJournalEvent({
          type: "dispatch.reply_reconsideration",
          dispatchId: input.parsedTask.dispatchId,
          profileId: input.parsedTask.targetProfileId,
          taskId: input.parsedTask.taskId,
          result,
          metadata: {
            reason: "new_relevant_space_signal",
            newerSignalCount: currentObservation.relevantSignals.length,
            observedThroughSignalId: currentObservation.observedThroughSignalId,
            triggeringSignalIds: currentObservation.relevantSignals.map(
              (signal) => signal.id
            ),
            startedAtMs: reconsiderationStartedAtMs,
            durationMs: Math.max(0, Date.now() - reconsiderationStartedAtMs),
          },
        });
      recordReconsideration("started");
      try {
        const continuation = resolveStructuredActionRepairContinuation({
          agentControllerConversationOverride:
            input.agentControllerConversationOverride,
          runtimeResult: input.runtimeResult,
        });
        if (
          !(
            continuation.contextId ||
            continuation.agentControllerConversationOverride
          )
        ) {
          throw new DaemonServiceRunError({
            code: "dispatch.agent_reply_reconsideration.conversation_unavailable",
            message:
              "The Space changed, but the exact Agent conversation is unavailable for reply reconsideration.",
          });
        }
        await input.controllerTurnCompletion;
        const activeTask = input.inflightTaskControlRegistry.getTask(
          input.parsedTask.taskId
        );
        if (
          activeTask?.dispatchId !== input.parsedTask.dispatchId ||
          activeTask.runtimeCoordinatorExecutionId !==
            input.parsedTask.runtimeCoordinatorExecutionId
        ) {
          throw new DaemonServiceRunError({
            code: "dispatch.agent_reply_reconsideration.execution_inactive",
            message:
              "The Wake stopped before the Agent could reconsider its reply.",
          });
        }
        if (input.dispatchSpaceActionContext) {
          supersedeDispatchSpaceActionRecordForReconsideration({
            context: input.dispatchSpaceActionContext,
          });
        }
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.agent_reply_reconsideration_started",
          text: `Agent reply reconsideration started for task ${input.parsedTask.taskId}`,
          payload: {
            dispatchId: input.parsedTask.dispatchId,
            newerSignalCount: currentObservation.relevantSignals.length,
            observedThroughSignalId: currentObservation.observedThroughSignalId,
            targetProfileId: input.parsedTask.targetProfileId,
            taskId: input.parsedTask.taskId,
          },
        });
        let runtimeResult = await runDispatchRuntimeExecution({
          onInteractionRequest: input.onInteractionRequest,
          onNativeTurnStarted: input.onNativeTurnStarted,
          onNativeTurnCompleted: input.onNativeTurnCompleted,
          onRuntimeEvent: input.onRuntimeEvent,
          agentControllerConversationOverride:
            continuation.agentControllerConversationOverride,
          computerFileAccessBoundary: input.computerFileAccessBoundary,
          contextId: continuation.contextId,
          executionMode: "repair",
          instructionPrompt: input.instructionPrompt
            ? {
                ...input.instructionPrompt,
                userPrompt: prompt,
              }
            : undefined,
          io: input.ledgerIo,
          ledgerPaths: input.ledgerPaths,
          parsedTask: input.parsedTask,
          prompt,
          routeConfig: input.routeConfig,
          runtimeContext: input.runtimeContext,
          runtimeEnvOverrides: input.runtimeEnvOverrides,
          runtimeControllerSupport: input.runtimeControllerSupport,
          streamingModeOverride: "final",
        });
        runtimeResult = await applyCliSpaceActionRecordIfPresent({
          dispatchSpaceActionContext: input.dispatchSpaceActionContext,
          parsedTask: input.parsedTask,
          presenter: input.presenter,
          runtimeResult,
        });
        const reconsidered = await resolveRuntimeResultStructuredSpaceAction({
          ...input,
          agentControllerConversationOverride:
            continuation.agentControllerConversationOverride,
          allowConcurrentReplyReconsideration: false,
          runtimeResult,
        });
        if (!reconsidered.resolvedSpaceAction) {
          if (reconsidered.runtimeResult.resultPayload.status === "failed") {
            return {
              action: undefined,
              value: {
                provenance: undefined,
                runtimeResult: reconsidered.runtimeResult,
              },
            };
          }
          throw new DaemonServiceRunError({
            code: "dispatch.agent_reply_reconsideration.action_missing",
            message:
              "The Agent did not return a valid Space action after reviewing newer messages.",
          });
        }
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.agent_reply_reconsideration_completed",
          text: `Agent reply reconsideration completed for task ${input.parsedTask.taskId}`,
          payload: {
            dispatchId: input.parsedTask.dispatchId,
            observedThroughSignalId: currentObservation.observedThroughSignalId,
            targetProfileId: input.parsedTask.targetProfileId,
            taskId: input.parsedTask.taskId,
          },
        });
        return {
          action: reconsidered.resolvedSpaceAction,
          value: {
            provenance: "controller_repair" as const,
            runtimeResult: reconsidered.runtimeResult,
          },
        };
      } finally {
        recordReconsideration("finished");
      }
    },
    refreshObservation: readObservation,
    spaceId: input.parsedTask.spaceId,
  });
  return {
    resolvedSpaceAction: coordinated.action,
    resolvedSpaceActionProvenance: coordinated.value.provenance,
    runtimeResult: applyStructuredSpaceActionResolutionToRuntimePayload({
      resolution: {
        action: coordinated.action,
        parseError: null,
        spaceActionProvenance: coordinated.value.provenance,
      },
      runtimeResult: coordinated.value.runtimeResult,
    }),
  };
}

function normalizeResolvedStructuredSpaceAction(input: {
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
  runtimeResult: RuntimeTaskResult;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
  structuredSpaceActionResolution: ReturnType<
    typeof resolveStructuredSpaceActionFromRuntimePayload
  >;
}): {
  failureReason: string | null;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
} {
  const postMessageResult = normalizeResolvedPostMessageAction(input);
  if (postMessageResult.failureReason) {
    return postMessageResult;
  }
  const postStatusResult = normalizeResolvedPostStatusAction({
    parsedTask: input.parsedTask,
    presenter: input.presenter,
    resolvedSpaceAction: postMessageResult.resolvedSpaceAction,
  });
  if (postStatusResult.failureReason) {
    return postStatusResult;
  }

  return normalizeResolvedThreadAction({
    parsedTask: input.parsedTask,
    presenter: input.presenter,
    resolvedSpaceAction: postStatusResult.resolvedSpaceAction,
  });
}

function normalizeResolvedPostMessageAction(input: {
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
  runtimeResult: RuntimeTaskResult;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
  structuredSpaceActionResolution: ReturnType<
    typeof resolveStructuredSpaceActionFromRuntimePayload
  >;
}): {
  failureReason: string | null;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
} {
  const action = input.resolvedSpaceAction;
  if (action?.type !== "post_message") {
    return { failureReason: null, resolvedSpaceAction: action };
  }

  try {
    const normalizedPostMessageAction = normalizeDispatchPostMessageAction({
      action,
      currentReplyToSignalId:
        input.parsedTask.replyToSnapshot?.signalId ?? null,
      inputKind: "direct_payload",
      sendTargetReference: input.sendTargetReference,
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.post_message_normalized",
      text: `post_message normalized for task ${input.parsedTask.taskId}`,
      payload: {
        dispatchId: input.parsedTask.dispatchId,
        ...normalizedPostMessageAction.tracePayload,
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
    return {
      failureReason: null,
      resolvedSpaceAction: normalizedPostMessageAction.action,
    };
  } catch (error) {
    const failureReason = toErrorMessage(error);
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.post_message_validation_rejected",
      text: `post_message validation rejected for task ${input.parsedTask.taskId}`,
      payload: {
        activationTargetsCount: action.messageEnvelope.activationTargets.length,
        dispatchId: input.parsedTask.dispatchId,
        failureReason,
        inputKind: "direct_payload",
        memberDirectoryLoaded: input.sendTargetReference.status === "loaded",
        mentionTargetsCount: action.messageEnvelope.mentionTargets?.length ?? 0,
        referenceTargetsCount: action.messageEnvelope.referenceTargets.length,
        replyToSignalIdResolved: Boolean(
          action.messageEnvelope.replyToSignalId
        ),
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
    return { failureReason, resolvedSpaceAction: undefined };
  }
}

function normalizeResolvedPostStatusAction(input: {
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
}): {
  failureReason: string | null;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
} {
  const action = input.resolvedSpaceAction;
  if (action?.type !== "post_status" || action.status !== "working") {
    return { failureReason: null, resolvedSpaceAction: action };
  }

  const failureReason =
    "post_status working is not allowed for a final OpenMeld Space Action. Use done, blocked, needs_input, handoff, post_message, or stay_silent.";
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.post_status_validation_rejected",
    text: `post_status validation rejected for task ${input.parsedTask.taskId}`,
    payload: {
      dispatchId: input.parsedTask.dispatchId,
      failureReason,
      status: action.status,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });
  return { failureReason, resolvedSpaceAction: undefined };
}

function normalizeResolvedThreadAction(input: {
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
}): {
  failureReason: string | null;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
} {
  const action = input.resolvedSpaceAction;
  if (!(action?.type === "post_message" || action?.type === "post_status")) {
    return { failureReason: null, resolvedSpaceAction: action };
  }

  try {
    return {
      failureReason: null,
      resolvedSpaceAction: normalizeDispatchThreadAction({
        action,
        threadContext: input.parsedTask.threadContext,
      }),
    };
  } catch (error) {
    const failureReason = toErrorMessage(error);
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.thread_action_validation_rejected",
      text: `thread action validation rejected for task ${input.parsedTask.taskId}`,
      payload: {
        dispatchId: input.parsedTask.dispatchId,
        failureReason,
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
        threadId: input.parsedTask.threadContext?.threadId ?? null,
      },
    });
    return { failureReason, resolvedSpaceAction: undefined };
  }
}

async function maybeRepairStructuredSpaceAction(input: {
  cliEntry?: string | null;
  dispatchSpaceActionContext: DispatchSpaceActionContext | null;
  failureReason: string;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  runControllerRepair?: (input: {
    prompt: string;
    runtimeResult: RuntimeTaskResult;
  }) => Promise<RuntimeTaskResult>;
  runtimeResult: RuntimeTaskResult;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
}): Promise<StructuredActionRepairResult> {
  if (!input.failureReason) {
    return {
      finalFailureDiagnostics: null,
      runtimeResult: null,
    };
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.structured_action_repair_started",
    text: `structured OpenMeld Space action repair started for task ${input.parsedTask.taskId}`,
    payload: {
      dispatchId: input.parsedTask.dispatchId,
      failureReason: input.failureReason,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });

  if (!input.runControllerRepair) {
    return {
      finalFailureDiagnostics: resolveStructuredActionFailureDiagnostics({
        carrierKind: "none",
        parseError: input.failureReason,
        publicFailureReason: input.failureReason,
        repairMode: "controller_roundtrip",
        runtimeResult: input.runtimeResult,
      }),
      runtimeResult: null,
    };
  }

  let providerRepairRuntimeResult: RuntimeTaskResult;
  try {
    providerRepairRuntimeResult = await input.runControllerRepair({
      prompt: buildStructuredActionRepairPrompt({
        cliEntry: input.cliEntry,
        currentReplyToSignalId: input.parsedTask.replyToSnapshot?.signalId,
        parseError: input.failureReason,
        previousOutput: resolveStructuredActionRepairPreviousOutput(
          input.runtimeResult
        ),
        sendTargetReferenceLines: input.sendTargetReference.referenceLines,
        spaceContractSnapshot: input.parsedTask.spaceContractSnapshot,
        spaceId: input.parsedTask.spaceId,
      }),
      runtimeResult: input.runtimeResult,
    });
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.structured_action_repair_failed",
      text: `structured OpenMeld Space action repair failed for task ${input.parsedTask.taskId}`,
      payload: {
        dispatchId: input.parsedTask.dispatchId,
        ...resolveStructuredActionFailureDiagnostics({
          carrierKind: "none",
          parseError: toErrorMessage(error),
          publicFailureReason: input.failureReason,
          repairMode: "controller_roundtrip",
          runtimeResult: input.runtimeResult,
        }),
        failureReason: input.failureReason,
        repairedRuntimeStatus: "failed",
        repairedStructuredActionPresent: false,
        repairMode: "controller_roundtrip",
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
    return {
      finalFailureDiagnostics: resolveStructuredActionFailureDiagnostics({
        carrierKind: "none",
        parseError: toErrorMessage(error),
        publicFailureReason: input.failureReason,
        repairMode: "controller_roundtrip",
        runtimeResult: input.runtimeResult,
      }),
      runtimeResult: null,
    };
  }

  providerRepairRuntimeResult = await applyCliSpaceActionRecordIfPresent({
    dispatchSpaceActionContext: input.dispatchSpaceActionContext,
    parsedTask: input.parsedTask,
    presenter: input.presenter,
    runtimeResult: providerRepairRuntimeResult,
  });

  const providerRepairEvaluation = resolveStructuredActionRepairEvaluation({
    runtimeResult: providerRepairRuntimeResult,
  });
  if (
    !(
      providerRepairEvaluation.accepted &&
      providerRepairEvaluation.runtimeResult
    )
  ) {
    const providerFailureDiagnostics =
      resolveStructuredActionFailureDiagnostics({
        carrierKind: providerRepairEvaluation.carrierKind,
        parseError: providerRepairEvaluation.parseError,
        publicFailureReason: input.failureReason,
        repairMode: "controller_roundtrip",
        runtimeResult:
          providerRepairEvaluation.runtimeResult ?? providerRepairRuntimeResult,
      });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.structured_action_repair_failed",
      text: `structured OpenMeld Space action repair failed for task ${input.parsedTask.taskId}`,
      payload: {
        dispatchId: input.parsedTask.dispatchId,
        ...providerFailureDiagnostics,
        failureReason: input.failureReason,
        repairedRuntimeStatus: providerRepairEvaluation.repairedRuntimeStatus,
        repairedStructuredActionPresent:
          providerRepairEvaluation.repairedStructuredActionPresent,
        repairMode: "controller_roundtrip",
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
    return {
      finalFailureDiagnostics: providerFailureDiagnostics,
      runtimeResult: null,
    };
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.structured_action_repair_completed",
    text: `structured OpenMeld Space action repair completed for task ${input.parsedTask.taskId}`,
    payload: {
      dispatchId: input.parsedTask.dispatchId,
      repaired: true,
      repairMode: "controller_roundtrip",
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });
  return {
    finalFailureDiagnostics: null,
    runtimeResult: applyStructuredSpaceActionProvenanceToRuntimeResult({
      runtimeResult: providerRepairEvaluation.runtimeResult,
      provenance: "controller_repair",
    }),
  };
}

function resolveStructuredActionRepairEvaluation(input: {
  runtimeResult: RuntimeTaskResult;
}): {
  accepted: boolean;
  carrierKind: StructuredActionFailureDiagnostics["carrierKind"];
  parseError: string | null;
  repairedRuntimeStatus: RuntimeTaskResult["resultPayload"]["status"];
  repairedStructuredActionPresent: boolean;
  runtimeResult: RuntimeTaskResult | null;
} {
  const runtimeResult = input.runtimeResult;
  const repairedResolution =
    resolveStructuredSpaceActionFromRuntimePayload(runtimeResult);
  const repairedAction =
    runtimeResult.resultPayload.spaceAction ?? repairedResolution.action;
  const repairedRuntimeStatus = runtimeResult.resultPayload.status;
  const accepted =
    (repairedRuntimeStatus === "success" ||
      repairedRuntimeStatus === "partial_success") &&
    repairedResolution.parseError === null &&
    repairedAction !== undefined;

  return {
    accepted,
    carrierKind: repairedResolution.carrierKind,
    parseError: repairedResolution.parseError,
    repairedRuntimeStatus,
    repairedStructuredActionPresent: repairedAction !== undefined,
    runtimeResult,
  };
}

function resolveStructuredActionFailureDiagnostics(input: {
  carrierKind: StructuredActionFailureDiagnostics["carrierKind"];
  parseError: string | null;
  publicFailureReason?: string | null;
  repairMode: StructuredActionFailureDiagnostics["repairMode"];
  runtimeResult: RuntimeTaskResult;
}): StructuredActionFailureDiagnostics {
  return {
    carrierKind: input.carrierKind,
    invalidOutputPreview: buildInvalidStructuredActionOutputPreview(
      input.runtimeResult
    ),
    publicFailureReason: normalizeOptionalText(input.publicFailureReason),
    repairMode: input.repairMode,
    spaceActionCandidatePresent: input.carrierKind !== "none",
    spaceActionParseError: normalizeOptionalText(input.parseError),
  };
}

function maybeRejectDispatchPreflight(input: {
  activeLeaseEpoch: number | undefined;
  correlation: DispatchCorrelation;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  parsedTask: ReturnType<typeof parseDispatchTask>;
  ledgerPaths: LedgerPaths;
  presenter: Presenter;
  socket: DaemonFrameSink;
}): LocalExecutionSlotTaskResult | null {
  const staleLeaseResult = maybeRejectStaleLease({
    activeLeaseEpoch: input.activeLeaseEpoch,
    correlation: input.correlation,
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    ledgerPaths: input.ledgerPaths,
    parsedTask: input.parsedTask,
    presenter: input.presenter,
    socket: input.socket,
  });
  if (staleLeaseResult) {
    return staleLeaseResult;
  }

  return maybeRejectInvalidDispatchTask({
    correlation: input.correlation,
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    ledgerPaths: input.ledgerPaths,
    parsedTask: input.parsedTask,
    presenter: input.presenter,
    socket: input.socket,
  });
}

function resolveStructuredSpaceActionFromRuntimePayload(
  runtimeResult: RuntimeTaskResult
): {
  action: OpenMeldDaemonTaskResultPayload["spaceAction"];
  carrierKind: StructuredActionFailureDiagnostics["carrierKind"];
  cleanedOutput?: string;
  parseError: string | null;
} {
  const payload = runtimeResult.resultPayload;
  if (payload.status !== "success" && payload.status !== "partial_success") {
    return {
      action: undefined,
      carrierKind: "none",
      cleanedOutput: undefined,
      parseError: null,
    };
  }

  return {
    action: payload.spaceAction,
    carrierKind: "none",
    cleanedOutput: undefined,
    parseError: null,
  };
}

function applyStructuredSpaceActionResolutionToRuntimePayload(input: {
  runtimeResult: RuntimeTaskResult;
  resolution: {
    action: OpenMeldDaemonTaskResultPayload["spaceAction"];
    cleanedOutput?: string;
    parseError: string | null;
    spaceActionProvenance?: OpenMeldDaemonTaskResultPayload["spaceActionProvenance"];
  };
}): RuntimeTaskResult {
  const payload = input.runtimeResult.resultPayload;
  if (payload.status !== "success" && payload.status !== "partial_success") {
    return input.runtimeResult;
  }

  return {
    ...input.runtimeResult,
    resultPayload: {
      ...payload,
      output: input.resolution.cleanedOutput ?? payload.output,
      ...(input.resolution.action
        ? { spaceAction: input.resolution.action }
        : {}),
      ...(input.resolution.action && input.resolution.spaceActionProvenance
        ? { spaceActionProvenance: input.resolution.spaceActionProvenance }
        : {}),
    },
  };
}

function applyStructuredSpaceActionProvenanceToRuntimeResult(input: {
  runtimeResult: RuntimeTaskResult;
  provenance: NonNullable<
    OpenMeldDaemonTaskResultPayload["spaceActionProvenance"]
  >;
}): RuntimeTaskResult {
  const payload = input.runtimeResult.resultPayload;
  if (
    (payload.status !== "success" && payload.status !== "partial_success") ||
    !payload.spaceAction
  ) {
    return input.runtimeResult;
  }

  return {
    ...input.runtimeResult,
    resultPayload: {
      ...payload,
      spaceActionProvenance: payload.spaceActionProvenance ?? input.provenance,
    },
  };
}

function resolveStructuredSpaceActionProvenance(input: {
  runtimeResult: RuntimeTaskResult;
  resolvedSpaceAction: OpenMeldDaemonTaskResultPayload["spaceAction"];
}): OpenMeldDaemonTaskResultPayload["spaceActionProvenance"] {
  if (!input.resolvedSpaceAction) {
    return undefined;
  }
  return input.runtimeResult.resultPayload.spaceActionProvenance ?? "direct";
}

type DispatchRuntimeRoute = NonNullable<
  Parameters<typeof runRuntimeTask>[0]["route"]
>;
type DispatchRuntimeTask = Parameters<typeof runRuntimeTask>[0]["task"];

async function runDispatchRuntimeExecution(input: {
  onNativeTurnStarted: () => Promise<void>;
  onNativeTurnCompleted: (result: RuntimeTaskResult) => void;
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary | null;
  contextId: string | null;
  executionMode: AdapterDispatchExecutionMode;
  io: ReturnType<typeof createLedgerIo>;
  ledgerPaths: LedgerPaths;
  onInteractionRequest?: Parameters<
    typeof runRuntimeTask
  >[0]["onInteractionRequest"];
  onPublicProgress?: (
    update: string
  ) => DispatchPublicProgressResult | Promise<DispatchPublicProgressResult>;
  onPreview?: Parameters<typeof runRuntimeTask>[0]["onPreview"];
  onRuntimeEvent?: Parameters<typeof runRuntimeTask>[0]["onRuntimeEvent"];
  parsedTask: ParsedDispatchTask;
  instructionPrompt?: AdapterInstructionPrompt;
  prompt: string;
  routeConfig: DaemonProfileRouteConfig | null;
  runtimeContext: ProviderDispatchRuntimeContext;
  runtimeEnvOverrides?: Record<string, string | undefined>;
  runtimeControllerSupport: SupportedRuntimeControllerSupport;
  streamingModeOverride?: DispatchRuntimeRoute["streamingMode"];
  agentControllerConversationOverride?: AgentControllerConversationRef | null;
}): Promise<Awaited<ReturnType<typeof runRuntimeTask>>> {
  const route = buildDispatchRuntimeRoute({
    contextId: input.contextId,
    envOverrides: input.runtimeEnvOverrides,
    parsedTask: input.parsedTask,
    routeConfig: input.routeConfig,
    runtimeControllerSupport: input.runtimeControllerSupport,
    streamingMode:
      input.streamingModeOverride ?? input.parsedTask.streamingMode,
  });
  const dispatchRuntimeEnv = { ...process.env, ...route.env };
  const spaceActionTools = route.env?.[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]
    ? createDispatchSpaceTools({
        env: dispatchRuntimeEnv,
        ...(input.onPublicProgress
          ? { reportProgress: input.onPublicProgress }
          : {}),
      })
    : undefined;
  const progressRelay =
    input.onPublicProgress &&
    route.env?.[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]
      ? startDispatchSpaceProgressRelay({
          context:
            readDispatchSpaceActionContextForReceiptFromEnv(dispatchRuntimeEnv),
          contextPath: route.env[
            OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV
          ] as string,
          reportProgress: input.onPublicProgress,
        })
      : null;
  try {
    await input.onNativeTurnStarted();
    const result = await runRuntimeTask({
      spaceActionTools,
      // Admission/continuation already selected the conversation. An explicit
      // null means start fresh, not permission to restore a retained ledger ID.
      agentContextOverride: {
        agentControllerConversationId: input.contextId,
        agentControllerConversationOverride:
          input.agentControllerConversationOverride ?? null,
      },
      io: input.io,
      ...(input.onInteractionRequest
        ? { onInteractionRequest: input.onInteractionRequest }
        : {}),
      ...(input.onPreview ? { onPreview: input.onPreview } : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      paths: input.ledgerPaths,
      route,
      task: buildDispatchRuntimeTask({
        computerFileAccessBoundary: input.computerFileAccessBoundary,
        executionMode: input.executionMode,
        instructionPrompt: input.instructionPrompt,
        parsedTask: input.parsedTask,
        prompt: input.prompt,
        runtimeContext: input.runtimeContext,
      }),
    });
    input.onNativeTurnCompleted(result);
    return result;
  } finally {
    await progressRelay?.close();
    spaceActionTools?.close();
  }
}

function buildDispatchRuntimeRoute(input: {
  contextId: string | null;
  envOverrides?: Record<string, string | undefined>;
  parsedTask: ParsedDispatchTask;
  routeConfig: DaemonProfileRouteConfig | null;
  runtimeControllerSupport: SupportedRuntimeControllerSupport;
  streamingMode: DispatchRuntimeRoute["streamingMode"];
}): DispatchRuntimeRoute {
  const runtimeEnv: Record<string, string | undefined> = input.contextId
    ? {
        [input.parsedTask.contextIdMappingSpec.sourceField]: input.contextId,
        ...(input.envOverrides ?? {}),
      }
    : (input.envOverrides ?? {});
  return {
    contextIdMappingSpec: input.parsedTask.contextIdMappingSpec,
    agentControllerRef: input.parsedTask.agentControllerRef,
    controllerRuntimeAvailable: true,
    env: buildDispatchOwnedRuntimeEnv({
      dispatchId: input.parsedTask.dispatchId,
      targetProfileId: input.parsedTask.targetProfileId,
      env: runtimeEnv,
      spaceActionContextPath:
        runtimeEnv[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV] ?? null,
    }),
    serviceHealthy: true,
    serviceInstalled: true,
    ...(input.routeConfig?.agentControllerPermissionMode
      ? {
          agentControllerPermissionMode:
            input.routeConfig.agentControllerPermissionMode,
        }
      : {}),
    ...(input.routeConfig?.conversationPolicy
      ? { conversationPolicy: input.routeConfig.conversationPolicy }
      : {}),
    ...(input.routeConfig?.openCodePermission
      ? { openCodePermission: input.routeConfig.openCodePermission }
      : {}),
    targets: [
      ...buildRuntimeRouteTargets({
        agentControllerRef: input.parsedTask.agentControllerRef,
        launchContract: input.routeConfig?.launchContract ?? null,
        runtimeControllerSupport: input.runtimeControllerSupport,
      }),
    ],
    streamingMode: input.streamingMode,
    transportMode: input.parsedTask.transportMode,
    view: "agent",
  };
}

function buildDispatchRuntimeTask(input: {
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary | null;
  executionMode: AdapterDispatchExecutionMode;
  instructionPrompt?: AdapterInstructionPrompt;
  parsedTask: ParsedDispatchTask;
  prompt: string;
  runtimeContext: ProviderDispatchRuntimeContext;
}): DispatchRuntimeTask {
  return {
    executionContext: input.parsedTask.executionContext,
    agentContextScopeId: resolveColleagueLedgerScopeId(input.parsedTask),
    agentId: input.parsedTask.targetProfileId,
    attemptId: input.parsedTask.attemptId,
    bindingKey: `${input.parsedTask.spaceId}|${input.parsedTask.targetProfileId}`,
    ...(input.computerFileAccessBoundary
      ? { computerFileAccessBoundary: input.computerFileAccessBoundary }
      : {}),
    dispatchId: input.parsedTask.dispatchId,
    deliveryRecoveryReason:
      input.parsedTask.deliveryRecoveryReason ?? undefined,
    executionMode: input.executionMode,
    ...(input.instructionPrompt
      ? { instructionPrompt: input.instructionPrompt }
      : {}),
    mentioned: true,
    newSessionTitle:
      input.executionMode === "normal" &&
      input.parsedTask.agentControllerRef === "builtin:codex"
        ? buildDispatchSessionTitle(input.parsedTask)
        : undefined,
    prompt: input.prompt,
    runtimeContext: input.runtimeContext,
    sequence: input.parsedTask.sequence,
    sourceEventId: input.parsedTask.sourceEventId,
    spaceId: input.parsedTask.spaceId,
    taskId: input.parsedTask.taskId,
    triggerMode: input.parsedTask.triggerMode,
  };
}

function maybeRejectStaleLease(input: {
  activeLeaseEpoch: number | undefined;
  correlation: DispatchCorrelation;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  ledgerPaths: LedgerPaths;
  parsedTask: ReturnType<typeof parseDispatchTask>;
  presenter: Presenter;
  socket: DaemonFrameSink;
}): LocalExecutionSlotTaskResult | null {
  if (
    input.activeLeaseEpoch === undefined ||
    input.activeLeaseEpoch === input.deliverRequest.leaseEpoch
  ) {
    return null;
  }

  return sendDispatchRejectionResult({
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    dispatchId: input.correlation.dispatchId,
    ledgerPaths: input.ledgerPaths,
    payload: {
      attemptId: input.correlation.attemptId,
      agentControllerRef: input.parsedTask?.agentControllerRef ?? null,
      errorCode: "daemon.session.stale_lease",
      errorMessage:
        "daemon.session.stale_lease: local lease epoch does not match deliver frame",
      errorType: "config",
      sourceEventId: input.correlation.sourceEventId,
      targetProfileId: input.correlation.targetProfileId,
      taskId: input.correlation.taskId,
    },
    presenter: input.presenter,
  });
}

function maybeRejectInvalidDispatchTask(input: {
  correlation: DispatchCorrelation;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  ledgerPaths: LedgerPaths;
  parsedTask: ReturnType<typeof parseDispatchTask>;
  presenter: Presenter;
  socket: DaemonFrameSink;
}): LocalExecutionSlotTaskResult | null {
  if (input.parsedTask) {
    return null;
  }

  return sendDispatchRejectionResult({
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    dispatchId: input.correlation.dispatchId,
    ledgerPaths: input.ledgerPaths,
    payload: {
      attemptId: input.correlation.attemptId,
      agentControllerRef: input.correlation.agentControllerRef,
      errorCode: "schema.invalid",
      errorMessage:
        "schema.invalid: daemon dispatch payload is invalid or missing required fields",
      errorType: "config",
      sourceEventId: input.correlation.sourceEventId,
      targetProfileId: input.correlation.targetProfileId,
      taskId: input.correlation.taskId,
    },
    presenter: input.presenter,
  });
}

function resolveValidatedDispatchDeliveryInput(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  ledgerPaths: LedgerPaths;
  leasesByProfileId: Map<string, number>;
  localAdapterContainer: LocalDaemonAdapterContainer;
  presenter: Presenter;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  socket: DaemonFrameSink;
}):
  | {
      result: LocalExecutionSlotTaskResult;
      status: "rejected";
    }
  | {
      parsedTask: ParsedDispatchTask;
      routeConfig: DaemonProfileRouteConfig | null;
      runtimeControllerSupport: ReturnType<
        typeof resolveLocalRuntimeControllerSupport
      >;
      status: "ready";
    } {
  const routeConfig =
    input.routeByProfileId.get(input.deliverRequest.profileId) ?? null;
  const parsedTask = parseDispatchTask({
    deliverRequest: input.deliverRequest,
    fallbackRouteConfig: routeConfig,
  });
  const correlation = buildDispatchCorrelation({
    deliverRequest: input.deliverRequest,
    parsedTask,
  });
  const activeLeaseEpoch = input.leasesByProfileId.get(
    input.deliverRequest.profileId
  );
  const preflightRejectionResult = maybeRejectDispatchPreflight({
    activeLeaseEpoch,
    correlation,
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    ledgerPaths: input.ledgerPaths,
    parsedTask,
    presenter: input.presenter,
    socket: input.socket,
  });
  if (preflightRejectionResult) {
    return {
      result: preflightRejectionResult,
      status: "rejected",
    };
  }
  assertParsedDispatchTask(parsedTask);

  const runtimeControllerSupport = resolveLocalRuntimeControllerSupport({
    agentControllerRef: parsedTask.agentControllerRef,
    localAdapterContainer: input.localAdapterContainer,
  });

  return {
    parsedTask,
    routeConfig,
    runtimeControllerSupport,
    status: "ready",
  };
}

function assertParsedDispatchTask(
  parsedTask: ReturnType<typeof parseDispatchTask>
): asserts parsedTask is ParsedDispatchTask {
  if (!parsedTask) {
    throw new Error("dispatch task unexpectedly missing after validation");
  }
}

function assertSupportedRuntimeControllerSupport(
  runtimeControllerSupport: ReturnType<
    typeof resolveLocalRuntimeControllerSupport
  >
): asserts runtimeControllerSupport is SupportedRuntimeControllerSupport {
  if (!runtimeControllerSupport.supported) {
    throw new Error(
      `runtime controller support unexpectedly missing after validation: ${runtimeControllerSupport.reasonDetail}`
    );
  }
}

function maybeRejectUnsupportedController(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  ledgerPaths: LedgerPaths;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  runtimeControllerSupport: ReturnType<
    typeof resolveLocalRuntimeControllerSupport
  >;
  socket: DaemonFrameSink;
}): LocalExecutionSlotTaskResult | null {
  if (input.runtimeControllerSupport.supported) {
    return null;
  }

  return sendDispatchRejectionResult({
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    deliverRequest: input.deliverRequest,
    dispatchId: input.parsedTask.dispatchId,
    ledgerPaths: input.ledgerPaths,
    payload: {
      attemptId: input.parsedTask.attemptId,
      agentControllerRef: input.parsedTask.agentControllerRef,
      errorCode: "controller.kind.unsupported",
      errorMessage: `controller.kind.unsupported: ${input.runtimeControllerSupport.reasonDetail}`,
      errorType: "config",
      sourceEventId: input.parsedTask.sourceEventId,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
    presenter: input.presenter,
  });
}

function sendDispatchRejectionResult(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  dispatchId: string;
  ledgerPaths: LedgerPaths;
  payload: DispatchRejectionPayloadInput;
  presenter: Presenter;
}): LocalExecutionSlotTaskResult {
  const payload = buildFailedTaskResultPayload(input.payload);
  return sendResultAndSummarize({
    attemptId: input.payload.attemptId,
    connectionGeneration: input.deliverRequest.connectionGeneration,
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: input.daemonSessionId,
    dispatchId: input.dispatchId,
    executionIdentityEcho: toRuntimeTransportResultIdentityEcho(
      input.deliverRequest
    ),
    executionTokenEcho: toRuntimeCoordinatorExecutionTokenEcho(
      input.deliverRequest
    ),
    ledgerPaths: input.ledgerPaths,
    leaseEpoch: input.deliverRequest.leaseEpoch,
    payload,
    presenter: input.presenter,
    runtimeCoordinatorExecutionId:
      input.deliverRequest.payload.runtimeCoordinatorExecutionId,
    taskId: input.payload.taskId,
  }).resultSummary;
}

export function buildDispatchExecution(input: {
  agentControllerConversationId: string | null;
  bootstrapPlan: BootstrapPlan;
  localRuntimeContextPlan: LocalRuntimeContextPlan;
  observedAgentControllerConversation: AgentControllerConversationRef | null;
  plannedAgentControllerConversation: AgentControllerConversationRef | null;
}): DispatchExecution {
  const effectiveObservedAgentControllerConversation =
    input.observedAgentControllerConversation ??
    input.plannedAgentControllerConversation;
  let agentControllerConversationResume: DispatchExecution["agentControllerConversationResume"];
  if (!normalizeOptionalContextId(input.agentControllerConversationId)) {
    agentControllerConversationResume = {
      status: "not_bound",
    };
  } else if (
    input.plannedAgentControllerConversation &&
    areSameAgentControllerConversationRef(
      input.plannedAgentControllerConversation,
      effectiveObservedAgentControllerConversation
    )
  ) {
    agentControllerConversationResume = {
      status: "continued",
    };
  } else {
    agentControllerConversationResume = {
      status: "replaced_by_provider",
    };
  }
  return {
    bootstrap: input.bootstrapPlan.shouldInject
      ? {
          reason: input.bootstrapPlan.reason ?? "missing_bootstrap_state",
          status: "pending",
        }
      : {
          reason: null,
          status: "applied",
        },
    localRuntimeContext: {
      reason: input.localRuntimeContextPlan.reason,
      status:
        input.localRuntimeContextPlan.status === "reuse"
          ? "reused"
          : "recreated",
    },
    agentControllerConversationResume,
  };
}

function sendResultAndSummarize(input: {
  attemptId: string;
  connectionGeneration: number;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchId: string;
  emitCompletedLifecycle?: boolean;
  executionIdentityEcho: RuntimeTransportResultIdentityEcho;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho | null;
  ledgerPaths: LedgerPaths;
  leaseEpoch: number;
  payload: OpenMeldDaemonTaskResultPayload;
  presenter: Presenter;
  runtimeCoordinatorExecutionId: string | null;
  taskId: string;
  waitForSettlement?: boolean;
}): {
  resultSummary: LocalExecutionSlotTaskResult;
  settlement: Promise<DispatchResultOutboxSettlement> | null;
} {
  let settlement: Promise<DispatchResultOutboxSettlement> | null = null;
  try {
    if (input.emitCompletedLifecycle !== false) {
      emitDispatchLifecycleTransition({
        attemptId: input.attemptId,
        connectionGeneration: input.connectionGeneration,
        currentSocketRef: input.currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        dispatchId: input.dispatchId,
        leaseEpoch: input.leaseEpoch,
        phase: "completed_local",
        presenter: input.presenter,
        executionTokenEcho: input.executionTokenEcho,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
        taskId: input.taskId,
      });
    }
    settlement = enqueueDispatchResultOutboxRecord({
      attemptId: input.attemptId,
      connectionGeneration: input.connectionGeneration,
      currentSocketRef: input.currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      executionIdentityEcho: input.executionIdentityEcho,
      executionTokenEcho: input.executionTokenEcho,
      ledgerPaths: input.ledgerPaths,
      leaseEpoch: input.leaseEpoch,
      payload: input.payload,
      presenter: input.presenter,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      taskId: input.taskId,
      waitForSettlement: input.waitForSettlement,
    });
    emitDaemonDispatchJournalEvent({
      attemptId: input.attemptId,
      connectionGeneration: input.connectionGeneration,
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      leaseEpoch: input.leaseEpoch,
      metadata: buildResultDispatchJournalMetadata(input.payload),
      result: input.payload.status,
      taskId: input.taskId,
      type: "dispatch.result.sent",
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.result_queued",
      text: `daemon result queued for dispatch ${input.dispatchId}`,
      payload: {
        attemptId: input.attemptId,
        connectionGeneration: input.connectionGeneration,
        daemonSessionId: input.daemonSessionId,
        dispatchId: input.dispatchId,
        leaseEpoch: input.leaseEpoch,
        result: input.payload.status,
        taskId: input.taskId,
      },
    });
  } catch (error) {
    emitDaemonDispatchJournalEvent({
      attemptId: input.attemptId,
      connectionGeneration: input.connectionGeneration,
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      leaseEpoch: input.leaseEpoch,
      metadata: {
        ...buildResultDispatchJournalMetadata(input.payload),
        errorMessage: toErrorMessage(error),
      },
      result: input.payload.status,
      taskId: input.taskId,
      type: "dispatch.result.send_failed",
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.result_send_failed",
      text: `daemon result send failed for dispatch ${input.dispatchId}: ${toErrorMessage(error)}`,
      payload: {
        attemptId: input.attemptId,
        connectionGeneration: input.connectionGeneration,
        daemonSessionId: input.daemonSessionId,
        dispatchId: input.dispatchId,
        leaseEpoch: input.leaseEpoch,
        result: input.payload.status,
        taskId: input.taskId,
      },
    });
    throw error;
  }
  return {
    resultSummary: summarizeTaskResultPayload(input.payload),
    settlement,
  };
}

function requireCompletedDispatchPlans(input: {
  bootstrapPlan: BootstrapPlan | null;
  ledgerIo: ReturnType<typeof createLedgerIo> | null;
  localRuntimeContextPlan: LocalRuntimeContextPlan | null;
  runtimePromptPlan: DispatchPromptPlan | null;
}): {
  bootstrapPlan: BootstrapPlan;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  localRuntimeContextPlan: LocalRuntimeContextPlan;
  runtimePromptPlan: DispatchPromptPlan;
} {
  if (
    !(
      input.bootstrapPlan &&
      input.ledgerIo &&
      input.localRuntimeContextPlan &&
      input.runtimePromptPlan
    )
  ) {
    throw new DaemonServiceRunError({
      code: "dispatch.runtime_context.incomplete",
      message:
        "OpenMeld could not settle the Agent reply because its runtime context is incomplete.",
    });
  }
  return {
    bootstrapPlan: input.bootstrapPlan,
    ledgerIo: input.ledgerIo,
    localRuntimeContextPlan: input.localRuntimeContextPlan,
    runtimePromptPlan: input.runtimePromptPlan,
  };
}

async function requestDispatchAgentInteraction(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  leasesByProfileId: Map<string, number>;
  parsedTask: ParsedDispatchTask;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  presenter: Presenter;
  request: AdapterInteractionRequest;
}): Promise<Awaited<ReturnType<PendingAgentInteractionRegistry["register"]>>> {
  const requestedAtMs = Date.now();
  const interactionCandidate: AgentInteractionRequest = {
    ...input.request,
    ...(input.request.kind === "permission"
      ? { supportsPermissionModeUpdate: true }
      : {}),
    v: AGENT_INTERACTION_SCHEMA_VERSION,
    interactionId: randomUUID(),
    requestedAtMs,
    expiresAtMs: requestedAtMs + AGENT_INTERACTION_DEFAULT_TIMEOUT_MS,
  };
  const parsedInteraction =
    agentInteractionRequestSchema.safeParse(interactionCandidate);
  if (!parsedInteraction.success) {
    throw new DaemonServiceRunError({
      code: "daemon.run.interaction_payload_invalid",
      message: "local agent produced an invalid interaction request",
    });
  }

  const responsePromise = input.pendingAgentInteractionRegistry.register({
    authority: {
      attemptId: input.parsedTask.attemptId,
      dispatchId: input.parsedTask.dispatchId,
      executionIdentityEcho: toRuntimeTransportRuntimeEvidenceIdentityEcho(
        input.deliverRequest
      ),
      executionTokenEcho: input.parsedTask.executionTokenEcho,
      runtimeCoordinatorExecutionId:
        input.parsedTask.runtimeCoordinatorExecutionId,
      targetProfileId: input.parsedTask.targetProfileId,
    },
    request: parsedInteraction.data,
    taskId: input.parsedTask.taskId,
  });
  try {
    sendDispatchInteractionRequestFrame({
      attemptId: input.parsedTask.attemptId,
      connectionGeneration: resolveCurrentConnectionGeneration({
        currentSocketRef: input.currentSocketRef,
        fallbackConnectionGeneration: input.deliverRequest.connectionGeneration,
      }),
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.parsedTask.dispatchId,
      executionIdentityEcho: toRuntimeTransportRuntimeEvidenceIdentityEcho(
        input.deliverRequest
      ),
      executionTokenEcho: input.parsedTask.executionTokenEcho,
      interaction: parsedInteraction.data,
      leaseEpoch:
        input.leasesByProfileId.get(input.parsedTask.targetProfileId) ??
        input.deliverRequest.leaseEpoch,
      runtimeCoordinatorExecutionId:
        input.parsedTask.runtimeCoordinatorExecutionId,
      socket:
        input.currentSocketRef.socket ??
        failMissingCurrentSocket(input.parsedTask.dispatchId),
      taskId: input.parsedTask.taskId,
    });
  } catch (error) {
    input.pendingAgentInteractionRegistry.reject(
      parsedInteraction.data.interactionId,
      error instanceof Error ? error : new Error(toErrorMessage(error))
    );
    throw error;
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.interaction_requested",
    text: `local agent is waiting for user input for task ${input.parsedTask.taskId}`,
    payload: {
      dispatchId: input.parsedTask.dispatchId,
      expiresAtMs: parsedInteraction.data.expiresAtMs,
      interactionId: parsedInteraction.data.interactionId,
      interactionKind: parsedInteraction.data.kind,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });
  return await responsePromise;
}

function emitDispatchPreviewFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchId: string;
  leaseEpoch: number;
  presenter: Presenter;
  previewText: string;
  taskId: string;
}): void {
  try {
    sendDispatchPreviewFrame({
      attemptId: input.attemptId,
      connectionGeneration: resolveCurrentConnectionGeneration({
        currentSocketRef: input.currentSocketRef,
        fallbackConnectionGeneration: input.connectionGeneration,
      }),
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      leaseEpoch: input.leaseEpoch,
      previewText: input.previewText,
      socket:
        input.currentSocketRef.socket ??
        failMissingCurrentSocket(input.dispatchId),
    });
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.preview_send_failed",
      text: `daemon preview send failed for dispatch ${input.dispatchId}: ${toErrorMessage(error)}`,
      payload: {
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        taskId: input.taskId,
      },
    });
  }
}

function emitDispatchAgentToolActivityFrame(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  event: AdapterToolActivityEvent;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  sequence: number;
}): void {
  try {
    sendDispatchToolActivityFrame({
      attemptId: input.parsedTask.attemptId,
      connectionGeneration: resolveCurrentConnectionGeneration({
        currentSocketRef: input.currentSocketRef,
        fallbackConnectionGeneration: input.deliverRequest.connectionGeneration,
      }),
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.parsedTask.dispatchId,
      executionIdentityEcho: toRuntimeTransportRuntimeEvidenceIdentityEcho(
        input.deliverRequest
      ),
      executionTokenEcho: input.parsedTask.executionTokenEcho,
      leaseEpoch: input.deliverRequest.leaseEpoch,
      observedAtMs: input.event.tsMs,
      part: {
        type: "tool",
        toolCallId: input.event.toolCallId,
        toolName: input.event.toolName,
        state: input.event.state,
        ...(input.event.work ? { work: input.event.work } : {}),
      },
      runtimeCoordinatorExecutionId:
        input.parsedTask.runtimeCoordinatorExecutionId,
      sequence: input.sequence,
      socket:
        input.currentSocketRef.socket ??
        failMissingCurrentSocket(input.parsedTask.dispatchId),
      sourceSignalId: input.parsedTask.sourceEventId,
      spaceId: input.parsedTask.spaceId,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    });
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.tool_activity_send_failed",
      text: `daemon tool activity send failed for dispatch ${input.parsedTask.dispatchId}: ${toErrorMessage(error)}`,
      payload: {
        attemptId: input.parsedTask.attemptId,
        dispatchId: input.parsedTask.dispatchId,
        sequence: input.sequence,
        state: input.event.state,
        toolName: input.event.toolName,
        taskId: input.parsedTask.taskId,
      },
    });
  }
}

function emitDispatchPreviewEndFrame(input: {
  attemptId: string;
  connectionGeneration: number;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchId: string;
  leaseEpoch: number;
  presenter: Presenter;
  taskId: string;
}): void {
  try {
    sendDispatchPreviewEndFrame({
      attemptId: input.attemptId,
      connectionGeneration: resolveCurrentConnectionGeneration({
        currentSocketRef: input.currentSocketRef,
        fallbackConnectionGeneration: input.connectionGeneration,
      }),
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      leaseEpoch: input.leaseEpoch,
      socket:
        input.currentSocketRef.socket ??
        failMissingCurrentSocket(input.dispatchId),
    });
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.preview_end_send_failed",
      text: `daemon preview end send failed for dispatch ${input.dispatchId}: ${toErrorMessage(error)}`,
      payload: {
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        taskId: input.taskId,
      },
    });
  }
}

function emitDispatchRuntimeEvidenceTransition(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  durationMs?: number | null;
  errorName?: string | null;
  parsedTask?: ParsedDispatchTask | null;
  phase: RuntimeTransportDispatchRuntimeEvidencePhase;
  presenter: Presenter;
  reasonCode?: string | null;
}): void {
  const identity = buildDispatchRuntimeEvidenceIdentity({
    deliverRequest: input.deliverRequest,
    parsedTask: input.parsedTask ?? null,
  });

  try {
    sendDispatchRuntimeEvidenceFrame({
      attemptId: identity.attemptId,
      connectionGeneration: resolveCurrentConnectionGeneration({
        currentSocketRef: input.currentSocketRef,
        fallbackConnectionGeneration: input.deliverRequest.connectionGeneration,
      }),
      daemonSessionId: input.daemonSessionId,
      dispatchId: identity.dispatchId,
      durationMs: input.durationMs ?? null,
      errorName: input.errorName ?? null,
      executionIdentityEcho: toRuntimeTransportRuntimeEvidenceIdentityEcho(
        input.deliverRequest
      ),
      executionTokenEcho: toRuntimeCoordinatorExecutionTokenEcho(
        input.deliverRequest
      ),
      leaseEpoch: input.deliverRequest.leaseEpoch,
      phase: input.phase,
      reasonCode: input.reasonCode ?? null,
      runtimeCoordinatorExecutionId:
        input.deliverRequest.payload.runtimeCoordinatorExecutionId,
      socket:
        input.currentSocketRef.socket ??
        failMissingCurrentSocket(identity.dispatchId),
      sourceClientMessageId: identity.sourceClientMessageId,
      sourceSignalId: identity.sourceSignalId,
      spaceId: identity.spaceId,
      targetProfileId: identity.targetProfileId,
      taskId: identity.taskId,
    });
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.runtime_evidence_send_failed",
      text: `daemon runtime evidence ${input.phase} send failed for dispatch ${identity.dispatchId}: ${toErrorMessage(error)}`,
      payload: {
        attemptId: identity.attemptId,
        dispatchId: identity.dispatchId,
        phase: input.phase,
        reasonCode: input.reasonCode ?? null,
        taskId: identity.taskId,
      },
    });
  }
}

function buildDispatchRuntimeEvidenceIdentity(input: {
  deliverRequest: RuntimeTransportDeliverDispatchRequest;
  parsedTask: ParsedDispatchTask | null;
}): {
  attemptId: string;
  dispatchId: string;
  sourceClientMessageId: string | null;
  sourceSignalId: string;
  spaceId: string;
  targetProfileId: string;
  taskId: string;
} {
  const payload = input.deliverRequest.payload;
  return {
    attemptId: input.parsedTask?.attemptId ?? input.deliverRequest.attemptId,
    dispatchId: input.parsedTask?.dispatchId ?? input.deliverRequest.dispatchId,
    sourceClientMessageId: payload.sourceClientMessageId ?? null,
    sourceSignalId: input.parsedTask?.sourceEventId ?? payload.sourceEventId,
    spaceId: input.parsedTask?.spaceId ?? payload.spaceId,
    targetProfileId:
      input.parsedTask?.targetProfileId ?? payload.targetProfileId,
    taskId: input.parsedTask?.taskId ?? payload.taskId,
  };
}

function toRuntimeTransportRuntimeEvidenceIdentityEcho(
  deliverRequest: RuntimeTransportDeliverDispatchRequest
): RuntimeTransportRuntimeEvidenceIdentityEcho {
  return {
    echoSource: "daemon_delivery_context",
    core: deliverRequest.payload.executionIdentity.core,
  };
}

function toRuntimeTransportResultIdentityEcho(
  deliverRequest: RuntimeTransportDeliverDispatchRequest
): RuntimeTransportResultIdentityEcho {
  return toRuntimeTransportResultIdentityEchoFromDeliveryIdentity(
    deliverRequest.payload.executionIdentity
  );
}

function toRuntimeCoordinatorExecutionTokenEcho(
  deliverRequest: RuntimeTransportDeliverDispatchRequest
): RuntimeCoordinatorExecutionTokenEcho | null {
  const executionToken = deliverRequest.payload.executionToken;
  if (!executionToken) {
    return null;
  }
  return {
    executionToken: executionToken.executionToken,
    runId: executionToken.runId,
    runtimeCoordinatorExecutionId:
      executionToken.executionScope.runtimeCoordinatorExecutionId,
    tokenFingerprint: executionToken.tokenFingerprint,
  };
}

function resolveRuntimeCoordinatorExecutionTokenEchoFromRaw(
  value: unknown
): RuntimeCoordinatorExecutionTokenEcho | null {
  const parsed =
    runtimeCoordinatorExecutionTokenEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return {
    executionToken: parsed.data.executionToken,
    runId: parsed.data.runId,
    runtimeCoordinatorExecutionId:
      parsed.data.executionScope.runtimeCoordinatorExecutionId,
    tokenFingerprint: parsed.data.tokenFingerprint,
  };
}

function toRuntimeTransportResultIdentityEchoFromDeliveryIdentity(
  executionIdentity: RuntimeTransportDeliveryExecutionIdentity
): RuntimeTransportResultIdentityEcho {
  return {
    echoSource: "daemon_delivery_context",
    core: executionIdentity.core,
  };
}

function resolveRuntimeEvidenceResultPhase(
  payload: OpenMeldDaemonTaskResultPayload
): Extract<
  RuntimeTransportDispatchRuntimeEvidencePhase,
  "completed" | "failed"
> {
  return payload.status === "failed" ? "failed" : "completed";
}

function resolveRuntimeEvidenceResultReasonCode(
  payload: OpenMeldDaemonTaskResultPayload
): string | null {
  if (payload.status !== "failed") {
    return null;
  }
  return normalizeOptionalText(payload.errorCode) ?? null;
}

function toRuntimeTransportDispatchLocalQueueDiagnostics(
  input: LocalExecutionSlotDiagnostics
): RuntimeTransportDispatchLocalQueueDiagnostics {
  return {
    activeForLane: input.activeForLane,
    activeGlobal: input.activeGlobal,
    globalConcurrency: input.limits.globalConcurrency,
    queueDepth: input.queueDepth,
    queueMax: input.limits.queueMax,
    queuePosition: input.queuePosition,
    status: input.status,
    waitReason: input.waitReason,
  };
}

function emitDispatchLifecycleTransition(input: {
  agentControllerConversationOccupancy?: RuntimeTransportAgentControllerConversationOccupancy | null;
  attemptId: string;
  connectionGeneration: number;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchId: string;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho | null;
  leaseEpoch: number;
  localQueue?: RuntimeTransportDispatchLocalQueueDiagnostics | null;
  phase: DispatchLifecyclePhase;
  presenter: Presenter;
  runtimeCoordinatorExecutionId: string | null;
  taskId: string;
}): void {
  try {
    sendCurrentDispatchLifecycleFrame({
      agentControllerConversationOccupancy:
        input.agentControllerConversationOccupancy ?? null,
      attemptId: input.attemptId,
      connectionGeneration: input.connectionGeneration,
      currentSocketRef: input.currentSocketRef,
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      executionTokenEcho: input.executionTokenEcho,
      leaseEpoch: input.leaseEpoch,
      localQueue: input.localQueue ?? null,
      phase: input.phase,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    });
  } catch (error) {
    emitDaemonDispatchJournalEvent({
      attemptId: input.attemptId,
      connectionGeneration: input.connectionGeneration,
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      leaseEpoch: input.leaseEpoch,
      metadata: {
        errorMessage: toErrorMessage(error),
        localQueue: input.localQueue ?? null,
        phase: input.phase,
      },
      result: "failed",
      taskId: input.taskId,
      type: "dispatch.lifecycle.send_failed",
    });
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.lifecycle_send_failed",
      text: `daemon lifecycle ${input.phase} send failed for dispatch ${input.dispatchId}: ${toErrorMessage(error)}`,
      payload: {
        attemptId: input.attemptId,
        dispatchId: input.dispatchId,
        phase: input.phase,
        taskId: input.taskId,
      },
    });
    return;
  }
  emitDaemonDispatchJournalEvent({
    attemptId: input.attemptId,
    connectionGeneration: input.connectionGeneration,
    daemonSessionId: input.daemonSessionId,
    dispatchId: input.dispatchId,
    leaseEpoch: input.leaseEpoch,
    metadata: {
      localQueue: input.localQueue ?? null,
      phase: input.phase,
    },
    result: "sent",
    taskId: input.taskId,
    type: "dispatch.lifecycle.sent",
  });
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.lifecycle_sent",
    text: `daemon lifecycle ${input.phase} sent for dispatch ${input.dispatchId}`,
    payload: {
      attemptId: input.attemptId,
      connectionGeneration: input.connectionGeneration,
      daemonSessionId: input.daemonSessionId,
      dispatchId: input.dispatchId,
      leaseEpoch: input.leaseEpoch,
      localQueue: input.localQueue ?? null,
      phase: input.phase,
      taskId: input.taskId,
    },
  });
}

function resolveInitialDispatchLifecyclePhase(input: {
  providerAdmissionOwnsRunningLifecycle: boolean;
}): Extract<DispatchLifecyclePhase, "accepted_local" | "running"> {
  return input.providerAdmissionOwnsRunningLifecycle
    ? "accepted_local"
    : "running";
}

function startDispatchLifecycleKeepalive(input: {
  agentControllerConversationOccupancy?: RuntimeTransportAgentControllerConversationOccupancy | null;
  attemptId: string;
  connectionGeneration: number;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchId: string;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho | null;
  leaseEpoch: number;
  localQueue?: RuntimeTransportDispatchLocalQueueDiagnostics | null;
  phase: Extract<DispatchLifecyclePhase, "accepted_local" | "running">;
  presenter: Presenter;
  runtimeCoordinatorExecutionId: string | null;
  taskId: string;
}): () => void {
  let intervalCount = 0;
  let lastOccupancyConnectionGeneration: number | null = null;
  const intervalId = setInterval(() => {
    try {
      const currentConnectionGeneration = resolveCurrentConnectionGeneration({
        currentSocketRef: input.currentSocketRef,
        fallbackConnectionGeneration: input.connectionGeneration,
      });
      const shouldReassertOccupancy = Boolean(
        input.agentControllerConversationOccupancy &&
          (intervalCount %
            AGENT_CONTROLLER_OCCUPANCY_KEEPALIVE_REASSERT_INTERVALS ===
            0 ||
            lastOccupancyConnectionGeneration !== currentConnectionGeneration)
      );
      intervalCount += 1;
      if (shouldReassertOccupancy) {
        lastOccupancyConnectionGeneration = currentConnectionGeneration;
      }
      sendCurrentDispatchLifecycleFrame({
        agentControllerConversationOccupancy: shouldReassertOccupancy
          ? (input.agentControllerConversationOccupancy ?? null)
          : null,
        attemptId: input.attemptId,
        connectionGeneration: input.connectionGeneration,
        currentSocketRef: input.currentSocketRef,
        daemonSessionId: input.daemonSessionId,
        dispatchId: input.dispatchId,
        executionTokenEcho: input.executionTokenEcho,
        leaseEpoch: input.leaseEpoch,
        localQueue: input.localQueue ?? null,
        phase: input.phase,
        runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      });
    } catch (error) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.lifecycle_keepalive_failed",
        text: `daemon lifecycle keepalive failed for dispatch ${input.dispatchId}: ${error instanceof Error ? error.message : String(error)}`,
        payload: {
          attemptId: input.attemptId,
          dispatchId: input.dispatchId,
          phase: input.phase,
          taskId: input.taskId,
        },
      });
    }
  }, DEFAULT_TASK_LIFECYCLE_HEARTBEAT_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
  };
}

function sendCurrentDispatchLifecycleFrame(input: {
  agentControllerConversationOccupancy?: RuntimeTransportAgentControllerConversationOccupancy | null;
  attemptId: string;
  connectionGeneration: number;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchId: string;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho | null;
  leaseEpoch: number;
  localQueue?: RuntimeTransportDispatchLocalQueueDiagnostics | null;
  phase: DispatchLifecyclePhase;
  runtimeCoordinatorExecutionId: string | null;
}): void {
  sendDispatchLifecycleFrame({
    agentControllerConversationOccupancy:
      input.agentControllerConversationOccupancy ?? null,
    attemptId: input.attemptId,
    connectionGeneration: resolveCurrentConnectionGeneration({
      currentSocketRef: input.currentSocketRef,
      fallbackConnectionGeneration: input.connectionGeneration,
    }),
    daemonSessionId: input.daemonSessionId,
    dispatchId: input.dispatchId,
    leaseEpoch: input.leaseEpoch,
    localQueue: input.localQueue ?? null,
    phase: input.phase,
    executionTokenEcho: input.executionTokenEcho,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    socket:
      input.currentSocketRef.socket ??
      failMissingCurrentSocket(input.dispatchId),
  });
}

function resolveCurrentConnectionGeneration(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  fallbackConnectionGeneration: number;
}): number {
  return (
    input.currentSocketRef.connectionGeneration ??
    input.fallbackConnectionGeneration
  );
}

function failMissingCurrentSocket(dispatchId: string): never {
  throw new DaemonServiceRunError({
    code: "daemon.run.socket_unavailable",
    message: `active daemon socket is unavailable for dispatch ${dispatchId}`,
  });
}
