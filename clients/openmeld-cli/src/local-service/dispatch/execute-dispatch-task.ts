import { randomUUID } from "node:crypto";
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
import type { RuntimeTaskResult } from "@openmeld/local-execution";
import {
  appendLedgerHistoryEntry,
  buildAgentContextLookupKey,
  buildRuntimeWorkspaceFingerprint,
  commitResolvedAgentContext,
  DEFAULT_TASK_LIFECYCLE_HEARTBEAT_INTERVAL_MS,
  resolveConversationExecutionStateByLookupKey,
  runRuntimeTask,
  seedLegacyAgentContext,
  settleInflightTask,
  withLedgerStateTransaction,
} from "@openmeld/local-execution";
import {
  createSerialAgentInteractionCallback,
  type DispatchContinuityObservation,
  type InflightTaskControlRegistry,
  type LocalDaemonAdapterContainer,
  type LocalExecutionSlotDiagnostics,
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
import { resolveBaseUrl } from "../../config/base-url";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../../config/openmeld-request-context";
import { emitDaemonDispatchJournalEvent } from "../../local-service/dispatch/daemon-dispatch-journal";
import {
  type DispatchRuntimePreparation,
  prepareDispatchRuntimeExecution,
  resolveDispatchRuntimeContext,
} from "../../local-service/execution/dispatch-runtime-preparation";
import { toTaskExecutionError as toTaskExecutionErrorInternal } from "../../local-service/execution/task-execution-error";
import { resolveCurrentDaemonExpectedVersion } from "../../local-service/lifecycle/current-daemon-version";
import {
  buildDaemonServiceFreshnessPromptLines,
  resolveDaemonServiceFreshnessWarning,
} from "../../local-service/lifecycle/daemon-service-freshness";
import { inspectDaemonServiceInventory } from "../../local-service/lifecycle/daemon-service-inventory";
import {
  buildDispatchOwnedRuntimeEnv,
  resolveDispatchOwnedRuntimeActionCliEntryCommand,
} from "../../runtime/dispatch-owned-runtime";
import {
  createDispatchSpaceActionContext,
  type DispatchSpaceActionContext,
  type DispatchSpaceActionRecord,
  type DispatchSpaceActionRecordReadResult,
  OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV,
  readDispatchSpaceActionRecord,
  supersedeDispatchSpaceActionRecordForReconsideration,
} from "../../runtime/dispatch-space-action-context";
import type { Presenter } from "../../runtime/presenter/types";
import { fetchSpaceMeta } from "../../space/meta-api";
import type { WsClient } from "../../transport/ws";
import { resolveProviderRuntimeDispatchContinuation } from "../continuation/provider-runtime-continuation";
import {
  emitRunLine,
  normalizeOptionalText,
  toErrorMessage,
} from "../core/logger";
import type {
  CurrentDaemonSocketRef,
  DaemonProfileRouteConfig,
  InflightDispatchMeta,
  LedgerPaths,
} from "../core/types";
import { DaemonServiceRunError } from "../core/types";
import { resolveComputerFileAccessAdmission } from "../file-access/computer-file-access-admission";
import { applyComputerFileAccessAwareness } from "../file-access/computer-file-access-prompt";
import { readComputerFileAccessPolicy } from "../file-access/computer-file-access-store";
import { probeAgentControllerUsageObservationAuth } from "../inventory/agent-controller-interface";
import { recordRuntimeProviderUsageLimits } from "../inventory/runtime-provider-usage-limits";
import {
  buildRuntimeRouteTargets,
  resolveLocalRuntimeControllerSupport,
} from "../routing/resolve-controller-support";
import { createLedgerIo } from "../state/ledger-io";
import {
  coordinateDispatchAgentReply,
  type DispatchAgentReplyObservation,
  readDispatchAgentReplyObservation,
} from "./dispatch-agent-reply-observation";
import {
  type DispatchImageAttachmentPreparation,
  downloadDispatchImageAttachment,
  materializeDispatchImageAttachments,
} from "./dispatch-image-attachments";
import {
  type DispatchResultOutboxSettlement,
  enqueueDispatchResultOutboxRecord,
} from "./dispatch-result-outbox";
import { ensureDispatchControllerOpenMeldSkill } from "./ensure-dispatch-controller-openmeld-skill";
import {
  markBootstrapInjectedContext as markBootstrapInjectedContextInternal,
  reconcileBootstrapInjectedContextAfterDispatch as reconcileBootstrapInjectedContextAfterDispatchInternal,
  resolveBootstrapPlan as resolveBootstrapPlanInternal,
  rollbackBootstrapExecutionStateAfterDispatchFailure as rollbackBootstrapExecutionStateAfterDispatchFailureInternal,
} from "./execute-dispatch-bootstrap-plan";
import {
  areSameAgentControllerConversationRef,
  buildAgentControllerConversationRefFromAgentControllerConversation,
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
  buildDispatchBootstrapTemplateFacts,
  buildDispatchCorrelation,
  buildDispatchPromptPlan,
  type DispatchPromptPlan,
  parseDispatchTask,
  resolveBootstrapSpaceOwnerProfileId,
  resolveBootstrapTargetProfileContext,
  resolveDispatchMentionSourceContext,
} from "./parse-dispatch-task";
import { buildDispatchPromptTrace } from "./prompt-trace";
import {
  buildFailedTaskResultPayload,
  resolveDispatchResultPayload,
  sendDispatchInteractionRequestFrame,
  sendDispatchLifecycleFrame,
  sendDispatchPreviewEndFrame,
  sendDispatchPreviewFrame,
  sendDispatchRuntimeEvidenceFrame,
  sendDispatchToolActivityFrame,
} from "./send-dispatch-result";
import { resolveDispatchSendTargetReference } from "./send-target-reference";

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
const CLI_SPACE_ACTION_PROVIDER_CONVERSATION_GRACE_MS = 1500;
const AGENT_CONTROLLER_OCCUPANCY_KEEPALIVE_REASSERT_INTERVALS = 4;

// OPENMELD_SERVICE_THIN_CORE: temporary dispatch execution shell.
// Keep new local-service execution helpers outside this file. This file still
// orchestrates delivery intake, runtime preparation, Space Action handling, and
// result evidence until those slices are split one by one.
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
  presenter: Presenter;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  socket: WsClient;
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
  const { pendingAgentInteractionRegistry } = input;
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
  const enqueueResult = input.localExecutionSlots.request({
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
        deliverRequest,
        inflightDispatchMetaByTaskId: input.inflightDispatchMetaByTaskId,
        inflightTaskControlRegistry: input.inflightTaskControlRegistry,
        pendingAgentInteractionRegistry,
        ledgerPaths: input.ledgerPaths,
        leasesByProfileId: input.leasesByProfileId,
        localAdapterContainer: input.localAdapterContainer,
        profileOwnerName: input.profileOwnerName,
        profileOwnerUserId: input.profileOwnerUserId,
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
  inflightDispatchMetaByTaskId: Map<string, InflightDispatchMeta>;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  pendingAgentInteractionRegistry: PendingAgentInteractionRegistry;
  ledgerPaths: LedgerPaths;
  leasesByProfileId: Map<string, number>;
  localAdapterContainer: LocalDaemonAdapterContainer;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  presenter: Presenter;
  routeByProfileId: Map<string, DaemonProfileRouteConfig>;
  socket: WsClient;
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
  let observedProviderConversation: AgentControllerConversationRef | null =
    null;
  let runtimePromptPlan: DispatchPromptPlan | null = null;
  let runtimePromptTrace: DispatchPromptTrace | null = null;
  let settledResultSummary: LocalExecutionSlotTaskResult | null = null;
  const providerAdmissionOwnsRunningLifecycle =
    resolveBuiltinAgentControllerDefinition(
      runtimeControllerSupport.runtimeAdapterMatch.agentId
    )?.conversationOccupancy.mode ===
    "official_atomic_admission_and_release_signal";
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
    targetProfileId: parsedTask.targetProfileId,
    taskId: parsedTask.taskId,
  });
  const runtimeStartedAtMs = Date.now();
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

  try {
    dispatchRuntimeContext = await resolveDispatchRuntimeContext({
      defaultProjectId: parsedTask.defaultProjectId,
      openMeldProfileId: parsedTask.targetProfileId,
    });
    const runtimePreparation = await prepareDispatchRuntimeExecution({
      agentControllerRef: parsedTask.agentControllerRef,
      daemonWorkingDirectory,
      dispatchRuntimeContext,
      profileName: bootstrapContext.targetProfileName,
      targetProfileId: parsedTask.targetProfileId,
    });
    effectiveRuntimeContext = runtimePreparation.effectiveRuntimeContext;
    computerFileAccessBoundary = await resolveDispatchComputerFileAccess({
      computerFileAccessStorePath: input.computerFileAccessStorePath,
      onInteractionRequest,
      parsedTask,
      presenter: input.presenter,
      routeConfig,
      runtimeControllerSupport,
      runtimePreparation,
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
      parsedTask,
      runtimePreparation,
      sendTargetReference,
    });
    dispatchSpaceActionContext =
      spaceActionRuntimeContext.dispatchSpaceActionContext;
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
      runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        activeRuntimeContext.providerRuntimeWorkingDirectory
      ),
    });
    contextLookupKey = dispatchLedgerContext.contextLookupKey;
    currentExecutionState = dispatchLedgerContext.currentExecutionState;
    existingContextId = dispatchLedgerContext.existingContextId;
    effectiveAgentControllerConversationId =
      resolveEffectiveAgentControllerConversationId({
        agentControllerConversationId: parsedTask.agentControllerConversationId,
        existingContextId,
      });
    latestScopedExecutionState =
      dispatchLedgerContext.latestScopedExecutionState;
    ledgerIo = dispatchLedgerContext.ledgerIo;
    input.inflightDispatchMetaByTaskId.set(parsedTask.taskId, {
      agentContextLookupKey: contextLookupKey,
    });
    const runtimeContinuation = resolveProviderRuntimeDispatchContinuation({
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
    observedProviderConversation = plannedAgentControllerConversation;
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
    const baseRuntimePromptPlan = buildDispatchRuntimePrompt({
      bootstrapContext,
      imageAttachmentPreparation,
      parsedTask,
      profileOwnerName: input.profileOwnerName,
      profileOwnerUserId: input.profileOwnerUserId,
      sendTargetReference,
      shouldInjectBootstrap: bootstrapPlan.shouldInject,
    });
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
      const agentControllerConversation =
        observation.agentControllerConversation ??
        buildAgentControllerConversationRefFromAgentControllerConversation({
          agentControllerConversationId,
          agentControllerRef: parsedTask.agentControllerRef,
        });
      observedProviderConversationId = agentControllerConversationId;
      observedProviderConversation = agentControllerConversation;
      if (
        contextIdForDispatch === null &&
        recordedOpenMeldCreatedSessionId !== agentControllerConversationId
      ) {
        recordedOpenMeldCreatedSessionId = agentControllerConversationId;
        recordOpenMeldCreatedLocalAgentSession({
          agentControllerRef: parsedTask.agentControllerRef,
          nativeSessionId: agentControllerConversationId,
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
          invalidStateStrategy: "backup_and_reset",
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
    let agentToolActivitySequence = 0;
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
    const runtimeExecutionPromise = Promise.resolve(
      runDispatchRuntimeExecution({
        computerFileAccessBoundary,
        contextId: contextIdForDispatch,
        executionMode: "normal",
        io: ledgerIo,
        ledgerPaths: input.ledgerPaths,
        onInteractionRequest,
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
        onRuntimeEvent: (event) => {
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
              agentControllerConversationId:
                event.agentControllerConversationId,
              source: "runtime_event",
            });
          }
          if (
            event.phase === "provider_usage_limits_observed" &&
            routeConfig?.launchContract
          ) {
            const agentId =
              runtimeControllerSupport.runtimeAdapterMatch.adapterId;
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
                    observedLimitKeys: event.usageLimits.map(
                      (limit) => limit.key
                    ),
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
                    observedLimitKeys: event.usageLimits.map(
                      (limit) => limit.key
                    ),
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
          if (
            event.phase === "process_spawned" ||
            event.phase === "process_exit"
          ) {
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
    let runtimeResult = await resolveRuntimeResultFromRuntimeOrCliSpaceAction({
      contextIdForDispatch,
      dispatchSpaceActionContext,
      getObservedAgentControllerConversation: () =>
        observedProviderConversation,
      getObservedAgentControllerConversationId: () =>
        observedProviderConversationId,
      ledgerIo,
      ledgerPaths: input.ledgerPaths,
      onRuntimeResultAfterCliSpaceAction: (runtimeResult) => {
        const runtimeContextDelta =
          resolveDispatchContextDeltaFromRuntimeResult(
            runtimeResult.dispatchResult
          );
        recordProviderConversationObservation({
          agentControllerConversation:
            runtimeResult.contextResolution?.agentControllerConversation ??
            runtimeContextDelta?.agentControllerConversation ??
            null,
          agentControllerConversationId:
            runtimeResult.contextResolution?.agentControllerConversationId ??
            runtimeContextDelta?.agentControllerConversationId ??
            null,
          source: "runtime_result",
        });
      },
      parsedTask,
      presenter: input.presenter,
      runtimeExecutionPromise,
    });
    const structuredSpaceActionOutcome =
      await resolveRuntimeResultStructuredSpaceAction({
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
      invalidStateStrategy: "backup_and_reset",
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
    const buildCurrentResultPayload = (): OpenMeldDaemonTaskResultPayload => {
      const currentContextDelta = resolveDispatchContextDeltaFromRuntimeResult(
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
      dispatchExecution = buildDispatchExecution({
        bootstrapPlan: completedBootstrapPlan,
        agentControllerConversationId: effectiveAgentControllerConversationId,
        localRuntimeContextPlan: completedLocalRuntimeContextPlan,
        observedAgentControllerConversation,
        plannedAgentControllerConversation,
      });
      return resolveDispatchResultPayload({
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
        workingDirectory: activeRuntimeContext.providerRuntimeWorkingDirectory,
        spaceAction: resolvedSpaceAction,
        spaceActionProvenance: resolvedSpaceActionProvenance,
        sourceEventId: parsedTask.sourceEventId,
        targetProfileId: parsedTask.targetProfileId,
        taskId: parsedTask.taskId,
      });
    };
    resultPayload = buildCurrentResultPayload();
    const replySettlement = await settleAgentReplyProposals({
      initialResultPayload: resultPayload,
      reconsider: async (agentReplyObservationCursor) => {
        const reconsidered = await resolveRuntimeResultStructuredSpaceAction({
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
        return buildCurrentResultPayload();
      },
      submit: (payload) =>
        sendResultAndSummarize({
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
        }),
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
    lifecycleKeepalive.stop?.();
    lifecycleKeepalive.stop = null;
    input.inflightDispatchMetaByTaskId.delete(parsedTask.taskId);
    input.inflightTaskControlRegistry.removeTask(parsedTask.taskId);
    pendingAgentInteractionRegistry.removeTask(parsedTask.taskId);
  }

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

async function loadDispatchLedgerContext(input: {
  contextStore: Map<string, string>;
  ledgerPaths: LedgerPaths;
  parsedTask: ParsedDispatchTask;
  runtimeWorkspaceFingerprint: string;
}): Promise<{
  contextLookupKey: string;
  currentExecutionState: ConversationExecutionState | null;
  existingContextId: string | null;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  latestScopedExecutionState: ConversationExecutionState | null;
}> {
  const keyInput = {
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
    invalidStateStrategy: "backup_and_reset",
    io: ledgerIo,
    mutate: (state) => {
      const scopeInput = {
        agentControllerRef: input.parsedTask.agentControllerRef,
        spaceId: input.parsedTask.spaceId,
        targetProfileId: input.parsedTask.targetProfileId,
        transportMode: input.parsedTask.transportMode,
      } as const;
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
      const latestScopedExecutionState =
        resolveLatestScopedConversationExecutionState({
          scope: scopeInput,
          state: seededLedgerState,
        })?.executionState ?? null;
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
  bootstrapTemplateFacts: BootstrapTemplateFacts;
  cliEntry: string | null;
  mentionSourceMentionLabel: string | null;
  mentionSourceProfileName: string | null;
  sendTargetReferencePromise: Promise<DispatchSendTargetReferenceLoadResult>;
  serviceFreshnessWarningLines: string[];
  spaceGuide: string | null;
  spaceName: string | null;
  spaceOwnerProfileId: string | null;
  spacePurpose: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  targetProfileRole: string | null;
};

type DispatchSpaceMetaLoadResult =
  | {
      status: "loaded";
      spaceGuide: string | null;
      spaceName: string | null;
      spacePurpose: string | null;
    }
  | {
      status: "failed";
      errorMessage: string;
      spaceGuide: null;
      spaceName: null;
      spacePurpose: null;
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
    spaceMetaContext,
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
    resolveDispatchSpaceMetaContext({
      parsedTask: input.parsedTask,
      profileOwnerName: input.profileOwnerName,
      profileOwnerUserId: input.profileOwnerUserId,
    }),
  ]);
  input.onPhase?.("bootstrap_context_ready", {
    mentionSourceMentionLabelPresent:
      mentionSourceContext.mentionSourceMentionLabel !== null,
    mentionSourceProfileNamePresent:
      mentionSourceContext.mentionSourceProfileName !== null,
    source: "dispatch_bootstrap_context",
    spaceGuidePresent: spaceMetaContext.spaceGuide !== null,
    spaceMetaError:
      spaceMetaContext.status === "failed"
        ? spaceMetaContext.errorMessage
        : null,
    spaceMetaStatus: spaceMetaContext.status,
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
  const cliEntry = resolveDispatchOwnedRuntimeActionCliEntryCommand();
  const serviceFreshnessWarningLines =
    await resolveDispatchServiceFreshnessWarningLines({ cliEntry });
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
    serviceFreshnessWarningLines,
  });

  return {
    bootstrapTemplateFacts,
    cliEntry,
    mentionSourceMentionLabel:
      mentionSourceContext.mentionSourceMentionLabel ?? null,
    mentionSourceProfileName: mentionSourceContext.mentionSourceProfileName,
    sendTargetReferencePromise,
    serviceFreshnessWarningLines,
    spaceGuide: spaceMetaContext.spaceGuide,
    spaceName: spaceMetaContext.spaceName,
    spaceOwnerProfileId,
    spacePurpose: spaceMetaContext.spacePurpose,
    targetProfileMentionLabel: targetProfileContext.targetProfileMentionLabel,
    targetProfileName: targetProfileContext.targetProfileName,
    targetProfileRole: targetProfileContext.targetProfileRole,
  };
}

async function resolveDispatchSpaceMetaContext(input: {
  parsedTask: ParsedDispatchTask;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
}): Promise<DispatchSpaceMetaLoadResult> {
  try {
    const baseUrl = await resolveBaseUrl();
    const requestContext = buildOpenMeldRequestContextFromProfileIdentity({
      profileIdentity: {
        openMeldProfileId: input.parsedTask.targetProfileId,
        profileKind: "agent",
        ownerUserId: input.profileOwnerUserId,
        ...(input.profileOwnerName
          ? { ownerName: input.profileOwnerName }
          : {}),
        profileName:
          input.parsedTask.targetProfileName ??
          input.parsedTask.targetProfileMentionLabel ??
          input.parsedTask.targetProfileId,
      },
    });
    const meta = await fetchSpaceMeta({
      baseUrl,
      requestContext,
      space: input.parsedTask.spaceId,
      ...(input.parsedTask.spacePassword
        ? { password: input.parsedTask.spacePassword }
        : {}),
    });
    return {
      status: "loaded",
      spaceGuide: normalizeOptionalText(meta.guide),
      spaceName: normalizeOptionalText(meta.name),
      spacePurpose: normalizeOptionalText(meta.purpose),
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage: toErrorMessage(error),
      spaceGuide: null,
      spaceName: null,
      spacePurpose: null,
    };
  }
}

async function resolveDispatchServiceFreshnessWarningLines(input: {
  cliEntry: string | null;
}): Promise<string[]> {
  const inventory = await inspectDaemonServiceInventory({
    expectedVersion: resolveCurrentDaemonExpectedVersion(),
  }).catch(() => null);
  const warning = resolveDaemonServiceFreshnessWarning({
    cliEntry: input.cliEntry,
    inventory,
  });
  return buildDaemonServiceFreshnessPromptLines(warning);
}

function buildDispatchRuntimePrompt(input: {
  bootstrapContext: DispatchBootstrapContext;
  imageAttachmentPreparation: DispatchImageAttachmentPreparation;
  parsedTask: ParsedDispatchTask;
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
  shouldInjectBootstrap: boolean;
}): DispatchPromptPlan {
  return buildDispatchPromptPlan({
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
    prompt: input.parsedTask.prompt,
    recipientExplicitlyAddressedByActivationTargets:
      input.parsedTask.recipientExplicitlyAddressedByActivationTargets,
    sourceSignalId: input.parsedTask.sourceEventId,
    sourceMessageEnvelope: input.parsedTask.sourceMessageEnvelope,
    sendTargetReferenceLines: input.sendTargetReference.referenceLines,
    serviceFreshnessWarningLines:
      input.bootstrapContext.serviceFreshnessWarningLines,
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

async function resolveDispatchComputerFileAccess(input: {
  computerFileAccessStorePath: string;
  onInteractionRequest: AdapterInteractionCallback;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  routeConfig: DaemonProfileRouteConfig | null;
  runtimeControllerSupport: SupportedRuntimeControllerSupport;
  runtimePreparation: DispatchRuntimePreparation;
}): Promise<AdapterComputerFileAccessBoundary | null> {
  const policy = await readComputerFileAccessPolicy(
    input.computerFileAccessStorePath
  );
  const verifier =
    input.runtimeControllerSupport.localAdapterEntry.adapter
      .verifyComputerFileAccessBoundary;
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
            return verification.supported;
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
  parsedTask: ParsedDispatchTask;
  runtimePreparation: DispatchRuntimePreparation;
  sendTargetReference: DispatchSendTargetReferenceLoadResult;
}): {
  dispatchSpaceActionContext: DispatchSpaceActionContext;
  runtimeEnvOverrides: Record<string, string | undefined> | undefined;
} {
  const contextResult = createDispatchSpaceActionContext({
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

export async function resolveRuntimeResultFromRuntimeOrCliSpaceAction(input: {
  contextIdForDispatch: string | null;
  dispatchSpaceActionContext: DispatchSpaceActionContext | null;
  getObservedAgentControllerConversation?: () => AgentControllerConversationRef | null;
  getObservedAgentControllerConversationId?: () => string | null;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  ledgerPaths: LedgerPaths;
  onRuntimeResultAfterCliSpaceAction?: (
    runtimeResult: RuntimeTaskResult
  ) => Promise<void> | void;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  runtimeExecutionPromise: Promise<RuntimeTaskResult>;
}): Promise<RuntimeTaskResult> {
  if (!input.dispatchSpaceActionContext) {
    return await input.runtimeExecutionPromise;
  }

  const cliSpaceActionAbortController = new AbortController();
  let completion: DispatchRuntimeCompletion;
  try {
    completion = await Promise.race([
      input.runtimeExecutionPromise.then(
        (runtimeResult): DispatchRuntimeCompletion => ({
          kind: "runtime",
          runtimeResult,
        })
      ),
      waitForCliSpaceActionRecord({
        dispatchSpaceActionContext: input.dispatchSpaceActionContext,
        signal: cliSpaceActionAbortController.signal,
      }),
    ]);
  } finally {
    cliSpaceActionAbortController.abort();
  }

  if (completion.kind === "runtime") {
    return await applyCliSpaceActionRecordIfPresent({
      dispatchSpaceActionContext: input.dispatchSpaceActionContext,
      parsedTask: input.parsedTask,
      presenter: input.presenter,
      runtimeResult: completion.runtimeResult,
    });
  }

  if (completion.kind === "cli_space_action_poll_aborted") {
    return await input.runtimeExecutionPromise;
  }

  if (completion.kind === "cli_space_action_invalid") {
    throw new DaemonServiceRunError({
      code: "dispatch.cli_space_action.invalid",
      message: completion.errorMessage,
    });
  }

  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.cli_space_action_finalized",
    text: `CLI OpenMeld Space Action finalized task ${input.parsedTask.taskId}`,
    payload: {
      command: completion.record.command,
      dispatchId: input.parsedTask.dispatchId,
      spaceActionType: completion.record.action.type,
      targetProfileId: input.parsedTask.targetProfileId,
      taskId: input.parsedTask.taskId,
    },
  });

  const completedRuntimeResult =
    await resolveAlreadyCompletedRuntimeResultAfterCliSpaceAction({
      parsedTask: input.parsedTask,
      presenter: input.presenter,
      runtimeExecutionPromise: input.runtimeExecutionPromise,
    });
  if (completedRuntimeResult) {
    return applyCliSpaceActionRecordToRuntimeResult({
      record: completion.record,
      runtimeResult: completedRuntimeResult,
    });
  }

  const postActionCompletion =
    await resolveRuntimeResultOrObservedProviderConversationAfterCliSpaceAction(
      {
        contextIdForDispatch: input.contextIdForDispatch,
        getObservedAgentControllerConversation:
          input.getObservedAgentControllerConversation,
        getObservedAgentControllerConversationId:
          input.getObservedAgentControllerConversationId,
        parsedTask: input.parsedTask,
        runtimeExecutionPromise: input.runtimeExecutionPromise,
      }
    );
  if (postActionCompletion?.kind === "runtime") {
    return applyCliSpaceActionRecordToRuntimeResult({
      record: completion.record,
      runtimeResult: postActionCompletion.runtimeResult,
    });
  }

  observeRuntimeResultAfterCliSpaceAction({
    onRuntimeResultAfterCliSpaceAction:
      input.onRuntimeResultAfterCliSpaceAction,
    parsedTask: input.parsedTask,
    presenter: input.presenter,
    runtimeExecutionPromise: input.runtimeExecutionPromise,
  });
  const observedAgentControllerConversation =
    postActionCompletion?.kind === "provider_conversation"
      ? postActionCompletion.agentControllerConversation
      : resolveObservedProviderConversationForCliSpaceAction({
          contextIdForDispatch: input.contextIdForDispatch,
          getObservedAgentControllerConversation:
            input.getObservedAgentControllerConversation,
          getObservedAgentControllerConversationId:
            input.getObservedAgentControllerConversationId,
          parsedTask: input.parsedTask,
        });

  return await buildCliSpaceActionRuntimeResult({
    agentControllerConversation: observedAgentControllerConversation,
    agentControllerConversationId:
      observedAgentControllerConversation?.agentControllerConversationId ??
      null,
    ledgerIo: input.ledgerIo,
    ledgerPaths: input.ledgerPaths,
    parsedTask: input.parsedTask,
    record: completion.record,
  });
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

type CliSpaceActionPostActionCompletion =
  | {
      kind: "provider_conversation";
      agentControllerConversation: AgentControllerConversationRef;
    }
  | {
      kind: "runtime";
      runtimeResult: RuntimeTaskResult;
    };

async function resolveRuntimeResultOrObservedProviderConversationAfterCliSpaceAction(input: {
  contextIdForDispatch: string | null;
  getObservedAgentControllerConversation?: () => AgentControllerConversationRef | null;
  getObservedAgentControllerConversationId?: () => string | null;
  parsedTask: ParsedDispatchTask;
  runtimeExecutionPromise: Promise<RuntimeTaskResult>;
}): Promise<CliSpaceActionPostActionCompletion | null> {
  const existingConversation =
    resolveObservedProviderConversationForCliSpaceAction({
      contextIdForDispatch: input.contextIdForDispatch,
      getObservedAgentControllerConversation:
        input.getObservedAgentControllerConversation,
      getObservedAgentControllerConversationId:
        input.getObservedAgentControllerConversationId,
      parsedTask: input.parsedTask,
    });
  if (existingConversation) {
    return {
      kind: "provider_conversation",
      agentControllerConversation: existingConversation,
    };
  }

  const deadlineMs =
    Date.now() + CLI_SPACE_ACTION_PROVIDER_CONVERSATION_GRACE_MS;
  const runtimeCompletion = input.runtimeExecutionPromise.then(
    (runtimeResult) => ({ runtimeResult, status: "runtime" as const }),
    (error) => ({ error, status: "runtime_error" as const })
  );

  while (Date.now() < deadlineMs) {
    const remainingMs = Math.max(0, deadlineMs - Date.now());
    const waitMs = Math.min(
      CLI_SPACE_ACTION_RECORD_POLL_INTERVAL_MS,
      remainingMs
    );
    const result = await Promise.race([
      runtimeCompletion,
      delay(waitMs).then(() => ({ status: "pending" as const })),
    ]);

    if (result.status === "runtime") {
      return {
        kind: "runtime",
        runtimeResult: result.runtimeResult,
      };
    }
    if (result.status === "runtime_error") {
      return null;
    }

    const observedConversation =
      resolveObservedProviderConversationForCliSpaceAction({
        contextIdForDispatch: input.contextIdForDispatch,
        getObservedAgentControllerConversation:
          input.getObservedAgentControllerConversation,
        getObservedAgentControllerConversationId:
          input.getObservedAgentControllerConversationId,
        parsedTask: input.parsedTask,
      });
    if (observedConversation) {
      return {
        kind: "provider_conversation",
        agentControllerConversation: observedConversation,
      };
    }
  }

  return null;
}

function resolveObservedProviderConversationForCliSpaceAction(input: {
  contextIdForDispatch: string | null;
  getObservedAgentControllerConversation?: () => AgentControllerConversationRef | null;
  getObservedAgentControllerConversationId?: () => string | null;
  parsedTask: ParsedDispatchTask;
}): AgentControllerConversationRef | null {
  const observedAgentControllerConversation =
    input.getObservedAgentControllerConversation?.() ?? null;
  if (observedAgentControllerConversation) {
    return observedAgentControllerConversation;
  }

  const observedAgentControllerConversationId =
    normalizeOptionalContextId(
      input.getObservedAgentControllerConversationId?.() ?? null
    ) ?? input.contextIdForDispatch;
  return buildAgentControllerConversationRefFromAgentControllerConversation({
    agentControllerConversationId: observedAgentControllerConversationId,
    agentControllerRef: input.parsedTask.agentControllerRef,
  });
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

async function buildCliSpaceActionRuntimeResult(input: {
  agentControllerConversation: AgentControllerConversationRef | null;
  agentControllerConversationId: string | null;
  ledgerIo: ReturnType<typeof createLedgerIo>;
  ledgerPaths: LedgerPaths;
  parsedTask: ParsedDispatchTask;
  record: DispatchSpaceActionRecord;
}): Promise<RuntimeTaskResult> {
  const resultPayload = buildCliSpaceActionSuccessPayload({
    basePayload: {
      agentId: input.parsedTask.targetProfileId,
      attemptId: input.parsedTask.attemptId,
      deduped: false,
      sourceEventId: input.parsedTask.sourceEventId,
      taskId: input.parsedTask.taskId,
      ...(input.agentControllerConversation
        ? {
            agentControllerConversation: input.agentControllerConversation,
          }
        : {}),
      ...(input.agentControllerConversationId
        ? {
            agentControllerConversationId: input.agentControllerConversationId,
          }
        : {}),
      ...(input.parsedTask.agentControllerRef
        ? { agentControllerRef: input.parsedTask.agentControllerRef }
        : {}),
      ...(input.parsedTask.transportMode
        ? { transportMode: input.parsedTask.transportMode }
        : {}),
    },
    record: input.record,
  });
  const state = await withLedgerStateTransaction({
    invalidStateStrategy: "backup_and_reset",
    io: input.ledgerIo,
    mutate: (state) => {
      const nextState = settleInflightTask({
        state,
        taskId: input.parsedTask.taskId,
      });
      return {
        nextState,
        value: nextState,
      };
    },
    paths: input.ledgerPaths,
  });
  await appendLedgerHistoryEntry({
    entry: {
      message: "task finalized from CLI Space Action",
      reasonCode: "task.cli_space_action",
      status: resultPayload.status,
      taskId: input.parsedTask.taskId,
      ts: new Date().toISOString(),
    },
    io: input.ledgerIo,
    paths: input.ledgerPaths,
  });

  return {
    agentContextLifecycleCounters: state.agentContextLifecycleCounters,
    deduped: false,
    dispatchResult: {
      adapterResult: {
        ...(input.agentControllerConversationId
          ? {
              contextDelta: {
                ...(input.agentControllerConversation
                  ? {
                      agentControllerConversation:
                        input.agentControllerConversation,
                    }
                  : {}),
                agentControllerConversationId:
                  input.agentControllerConversationId,
              },
            }
          : {}),
        output: resultPayload.output,
        status: "success",
      },
      dispatched: true,
      reason: "dispatched",
    },
    resultPayload,
    runtimeState: "idle",
    state,
  };
}

async function applyCliSpaceActionRecordIfPresent(input: {
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

async function resolveAlreadyCompletedRuntimeResultAfterCliSpaceAction(input: {
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  runtimeExecutionPromise: Promise<RuntimeTaskResult>;
}): Promise<RuntimeTaskResult | null> {
  try {
    const result = await Promise.race([
      input.runtimeExecutionPromise.then((runtimeResult) => ({
        runtimeResult,
        status: "runtime" as const,
      })),
      delay(0).then(() => ({
        status: "pending" as const,
      })),
    ]);
    if (result.status === "runtime") {
      return result.runtimeResult;
    }
  } catch (error) {
    emitRunLine({
      presenter: input.presenter,
      code: "daemon.run.runtime_ignored_after_cli_space_action",
      text: `runtime failed after CLI OpenMeld Space Action finalized task ${input.parsedTask.taskId}`,
      payload: {
        dispatchId: input.parsedTask.dispatchId,
        errorMessage: toErrorMessage(error),
        targetProfileId: input.parsedTask.targetProfileId,
        taskId: input.parsedTask.taskId,
      },
    });
  }
  return null;
}

function observeRuntimeResultAfterCliSpaceAction(input: {
  onRuntimeResultAfterCliSpaceAction?: (
    runtimeResult: RuntimeTaskResult
  ) => Promise<void> | void;
  parsedTask: ParsedDispatchTask;
  presenter: Presenter;
  runtimeExecutionPromise: Promise<RuntimeTaskResult>;
}): void {
  input.runtimeExecutionPromise
    .then(async (runtimeResult) => {
      await input.onRuntimeResultAfterCliSpaceAction?.(runtimeResult);
    })
    .catch((error) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.runtime_ignored_after_cli_space_action",
        text: `runtime failed after CLI OpenMeld Space Action finalized task ${input.parsedTask.taskId}`,
        payload: {
          dispatchId: input.parsedTask.dispatchId,
          errorMessage: toErrorMessage(error),
          targetProfileId: input.parsedTask.targetProfileId,
          taskId: input.parsedTask.taskId,
        },
      });
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
      runControllerRepair: ({ prompt, runtimeResult }) => {
        const repairContinuation = resolveStructuredActionRepairContinuation({
          runtimeResult,
          agentControllerConversationOverride:
            input.agentControllerConversationOverride,
        });
        return runDispatchRuntimeExecution({
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
          runtimeEnvOverrides: input.runtimeEnvOverrides,
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
      return {
        observedThroughSignalId,
        relevantSignals: [],
        status: "current",
      };
    }
  };
  const observation = await readObservation(
    normalizeOptionalText(input.agentReplyObservationCursor) ??
      input.parsedTask.sourceEventId
  );

  const coordinated = await coordinateDispatchAgentReply({
    action: input.resolvedSpaceAction,
    currentValue: {
      provenance: input.resolvedSpaceActionProvenance,
      runtimeResult: input.runtimeResult,
    },
    observation,
    reconsider: async (prompt, currentObservation) => {
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

  const skillRepair = await ensureDispatchControllerOpenMeldSkill({
    agentControllerRef: input.parsedTask.agentControllerRef,
  });
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.dispatch_controller_skill_repair_checked",
    text: `OpenMeld skill repair checked for task ${input.parsedTask.taskId}`,
    payload: {
      agentControllerRef: input.parsedTask.agentControllerRef,
      agentId: skillRepair.agentId,
      dispatchId: input.parsedTask.dispatchId,
      ...(skillRepair.reason ? { reason: skillRepair.reason } : {}),
      status: skillRepair.status,
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
  socket: WsClient;
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

function runDispatchRuntimeExecution(input: {
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary | null;
  contextId: string | null;
  executionMode: AdapterDispatchExecutionMode;
  io: ReturnType<typeof createLedgerIo>;
  ledgerPaths: LedgerPaths;
  onInteractionRequest?: Parameters<
    typeof runRuntimeTask
  >[0]["onInteractionRequest"];
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
  return runRuntimeTask({
    ...(input.agentControllerConversationOverride
      ? {
          agentContextOverride: {
            agentControllerConversationId: input.contextId,
            agentControllerConversationOverride:
              input.agentControllerConversationOverride,
          },
        }
      : {}),
    io: input.io,
    ...(input.onInteractionRequest
      ? { onInteractionRequest: input.onInteractionRequest }
      : {}),
    ...(input.onPreview ? { onPreview: input.onPreview } : {}),
    ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
    paths: input.ledgerPaths,
    route: buildDispatchRuntimeRoute({
      contextId: input.contextId,
      envOverrides: input.runtimeEnvOverrides,
      parsedTask: input.parsedTask,
      routeConfig: input.routeConfig,
      runtimeControllerSupport: input.runtimeControllerSupport,
      streamingMode:
        input.streamingModeOverride ?? input.parsedTask.streamingMode,
    }),
    task: buildDispatchRuntimeTask({
      computerFileAccessBoundary: input.computerFileAccessBoundary,
      executionMode: input.executionMode,
      instructionPrompt: input.instructionPrompt,
      parsedTask: input.parsedTask,
      prompt: input.prompt,
      runtimeContext: input.runtimeContext,
    }),
  });
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
  socket: WsClient;
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
  socket: WsClient;
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
  socket: WsClient;
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
  socket: WsClient;
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

function requireDispatchResultOutboxSettlement(input: {
  settlement: Promise<DispatchResultOutboxSettlement> | null;
}): Promise<DispatchResultOutboxSettlement> {
  if (!input.settlement) {
    throw new DaemonServiceRunError({
      code: "dispatch.result_settlement.not_registered",
      message:
        "OpenMeld could not wait for the Agent reply because result settlement was not registered.",
    });
  }
  return input.settlement;
}

function shouldAwaitAgentReplySettlement(
  payload: OpenMeldDaemonTaskResultPayload
): boolean {
  return (
    (payload.status === "success" || payload.status === "partial_success") &&
    payload.spaceAction?.type === "post_message"
  );
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

async function settleAgentReplyProposals(input: {
  initialResultPayload: OpenMeldDaemonTaskResultPayload;
  reconsider: (
    agentReplyObservationCursor: string
  ) => Promise<OpenMeldDaemonTaskResultPayload>;
  submit: (payload: OpenMeldDaemonTaskResultPayload) => {
    resultSummary: LocalExecutionSlotTaskResult;
    settlement: Promise<DispatchResultOutboxSettlement> | null;
  };
}): Promise<{
  resultPayload: OpenMeldDaemonTaskResultPayload;
  resultSummary: LocalExecutionSlotTaskResult | null;
}> {
  let resultPayload = input.initialResultPayload;
  while (shouldAwaitAgentReplySettlement(resultPayload)) {
    const proposal = input.submit(resultPayload);
    const settlement = await requireDispatchResultOutboxSettlement(proposal);
    if (settlement.status === "accepted") {
      return {
        resultPayload,
        resultSummary: proposal.resultSummary,
      };
    }
    if (settlement.status === "rejected_terminal") {
      throw new DaemonServiceRunError({
        code: settlement.reasonCode,
        message: `OpenMeld rejected the Agent reply proposal: ${settlement.reasonCode}`,
      });
    }
    const observedThroughSignalId =
      resultPayload.spaceAction?.type === "post_message"
        ? resultPayload.spaceAction.observedThroughSignalId
        : null;
    resultPayload = await input.reconsider(
      normalizeOptionalText(observedThroughSignalId) ??
        resultPayload.sourceEventId
    );
  }
  return { resultPayload, resultSummary: null };
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
