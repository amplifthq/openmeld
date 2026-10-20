import { resolveAgentWakeAdmissionTerminalDecision } from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  buildAgentControllerRoutingKey,
  buildAgentTaskKey,
  buildRuntimeCoordinatorExecutionId,
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
  DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
  DISPATCH_ACTIVITY_FAILED_PURPOSE,
  DISPATCH_ACTIVITY_RETRYING_PURPOSE,
  isHostedAgentRuntimeKind,
  OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION,
  parseOpenMeldDaemonDispatchQueueIngress,
  projectTargetWakeLifecycleIdentity,
  RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE,
  RUNTIME_COORDINATOR_DEVICE_WAITING_REASON_CODE,
  RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
} from "@openmeld/schemas";
import type {
  AgentTaskContinuationQueueMessage,
  AgentTaskHandle,
  AgentTaskObservationRedriveQueueMessage,
  AgentTaskTerminalOutcome,
  OpenMeldDaemonAcceptedDispatchSnapshot,
  OpenMeldDaemonDispatchQueueMessage,
  RemoteAgentNativeDeliveryDeadlineProbeQueueMessage,
  RequestChain,
  RuntimeTransportRuntimeCoordinatorDecisionResponse,
} from "@openmeld/schemas/types";
import { processAgentTaskContinuationQueueMessage } from "../../agent-task-coordination/application/agent-task-continuation-service";
import { recordAndEnqueueAgentTaskNeedsAttentionObservation } from "../../agent-task-coordination/application/agent-task-needs-attention-observation-service";
import { recordAndEnqueueAgentTaskTerminalOutcomeIfMatching } from "../../agent-task-coordination/application/agent-task-terminal-outcome-service";
import {
  readAgentTaskNeedsAttentionObservation,
  readAgentTaskTerminalOutcome,
} from "../../agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import type { CoreBindings } from "../../lib/bindings";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import { createConfiguredMessageChannelProviderRegistry } from "../../remote-agent/application/message-channel-provider-runtime";
import {
  processRemoteAgentNativeDeliveryDeadlineProbe,
  publishRemoteAgentFailureNotice,
  submitRemoteAgentNativeDelivery,
} from "../../remote-agent/application/native-delivery-service";
import {
  createAdmittedRequestChainDeps,
  resolveAdmittedRequestChain,
} from "../../request-chain/dispatch-request-chain";
import {
  type RequestChainRejectionReason,
  readRequestChainRootProfileId,
} from "../../request-chain/request-chain";
import { resolveSpaceStub } from "../../rpc/space-ref";
import { emitSpaceSystemNoticeSignal } from "../../rpc/space-signal-emitter";
import { DELETED_AGENT_PROFILE_WAKE_STOP_REASON } from "../../runtime-transport/application/deleted-agent-profile-wake-cancellation";
import {
  RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
  resolveRuntimeCoordinatorHeadWaitingDecision,
  resolveRuntimeCoordinatorHeadWaitingPolicy,
} from "../../runtime-transport/application/runtime-coordinator-authority";
import { emitCoreCloudflareRuntimeEvidence } from "../../shared/observability/cloudflare-runtime-evidence";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  createSpaceBootstrapTimingCollector,
  formatSpaceBootstrapServerTiming,
  type SpaceBootstrapTimingCollector,
  type SpaceBootstrapTimingMetric,
} from "../../space/application/space-bootstrap-timing";
import { readSpaceFinalOutcomeClaim } from "../../space/application/space-final-outcome-claim-reader";
import { EXECUTION_TARGET_MUTATION_WAKE_WAIT_MAX_MS } from "../../strategy-constants";
import {
  claimDispatchAttempt,
  correlateDuplicateDispatchDeliveryAttempt,
  markDispatchAttemptWaitingForResult,
  markDispatchStatus,
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  writeDispatchDlq,
  writeInvalidDispatchPayloadDlq,
  writeOpenMeldDaemonOpsDecision,
} from "../infrastructure/postgresql/dispatch-ledger-postgresql";
import {
  claimPreHeadFailurePublicationIntent,
  createPreHeadFailurePublicationIntent,
  createPreHeadFailureRedriveMessage,
  ensurePreHeadFailurePublicationIntent,
  freezePreHeadFailurePublicationIdentity,
  listDuePreHeadFailurePublicationIntents,
  markPreHeadFailurePublicationCompleted,
  markPreHeadFailurePublicationNeedsAttention,
  PRE_HEAD_FAILURE_PUBLICATION_PENDING_ERROR_CODE,
  type PreHeadFailurePublicationCommand,
  type PreHeadFailurePublicationIntent,
  readPreHeadFailurePublicationState,
  reschedulePreHeadFailurePublicationIntent,
} from "../infrastructure/postgresql/pre-head-failure-publication-outbox-repository";
import {
  acceptRuntimeTransportRuntimeCoordinatorHead,
  decideRuntimeTransportRuntimeCoordinatorExecution,
  readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace,
  recordRuntimeTransportRuntimeCoordinatorHeadNoExecution,
  recordRuntimeTransportRuntimeCoordinatorHeadPreAgentStop,
  recordRuntimeTransportRuntimeCoordinatorHeadWaiting,
  requestRuntimeTransportRuntimeCoordinatorWakeStop,
} from "../infrastructure/runtime-transport/runtime-coordinator-client";
import { lookupRuntimeTransportRoute } from "../infrastructure/runtime-transport/runtime-transport-client";
import { resolveRuntimeTransportOwnerShard } from "../infrastructure/runtime-transport/runtime-transport-shard";
import {
  classifyDispatchError,
  isDispatchAttemptTimeoutErrorCode,
  isPostgresSchemaError,
  isRuntimeTaskDedupedErrorCode,
  RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE,
  resolveDispatchErrorCode,
  resolveDispatchRetryDelaySeconds,
  shouldRetryDispatchAttemptForErrorCode,
} from "../rules/dispatch-error-policy";
import {
  buildDispatchingActivityText,
  buildReplyingHintText,
  buildRetryingActivityText,
  DISPATCH_HINT_SYSTEM_PROFILE_ID,
  DISPATCH_HINT_SYSTEM_PROFILE_NAME,
  DISPATCH_REPLYING_HINT_END_PURPOSE,
  type DispatchFailureHintContext,
  resolveDispatchFailureActivityText,
  resolveDispatchFailureHintText,
  shouldPersistDispatchFailureHintToSpaceHistory,
} from "../rules/dispatch-hint-policy";
import type {
  OpenMeldDaemonDispatchAttemptState,
  OpenMeldDaemonDispatchState,
} from "../rules/dispatch-lifecycle-contract";
import {
  DISPATCH_DEDUPE_WINDOW_RISK_CODE,
  isDispatchDedupeWindowRisk,
  shouldRetryUnknownDispatchAttempt,
} from "../rules/dispatch-runtime-constants";
import {
  type ReplyingHintTransition,
  resolveReplyingHintFinalizeDecision,
} from "../rules/replying-hint-lifecycle";
import {
  applyAcceptedDispatchSnapshotToMessage,
  applyFolderSelectionPolicy,
  buildAcceptedDispatchSnapshot,
  resolveContextWorkspaceDefault,
} from "./accepted-dispatch-snapshot";
import { emitDispatchActivitySignal } from "./dispatch-activity-signal";
import {
  applyEffectiveTargetBindingSnapshotToMessage,
  continueDispatchMessageAttempt,
  type DispatchExecutionContext,
  type DispatchExecutionPreflightResult,
  DispatchExecutionValidationError,
  deliverDispatchMessageToDaemon,
  type EffectiveTargetBindingSnapshot,
  emitDispatchReplyingHintSignal,
  resolveDispatchTargetProfileName,
  runDispatchExecutionPreflightGate,
} from "./dispatch-execution-service";
import { buildDispatchHumanLogContext } from "./dispatch-log-context";
import {
  buildDispatchSystemRequestContext,
  buildDispatchSystemSpaceAccess,
} from "./dispatch-space-access";
import { checkDeviceWaitingWakeAccess } from "./wake-device-wait";

type QueueBatchMessage = MessageBatch<unknown>["messages"][number];
export type DispatchQueueWaitContext = {
  waitUntil(promise: Promise<unknown>): void;
};
export type DispatchQueueBatchOutcome =
  | {
      reasonCode:
        | "dispatch_storage_not_ready"
        | "missing_dispatch_runtime_binding";
      status: "retry_scheduled";
    }
  | {
      status: "processed";
    };
export type DispatchOutboxDirectDeliveryOutcome =
  | {
      retryDelaySeconds: null;
      status: "submitted";
    }
  | {
      reasonCode:
        | "dispatch_direct_retry_requested"
        | "missing_dispatch_runtime_binding";
      recoveryTransport: "outbox" | "queue";
      retryDelaySeconds: number | null;
      status: "retry_scheduled";
    };
type ResolvedIncomingQueueMessage =
  | {
      kind: "current_v2";
      message: OpenMeldDaemonDispatchQueueMessage;
      receivedQueueSchemaVersion: 2;
    }
  | {
      kind: "remote_agent_deadline_probe";
      message: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage;
      receivedQueueSchemaVersion: 3;
    }
  | {
      kind: "agent_task_continuation";
      message: AgentTaskContinuationQueueMessage;
      receivedQueueSchemaVersion: 4;
    }
  | {
      kind: "agent_task_observation_redrive";
      message: AgentTaskObservationRedriveQueueMessage;
      receivedQueueSchemaVersion: 5;
    }
  | {
      kind: "legacy_v1";
      issues: unknown;
      receivedQueueSchemaVersion: 1;
    }
  | {
      kind: "invalid";
      issues: unknown;
      receivedQueueSchemaVersion: number | null;
    };
type PreparedQueueBatchMessage = {
  controllerKey: string;
  idempotencyKey: string | null;
  message: QueueBatchMessage;
  resolved: ResolvedIncomingQueueMessage;
};
type DirectDispatchQueueMessage = QueueBatchMessage & {
  readonly acked: boolean;
  readonly retryDelaySeconds: number | null;
  readonly retryRequested: boolean;
};
class HostedNativeDeliverySubmissionError extends Error {
  readonly code: string;
  constructor(input: {
    cause: unknown;
    code: string;
    message: string;
  }) {
    super(input.message, { cause: input.cause });
    this.code = input.code;
    this.name = "HostedNativeDeliverySubmissionError";
  }
}
class HostedNativeDeliveryFailurePublicationError extends Error {
  constructor(input: {
    cause: unknown;
    dispatchId: string;
  }) {
    super(
      `Could not persist the hosted Center Agent failure for dispatch ${input.dispatchId}`,
      { cause: input.cause }
    );
    this.name = "HostedNativeDeliveryFailurePublicationError";
  }
}
type OffloadedWaitPhaseInput = {
  agentControllerRef: string | null;
  controllerKey: string;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  executionAttemptNo: number;
  executionContext: DispatchExecutionContext;
  targetOwnerUserId: string;
  profileHandle: string | null;
  targetProfileMentionLabel: string | null;
  targetProfileName: string | null;
  waitPhaseMode: "started" | "resumed";
};
type DispatchQueueMessageExecutionResult = {
  controllerWaitPromise: Promise<void> | null;
  shouldAck: boolean;
};
const AUDIT_UNKNOWN_DAEMON_SESSION_ID = "unknown";
const AUDIT_UNKNOWN_LEASE_EPOCH = -1;
const SESSION_REPLACED_DECISION_CODE = "daemon.delivery.session_replaced";
const SESSION_REPLACED_DECIDED_BY = "core.dispatch_queue.session_replaced";
const CONNECTION_REPLACED_REDRIVE_DECISION_CODE =
  "daemon.delivery.connection_replaced_redrive";
const CONNECTION_REPLACED_REDRIVE_DECIDED_BY =
  "core.dispatch_queue.connection_replaced_redrive";
const ROUTE_LOST_REDRIVE_DECISION_CODE = "daemon.delivery.route_lost_redrive";
const ROUTE_LOST_REDRIVE_DECIDED_BY = "core.dispatch_queue.route_lost_redrive";
const OFFLOADED_WAIT_PHASE_CRASHED_DECISION_CODE =
  "dispatch.attempt.offloaded_wait_crashed";
const OFFLOADED_WAIT_PHASE_CRASHED_DECIDED_BY =
  "core.dispatch_queue.offloaded_wait_crashed";
const OFFLOADED_WAIT_PHASE_CRASHED_ERROR_CODE = "dispatch.execution_failed";
const RUNTIME_COORDINATOR_HANDOFF_PENDING_OR_UNAVAILABLE_DECISION_CODE =
  "runtime_coordinator_handoff_pending_or_unavailable";
const CORE_DISPATCH_BATCH_GLOBAL_CONCURRENCY = 5;
const PRE_EXECUTION_OWNER_UNRESOLVED_VISIBLE_FAILURE_CODE =
  "dispatch.target_profile_owner_unresolved";
const REMOTE_AGENT_NATIVE_DELIVERY_RETRY_REASON_CODE =
  "remote_agent.native_delivery_retry_required";
const LEADING_AT_SIGNS_PATTERN = /^@+/;
type RouteOwnershipState = "active" | "lost" | "unknown";
export const handleDispatchQueueBatch = async (input: {
  batch: MessageBatch<unknown>;
  ctx: DispatchQueueWaitContext;
  env: CoreBindings;
}): Promise<DispatchQueueBatchOutcome> => {
  if (!(input.env.OPENMELD_POSTGRESQL && input.env.OPENMELD_SPACES)) {
    // A missing binding is a deployment/configuration issue.
    // Keep messages retryable instead of dropping them.
    retryBatchMessages(input.batch);
    return {
      reasonCode: "missing_dispatch_runtime_binding",
      status: "retry_scheduled",
    };
  }
  const db = getPostgresDatabase(input.env);
  // No per-batch storage-readiness probe on this latency-critical Wake path.
  // The release flow runs DB migrations (with preflight) before Core deploys,
  // so the "code is up before its tables exist" window is closed upstream. A
  // genuinely missing table now surfaces as a terminal PostgreSQL schema error
  // (classifyDispatchError -> isPostgresSchemaError -> non_retryable) and fails loud
  // instead of being retried, rather than every dispatch paying to re-probe.
  await processDispatchQueueBatchWithControllerParallelism({
    db,
    ctx: input.ctx,
    env: input.env,
    messages: input.batch.messages,
  });
  return { status: "processed" };
};
const processDispatchQueueBatchWithControllerParallelism = async (input: {
  db: PostgresDatabase;
  ctx: DispatchQueueWaitContext;
  env: CoreBindings;
  messages: readonly QueueBatchMessage[];
}): Promise<void> => {
  if (input.messages.length === 0) {
    return;
  }
  const preparedMessages = input.messages.map((message, index) =>
    prepareQueueBatchMessage({
      fallbackKey: `__fallback__${index}`,
      message,
    })
  );
  const queuesByControllerKey = groupMessagesByControllerKey(preparedMessages);
  const controllerQueues = [...queuesByControllerKey.values()];
  const workerCount = Math.max(
    1,
    Math.min(CORE_DISPATCH_BATCH_GLOBAL_CONCURRENCY, controllerQueues.length)
  );
  const processedIdempotencyKeys = new Set<string>();
  let nextQueueIndex = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const queueIndex = nextQueueIndex;
        nextQueueIndex += 1;
        const controllerQueue = controllerQueues[queueIndex];
        if (!controllerQueue) {
          return;
        }
        await processControllerQueue({
          controllerQueue,
          ctx: input.ctx,
          db: input.db,
          env: input.env,
          processedIdempotencyKeys,
        });
      }
    })
  );
};
const processControllerQueue = async (input: {
  controllerQueue: readonly PreparedQueueBatchMessage[];
  ctx: DispatchQueueWaitContext;
  db: PostgresDatabase;
  env: CoreBindings;
  processedIdempotencyKeys: Set<string>;
}): Promise<void> => {
  for (
    let messageIndex = 0;
    messageIndex < input.controllerQueue.length;
    messageIndex += 1
  ) {
    const preparedMessage = input.controllerQueue[messageIndex];
    if (!preparedMessage) {
      continue;
    }
    if (
      skipBatchDuplicateMessage(preparedMessage, input.processedIdempotencyKeys)
    ) {
      continue;
    }
    const outcome = await processDispatchQueueMessage({
      db: input.db,
      ctx: input.ctx,
      deliveryPath: "queue",
      env: input.env,
      preparedMessage,
    });
    const hasPendingControllerMessages =
      messageIndex < input.controllerQueue.length - 1;
    if (hasPendingControllerMessages && outcome.controllerWaitPromise) {
      await outcome.controllerWaitPromise.catch(() => undefined);
    }
  }
};
const skipBatchDuplicateMessage = (
  preparedMessage: PreparedQueueBatchMessage,
  processedIdempotencyKeys: Set<string>
): boolean => {
  const messageIdempotencyKey = preparedMessage.idempotencyKey;
  if (
    !(
      messageIdempotencyKey &&
      processedIdempotencyKeys.has(messageIdempotencyKey)
    )
  ) {
    if (messageIdempotencyKey) {
      processedIdempotencyKeys.add(messageIdempotencyKey);
    }
    return false;
  }
  preparedMessage.message.ack();
  console.info("[core.openMeldDaemon.dispatch_queue.batch_dedupe]", {
    idempotencyKey: messageIdempotencyKey,
  });
  return true;
};
const groupMessagesByControllerKey = (
  messages: readonly PreparedQueueBatchMessage[]
): Map<string, PreparedQueueBatchMessage[]> => {
  const grouped = new Map<string, PreparedQueueBatchMessage[]>();
  for (const message of messages) {
    const key = message.controllerKey;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(message);
      continue;
    }
    grouped.set(key, [message]);
  }
  return grouped;
};
const prepareQueueBatchMessage = (input: {
  fallbackKey: string;
  message: QueueBatchMessage;
}): PreparedQueueBatchMessage => {
  const resolved = resolveIncomingQueueMessage(input.message.body);
  return {
    controllerKey: resolveDispatchControllerKey({
      fallbackKey: input.fallbackKey,
      resolved,
    }),
    idempotencyKey: resolveDispatchMessageIdempotencyKey(resolved),
    message: input.message,
    resolved,
  };
};
const resolveDispatchControllerKey = (input: {
  fallbackKey: string;
  resolved: ResolvedIncomingQueueMessage;
}): string => {
  if (input.resolved.kind === "remote_agent_deadline_probe") {
    return `remote-agent-deadline:${input.resolved.message.submissionId}`;
  }
  if (input.resolved.kind === "agent_task_continuation") {
    return `agent-task-continuation:${input.resolved.message.subscriptionId}`;
  }
  if (input.resolved.kind === "agent_task_observation_redrive") {
    return `agent-task-observation:${input.resolved.message.deliveryId}`;
  }
  if (input.resolved.kind !== "current_v2") {
    return input.fallbackKey;
  }
  const parsed = input.resolved.message;
  const agentControllerRef = normalizeOptionalText(
    parsed.controllerSnapshot.agentControllerRef
  );
  if (agentControllerRef) {
    const controllerKey = buildAgentControllerRoutingKey(agentControllerRef);
    if (controllerKey) {
      return controllerKey;
    }
  }
  const targetProfileId = normalizeOptionalText(parsed.targetProfileId);
  if (targetProfileId) {
    return `profile:${targetProfileId}`;
  }
  return input.fallbackKey;
};
const resolveDispatchMessageIdempotencyKey = (
  resolved: ResolvedIncomingQueueMessage
): string | null => {
  if (resolved.kind === "remote_agent_deadline_probe") {
    const normalized = String(resolved.message.idempotencyKey ?? "").trim();
    return normalized.length > 0
      ? `remote-agent-deadline:${normalized}:${resolved.message.submissionId}`
      : null;
  }
  if (resolved.kind === "agent_task_continuation") {
    return resolved.message.idempotencyKey;
  }
  if (resolved.kind === "agent_task_observation_redrive") {
    return resolved.message.idempotencyKey;
  }
  if (resolved.kind !== "current_v2") {
    return null;
  }
  const normalized = String(resolved.message.idempotencyKey ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};
const processAgentTaskContinuationQueuePayload = async (input: {
  db: PostgresDatabase;
  env: CoreBindings;
  preparedMessage: PreparedQueueBatchMessage & {
    resolved: Extract<
      ResolvedIncomingQueueMessage,
      {
        kind: "agent_task_continuation";
      }
    >;
  };
}): Promise<DispatchQueueMessageExecutionResult> => {
  try {
    const outcome = await processAgentTaskContinuationQueueMessage({
      db: input.db,
      env: input.env,
      message: input.preparedMessage.resolved.message,
      nowMs: Date.now(),
    });
    if (outcome.status === "retry_later") {
      retryQueueMessage(input.preparedMessage.message, {
        delaySeconds: outcome.retryAfterSeconds,
      });
      return {
        controllerWaitPromise: null,
        shouldAck: false,
      };
    }
    input.preparedMessage.message.ack();
    return {
      controllerWaitPromise: null,
      shouldAck: true,
    };
  } catch (error) {
    console.warn("[core.agent_task_continuation.queue_processing_failed]", {
      error: toErrorMessage(error),
      event: CORE_LOG_EVENTS.coreInternalError,
      subscriptionId: input.preparedMessage.resolved.message.subscriptionId,
    });
    retryQueueMessage(input.preparedMessage.message, { delaySeconds: 30 });
    return {
      controllerWaitPromise: null,
      shouldAck: false,
    };
  }
};
const processRemoteAgentDeadlineProbeQueuePayload = async (input: {
  db: PostgresDatabase;
  env: CoreBindings;
  preparedMessage: PreparedQueueBatchMessage & {
    resolved: Extract<
      ResolvedIncomingQueueMessage,
      {
        kind: "remote_agent_deadline_probe";
      }
    >;
  };
}): Promise<DispatchQueueMessageExecutionResult> => {
  try {
    await processRemoteAgentNativeDeliveryDeadlineProbe({
      db: input.db,
      env: input.env,
      messageChannelProviderRegistry:
        createConfiguredMessageChannelProviderRegistry({
          db: input.db,
          env: input.env,
        }),
      nowMs: Date.now(),
      probe: input.preparedMessage.resolved.message,
    });
    input.preparedMessage.message.ack();
    return {
      controllerWaitPromise: null,
      shouldAck: true,
    };
  } catch (error) {
    console.warn("[core.remote_agent.native_delivery.deadline_probe_failed]", {
      event: CORE_LOG_EVENTS.coreInternalError,
      error: toErrorMessage(error),
      submissionId: input.preparedMessage.resolved.message.submissionId,
    });
    retryQueueMessage(input.preparedMessage.message, { delaySeconds: 30 });
    return {
      controllerWaitPromise: null,
      shouldAck: false,
    };
  }
};
const processAgentTaskObservationRedriveQueuePayload = async (input: {
  env: CoreBindings;
  preparedMessage: PreparedQueueBatchMessage & {
    resolved: Extract<
      ResolvedIncomingQueueMessage,
      {
        kind: "agent_task_observation_redrive";
      }
    >;
  };
}): Promise<DispatchQueueMessageExecutionResult> => {
  try {
    await resolveRuntimeTransportOwnerShard(
      input.env,
      input.preparedMessage.resolved.message.ownerUserId
    ).rpcRedriveAgentTaskObservation(input.preparedMessage.resolved.message);
    input.preparedMessage.message.ack();
    return {
      controllerWaitPromise: null,
      shouldAck: true,
    };
  } catch (error) {
    console.warn(
      "[core.agent_task_observation_redrive.queue_processing_failed]",
      {
        deliveryId: input.preparedMessage.resolved.message.deliveryId,
        error: toErrorMessage(error),
        event: CORE_LOG_EVENTS.coreInternalError,
      }
    );
    retryQueueMessage(input.preparedMessage.message, { delaySeconds: 30 });
    return {
      controllerWaitPromise: null,
      shouldAck: false,
    };
  }
};
const processDispatchQueueMessage = async (input: {
  db: PostgresDatabase;
  ctx: DispatchQueueWaitContext;
  deliveryPath: "direct" | "queue";
  env: CoreBindings;
  preflightCheck?: DispatchExecutionPreflightResult;
  preparedMessage: PreparedQueueBatchMessage;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<DispatchQueueMessageExecutionResult> => {
  const { preparedMessage } = input;
  if (preparedMessage.resolved.kind === "remote_agent_deadline_probe") {
    return processRemoteAgentDeadlineProbeQueuePayload({
      db: input.db,
      env: input.env,
      preparedMessage: preparedMessage as PreparedQueueBatchMessage & {
        resolved: Extract<
          ResolvedIncomingQueueMessage,
          {
            kind: "remote_agent_deadline_probe";
          }
        >;
      },
    });
  }
  if (preparedMessage.resolved.kind === "agent_task_continuation") {
    return processAgentTaskContinuationQueuePayload({
      db: input.db,
      env: input.env,
      preparedMessage: preparedMessage as PreparedQueueBatchMessage & {
        resolved: Extract<
          ResolvedIncomingQueueMessage,
          {
            kind: "agent_task_continuation";
          }
        >;
      },
    });
  }
  if (preparedMessage.resolved.kind === "agent_task_observation_redrive") {
    return processAgentTaskObservationRedriveQueuePayload({
      env: input.env,
      preparedMessage: preparedMessage as PreparedQueueBatchMessage & {
        resolved: Extract<
          ResolvedIncomingQueueMessage,
          {
            kind: "agent_task_observation_redrive";
          }
        >;
      },
    });
  }
  if (preparedMessage.resolved.kind !== "current_v2") {
    await handleInvalidDispatchQueuePayload({
      db: input.db,
      message: preparedMessage.message,
      payload: preparedMessage.resolved,
    });
    return {
      controllerWaitPromise: null,
      shouldAck: false,
    };
  }
  const dispatchMessage = preparedMessage.resolved.message;
  const nowMs = Date.now();
  const queueAttempt = resolveQueueAttempt(preparedMessage.message);
  await emitDedupeWindowRiskIfNeeded({
    db: input.db,
    dispatchMessage,
    nowMs,
    queueAttempt,
  });
  let executionContext: DispatchExecutionContext | null = null;
  let executionAttemptId: string | null = null;
  let executionAttemptNo = queueAttempt;
  let runtimeExecutionDelivered = false;
  try {
    const outcome = await processDispatchQueueMessageExecution({
      captureAttempt: (attempt) => {
        executionAttemptId = attempt.attemptId;
        executionAttemptNo = attempt.attemptNo;
      },
      controllerKey: preparedMessage.controllerKey,
      db: input.db,
      ctx: input.ctx,
      deliveryPath: input.deliveryPath,
      env: input.env,
      dispatchMessage,
      preflightCheck: input.preflightCheck,
      queueAttempt,
      message: preparedMessage.message,
      receivedQueueSchemaVersion:
        preparedMessage.resolved.receivedQueueSchemaVersion,
      timing: input.timing,
      nowMs,
    });
    if (!outcome.shouldAck) {
      return outcome;
    }
    preparedMessage.message.ack();
    return outcome;
  } catch (error) {
    const queueError = error as {
      executionContext?: DispatchExecutionContext | null;
      deliveredExecutionContext?: DispatchExecutionContext | null;
      attemptId?: string;
      executionAttemptId?: string;
    };
    const preservedExecutionContext =
      (error instanceof DispatchExecutionValidationError &&
        error.executionContext) ||
      queueError.deliveredExecutionContext ||
      queueError.executionContext;
    if (preservedExecutionContext) {
      executionContext = preservedExecutionContext;
      runtimeExecutionDelivered = Boolean(queueError.deliveredExecutionContext);
      executionAttemptId =
        queueError.executionAttemptId ??
        queueError.attemptId ??
        preservedExecutionContext.attemptId;
    }
    let shouldAck: boolean;
    try {
      shouldAck = await handleDispatchQueueProcessingFailure({
        db: input.db,
        deliveryPath: input.deliveryPath,
        env: input.env,
        dispatchMessage,
        executionAttemptId:
          executionAttemptId ?? `missing-attempt:${dispatchMessage.dispatchId}`,
        queueAttempt: executionAttemptNo,
        nowMs,
        message: preparedMessage.message,
        error,
        executionContext,
        runtimeExecutionDelivered,
      });
    } catch (failureHandlingError) {
      // The failure handler itself threw — typically because the same broken DB
      // that caused the original failure also rejects the DLQ/terminal-status
      // writes (a missing-table schema fault after a misroute, or a cutover
      // before backfill). A NON-retryable failure must still end terminal:
      // retrying cannot create a missing table, and silently re-queuing is the
      // exact stuck loop that removing the per-batch storage probe relies on
      // never happening. Retryable/unknown failures still propagate (the queue
      // retries them, bounded by the queue's max_retries).
      if (
        failureHandlingError instanceof
          HostedNativeDeliveryFailurePublicationError ||
        classifyDispatchError(error, toErrorMessage(error)) !== "non_retryable"
      ) {
        throw failureHandlingError;
      }
      console.error("[core.openmeld.dispatch.terminal_recording_failed]", {
        event: "core.openmeld.dispatch.terminal_recording_failed",
        dispatchId: dispatchMessage.dispatchId,
        targetProfileId: dispatchMessage.targetProfileId,
        originalError: toErrorMessage(error),
        recordingError: toErrorMessage(failureHandlingError),
      });
      shouldAck = true;
    }
    if (!shouldAck) {
      return {
        controllerWaitPromise: null,
        shouldAck,
      };
    }
  }
  preparedMessage.message.ack();
  return {
    controllerWaitPromise: null,
    shouldAck: true,
  };
};
// The Space outbox uses this entry point in every environment. Runtime
// classification and recovery ownership stay together with the preflight.
export const dispatchOutboxMessageDirectly = async (input: {
  ctx: DispatchQueueWaitContext;
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<DispatchOutboxDirectDeliveryOutcome> => {
  const db = getPostgresDatabase(input.env);
  const recoveryDb = getPostgresDatabase(input.env);
  if (!(db && recoveryDb && input.env.OPENMELD_SPACES)) {
    return {
      reasonCode: "missing_dispatch_runtime_binding",
      recoveryTransport: "outbox",
      retryDelaySeconds: null,
      status: "retry_scheduled",
    };
  }
  const timing = createSpaceBootstrapTimingCollector();
  const preflightCheck = await timing.measure(
    {
      description:
        "Resolve the authoritative target runtime before direct delivery",
      name: "openmeld_dispatch_direct_eligibility",
    },
    () =>
      runDispatchExecutionPreflightGate({
        env: input.env,
        message: input.message,
        timing,
      })
  );
  const directMessage = createDirectDispatchQueueMessage(input.message);
  const preparedMessage = prepareQueueBatchMessage({
    fallbackKey: `direct:${input.message.dispatchId}`,
    message: directMessage,
  });
  const outcome = await processDispatchQueueMessage({
    db,
    ctx: input.ctx,
    deliveryPath: "direct",
    env: input.env,
    preflightCheck,
    preparedMessage,
    timing,
  });
  if (directMessage.retryRequested || !outcome.shouldAck) {
    return {
      reasonCode: "dispatch_direct_retry_requested",
      // Workstation recovery stays with the Space outbox. Only an
      // authoritatively identified hosted target can hand recovery to Queue.
      recoveryTransport:
        preflightCheck.ok &&
        isHostedAgentRuntimeKind(
          preflightCheck.effectiveTargetBindingSnapshot.runtimeKind
        ) &&
        preflightCheck.effectiveTargetBindingSnapshot.hostedRuntimeIdentity
          ? "queue"
          : "outbox",
      retryDelaySeconds: directMessage.retryDelaySeconds,
      status: "retry_scheduled",
    };
  }
  if (!directMessage.acked) {
    throw new Error(
      `direct dispatch completed without ack: ${input.message.dispatchId}`
    );
  }
  return {
    retryDelaySeconds: null,
    status: "submitted",
  };
};
const resolveDispatchQueuePreflight = async (input: {
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  preflightCheck?: DispatchExecutionPreflightResult;
  timing: SpaceBootstrapTimingCollector;
}): Promise<DispatchExecutionPreflightResult> => {
  if (input.preflightCheck) {
    return input.preflightCheck;
  }
  return await input.timing.measure(
    {
      description: "Resolve all dispatch execution preflight evidence",
      name: "openmeld_dispatch_preflight",
    },
    () =>
      runDispatchExecutionPreflightGate({
        env: input.env,
        message: input.message,
        timing: input.timing,
      })
  );
};
const resolveDispatchTimingCollector = (
  timing?: SpaceBootstrapTimingCollector
): SpaceBootstrapTimingCollector =>
  timing ?? createSpaceBootstrapTimingCollector();
const resumeHostedAdmissionRecoveryClaim = (input: {
  claimState: Awaited<ReturnType<typeof claimDispatchAttempt>>;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  queueAttempt: number;
}): Awaited<ReturnType<typeof claimDispatchAttempt>> => {
  if (
    input.claimState.status !== "deduped" ||
    !input.claimState.hostedAdmissionRecoveryAttemptId ||
    typeof input.claimState.hostedAdmissionRecoveryAttemptNo !== "number"
  ) {
    return input.claimState;
  }
  const resumedClaim = {
    attemptId: input.claimState.hostedAdmissionRecoveryAttemptId,
    attemptNo: input.claimState.hostedAdmissionRecoveryAttemptNo,
    deliveryRecoveryReason: "hosted_admission_incomplete" as const,
    replyingHintActive: false,
    status: "claimed" as const,
  };
  console.info(
    "[core.openMeldDaemon.dispatch_queue.hosted_admission_recovery_resumed]",
    {
      attemptId: resumedClaim.attemptId,
      dispatchId: input.dispatchMessage.dispatchId,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      queueAttempt: input.queueAttempt,
      targetProfileId: input.dispatchMessage.targetProfileId,
    }
  );
  return resumedClaim;
};
const removeHostedRecoveryReasonFromWorkstationDispatch = (
  message: OpenMeldDaemonDispatchQueueMessage
): OpenMeldDaemonDispatchQueueMessage => {
  if (message.deliveryRecoveryReason !== "hosted_admission_incomplete") {
    return message;
  }
  const {
    deliveryRecoveryReason: _hostedAdmissionRecoveryReason,
    ...workstationDispatchMessage
  } = message;
  console.info(
    "[core.openMeldDaemon.dispatch_queue.hosted_admission_recovery_target_changed]",
    {
      dispatchId: workstationDispatchMessage.dispatchId,
      targetProfileId: workstationDispatchMessage.targetProfileId,
    }
  );
  return workstationDispatchMessage;
};
const processDispatchQueueMessageExecution = async (input: {
  captureAttempt?: (attempt: { attemptId: string; attemptNo: number }) => void;
  controllerKey: string;
  db: PostgresDatabase;
  ctx: DispatchQueueWaitContext;
  deliveryPath: "direct" | "queue";
  env: CoreBindings;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  preflightCheck?: DispatchExecutionPreflightResult;
  queueAttempt: number;
  message: QueueBatchMessage;
  nowMs: number;
  receivedQueueSchemaVersion?: number;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<DispatchQueueMessageExecutionResult> => {
  if (
    input.dispatchMessage.dispatchContractVersion !==
    OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION
  ) {
    await handleUnsupportedDispatchContractVersion({
      db: input.db,
      message: input.dispatchMessage,
      attempt: input.queueAttempt,
      nowMs: input.nowMs,
      receivedQueueSchemaVersion: input.receivedQueueSchemaVersion,
    });
    return {
      controllerWaitPromise: null,
      shouldAck: true,
    };
  }
  const timing = resolveDispatchTimingCollector(input.timing);
  const logServerTiming = () => {
    logDispatchQueueServerTiming({
      deliveryPath: input.deliveryPath,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      metrics: timing.metrics(),
    });
  };
  const preHeadFailurePublication = await timing.measure(
    {
      description: "Resume any durable failure publication before dispatch",
      name: "openmeld_dispatch_pre_head_recovery",
    },
    () =>
      resumeExistingPreHeadFailurePublication({
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        env: input.env,
        message: input.message,
        nowMs: input.nowMs,
      })
  );
  if (preHeadFailurePublication) {
    logServerTiming();
    return preHeadFailurePublication;
  }
  let claimState = await timing.measure(
    {
      description: "Claim or correlate the durable dispatch attempt",
      name: "openmeld_dispatch_claim",
    },
    () =>
      claimDispatchAttempt({
        db: input.db,
        message: input.dispatchMessage,
        attempt: input.queueAttempt,
        nowMs: input.nowMs,
      })
  );
  const human = buildDispatchHumanLogContext({
    nowMs: input.nowMs,
    spaceName: input.dispatchMessage.spaceNameSnapshot ?? null,
    targetLabel: input.dispatchMessage.targetProfileMentionLabel ?? null,
    targetProfileName: input.dispatchMessage.targetProfileNameSnapshot ?? null,
    sourceProfileName: input.dispatchMessage.sourceProfileNameSnapshot ?? null,
    sourceText: input.dispatchMessage.sourceSignalSnapshot?.text ?? null,
    handedOffAtMs: input.dispatchMessage.enqueuedAtMs,
  });
  claimState = resumeHostedAdmissionRecoveryClaim({
    claimState,
    dispatchMessage: input.dispatchMessage,
    queueAttempt: input.queueAttempt,
  });
  if (claimState.status === "deduped") {
    const result = await handleDedupedDispatchClaim({
      claimState,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      human,
      message: input.message,
      queueAttempt: input.queueAttempt,
    });
    logServerTiming();
    return result;
  }
  console.info("[core.openMeldDaemon.dispatch_queue.claim_result]", {
    dispatchAttemptNo: claimState.attemptNo,
    dispatchId: input.dispatchMessage.dispatchId,
    deliveryRecoveryReason:
      claimState.status === "claimed"
        ? (claimState.deliveryRecoveryReason ?? null)
        : null,
    human,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    queueAttempt: input.queueAttempt,
    sourceEventId: input.dispatchMessage.sourceEventId,
    status: claimState.status,
    targetProfileId: input.dispatchMessage.targetProfileId,
    taskId: input.dispatchMessage.taskId,
  });
  const executionAttemptId = claimState.attemptId;
  const executionAttemptNo = claimState.attemptNo;
  input.captureAttempt?.({
    attemptId: executionAttemptId,
    attemptNo: executionAttemptNo,
  });
  const preflightCheck = await resolveDispatchQueuePreflight({
    env: input.env,
    message: input.dispatchMessage,
    preflightCheck: input.preflightCheck,
    timing,
  });
  logDispatchQueueBindingSource({
    dispatchMessage: input.dispatchMessage,
    preflightCheck,
  });
  if (!preflightCheck.ok) {
    const noExecutionHandled =
      await handlePreflightNoExecutionWithRuntimeCoordinatorHeadIfNeeded({
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        env: input.env,
        executionAttemptId,
        message: input.message,
        nowMs: input.nowMs,
        preflightCheck,
        queueAttempt: executionAttemptNo,
      });
    if (noExecutionHandled.handled) {
      logServerTiming();
      return {
        controllerWaitPromise: null,
        shouldAck: noExecutionHandled.shouldAck,
      };
    }
    const shouldAck = await handlePreflightDispatchCheckFailure({
      db: input.db,
      message: input.message,
      dispatchMessage: input.dispatchMessage,
      executionAttemptId,
      queueAttempt: executionAttemptNo,
      preflightCheck,
      nowMs: input.nowMs,
      env: input.env,
    });
    logServerTiming();
    return {
      controllerWaitPromise: null,
      shouldAck,
    };
  }
  input.ctx.waitUntil(
    emitDispatchingActivitySignal({
      env: input.env,
      message: input.dispatchMessage,
    })
  );
  let effectiveDispatchMessage = applyEffectiveTargetBindingSnapshotToMessage({
    message: input.dispatchMessage,
    snapshot: preflightCheck.effectiveTargetBindingSnapshot,
  });
  if (
    claimState.status === "claimed" &&
    claimState.deliveryRecoveryReason &&
    effectiveDispatchMessage.deliveryRecoveryReason !==
      claimState.deliveryRecoveryReason
  ) {
    effectiveDispatchMessage = {
      ...effectiveDispatchMessage,
      deliveryRecoveryReason: claimState.deliveryRecoveryReason,
    };
    console.info(
      "[core.openMeldDaemon.dispatch_queue.recovery_redrive_claimed]",
      {
        dispatchId: effectiveDispatchMessage.dispatchId,
        idempotencyKey: effectiveDispatchMessage.idempotencyKey,
        reason: claimState.deliveryRecoveryReason,
        taskId: effectiveDispatchMessage.taskId,
      }
    );
  }
  const targetOwnerUserId = normalizeOptionalText(
    preflightCheck.effectiveTargetBindingSnapshot.ownerUserId
  );
  if (
    isHostedAgentRuntimeKind(
      preflightCheck.effectiveTargetBindingSnapshot.runtimeKind
    )
  ) {
    const result = await handleHostedCenterAgentNativeDelivery({
      ctx: input.ctx,
      db: input.db,
      dispatchMessage: effectiveDispatchMessage,
      env: input.env,
      executionAttemptId,
      message: input.message,
      nowMs: input.nowMs,
      queueAttempt: executionAttemptNo,
      snapshot: preflightCheck.effectiveTargetBindingSnapshot,
      targetOwnerUserId,
      timing,
    });
    logServerTiming();
    return result;
  }
  if (!targetOwnerUserId) {
    throw new DispatchExecutionValidationError({
      code: "agent_profile_binding.lookup_failed",
      executionContext: {
        attemptId: executionAttemptId,
        connectionGeneration: null,
        daemonSessionId: AUDIT_UNKNOWN_DAEMON_SESSION_ID,
        leaseEpoch: AUDIT_UNKNOWN_LEASE_EPOCH,
        replyingHintActive: false,
      },
      message: "target owner user id is missing",
    });
  }
  effectiveDispatchMessage = removeHostedRecoveryReasonFromWorkstationDispatch(
    effectiveDispatchMessage
  );
  if (claimState.status === "continued") {
    const result = await scheduleContinuedDispatchWaitPhase({
      claimState,
      controllerKey: input.controllerKey,
      ctx: input.ctx,
      db: input.db,
      dispatchMessage: effectiveDispatchMessage,
      env: input.env,
      executionAttemptId,
      targetOwnerUserId,
    });
    logServerTiming();
    return result;
  }
  const headAcceptance = await timing.measure(
    {
      description: "Accept RuntimeCoordinator head before daemon delivery",
      name: "openmeld_dispatch_head_accept",
    },
    () =>
      acceptRuntimeCoordinatorHeadBeforeFreshExecution({
        db: input.db,
        dispatchMessage: effectiveDispatchMessage,
        env: input.env,
        executionAttemptId,
        nowMs: input.nowMs,
        openMeldServiceRuntimeId:
          preflightCheck.effectiveTargetBindingSnapshot
            .openMeldServiceRuntimeId,
        runtimeKind: preflightCheck.effectiveTargetBindingSnapshot.runtimeKind,
        targetOwnerUserId,
      })
  );
  const settledHeadAdmission = await settleFreshHeadAdmissionWithoutDelivery({
    db: input.db,
    dispatchMessage: effectiveDispatchMessage,
    env: input.env,
    executionAttemptId,
    executionAttemptNo,
    headAcceptance,
    message: input.message,
    nowMs: input.nowMs,
  });
  if (settledHeadAdmission) {
    logServerTiming();
    return settledHeadAdmission;
  }
  const acceptedDispatch = resolveRuntimeCoordinatorAcceptedDispatch({
    headAcceptance,
    message: effectiveDispatchMessage,
  });
  effectiveDispatchMessage = acceptedDispatch.message;
  const deviceWaiting = await settleDeviceWaitingWakeBeforeExecution({
    db: input.db,
    dispatchMessage: effectiveDispatchMessage,
    env: input.env,
    executionAttemptId,
    executionAttemptNo,
    message: input.message,
    nowMs: input.nowMs,
    preflightCheck,
    targetOwnerUserId,
  });
  const result =
    deviceWaiting ??
    (await beginFreshDispatchDeliveryPhase({
      acceptedDispatchSnapshot: acceptedDispatch.snapshot,
      controllerKey: input.controllerKey,
      ctx: input.ctx,
      db: input.db,
      dispatchMessage: effectiveDispatchMessage,
      env: input.env,
      executionAttemptId,
      executionAttemptNo,
      nowMs: input.nowMs,
      targetOwnerUserId,
      timing,
    }));
  logServerTiming();
  return result;
};
const settleDeviceWaitingWakeBeforeExecution = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  executionAttemptNo: number;
  message: QueueBatchMessage;
  nowMs: number;
  preflightCheck: Extract<
    DispatchExecutionPreflightResult,
    {
      ok: true;
    }
  >;
  targetOwnerUserId: string;
}): Promise<DispatchQueueMessageExecutionResult | null> => {
  const effectiveDispatchMessage = input.dispatchMessage;
  const {
    executionAttemptId,
    executionAttemptNo,
    preflightCheck,
    targetOwnerUserId,
  } = input;
  const deviceWaitAccess = effectiveDispatchMessage.deviceWait
    ? await checkDeviceWaitingWakeAccess({
        env: input.env,
        message: effectiveDispatchMessage,
      }).catch((error) => {
        console.warn("[core.device_wait.access_unavailable]", {
          dispatchId: effectiveDispatchMessage.dispatchId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      })
    : true;
  if (deviceWaitAccess === false) {
    const outcome =
      await handlePreflightNoExecutionWithRuntimeCoordinatorHeadIfNeeded({
        db: input.db,
        dispatchMessage: effectiveDispatchMessage,
        env: input.env,
        executionAttemptId,
        message: input.message,
        nowMs: input.nowMs,
        preflightCheck: {
          ok: false,
          canonicalAdmissionBlock: true,
          errorCode: "wake.device_wait.access_revoked",
          errorMessage:
            "The requester or Agent no longer has permission to execute this waiting Wake in this Space.",
          finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
          targetOwnerUserId,
        },
        queueAttempt: executionAttemptNo,
      });
    return { controllerWaitPromise: null, shouldAck: outcome.shouldAck };
  }
  const waitingReason =
    deviceWaitAccess === null
      ? "wake.device_wait.access_check_unavailable"
      : preflightCheck.deviceWaitReason;
  if (waitingReason) {
    let errorMessage =
      waitingReason === "daemon.profile.offline"
        ? "Waiting for the specified computer to come online. No work has started."
        : "Waiting for the Agent's current readiness checks. No work has started.";
    if (deviceWaitAccess === null) {
      errorMessage =
        "Waiting to verify the Wake's current Space access. No work has started.";
    }
    const waiting = await recordPreExecutionHeadWaiting({
      db: input.db,
      dispatchMessage: effectiveDispatchMessage,
      env: input.env,
      errorCode: waitingReason,
      errorMessage,
      executionAttemptId,
      failureAtMs: input.nowMs,
      message: input.message,
      ownerUserId: targetOwnerUserId,
      queueAttempt: executionAttemptNo,
    });
    return { controllerWaitPromise: null, shouldAck: waiting.shouldAck };
  }
  return null;
};
const isFreshRuntimeCoordinatorHeadSettledWithoutExecution = (
  outcome: RuntimeCoordinatorHeadAcceptanceOutcome
): boolean =>
  outcome.status === "profile_queue_waiting" ||
  outcome.status === "publication_intent_ready" ||
  outcome.status === "existing_publication_intent_preserved" ||
  outcome.status === "terminal_already_recorded" ||
  outcome.status === "skip_duplicate";
const settleFreshHeadAdmissionWithoutDelivery = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  executionAttemptNo: number;
  headAcceptance: RuntimeCoordinatorHeadAcceptanceOutcome;
  message: QueueBatchMessage;
  nowMs: number;
}): Promise<DispatchQueueMessageExecutionResult | null> => {
  if (input.headAcceptance.status === "retry") {
    if (
      input.headAcceptance.reasonCode ===
        "runtime_coordinator.execution_target_mutation_in_progress" &&
      input.nowMs -
        (input.dispatchMessage.outboxCreatedAtMs ??
          input.dispatchMessage.enqueuedAtMs) >=
        EXECUTION_TARGET_MUTATION_WAKE_WAIT_MAX_MS
    ) {
      return {
        controllerWaitPromise: null,
        shouldAck: await settleVisiblePreHeadFailure({
          db: input.db,
          dispatchMessage: input.dispatchMessage,
          env: input.env,
          errorCode:
            "runtime_coordinator.execution_target_mutation_wait_expired",
          errorMessage:
            "The Agent's execution settings stayed busy. Try this Wake again after the settings change finishes.",
          executionAttemptId: input.executionAttemptId,
          finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
          message: input.message,
          nowMs: input.nowMs,
        }),
      };
    }
    retryQueueMessageWithBackoff(
      input.message,
      input.executionAttemptNo,
      input.headAcceptance.reasonCode
    );
    return {
      controllerWaitPromise: null,
      shouldAck: false,
    };
  }
  if (
    input.headAcceptance.status === "queue_full" ||
    input.headAcceptance.status === "recovery_needs_attention" ||
    input.headAcceptance.status === "context_rejected"
  ) {
    return {
      controllerWaitPromise: null,
      shouldAck: await settleVisiblePreHeadFailure({
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        env: input.env,
        errorCode: input.headAcceptance.reasonCode,
        errorMessage: input.headAcceptance.errorMessage,
        executionAttemptId: input.executionAttemptId,
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        message: input.message,
        nowMs: input.nowMs,
      }),
    };
  }
  if (
    isFreshRuntimeCoordinatorHeadSettledWithoutExecution(input.headAcceptance)
  ) {
    return {
      controllerWaitPromise: null,
      shouldAck: true,
    };
  }
  return null;
};
const resumeExistingPreHeadFailurePublication = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  message: QueueBatchMessage;
  nowMs: number;
}): Promise<DispatchQueueMessageExecutionResult | null> => {
  const recoveryDb = getPostgresDatabase(input.env);
  if (!recoveryDb) {
    throw new Error("dispatch.pre_head_failure_publication_db_unavailable");
  }
  const state = await readPreHeadFailurePublicationState({
    db: recoveryDb,
    dispatchId: input.dispatchMessage.dispatchId,
  });
  if (state.status === "missing") {
    return null;
  }
  if (state.status === "completed" || state.status === "needs_attention") {
    return {
      controllerWaitPromise: null,
      shouldAck: true,
    };
  }
  return {
    controllerWaitPromise: null,
    shouldAck: await resumePreHeadFailurePublication({
      evidenceDb: input.db,
      env: input.env,
      intent: state.intent,
      message: input.message,
      nowMs: input.nowMs,
      recoveryDb,
    }),
  };
};
const scheduleContinuedDispatchWaitPhase = async (input: {
  claimState: Extract<
    Awaited<ReturnType<typeof claimDispatchAttempt>>,
    {
      status: "continued";
    }
  >;
  controllerKey: string;
  ctx: DispatchQueueWaitContext;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  targetOwnerUserId: string;
}): Promise<DispatchQueueMessageExecutionResult> => {
  await markDispatchAttemptWaitingForResult({
    attemptId: input.executionAttemptId,
    connectionGeneration: input.claimState.connectionGeneration,
    daemonSessionId: input.claimState.daemonSessionId,
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    leaseEpoch: input.claimState.leaseEpoch,
    nowMs: Date.now(),
    targetProfileId: input.dispatchMessage.targetProfileId,
    taskId: input.dispatchMessage.taskId,
  });
  const controllerWaitPromise = scheduleOffloadedWaitPhase(
    {
      agentControllerRef: normalizeOptionalText(
        input.dispatchMessage.controllerSnapshot.agentControllerRef
      ),
      controllerKey: input.controllerKey,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionAttemptId: input.executionAttemptId,
      executionAttemptNo: input.claimState.attemptNo,
      executionContext: {
        attemptId: input.executionAttemptId,
        connectionGeneration: input.claimState.connectionGeneration,
        daemonSessionId: input.claimState.daemonSessionId,
        leaseEpoch: input.claimState.leaseEpoch,
        replyingHintActive: input.claimState.replyingHintActive,
      },
      targetOwnerUserId: input.targetOwnerUserId,
      profileHandle: null,
      targetProfileName:
        normalizeOptionalText(
          input.dispatchMessage.targetProfileNameSnapshot
        ) ?? null,
      targetProfileMentionLabel:
        normalizeOptionalText(
          input.dispatchMessage.targetProfileMentionLabel
        ) ?? null,
      waitPhaseMode: "resumed",
    },
    input.ctx
  );
  return {
    controllerWaitPromise,
    shouldAck: true,
  };
};
const handlePreAgentStoppedBeforeDeliveryIfNeeded = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  nowMs: number;
  targetOwnerUserId: string;
  targetWakeLifecycleIdentity: ReturnType<
    typeof projectTargetWakeLifecycleIdentity
  >;
}): Promise<{
  handled: boolean;
}> => {
  const trace = await readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace({
    env: input.env,
    ownerUserId: input.targetOwnerUserId,
    request: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      targetWakeLifecycleIdentity: input.targetWakeLifecycleIdentity,
    },
  }).catch((error) => {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.pre_agent_stop_guard_read_failed]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(error),
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId:
          input.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      }
    );
    return null;
  });
  if (
    trace?.ok !== true ||
    trace.readStatus !== "found" ||
    trace.lifecycle.status !== "stopped_before_execution"
  ) {
    return { handled: false };
  }
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
    db: input.db,
    errorCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
    errorMessage: "RuntimeCoordinator stopped this Wake before local delivery",
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.nowMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.cancelled,
  });
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode: "runtime_coordinator.pre_agent_stop_queue_delivery_blocked",
    decisionPayload: {
      dispatchId: input.dispatchMessage.dispatchId,
      primaryDispatchId: trace.lifecycle.primaryDispatchId,
      reasonCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetWakeLifecycleId: trace.lifecycle.targetWakeLifecycleId,
    },
    decidedBy: "core.dispatch_queue.runtime_coordinator_head",
    decidedAtMs: input.nowMs,
    expectedRecoveryCriteria:
      "RuntimeCoordinator head lifecycle is stopped_before_execution; queue must ack without local delivery.",
    source: "dispatch_queue",
    correlationId: input.dispatchMessage.dispatchId,
  });
  console.info(
    "[core.openMeldDaemon.dispatch_queue.pre_agent_stop_delivery_blocked]",
    {
      dispatchId: input.dispatchMessage.dispatchId,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetWakeLifecycleId: trace.lifecycle.targetWakeLifecycleId,
    }
  );
  return { handled: true };
};
type RuntimeCoordinatorHeadAcceptanceOutcome =
  | {
      status: "context_rejected";
      reasonCode: string;
      errorMessage: string;
    }
  | {
      acceptedDispatchSnapshot?: OpenMeldDaemonAcceptedDispatchSnapshot;
      executionContext?: OpenMeldDaemonDispatchQueueMessage["executionContext"];
      status: "proceed";
    }
  | {
      status: "profile_queue_waiting";
    }
  | {
      errorMessage: string;
      reasonCode: "agent_profile_work_coordinator.continuation_needs_attention";
      status: "recovery_needs_attention";
    }
  | {
      errorMessage: string;
      reasonCode: "agent_profile_work_coordinator.queue_full";
      status: "queue_full";
    }
  | {
      reasonCode: string;
      status: "retry";
    }
  | {
      reasonCode: string;
      status: "publication_intent_ready";
    }
  | {
      status: "existing_publication_intent_preserved";
    }
  | {
      status: "terminal_already_recorded";
    }
  | {
      status: "skip_duplicate";
    };
const isAcceptedPayloadConflictSettlementReady = (
  outcome: RuntimeCoordinatorHeadAcceptanceOutcome
): boolean =>
  outcome.status === "existing_publication_intent_preserved" ||
  outcome.status === "terminal_already_recorded" ||
  (outcome.status === "publication_intent_ready" &&
    outcome.reasonCode ===
      RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE);
const resolveRuntimeCoordinatorAcceptedDispatch = (input: {
  headAcceptance: RuntimeCoordinatorHeadAcceptanceOutcome;
  message: OpenMeldDaemonDispatchQueueMessage;
}): {
  message: OpenMeldDaemonDispatchQueueMessage;
  snapshot: OpenMeldDaemonAcceptedDispatchSnapshot | undefined;
} => {
  const snapshot =
    input.headAcceptance.status === "proceed"
      ? input.headAcceptance.acceptedDispatchSnapshot
      : undefined;
  return {
    message: snapshot
      ? applyAcceptedDispatchSnapshotToMessage({
          message: input.message,
          snapshot,
          ...(input.headAcceptance.status === "proceed"
            ? { executionContext: input.headAcceptance.executionContext }
            : {}),
        })
      : input.message,
    snapshot,
  };
};
function requiresExecutionContext(
  message: OpenMeldDaemonDispatchQueueMessage,
  runtimeKind: string | null | undefined
): boolean {
  return Boolean(
    message.contextSelection ||
      (runtimeKind === "openmeld_service" && message.threadContext)
  );
}
const executionContextRejectionMessage = (reasonCode: string): string => {
  switch (reasonCode) {
    case "execution_context.selection_required":
      return "This Agent has more than one task in progress in this conversation. Choose the task to continue, or start a new task.";
    case "execution_context.history_selection_required":
      return "This Agent couldn't tell which earlier task in this conversation you meant. Choose the task to continue, or start a new task.";
    default:
      return "This task's background could not be verified. Choose a task from this conversation to continue or fork, or start a new task.";
  }
};
const settleRuntimeCoordinatorHeadAdmissionResponse = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  executionAttemptId: string;
  nowMs: number;
  response: Awaited<
    ReturnType<typeof acceptRuntimeTransportRuntimeCoordinatorHead>
  >;
  targetWakeLifecycleId: string;
}): Promise<RuntimeCoordinatorHeadAcceptanceOutcome | null> => {
  const { response } = input;
  if (
    !response.ok &&
    response.status === "conflict" &&
    response.reasonCode.startsWith("execution_context.")
  ) {
    return {
      status: "context_rejected",
      reasonCode: response.reasonCode,
      errorMessage: executionContextRejectionMessage(response.reasonCode),
    };
  }
  if (!response.ok && response.status === "retry_later") {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator head accept returned retry_later before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.head_accept_retry_later",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        reasonCode: response.reasonCode,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: input.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "RuntimeCoordinator head accept must succeed before execution creation; Queue will retry this target Wake.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    return {
      reasonCode: response.reasonCode,
      status: "retry",
    };
  }
  if (
    response.ok &&
    response.action === "wait_in_queue" &&
    response.status === "queued"
  ) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.profileQueueWaiting,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage: `RuntimeCoordinator queued this Wake at profile position ${response.queuePosition}`,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.queued,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "agent_profile_work_coordinator.queue_waiting",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        queuePosition: response.queuePosition,
        reasonCode: response.reasonCode,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "Agent Profile Work Coordinator promotion explicitly redrives this retained outbox seed before local execution delivery.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    console.info(
      "[core.openmeld.dispatch.agent_profile_work_coordinator_queue_waiting]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        queuePosition: response.queuePosition,
        reasonCode: response.reasonCode,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      }
    );
    return { status: "profile_queue_waiting" };
  }
  if (!response.ok && response.status === "queue_full") {
    return {
      errorMessage: `Agent Profile Work Coordinator rejected this Wake because ${response.waitingCount} items are already waiting`,
      reasonCode: response.reasonCode,
      status: "queue_full",
    };
  }
  if (
    !response.ok &&
    response.status === "conflict" &&
    response.reasonCode ===
      "agent_profile_work_coordinator.continuation_needs_attention"
  ) {
    return {
      errorMessage:
        "This interrupted Wake needs review because the Agent's setup changed before it could continue.",
      reasonCode: response.reasonCode,
      status: "recovery_needs_attention",
    };
  }
  return null;
};
const settleRuntimeCoordinatorAcceptedPayloadConflict = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  nowMs: number;
  targetOwnerUserId: string;
  targetWakeLifecycleIdentity: ReturnType<
    typeof projectTargetWakeLifecycleIdentity
  >;
}): Promise<RuntimeCoordinatorHeadAcceptanceOutcome> => {
  const response =
    await recordRuntimeTransportRuntimeCoordinatorHeadNoExecution({
      env: input.env,
      ownerUserId: input.targetOwnerUserId,
      noExecution: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        decisionSource: "dispatch_delivery_pre_execution",
        dispatchId: input.dispatchMessage.dispatchId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        ownerUserId: input.targetOwnerUserId,
        publicationCategory: "agent_profile_unavailable",
        reasonCode:
          RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE,
        targetWakeLifecycleIdentity: input.targetWakeLifecycleIdentity,
        userRecoveryAction: "check_status",
      },
    });
  if (!response.ok) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      errorCode:
        RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE,
      errorMessage: `RuntimeCoordinator rejected the changed accepted Wake payload and could not safely settle the original head: ${response.reasonCode}`,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode:
        "runtime_coordinator.head_payload_conflict_settlement_deferred",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        reasonCode: response.reasonCode,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId:
          input.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "Queue retries the same frozen Wake until RuntimeCoordinator can preserve its original execution or publish an exact identity-conflict failure.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    return { reasonCode: response.reasonCode, status: "retry" };
  }
  if (
    response.reasonCode ===
    RUNTIME_COORDINATOR_RETIRED_TERMINAL_HEAD_REDRIVE_REASON_CODE
  ) {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.retired_terminal_head_redrive_acked",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        reasonCode:
          RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE,
        runtimeCoordinatorReasonCode: response.reasonCode,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "Queue acknowledges the changed-payload redrive without execution, publication, or any rewrite of the terminal Wake outcome.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    return { status: "terminal_already_recorded" };
  }
  const finalReasonCode = response.reasonCode;
  const finalReasonIsAcceptedPayloadConflict =
    finalReasonCode ===
    RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE;
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode: finalReasonCode,
    errorMessage: finalReasonIsAcceptedPayloadConflict
      ? "RuntimeCoordinator preserved the first accepted Wake payload and prepared an exact visible identity-conflict failure"
      : "RuntimeCoordinator preserved the existing visible no-execution failure instead of replacing it with a payload conflict",
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.nowMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  });
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode: finalReasonIsAcceptedPayloadConflict
      ? "runtime_coordinator.head_payload_conflict_publication_intent_ready"
      : "runtime_coordinator.head_existing_publication_preserved",
    decisionPayload: {
      dispatchId: input.dispatchMessage.dispatchId,
      publicationIntentId: response.publicationIntentId,
      reasonCode: finalReasonCode,
      status: response.status,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetWakeLifecycleId: response.targetWakeLifecycleId,
    },
    decidedBy: "core.dispatch_queue.runtime_coordinator_head",
    decidedAtMs: input.nowMs,
    expectedRecoveryCriteria: finalReasonIsAcceptedPayloadConflict
      ? "RuntimeCoordinator publishes one visible failure for the original Wake identity; the changed payload must never execute."
      : "RuntimeCoordinator keeps the original visible failure and Queue acknowledges the redrive without executing the changed payload.",
    source: "dispatch_queue",
    correlationId: input.dispatchMessage.dispatchId,
  });
  return finalReasonIsAcceptedPayloadConflict
    ? {
        reasonCode: finalReasonCode,
        status: "publication_intent_ready",
      }
    : { status: "existing_publication_intent_preserved" };
};
/**
 * This Wake's request chain. Once the chain is enforced, a workstation Wake
 * without a human root is a visible failure: no human root, no Wake
 * (agent-transport-contract.md, Request Chain).
 */
async function admitDispatchRequestChain(input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  runtimeKind?: string | null;
}): Promise<
  | { status: "admitted"; requestChain: RequestChain | undefined }
  | Extract<
      RuntimeCoordinatorHeadAcceptanceOutcome,
      { status: "context_rejected" }
    >
> {
  const result = await resolveAdmittedRequestChain({
    deps: createAdmittedRequestChainDeps(input.env),
    message: input.dispatchMessage,
  });
  if (result.ok) {
    await recordDispatchRequestChainRoot({
      db: input.db,
      message: input.dispatchMessage,
      rootProfileId: readRequestChainRootProfileId(result.chain),
    });
    return { status: "admitted", requestChain: result.chain };
  }
  if (isRequestChainEnforced() && input.runtimeKind === "openmeld_service") {
    return {
      status: "context_rejected",
      reasonCode: result.reasonCode,
      errorMessage: describeRequestChainRejection(result.reasonCode),
    };
  }
  return { status: "admitted", requestChain: undefined };
}
/**
 * Projects the root into the Dispatch Ledger for root-based reads (the
 * permission-mode advisor, plugin access). First write wins: a Wake's root
 * never changes. A failed write leaves those readers on their fallback.
 */
async function recordDispatchRequestChainRoot(input: {
  db: PostgresDatabase;
  message: OpenMeldDaemonDispatchQueueMessage;
  rootProfileId: string;
}): Promise<void> {
  try {
    await input.db.query({
      text: `
        UPDATE "openmeld"."openMeldDaemon_dispatch_ledger"
        SET request_chain_root_profile_id = $1
        WHERE dispatch_id = $2
          AND target_profile_id = $3
          AND request_chain_root_profile_id IS NULL
      `,
      values: [
        input.rootProfileId,
        input.message.dispatchId,
        input.message.targetProfileId,
      ],
    });
  } catch (error) {
    console.warn("[core.dispatch.request_chain_root_projection_failed]", {
      dispatchId: input.message.dispatchId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
function describeRequestChainRejection(
  reasonCode: RequestChainRejectionReason
): string {
  switch (reasonCode) {
    case "request_chain.delegation_reentry":
      return "This Agent already handed this work off, so it can't take it back.";
    case "request_chain.depth_exceeded":
      return "Too many Agents are already working on this request to wake another one.";
    case "request_chain.anonymous_requester":
      return "Sign in to OpenMeld to wake an Agent.";
    case "request_chain.root_unavailable":
      return "The person who asked for this work is no longer in this organization.";
    default:
      return "OpenMeld couldn't confirm which person asked for this work, so the Agent didn't start.";
  }
}
const acceptRuntimeCoordinatorHeadBeforeFreshExecution = async (input: {
  allowPublicationIntentReconcile?: boolean;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  nowMs: number;
  openMeldServiceRuntimeId?: string | null;
  runtimeKind?:
    | "hosted_center_agent"
    | "hosted_remote_agent"
    | "openmeld_service"
    | null;
  targetOwnerUserId: string;
}): Promise<RuntimeCoordinatorHeadAcceptanceOutcome> => {
  const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
    clientMessageId: input.dispatchMessage.sourceClientMessageId ?? null,
    dispatchId: input.dispatchMessage.dispatchId,
    sourceSignalId: input.dispatchMessage.sourceEventId,
    spaceId: input.dispatchMessage.spaceId,
    targetProfileId: input.dispatchMessage.targetProfileId,
  });
  const preAgentStopped = await handlePreAgentStoppedBeforeDeliveryIfNeeded({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    executionAttemptId: input.executionAttemptId,
    nowMs: input.nowMs,
    targetOwnerUserId: input.targetOwnerUserId,
    targetWakeLifecycleIdentity,
  });
  if (preAgentStopped.handled) {
    return { status: "skip_duplicate" };
  }
  const admission = await admitDispatchRequestChain(input);
  if (admission.status === "context_rejected") {
    return admission;
  }
  const requestChain = admission.requestChain;
  const contextSelection = await applyFolderSelectionPolicy({
    env: input.env,
    message: input.dispatchMessage,
    requestChain,
    targetOwnerUserId: input.targetOwnerUserId,
  });
  const acceptedDispatchSnapshot = await buildAcceptedDispatchSnapshot({
    contextSelection,
    message: input.dispatchMessage,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    requestChain,
    runtimeKind: input.runtimeKind,
    workspaceDefault: await resolveContextWorkspaceDefault({
      contextSelection,
      env: input.env,
      message: input.dispatchMessage,
      requestChain,
      runtimeKind: input.runtimeKind,
      targetOwnerUserId: input.targetOwnerUserId,
    }),
  });
  if (
    requiresExecutionContext(input.dispatchMessage, input.runtimeKind) &&
    !acceptedDispatchSnapshot?.contextRequest
  ) {
    return {
      status: "context_rejected",
      reasonCode: "execution_context.scope_unavailable",
      errorMessage:
        "This Agent cannot start an independent task with the current connection and conversation. Reconnect the local Agent and try again.",
    };
  }
  const response = await acceptRuntimeTransportRuntimeCoordinatorHead({
    env: input.env,
    ownerUserId: input.targetOwnerUserId,
    head: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ...(acceptedDispatchSnapshot ? { acceptedDispatchSnapshot } : {}),
      dispatchId: input.dispatchMessage.dispatchId,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      ownerUserId: input.targetOwnerUserId,
      ...(input.dispatchMessage.targetProfileMentionLabel
        ? {
            targetProfileMentionLabel:
              input.dispatchMessage.targetProfileMentionLabel,
          }
        : {}),
      ...(input.dispatchMessage.targetProfileNameSnapshot
        ? { targetProfileName: input.dispatchMessage.targetProfileNameSnapshot }
        : {}),
      targetWakeLifecycleIdentity,
    },
  });
  const admissionOutcome = await settleRuntimeCoordinatorHeadAdmissionResponse({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    executionAttemptId: input.executionAttemptId,
    nowMs: input.nowMs,
    response,
    targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
  });
  if (admissionOutcome) {
    return admissionOutcome;
  }
  if (
    !response.ok &&
    response.status === "conflict" &&
    response.reasonCode ===
      RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE
  ) {
    return await settleRuntimeCoordinatorAcceptedPayloadConflict({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionAttemptId: input.executionAttemptId,
      nowMs: input.nowMs,
      targetOwnerUserId: input.targetOwnerUserId,
      targetWakeLifecycleIdentity,
    });
  }
  if (
    input.allowPublicationIntentReconcile === true &&
    response.ok &&
    response.action === "skip_duplicate" &&
    response.status === "publication_intent_ready" &&
    response.primaryDispatchId === input.dispatchMessage.dispatchId
  ) {
    return {
      reasonCode: response.reasonCode,
      status: "publication_intent_ready",
    };
  }
  if (
    response.ok &&
    response.action === "skip_duplicate" &&
    response.status === "stopped_before_execution"
  ) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
      db: input.db,
      errorCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
      errorMessage:
        "RuntimeCoordinator stopped this Wake before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.cancelled,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.pre_agent_stop_head_accept_blocked",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        primaryDispatchId: response.primaryDispatchId,
        reasonCode: response.reasonCode,
        runtimeCoordinatorExecutionId: null,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "RuntimeCoordinator head lifecycle is stopped_before_execution; queue must ack without creating execution.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    console.info(
      "[core.openMeldDaemon.dispatch_queue.runtime_coordinator_head_stop]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        primaryDispatchId: response.primaryDispatchId,
        reasonCode: response.reasonCode,
        status: response.status,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      }
    );
    return { status: "skip_duplicate" };
  }
  if (!response.ok) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator rejected this head admission without granting duplicate authority",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.head_authority_conflict",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        primaryDispatchId: response.primaryDispatchId,
        reasonCode: response.reasonCode,
        runtimeCoordinatorExecutionId: null,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "Queue retries without executing or deduping this conflicting Wake until RuntimeCoordinator authority becomes unambiguous.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    return { reasonCode: response.reasonCode, status: "retry" };
  }
  if (response.action === "skip_duplicate") {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator head already belongs to the primary target Wake dispatch",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.deduped,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.head_duplicate_dispatch_skipped",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        primaryDispatchId: response.primaryDispatchId,
        reasonCode: response.reasonCode,
        runtimeCoordinatorExecutionId: response.runtimeCoordinatorExecutionId,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "The first accepted RuntimeCoordinator head remains authoritative; this duplicate dispatch must not create a second execution.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    console.info(
      "[core.openMeldDaemon.dispatch_queue.runtime_coordinator_head_skip]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        primaryDispatchId: response.primaryDispatchId,
        reasonCode: response.reasonCode,
        runtimeCoordinatorExecutionId: response.runtimeCoordinatorExecutionId,
        status: response.status,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      }
    );
    return { status: "skip_duplicate" };
  }
  console.info(
    "[core.openMeldDaemon.dispatch_queue.runtime_coordinator_head_accept]",
    {
      action: response.action,
      dispatchId: input.dispatchMessage.dispatchId,
      primaryDispatchId: response.primaryDispatchId,
      reasonCode: response.reasonCode,
      runtimeCoordinatorExecutionId: response.runtimeCoordinatorExecutionId,
      status: response.status,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetWakeLifecycleId: response.targetWakeLifecycleId,
    }
  );
  return {
    ...(response.acceptedDispatchSnapshot
      ? { acceptedDispatchSnapshot: response.acceptedDispatchSnapshot }
      : {}),
    ...("executionContext" in response && response.executionContext
      ? { executionContext: response.executionContext }
      : {}),
    status: "proceed",
  };
};
const handlePreflightNoExecutionWithRuntimeCoordinatorHeadIfNeeded =
  async (input: {
    db: PostgresDatabase;
    dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
    env: CoreBindings;
    executionAttemptId: string;
    message: QueueBatchMessage;
    nowMs: number;
    preflightCheck: Extract<
      Awaited<ReturnType<typeof runDispatchExecutionPreflightGate>>,
      {
        ok: false;
      }
    >;
    queueAttempt: number;
  }): Promise<{
    handled: boolean;
    shouldAck: boolean;
  }> => {
    const noExecutionDecision =
      resolveRuntimeCoordinatorHeadNoExecutionDecision(input.preflightCheck);
    if (!noExecutionDecision) {
      return { handled: false, shouldAck: true };
    }
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: input.dispatchMessage.sourceClientMessageId ?? null,
      dispatchId: input.dispatchMessage.dispatchId,
      sourceSignalId: input.dispatchMessage.sourceEventId,
      spaceId: input.dispatchMessage.spaceId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    });
    const requiresExistingHead =
      input.preflightCheck.canonicalAdmissionBlock === true;
    if (requiresExistingHead) {
      const admissionBlockOutcome =
        await resolveFreshAdmissionReadinessBlockOutcome({
          db: input.db,
          dispatchMessage: input.dispatchMessage,
          env: input.env,
          executionAttemptId: input.executionAttemptId,
          message: input.message,
          noExecutionDecision,
          nowMs: input.nowMs,
          preflightCheck: input.preflightCheck,
          queueAttempt: input.queueAttempt,
          targetWakeLifecycleIdentity,
        });
      if (admissionBlockOutcome) {
        return admissionBlockOutcome;
      }
    }
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      errorCode: "runtime_coordinator.head_no_execution_pending",
      errorMessage:
        "RuntimeCoordinator no-execution decision is pending before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    if (!requiresExistingHead) {
      const headAcceptance =
        await acceptRuntimeCoordinatorHeadBeforeFreshExecution({
          allowPublicationIntentReconcile: true,
          db: input.db,
          dispatchMessage: input.dispatchMessage,
          env: input.env,
          executionAttemptId: input.executionAttemptId,
          nowMs: input.nowMs,
          targetOwnerUserId: noExecutionDecision.ownerUserId,
        });
      if (headAcceptance.status === "retry") {
        retryQueueMessageWithBackoff(
          input.message,
          input.queueAttempt,
          headAcceptance.reasonCode
        );
        return { handled: true, shouldAck: false };
      }
      if (headAcceptance.status === "profile_queue_waiting") {
        return { handled: true, shouldAck: true };
      }
      if (isAcceptedPayloadConflictSettlementReady(headAcceptance)) {
        return { handled: true, shouldAck: true };
      }
      if (
        headAcceptance.status === "queue_full" ||
        headAcceptance.status === "recovery_needs_attention" ||
        headAcceptance.status === "context_rejected"
      ) {
        return {
          handled: true,
          shouldAck: await settleVisiblePreHeadFailure({
            db: input.db,
            dispatchMessage: input.dispatchMessage,
            env: input.env,
            errorCode: headAcceptance.reasonCode,
            errorMessage: headAcceptance.errorMessage,
            executionAttemptId: input.executionAttemptId,
            finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
            message: input.message,
            nowMs: input.nowMs,
          }),
        };
      }
      if (headAcceptance.status === "skip_duplicate") {
        return { handled: true, shouldAck: true };
      }
    }
    const response =
      await recordRuntimeTransportRuntimeCoordinatorHeadNoExecution({
        env: input.env,
        ownerUserId: noExecutionDecision.ownerUserId,
        noExecution: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          dispatchId: input.dispatchMessage.dispatchId,
          idempotencyKey: input.dispatchMessage.idempotencyKey,
          ownerUserId: noExecutionDecision.ownerUserId,
          publicationCategory: noExecutionDecision.publicationCategory,
          reasonCode: noExecutionDecision.reasonCode,
          targetWakeLifecycleIdentity,
          userRecoveryAction: noExecutionDecision.userRecoveryAction,
        },
      });
    if (!response.ok && response.status === "retry_later") {
      await markDispatchStatus({
        attemptId: input.executionAttemptId,
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
        db: input.db,
        errorCode: response.reasonCode,
        errorMessage:
          "RuntimeCoordinator head no-execution decision returned retry_later before execution creation",
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        nowMs: input.nowMs,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      });
      await writeOpenMeldDaemonOpsDecision({
        db: input.db,
        decisionCode: "runtime_coordinator.head_no_execution_retry_later",
        decisionPayload: {
          dispatchId: input.dispatchMessage.dispatchId,
          noExecutionReasonCode: noExecutionDecision.reasonCode,
          reasonCode: response.reasonCode,
          targetProfileId: input.dispatchMessage.targetProfileId,
          targetWakeLifecycleId:
            targetWakeLifecycleIdentity.targetWakeLifecycleId,
        },
        decidedBy: "core.dispatch_queue.runtime_coordinator_head",
        decidedAtMs: input.nowMs,
        expectedRecoveryCriteria:
          "RuntimeCoordinator head no-execution decision must be durable before Queue can stop retrying this target Wake.",
        source: "dispatch_queue",
        correlationId: input.dispatchMessage.dispatchId,
      });
      retryQueueMessageWithBackoff(
        input.message,
        input.queueAttempt,
        response.reasonCode
      );
      return { handled: true, shouldAck: false };
    }
    if (!response.ok) {
      await markDispatchStatus({
        attemptId: input.executionAttemptId,
        attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
        db: input.db,
        errorCode: response.reasonCode,
        errorMessage:
          "RuntimeCoordinator head no-execution decision conflicted before execution creation",
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        nowMs: input.nowMs,
        status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      });
      return { handled: true, shouldAck: true };
    }
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode:
        "runtime_coordinator.head_no_execution_publication_intent_ready",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        publicationCategory: noExecutionDecision.publicationCategory,
        publicationIntentId: response.publicationIntentId,
        reasonCode: noExecutionDecision.reasonCode,
        status: response.status,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
        userRecoveryAction: noExecutionDecision.userRecoveryAction,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "Phase 6 publication pipeline publishes the prepared no-execution failure notice; Phase 5 must not claim final Space visibility.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
      db: input.db,
      errorCode: noExecutionDecision.reasonCode,
      errorMessage:
        "RuntimeCoordinator no-execution publication intent is ready before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    });
    console.info(
      "[core.openMeldDaemon.dispatch_queue.runtime_coordinator_no_execution]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        publicationCategory: noExecutionDecision.publicationCategory,
        publicationIntentId: response.publicationIntentId,
        reasonCode: noExecutionDecision.reasonCode,
        status: response.status,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      }
    );
    return { handled: true, shouldAck: true };
  };
const resolveFreshAdmissionReadinessBlockOutcome = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  message: QueueBatchMessage;
  noExecutionDecision: NonNullable<
    ReturnType<typeof resolveRuntimeCoordinatorHeadNoExecutionDecision>
  >;
  nowMs: number;
  preflightCheck: Extract<
    Awaited<ReturnType<typeof runDispatchExecutionPreflightGate>>,
    {
      ok: false;
    }
  >;
  queueAttempt: number;
  targetWakeLifecycleIdentity: ReturnType<
    typeof projectTargetWakeLifecycleIdentity
  >;
}): Promise<{
  handled: boolean;
  shouldAck: boolean;
} | null> => {
  const trace = await readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace({
    env: input.env,
    ownerUserId: input.noExecutionDecision.ownerUserId,
    request: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      targetWakeLifecycleIdentity: input.targetWakeLifecycleIdentity,
    },
  }).catch((error) => {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.admission_block_head_read_failed]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(error),
        reasonCode: input.noExecutionDecision.reasonCode,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId:
          input.targetWakeLifecycleIdentity.targetWakeLifecycleId,
      }
    );
    return null;
  });
  if (!trace?.ok) {
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      trace?.reasonCode ??
        "runtime_coordinator.head_lifecycle_trace_unavailable"
    );
    return { handled: true, shouldAck: false };
  }
  if (trace.readStatus === "missing") {
    return {
      handled: true,
      shouldAck: await settleVisiblePreHeadFailure({
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        env: input.env,
        errorCode: input.preflightCheck.errorCode,
        errorMessage: input.preflightCheck.errorMessage,
        executionAttemptId: input.executionAttemptId,
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        message: input.message,
        nowMs: input.nowMs,
      }),
    };
  }
  if (trace.lifecycle.primaryDispatchId !== input.dispatchMessage.dispatchId) {
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      "runtime_coordinator.head_no_execution_authority_conflict"
    );
    return { handled: true, shouldAck: false };
  }
  return null;
};
const resolveRuntimeCoordinatorHeadNoExecutionDecision = (
  preflightCheck: Extract<
    Awaited<ReturnType<typeof runDispatchExecutionPreflightGate>>,
    {
      ok: false;
    }
  >
):
  | ({
      ownerUserId: string;
    } & NonNullable<
      ReturnType<typeof resolveAgentWakeAdmissionTerminalDecision>
    >)
  | null => {
  const ownerUserId = normalizeOptionalText(preflightCheck.targetOwnerUserId);
  if (!ownerUserId) {
    return null;
  }
  if (
    preflightCheck.canonicalAdmissionBlock !== true &&
    !legacyPreflightHeadNoExecutionReasonCodes.has(preflightCheck.errorCode)
  ) {
    return null;
  }
  const decision = resolveAgentWakeAdmissionTerminalDecision(
    preflightCheck.errorCode
  );
  return decision ? { ...decision, ownerUserId } : null;
};
const legacyPreflightHeadNoExecutionReasonCodes = new Set([
  "agent_profile_binding.missing",
  "agent_profile_binding.disabled",
  "agent_profile_binding.owner_mismatch",
  "organization_binding_authorization.required",
]);
const handleHostedFinalOutcomeClaimBeforeDeliveryIfNeeded = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  nowMs: number;
}): Promise<{
  handled: boolean;
}> => {
  const claim = await readSpaceFinalOutcomeClaim({
    dispatchId: input.dispatchMessage.dispatchId,
    env: input.env,
    spaceId: input.dispatchMessage.spaceId,
    targetProfileId: input.dispatchMessage.targetProfileId,
  }).catch((error) => {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.hosted_final_outcome_claim_read_failed]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(error),
        targetProfileId: input.dispatchMessage.targetProfileId,
      }
    );
    return null;
  });
  if (!claim) {
    return { handled: false };
  }
  const stopped = claim.outcome === "stopped";
  const reasonCode = stopped
    ? "space.wake_stopped_before_native_delivery"
    : "space.final_outcome_already_claimed";
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
    db: input.db,
    errorCode: reasonCode,
    errorMessage: stopped
      ? "Space stopped this Wake before hosted native delivery"
      : "Space already has the authoritative final outcome",
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.nowMs,
    status: stopped
      ? OPENMELD_DAEMON_DISPATCH_STATE.cancelled
      : OPENMELD_DAEMON_DISPATCH_STATE.deduped,
  });
  await writeOpenMeldDaemonOpsDecision({
    correlationId: input.dispatchMessage.dispatchId,
    db: input.db,
    decidedAtMs: input.nowMs,
    decidedBy: "core.dispatch_queue.space_final_outcome_claim",
    decisionCode: "remote_agent.native_delivery_final_outcome_claim_blocked",
    decisionPayload: {
      dispatchId: input.dispatchMessage.dispatchId,
      finalOutcome: claim.outcome,
      reasonCode,
      signalId: claim.signalId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    },
    expectedRecoveryCriteria:
      "Space final-outcome claim is authoritative; hosted native delivery must not start a second execution.",
    source: "dispatch_queue",
  });
  console.info(
    "[core.openMeldDaemon.dispatch_queue.hosted_final_outcome_claim_blocked]",
    {
      dispatchId: input.dispatchMessage.dispatchId,
      finalOutcome: claim.outcome,
      signalId: claim.signalId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    }
  );
  return { handled: true };
};
const handleHostedCenterAgentNativeDelivery = async (input: {
  ctx: DispatchQueueWaitContext;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  message: QueueBatchMessage;
  nowMs: number;
  queueAttempt: number;
  snapshot: EffectiveTargetBindingSnapshot;
  targetOwnerUserId: string | null;
  timing: SpaceBootstrapTimingCollector;
}): Promise<DispatchQueueMessageExecutionResult> => {
  const { bindingId, modelRoute, organizationId } = input.snapshot;
  if (
    !(
      bindingId &&
      organizationId &&
      isHostedAgentRuntimeKind(input.snapshot.runtimeKind) &&
      input.snapshot.hostedRuntimeIdentity &&
      modelRoute
    )
  ) {
    throw new DispatchExecutionValidationError({
      code: "remote_agent.hosted_binding_invalid",
      executionContext: {
        attemptId: input.executionAttemptId,
        connectionGeneration: null,
        daemonSessionId: AUDIT_UNKNOWN_DAEMON_SESSION_ID,
        leaseEpoch: AUDIT_UNKNOWN_LEASE_EPOCH,
        replyingHintActive: false,
      },
      message:
        "hosted Center Agent Binding is missing native delivery identity",
    });
  }
  const finalOutcomeClaimed = await input.timing.measure(
    {
      description:
        "Check exact-target Space final-outcome authority before hosted admission",
      name: "openmeld_dispatch_hosted_final_outcome_claim",
    },
    () =>
      handleHostedFinalOutcomeClaimBeforeDeliveryIfNeeded({
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        env: input.env,
        executionAttemptId: input.executionAttemptId,
        nowMs: input.nowMs,
      })
  );
  if (finalOutcomeClaimed.handled) {
    return {
      controllerWaitPromise: null,
      shouldAck: true,
    };
  }
  let nativeDelivery: Awaited<
    ReturnType<typeof submitRemoteAgentNativeDelivery>
  >;
  try {
    nativeDelivery = await input.timing.measure(
      {
        description: "Prepare and admit the hosted Center Agent turn",
        name: "openmeld_dispatch_hosted_native_delivery",
      },
      () =>
        submitRemoteAgentNativeDelivery({
          binding: {
            bindingId,
            personalAgent: input.snapshot.runtimeKind === "hosted_remote_agent",
            controllerNormalization: input.snapshot.controllerNormalization,
            modelRoute,
            organizationId,
            ownerUserId: input.targetOwnerUserId,
          },
          db: input.db,
          env: input.env,
          executionAttemptId: input.executionAttemptId,
          message: input.dispatchMessage,
          nowMs: input.nowMs,
          timing: input.timing,
        })
    );
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    throw new HostedNativeDeliverySubmissionError({
      cause: error,
      code:
        resolveDispatchErrorCode(error, errorMessage) ??
        "remote_agent.native_delivery_submission_failed",
      message: errorMessage,
    });
  }
  if (nativeDelivery.status === "stopped") {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
      db: input.db,
      errorCode: "remote_agent.native_delivery_stopped",
      errorMessage: "Hosted native delivery was stopped before admission",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.cancelled,
    });
    return {
      controllerWaitPromise: null,
      shouldAck: nativeDelivery.shouldAck,
    };
  }
  // An ambiguous RPC or an unpersisted admission ACK must remain dispatching.
  // The Space outbox resumes that exact attempt through hosted recovery;
  // waiting_result would make its claim look like an already running Wake.
  if (nativeDelivery.status === "submitted" && nativeDelivery.shouldAck) {
    await input.timing.measure(
      {
        description: "Persist that hosted admission is waiting for a result",
        name: "openmeld_dispatch_hosted_waiting",
      },
      () =>
        markDispatchAttemptWaitingForResult({
          attemptId: input.executionAttemptId,
          db: input.db,
          idempotencyKey: input.dispatchMessage.idempotencyKey,
          nowMs: Date.now(),
          targetProfileId: input.dispatchMessage.targetProfileId,
          taskId: input.dispatchMessage.taskId,
        })
    );
    input.ctx.waitUntil(
      emitHostedCenterAgentNativeDeliveryReplyingHint({
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        env: input.env,
      })
    );
  }
  if (!nativeDelivery.shouldAck) {
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      REMOTE_AGENT_NATIVE_DELIVERY_RETRY_REASON_CODE
    );
  }
  return {
    controllerWaitPromise: null,
    shouldAck: nativeDelivery.shouldAck,
  };
};
const emitHostedCenterAgentNativeDeliveryReplyingHint = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
}): Promise<void> => {
  try {
    const replyingHintEmissionState = await emitDispatchReplyingHintSignal({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      localStateDb: null,
      targetProfileName:
        normalizeOptionalText(
          input.dispatchMessage.targetProfileNameSnapshot
        ) ?? null,
    });
    console.info(
      "[core.openMeldDaemon.dispatch_queue.hosted_native_delivery_replying_hint]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        event: CORE_LOG_EVENTS.dispatchQueueHostedNativeDeliveryReplyingHint,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        replyingHintEmissionState,
        targetProfileId: input.dispatchMessage.targetProfileId,
      }
    );
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.hosted_native_delivery_replying_hint]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(error),
        event: CORE_LOG_EVENTS.dispatchQueueHostedNativeDeliveryReplyingHint,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        replyingHintEmissionState: "unexpected_failure",
        targetProfileId: input.dispatchMessage.targetProfileId,
      }
    );
  }
};
const buildHostedNativeDeliverySystemFailureText = (
  targetProfileName: string | null | undefined
): string => {
  const targetName = normalizeOptionalText(targetProfileName) ?? "Center Agent";
  return `OpenMeld ran into a system problem before ${targetName} could reply. Try again. If it keeps happening, open diagnostics.`;
};
function logDispatchQueueBindingSource(input: {
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  preflightCheck: DispatchExecutionPreflightResult;
}): void {
  if (input.preflightCheck.ok) {
    console.info("[core.openMeldDaemon.dispatch_queue.binding_source]", {
      event: CORE_LOG_EVENTS.dispatchQueueBindingSource,
      dispatchId: input.dispatchMessage.dispatchId,
      targetProfileId: input.dispatchMessage.targetProfileId,
      source: input.preflightCheck.bindingSource,
      status: "resolved",
    });
    return;
  }
  if (!input.preflightCheck.bindingSource) {
    return;
  }
  console.warn("[core.openMeldDaemon.dispatch_queue.binding_source]", {
    event: CORE_LOG_EVENTS.dispatchQueueBindingSource,
    dispatchId: input.dispatchMessage.dispatchId,
    targetProfileId: input.dispatchMessage.targetProfileId,
    source: input.preflightCheck.bindingSource,
    status: "failed",
    errorCode: input.preflightCheck.errorCode,
    errorMessage: input.preflightCheck.errorMessage,
  });
}
const handleDedupedDispatchClaim = async (input: {
  claimState: Extract<
    Awaited<ReturnType<typeof claimDispatchAttempt>>,
    {
      status: "deduped";
    }
  >;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  human: ReturnType<typeof buildDispatchHumanLogContext>;
  message: QueueBatchMessage;
  queueAttempt: number;
}): Promise<DispatchQueueMessageExecutionResult> => {
  if (input.claimState.admissionInFlight) {
    retryQueueMessage(input.message, { delaySeconds: 1 });
    return { controllerWaitPromise: null, shouldAck: false };
  }
  if (input.claimState.runtimeCoordinatorDecisionRequest) {
    const coordinatorDecision = await triggerRuntimeCoordinatorQueueDecision({
      claimState: input.claimState,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      message: input.message,
      queueAttempt: input.queueAttempt,
    });
    if (!coordinatorDecision.shouldAck) {
      return {
        controllerWaitPromise: null,
        shouldAck: false,
      };
    }
  }
  console.info("[core.openMeldDaemon.dispatch_queue.claim_deduped]", {
    dispatchId: input.dispatchMessage.dispatchId,
    deliveryRecoveryReason:
      input.dispatchMessage.deliveryRecoveryReason ?? null,
    human: input.human,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    queueAttempt: input.queueAttempt,
    sourceEventId: input.dispatchMessage.sourceEventId,
    targetProfileId: input.dispatchMessage.targetProfileId,
    taskId: input.dispatchMessage.taskId,
  });
  return {
    controllerWaitPromise: null,
    shouldAck: true,
  };
};
// Deletion cannot resolve a live binding owner. Use the Core-recorded owner
// only to address the existing cancellation authority, never to run work.
const stopDeletedProfileRedelivery = async (input: {
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  message: QueueBatchMessage;
  ownerUserId: string;
  queueAttempt: number;
}): Promise<{
  shouldAck: boolean;
}> => {
  const dispatch = input.dispatchMessage;
  const stopped =
    await recordRuntimeTransportRuntimeCoordinatorHeadPreAgentStop({
      env: input.env,
      ownerUserId: input.ownerUserId,
      preAgentStop: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: input.ownerUserId,
        dispatchId: dispatch.dispatchId,
        idempotencyKey: dispatch.idempotencyKey,
        reason: DELETED_AGENT_PROFILE_WAKE_STOP_REASON,
        targetProfileName: dispatch.targetProfileNameSnapshot ?? undefined,
        targetProfileMentionLabel: dispatch.targetProfileMentionLabel,
        targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
          clientMessageId: dispatch.sourceClientMessageId ?? null,
          dispatchId: dispatch.dispatchId,
          sourceSignalId: dispatch.sourceEventId,
          spaceId: dispatch.spaceId,
          targetProfileId: dispatch.targetProfileId,
        }),
      },
    });
  if (
    stopped.ok ||
    stopped.reasonCode ===
      "runtime_coordinator.pre_agent_stop_after_publication_intent"
  ) {
    return { shouldAck: true };
  }
  if (
    stopped.status === "execution_linked" &&
    stopped.runtimeCoordinatorExecutionId
  ) {
    const cancellation =
      await requestRuntimeTransportRuntimeCoordinatorWakeStop({
        env: input.env,
        ownerUserId: input.ownerUserId,
        wakeStop: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: input.ownerUserId,
          runtimeCoordinatorExecutionId: stopped.runtimeCoordinatorExecutionId,
          dispatchId: stopped.primaryDispatchId ?? dispatch.dispatchId,
          spaceId: dispatch.spaceId,
          sourceClientMessageId: dispatch.sourceClientMessageId ?? null,
          targetProfileId: dispatch.targetProfileId,
          reason: DELETED_AGENT_PROFILE_WAKE_STOP_REASON,
        },
      });
    if (cancellation.ok || cancellation.status === "not_stoppable") {
      return { shouldAck: true };
    }
  }
  retryQueueMessageWithBackoff(
    input.message,
    input.queueAttempt,
    stopped.reasonCode
  );
  return { shouldAck: false };
};
const triggerRuntimeCoordinatorQueueDecision = async (input: {
  claimState: Extract<
    Awaited<ReturnType<typeof claimDispatchAttempt>>,
    {
      status: "deduped";
    }
  >;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  message: QueueBatchMessage;
  queueAttempt: number;
}): Promise<{
  shouldAck: boolean;
}> => {
  const decisionRequest = input.claimState.runtimeCoordinatorDecisionRequest;
  if (!decisionRequest) {
    return { shouldAck: true };
  }
  const preflightCheck = await runDispatchExecutionPreflightGate({
    env: input.env,
    message: input.dispatchMessage,
  }).catch(() => null);
  if (
    preflightCheck?.ok === false &&
    preflightCheck.targetProfileIdentityVerdict === "not_found" &&
    decisionRequest.ownerUserId
  ) {
    return await stopDeletedProfileRedelivery({
      ...input,
      ownerUserId: decisionRequest.ownerUserId,
    });
  }
  const ownerUserId = normalizeOptionalText(
    preflightCheck?.ok
      ? preflightCheck.effectiveTargetBindingSnapshot.ownerUserId
      : null
  );
  if (!ownerUserId) {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.queue_decision_owner_unavailable",
      decisionPayload: {
        claimDecision: decisionRequest.claimDecision,
        dispatchId: input.dispatchMessage.dispatchId,
        eventKind: decisionRequest.eventKind,
        reasonCode: "runtime_coordinator.owner_unavailable_for_decision",
        runtimeCoordinatorExecutionId:
          decisionRequest.runtimeCoordinatorExecutionId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      },
      decidedBy: "core.dispatch.queue.runtime_coordinator",
      decidedAtMs: Date.now(),
      expectedRecoveryCriteria:
        "RuntimeCoordinator decision requires the Core-owned target owner; queue does not decide retry itself",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      "runtime_coordinator.owner_unavailable_for_decision"
    );
    return { shouldAck: false };
  }
  const response = await decideRuntimeTransportRuntimeCoordinatorExecution({
    env: input.env,
    ownerUserId,
    decision: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      attemptId: null,
      claimDecision: decisionRequest.claimDecision,
      dispatchId: input.dispatchMessage.dispatchId,
      eventKind: decisionRequest.eventKind,
      idempotencyKey: `queue:${input.dispatchMessage.idempotencyKey}:${decisionRequest.eventKind}:${decisionRequest.claimDecision}`,
      reasonCode: decisionRequest.reasonCode,
      runtimeCoordinatorExecutionId:
        decisionRequest.runtimeCoordinatorExecutionId,
      sourceClientMessageId:
        input.dispatchMessage.sourceClientMessageId ?? null,
      spaceId: input.dispatchMessage.spaceId,
      targetProfileId: input.dispatchMessage.targetProfileId,
      trigger: "queue",
    },
  });
  if (!response.ok) {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.queue_decision_retry_later",
      decisionPayload: {
        claimDecision: decisionRequest.claimDecision,
        dispatchId: input.dispatchMessage.dispatchId,
        eventKind: decisionRequest.eventKind,
        reasonCode: response.reasonCode,
        runtimeCoordinatorExecutionId: response.runtimeCoordinatorExecutionId,
        status: response.status,
        targetProfileId: input.dispatchMessage.targetProfileId,
      },
      decidedBy: "core.dispatch.queue.runtime_coordinator",
      decidedAtMs: Date.now(),
      expectedRecoveryCriteria:
        "RuntimeCoordinator returned retry_later; queue keeps the message pending for a later RuntimeCoordinator decision",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      response.reasonCode
    );
    return { shouldAck: false };
  }
  console.info(
    "[core.openMeldDaemon.dispatch_queue.runtime_coordinator_decision]",
    {
      action: response.action,
      claimDecision: decisionRequest.claimDecision,
      dispatchId: input.dispatchMessage.dispatchId,
      eventKind: decisionRequest.eventKind,
      reasonCode: response.reasonCode,
      runtimeCoordinatorExecutionId: response.runtimeCoordinatorExecutionId,
      status: response.status,
      targetProfileId: input.dispatchMessage.targetProfileId,
    }
  );
  return { shouldAck: true };
};
const beginFreshDispatchDeliveryPhase = async (input: {
  acceptedDispatchSnapshot?: OpenMeldDaemonAcceptedDispatchSnapshot;
  controllerKey: string;
  ctx: DispatchQueueWaitContext;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionAttemptId: string;
  executionAttemptNo: number;
  nowMs: number;
  targetOwnerUserId: string;
  timing?: SpaceBootstrapTimingCollector;
}): Promise<DispatchQueueMessageExecutionResult> => {
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
    nowMs: input.nowMs,
  });
  console.info("[core.openMeldDaemon.dispatch_queue.execute_dispatch]", {
    attemptId: input.executionAttemptId,
    connectionGeneration: null,
    daemonSessionId: null,
    deliveryRecoveryReason:
      input.dispatchMessage.deliveryRecoveryReason ?? null,
    dispatchId: input.dispatchMessage.dispatchId,
    leaseEpoch: null,
    targetProfileId: input.dispatchMessage.targetProfileId,
    taskId: input.dispatchMessage.taskId,
  });
  const delivered = await deliverDispatchMessageToDaemon({
    acceptedDispatchSnapshot: input.acceptedDispatchSnapshot,
    attemptId: input.executionAttemptId,
    db: input.db,
    env: input.env,
    message: input.dispatchMessage,
    targetOwnerUserId: input.targetOwnerUserId,
    timing: input.timing,
  });
  const effectiveExecutionAttemptId =
    delivered.deliveryStatus === "delivered"
      ? input.executionAttemptId
      : delivered.correlatedAttemptId;
  if (delivered.deliveryStatus !== "delivered") {
    let duplicateCorrelationAuditStatus: "record_failed" | "recorded" =
      "recorded";
    try {
      await correlateDuplicateDispatchDeliveryAttempt({
        correlatedAttemptId: delivered.correlatedAttemptId,
        connectionGeneration:
          delivered.executionContext.connectionGeneration ?? 1,
        daemonSessionId: delivered.executionContext.daemonSessionId,
        db: input.db,
        duplicateAttemptId: input.executionAttemptId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        leaseEpoch: delivered.executionContext.leaseEpoch,
        nowMs: Date.now(),
        reason: delivered.deliveryStatus,
      });
    } catch (error) {
      duplicateCorrelationAuditStatus = "record_failed";
      console.warn(
        "[core.openMeldDaemon.dispatch_queue.duplicate_delivery_correlation_audit_record_failed]",
        {
          correlatedAttemptId: delivered.correlatedAttemptId,
          deliveryStatus: delivered.deliveryStatus,
          dispatchId: input.dispatchMessage.dispatchId,
          duplicateAttemptId: input.executionAttemptId,
          error: toErrorMessage(error),
          outcome: "existing_runtime_coordinator_attempt_remains_authoritative",
          targetProfileId: input.dispatchMessage.targetProfileId,
          taskId: input.dispatchMessage.taskId,
        }
      );
    }
    console.info(
      "[core.openMeldDaemon.dispatch_queue.duplicate_delivery_reused_existing_execution]",
      {
        correlatedAttemptId: delivered.correlatedAttemptId,
        correlationAuditStatus: duplicateCorrelationAuditStatus,
        deliveryStatus: delivered.deliveryStatus,
        dispatchId: input.dispatchMessage.dispatchId,
        duplicateAttemptId: input.executionAttemptId,
        targetProfileId: input.dispatchMessage.targetProfileId,
        taskId: input.dispatchMessage.taskId,
      }
    );
  }
  if (delivered.deliveryStatus !== "already_completed") {
    try {
      await markDispatchAttemptWaitingForResult({
        attemptId: effectiveExecutionAttemptId,
        connectionGeneration:
          delivered.executionContext.connectionGeneration ?? 1,
        daemonSessionId: delivered.executionContext.daemonSessionId,
        db: input.db,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        leaseEpoch: delivered.executionContext.leaseEpoch,
        nowMs: Date.now(),
        targetProfileId: input.dispatchMessage.targetProfileId,
        taskId: input.dispatchMessage.taskId,
      });
    } catch (error) {
      const markError =
        error instanceof Error
          ? (error as Error)
          : new Error(toErrorMessage(error));
      const enrichedMarkError = markError as Error & {
        executionContext: DispatchExecutionContext;
        deliveredExecutionContext: DispatchExecutionContext;
        attemptId: string;
        executionAttemptId: string;
        idempotencyKey: string;
      };
      enrichedMarkError.executionContext = delivered.executionContext;
      enrichedMarkError.deliveredExecutionContext = delivered.executionContext;
      enrichedMarkError.attemptId = effectiveExecutionAttemptId;
      enrichedMarkError.executionAttemptId = input.executionAttemptId;
      enrichedMarkError.idempotencyKey = input.dispatchMessage.idempotencyKey;
      throw enrichedMarkError;
    }
  }
  console.info(
    "[core.openMeldDaemon.dispatch_queue.delivery_phase_completed]",
    {
      attemptId: effectiveExecutionAttemptId,
      connectionGeneration: delivered.executionContext.connectionGeneration,
      agentControllerRef: normalizeOptionalText(
        input.dispatchMessage.controllerSnapshot.agentControllerRef
      ),
      controllerKey: input.controllerKey,
      daemonSessionId: delivered.executionContext.daemonSessionId,
      deliveryStatus: delivered.deliveryStatus,
      dispatchId: input.dispatchMessage.dispatchId,
      leaseEpoch: delivered.executionContext.leaseEpoch,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetProfileName: delivered.targetProfileName,
      taskId: input.dispatchMessage.taskId,
    }
  );
  const controllerWaitPromise = scheduleOffloadedWaitPhase(
    {
      agentControllerRef: normalizeOptionalText(
        input.dispatchMessage.controllerSnapshot.agentControllerRef
      ),
      controllerKey: input.controllerKey,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionAttemptId: effectiveExecutionAttemptId,
      executionAttemptNo: input.executionAttemptNo,
      executionContext: delivered.executionContext,
      targetOwnerUserId: input.targetOwnerUserId,
      profileHandle: delivered.profileHandle,
      targetProfileName: delivered.targetProfileName,
      targetProfileMentionLabel: delivered.targetProfileMentionLabel,
      waitPhaseMode: "started",
    },
    input.ctx
  );
  return {
    controllerWaitPromise,
    shouldAck: true,
  };
};
const scheduleOffloadedWaitPhase = (
  input: OffloadedWaitPhaseInput,
  ctx: DispatchQueueWaitContext
): Promise<void> => {
  const targetLabel = resolveDispatchTargetLabel({
    dispatchMessage: input.dispatchMessage,
    targetProfileName: input.targetProfileName,
    targetProfileMentionLabel: input.targetProfileMentionLabel,
  });
  console.info(
    `[core.openMeldDaemon.dispatch_queue.offloaded_wait_phase_${input.waitPhaseMode}]`,
    {
      attemptId: input.executionAttemptId,
      connectionGeneration: input.executionContext.connectionGeneration,
      agentControllerRef: input.agentControllerRef,
      controllerKey: input.controllerKey,
      daemonSessionId: input.executionContext.daemonSessionId,
      dispatchId: input.dispatchMessage.dispatchId,
      leaseEpoch: input.executionContext.leaseEpoch,
      targetLabel,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetProfileName: input.targetProfileName,
      taskId: input.dispatchMessage.taskId,
    }
  );
  const offloadedWaitPromise = runOffloadedWaitPhase(input).catch(
    async (error) => {
      const nowMs = Date.now();
      await persistOffloadedWaitFailure({
        db: input.db,
        executionAttemptId: input.executionAttemptId,
        executionAttemptNo: input.executionAttemptNo,
        agentControllerRef: input.agentControllerRef,
        controllerKey: input.controllerKey,
        dispatchMessage: input.dispatchMessage,
        error,
        nowMs,
      });
      throw error;
    }
  );
  ctx.waitUntil(offloadedWaitPromise);
  return offloadedWaitPromise;
};
const persistOffloadedWaitFailure = async (input: {
  db: PostgresDatabase;
  executionAttemptId: string;
  executionAttemptNo: number;
  agentControllerRef: string | null;
  controllerKey: string;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  error: unknown;
  nowMs: number;
}): Promise<void> => {
  const errorMessage = toErrorMessage(input.error);
  const errorCode =
    resolveDispatchErrorCode(input.error, errorMessage) ||
    OFFLOADED_WAIT_PHASE_CRASHED_ERROR_CODE;
  const recoveryWrites = await Promise.allSettled([
    markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      errorCode,
      errorMessage,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.nowMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    }),
    writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: OFFLOADED_WAIT_PHASE_CRASHED_DECISION_CODE,
      decisionPayload: {
        executionAttemptId: input.executionAttemptId,
        executionAttemptNo: input.executionAttemptNo,
        agentControllerRef: input.agentControllerRef,
        controllerKey: input.controllerKey,
        dispatchId: input.dispatchMessage.dispatchId,
        targetProfileId: input.dispatchMessage.targetProfileId,
        taskId: input.dispatchMessage.taskId,
        error: errorMessage,
        errorCode,
      },
      decidedBy: OFFLOADED_WAIT_PHASE_CRASHED_DECIDED_BY,
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "mark the attempt failed_retryable so the outbox watchdog can redrive after the crash",
      source: "dispatch_queue_consumer",
      correlationId: input.dispatchMessage.dispatchId,
    }),
  ]);
  for (const writeResult of recoveryWrites) {
    if (writeResult.status === "fulfilled") {
      continue;
    }
    console.error(
      "[core.openMeldDaemon.dispatch_queue.offloaded_wait_phase_crashed]",
      {
        attemptId: input.executionAttemptId,
        attemptNo: input.executionAttemptNo,
        agentControllerRef: input.agentControllerRef,
        controllerKey: input.controllerKey,
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(writeResult.reason),
        originalError: errorMessage,
        targetProfileId: input.dispatchMessage.targetProfileId,
        taskId: input.dispatchMessage.taskId,
      }
    );
  }
};
const runOffloadedWaitPhase = async (
  input: OffloadedWaitPhaseInput
): Promise<void> => {
  let executionContext = input.executionContext;
  try {
    const waitPhaseOutcome = await continueDispatchMessageAttempt({
      attemptId: input.executionAttemptId,
      connectionGeneration: executionContext.connectionGeneration ?? 1,
      db: input.db,
      daemonSessionId: executionContext.daemonSessionId,
      env: input.env,
      leaseEpoch: executionContext.leaseEpoch,
      message: input.dispatchMessage,
      replyingHintActive: executionContext.replyingHintActive,
      targetOwnerUserId: input.targetOwnerUserId,
      profileHandle: input.profileHandle,
      targetProfileName: input.targetProfileName,
      targetProfileMentionLabel: input.targetProfileMentionLabel,
    });
    executionContext = waitPhaseOutcome.executionContext;
    if (!waitPhaseOutcome.finalizationHandledByRuntimeCoordinator) {
      const settledAtMs = Date.now();
      await markDispatchStatus({
        attemptId: input.executionAttemptId,
        db: input.db,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        status: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
        nowMs: settledAtMs,
      });
    }
    executionContext = await finalizeReplyingHintLifecycle({
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionContext,
      targetProfileName: input.targetProfileName,
      transition: waitPhaseOutcome.replyingHintTransitionHint ?? "preserve",
    });
    console.info("[core.openMeldDaemon.dispatch_queue.wait_phase_completed]", {
      attemptId: input.executionAttemptId,
      connectionGeneration: executionContext.connectionGeneration,
      agentControllerRef: input.agentControllerRef,
      controllerKey: input.controllerKey,
      daemonSessionId: executionContext.daemonSessionId,
      dispatchId: input.dispatchMessage.dispatchId,
      leaseEpoch: executionContext.leaseEpoch,
      result: "succeeded",
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetProfileName: input.targetProfileName,
      taskId: input.dispatchMessage.taskId,
    });
  } catch (error) {
    await handleOffloadedWaitPhaseFailure({
      agentControllerRef: input.agentControllerRef,
      controllerKey: input.controllerKey,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      error,
      executionAttemptId: input.executionAttemptId,
      executionAttemptNo: input.executionAttemptNo,
      executionContext,
      targetProfileName: input.targetProfileName,
    });
  }
};
const handleOffloadedWaitPhaseFailure = async (input: {
  agentControllerRef: string | null;
  controllerKey: string;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  error: unknown;
  executionAttemptId: string;
  executionAttemptNo: number;
  executionContext: DispatchExecutionContext;
  targetProfileName: string | null;
}): Promise<void> => {
  const failureAtMs = Date.now();
  const errorMessage = toErrorMessage(input.error);
  const errorCode = resolveDispatchErrorCode(input.error, errorMessage);
  const executionContext = resolveOffloadedWaitPhaseExecutionContext(
    input.error,
    input.executionContext
  );
  if (isRuntimeTaskDedupedErrorCode(errorCode)) {
    await settleRuntimeTaskDedupedCorrelationLost({
      controllerKey: input.controllerKey,
      agentControllerRef: input.agentControllerRef,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorCode,
      errorMessage,
      executionAttemptId: input.executionAttemptId,
      executionAttemptNo: input.executionAttemptNo,
      executionContext,
      nowMs: failureAtMs,
      targetProfileName: input.targetProfileName,
    });
    return;
  }
  const routeOwnershipState = await resolveRouteOwnershipStateForRetryableError(
    {
      env: input.env,
      dispatchMessage: input.dispatchMessage,
      errorCode,
      executionContext,
    }
  );
  const errorCategory = classifyDispatchError(input.error, errorMessage);
  const shouldRetry =
    (errorCategory === "retryable" &&
      shouldRetryDispatchAttemptForErrorCode({
        attempt: input.executionAttemptNo,
        errorCode,
      })) ||
    (errorCategory === "unknown" &&
      shouldRetryUnknownDispatchAttempt(input.executionAttemptNo));
  const terminalReplyAlreadySettled =
    input.error instanceof DispatchExecutionValidationError &&
    input.error.terminalReplySettled;
  const terminalReplyTransition =
    input.error instanceof DispatchExecutionValidationError
      ? input.error.replyingHintTransitionHint
      : null;
  console.warn("[core.openmeld.dispatch.failure_classified]", {
    event: "core.openmeld.dispatch.failure_classified",
    attemptId: input.executionAttemptId,
    attemptNo: input.executionAttemptNo,
    dispatchId: input.dispatchMessage.dispatchId,
    errorCategory,
    errorCode,
    shouldRetry,
    targetProfileId: input.dispatchMessage.targetProfileId,
    terminalReplyAlreadySettled,
  });
  const runtimeCoordinatorDecision =
    await decideRuntimeCoordinatorFailureForBackedExecution({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorCode,
      executionAttemptId: input.executionAttemptId,
      executionContext,
      runtimeExecutionDelivered: true,
      source: "offloaded_wait",
    });
  if (
    handleRuntimeCoordinatorOffloadedWaitDecision({
      db: input.db,
      decision: runtimeCoordinatorDecision,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorMessage,
      executionAttemptId: input.executionAttemptId,
      failureAtMs,
    })
  ) {
    return;
  }
  if (shouldRetry) {
    await settleRetryableOffloadedWaitRecovery({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorCode,
      errorMessage,
      executionAttemptId: input.executionAttemptId,
      executionAttemptNo: input.executionAttemptNo,
      executionContext,
      failureAtMs,
      routeOwnershipState,
      targetProfileName: input.targetProfileName,
    });
    await finalizeReplyingHintLifecycle({
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionContext,
      targetProfileName: input.targetProfileName,
      transition: "replace_with_activity",
    });
    return;
  }
  await writeDispatchDlq({
    db: input.db,
    errorCode,
    errorMessage,
    message: input.dispatchMessage,
    nowMs: failureAtMs,
  });
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: isDispatchAttemptTimeoutErrorCode(errorCode)
      ? OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut
      : OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode,
    errorMessage,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: failureAtMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  });
  if (!terminalReplyAlreadySettled) {
    await emitDispatchFailureActivitySignal({
      env: input.env,
      message: input.dispatchMessage,
      errorCode,
      ...(errorMessage ? { errorMessage } : {}),
    });
    await emitDispatchFailureHintSignal({
      db: input.db,
      env: input.env,
      message: input.dispatchMessage,
      errorCode,
      errorMessage,
      failureContext: "execution_terminal",
    });
  }
  await finalizeReplyingHintLifecycle({
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    executionContext,
    targetProfileName: input.targetProfileName,
    transition: terminalReplyAlreadySettled
      ? (terminalReplyTransition ?? "clear_for_terminal_reply")
      : "replace_with_activity",
  });
  console.warn("[core.openMeldDaemon.dispatch_queue.wait_phase_completed]", {
    attemptId: input.executionAttemptId,
    connectionGeneration: executionContext.connectionGeneration,
    agentControllerRef: input.agentControllerRef,
    controllerKey: input.controllerKey,
    daemonSessionId: executionContext.daemonSessionId,
    dispatchId: input.dispatchMessage.dispatchId,
    errorCode,
    leaseEpoch: executionContext.leaseEpoch,
    result: "failed_terminal",
    targetProfileId: input.dispatchMessage.targetProfileId,
    targetProfileName: input.targetProfileName,
    taskId: input.dispatchMessage.taskId,
  });
};
export type RuntimeCoordinatorFailureDecisionHandling =
  | {
      handled: false;
    }
  | {
      handled: true;
      reasonCode: string;
      status: "coordinator_handled" | "diagnostic_only" | "retry_later";
    };
export const classifyRuntimeCoordinatorQueueDecisionResponse = (
  response: RuntimeTransportRuntimeCoordinatorDecisionResponse
): RuntimeCoordinatorFailureDecisionHandling => {
  if (!response.ok) {
    return {
      handled: true,
      reasonCode: response.reasonCode,
      status: "retry_later",
    };
  }
  if (response.action === "diagnostic_only") {
    return {
      handled: true,
      reasonCode: response.reasonCode,
      status: "diagnostic_only",
    };
  }
  if (response.action === "redelivery_deferred") {
    return {
      handled: true,
      reasonCode: response.reasonCode,
      status: "retry_later",
    };
  }
  if (
    response.action === "keep_waiting" ||
    response.action === "redeliver_current_run" ||
    response.action === "retry_run_issued"
  ) {
    return {
      handled: true,
      reasonCode: response.reasonCode,
      status: "coordinator_handled",
    };
  }
  return {
    handled: true,
    reasonCode: response.reasonCode,
    status: "coordinator_handled",
  };
};
const resolveRuntimeCoordinatorFailureEventKind = (
  errorCode: string
): "retry" | "timeout" => {
  if (isDispatchAttemptTimeoutErrorCode(errorCode)) {
    return "timeout";
  }
  return "retry";
};
const decideRuntimeCoordinatorFailureForBackedExecution = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorCode: string;
  executionAttemptId: string;
  executionContext: DispatchExecutionContext | null;
  runtimeExecutionDelivered: boolean;
  source: "offloaded_wait" | "queue_failure";
}): Promise<RuntimeCoordinatorFailureDecisionHandling> => {
  if (
    !(
      input.runtimeExecutionDelivered &&
      isRuntimeCoordinatorBackedExecutionContext(input.executionContext)
    )
  ) {
    return { handled: false };
  }
  const eventKind = resolveRuntimeCoordinatorFailureEventKind(input.errorCode);
  const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
    dispatchId: input.dispatchMessage.dispatchId,
    spaceId: input.dispatchMessage.spaceId,
    targetProfileId: input.dispatchMessage.targetProfileId,
  });
  const preflightCheck = await runDispatchExecutionPreflightGate({
    env: input.env,
    message: input.dispatchMessage,
  }).catch(() => null);
  const ownerUserId = normalizeOptionalText(
    preflightCheck?.ok
      ? preflightCheck.effectiveTargetBindingSnapshot.ownerUserId
      : null
  );
  if (!ownerUserId) {
    await writeRuntimeCoordinatorHandoffPendingOrUnavailableDecision({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      errorCode: input.errorCode,
      eventKind,
      executionAttemptId: input.executionAttemptId,
      reasonCode: "runtime_coordinator.owner_unavailable_for_decision",
      runtimeCoordinatorExecutionId,
      source: input.source,
      status: "retry_later",
    });
    return {
      handled: true,
      reasonCode: "runtime_coordinator.owner_unavailable_for_decision",
      status: "retry_later",
    };
  }
  const response = await decideRuntimeTransportRuntimeCoordinatorExecution({
    env: input.env,
    ownerUserId,
    decision: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      attemptId: input.executionAttemptId,
      dispatchId: input.dispatchMessage.dispatchId,
      eventKind,
      idempotencyKey: `${input.source}:${input.dispatchMessage.dispatchId}:${input.executionAttemptId}:${eventKind}:${input.errorCode}`,
      reasonCode: input.errorCode,
      runtimeCoordinatorExecutionId,
      sourceClientMessageId:
        input.dispatchMessage.sourceClientMessageId ?? null,
      spaceId: input.dispatchMessage.spaceId,
      targetProfileId: input.dispatchMessage.targetProfileId,
      trigger: input.source === "queue_failure" ? "queue" : "alarm",
    },
  });
  const classified = classifyRuntimeCoordinatorQueueDecisionResponse(response);
  if (classified.handled && classified.status === "retry_later") {
    await writeRuntimeCoordinatorHandoffPendingOrUnavailableDecision({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      errorCode: input.errorCode,
      eventKind,
      executionAttemptId: input.executionAttemptId,
      reasonCode: classified.reasonCode,
      runtimeCoordinatorExecutionId,
      source: input.source,
      status: "retry_later",
    });
  }
  return classified;
};
const writeRuntimeCoordinatorHandoffPendingOrUnavailableDecision =
  async (input: {
    db: PostgresDatabase;
    dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
    errorCode: string;
    eventKind: "retry" | "timeout";
    executionAttemptId: string;
    reasonCode: string;
    runtimeCoordinatorExecutionId: string;
    source: "offloaded_wait" | "queue_failure";
    status: "retry_later";
  }): Promise<void> => {
    try {
      await writeOpenMeldDaemonOpsDecision({
        db: input.db,
        decisionCode:
          RUNTIME_COORDINATOR_HANDOFF_PENDING_OR_UNAVAILABLE_DECISION_CODE,
        decisionPayload: {
          attemptId: input.executionAttemptId,
          dispatchId: input.dispatchMessage.dispatchId,
          errorCode: input.errorCode,
          eventKind: input.eventKind,
          reasonCode: input.reasonCode,
          runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
          source: input.source,
          sourceClientMessageId:
            input.dispatchMessage.sourceClientMessageId ?? null,
          sourceEventId: input.dispatchMessage.sourceEventId,
          spaceId: input.dispatchMessage.spaceId,
          status: input.status,
          targetProfileId: input.dispatchMessage.targetProfileId,
          taskId: input.dispatchMessage.taskId,
          trigger: input.source === "queue_failure" ? "queue" : "alarm",
        },
        decidedBy: "core.dispatch_queue.runtime_coordinator_handoff",
        decidedAtMs: Date.now(),
        expectedRecoveryCriteria:
          resolveRuntimeCoordinatorHandoffExpectedRecoveryCriteria(
            input.source
          ),
        source: "dispatch_queue_runtime_coordinator_handoff",
        correlationId: input.dispatchMessage.dispatchId,
      });
    } catch (error) {
      console.warn(
        "[core.openmeld.dispatch.runtime_coordinator_handoff_pending_audit_failed]",
        {
          dispatchId: input.dispatchMessage.dispatchId,
          error: toErrorMessage(error),
          reasonCode: input.reasonCode,
          source: input.source,
          targetProfileId: input.dispatchMessage.targetProfileId,
        }
      );
    }
  };
const isRuntimeCoordinatorBackedExecutionContext = (
  executionContext: DispatchExecutionContext | null
): boolean => {
  if (!executionContext) {
    return false;
  }
  return (
    normalizeOptionalText(executionContext.daemonSessionId) !== null &&
    executionContext.daemonSessionId !== AUDIT_UNKNOWN_DAEMON_SESSION_ID &&
    executionContext.leaseEpoch > AUDIT_UNKNOWN_LEASE_EPOCH
  );
};
const handleRuntimeCoordinatorOffloadedWaitDecision = (input: {
  db: PostgresDatabase;
  decision: RuntimeCoordinatorFailureDecisionHandling;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorMessage: string;
  executionAttemptId: string;
  failureAtMs: number;
}): boolean => {
  if (!input.decision.handled) {
    return false;
  }
  if (input.decision.status === "coordinator_handled") {
    return true;
  }
  if (input.decision.status === "retry_later") {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.runtime_coordinator_offloaded_wait_deferred_to_watchdog]",
      {
        attemptId: input.executionAttemptId,
        dispatchId: input.dispatchMessage.dispatchId,
        failureAtMs: input.failureAtMs,
        reasonCode: input.decision.reasonCode,
        sourceEventId: input.dispatchMessage.sourceEventId,
        targetProfileId: input.dispatchMessage.targetProfileId,
      }
    );
  }
  return true;
};
export const handleRuntimeCoordinatorQueueFailureDecision = (input: {
  decision: RuntimeCoordinatorFailureDecisionHandling;
  forceTerminal: boolean;
  message: QueueBatchMessage;
  queueAttempt: number;
}): {
  handled: boolean;
  shouldAck: boolean;
} => {
  if (!input.decision.handled) {
    return { handled: false, shouldAck: true };
  }
  if (input.decision.status === "retry_later") {
    if (input.forceTerminal) {
      // A non-retryable failure (e.g. a D1 schema fault) must never be
      // re-queued by the RuntimeCoordinator retry path — retrying cannot fix a
      // missing table. Fall through (handled: false) to the terminal DLQ/ack
      // path so the message ends terminal, not in a silent retry loop.
      return { handled: false, shouldAck: true };
    }
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      input.decision.reasonCode
    );
    return { handled: true, shouldAck: false };
  }
  return { handled: true, shouldAck: true };
};
const handlePreExecutionHeadLifecycleFailureIfNeeded = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorCode: string;
  errorMessage: string;
  executionAttemptId: string;
  failureAtMs: number;
  message: QueueBatchMessage;
  queueAttempt: number;
  runtimeExecutionDelivered: boolean;
}): Promise<{
  handled: boolean;
  shouldAck: boolean;
}> => {
  if (
    input.errorCode !== "daemon.profile.offline" &&
    input.errorCode !== "daemon.profile.pending_first_report" &&
    input.errorCode !== "wake.device_wait.readiness_checking" &&
    input.errorCode !== "daemon.service.draining" &&
    input.errorCode !== "service.update_required" &&
    input.errorCode !== "local_service.identity_mismatch"
  ) {
    return { handled: false, shouldAck: true };
  }
  if (
    input.errorCode === "daemon.service.draining" &&
    (!input.dispatchMessage.deviceWait || input.runtimeExecutionDelivered)
  ) {
    return { handled: false, shouldAck: true };
  }
  const preflightCheck = await runDispatchExecutionPreflightGate({
    env: input.env,
    message: input.dispatchMessage,
  }).catch(() => null);
  const ownerUserId = normalizeOptionalText(
    preflightCheck?.ok
      ? preflightCheck.effectiveTargetBindingSnapshot.ownerUserId
      : null
  );
  if (!ownerUserId) {
    if (
      shouldRetryDispatchAttemptForErrorCode({
        attempt: input.queueAttempt,
        errorCode: input.errorCode,
      })
    ) {
      return { handled: false, shouldAck: true };
    }
    return await recordPreExecutionOwnerUnresolvedVisibleFailure({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      executionAttemptId: input.executionAttemptId,
      failureAtMs: input.failureAtMs,
    });
  }
  const headAcceptance = await acceptRuntimeCoordinatorHeadBeforeFreshExecution(
    {
      allowPublicationIntentReconcile: true,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionAttemptId: input.executionAttemptId,
      nowMs: input.failureAtMs,
      targetOwnerUserId: ownerUserId,
    }
  );
  if (headAcceptance.status === "retry") {
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      headAcceptance.reasonCode
    );
    return { handled: true, shouldAck: false };
  }
  if (headAcceptance.status === "profile_queue_waiting") {
    return { handled: true, shouldAck: true };
  }
  if (isAcceptedPayloadConflictSettlementReady(headAcceptance)) {
    return { handled: true, shouldAck: true };
  }
  if (
    headAcceptance.status === "queue_full" ||
    headAcceptance.status === "recovery_needs_attention" ||
    headAcceptance.status === "context_rejected"
  ) {
    return {
      handled: true,
      shouldAck: await settleVisiblePreHeadFailure({
        db: input.db,
        dispatchMessage: input.dispatchMessage,
        env: input.env,
        errorCode: headAcceptance.reasonCode,
        errorMessage: headAcceptance.errorMessage,
        executionAttemptId: input.executionAttemptId,
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        message: input.message,
        nowMs: input.failureAtMs,
      }),
    };
  }
  if (headAcceptance.status === "skip_duplicate") {
    return { handled: true, shouldAck: true };
  }
  if (input.errorCode === "service.update_required") {
    return await recordServiceUpdateRequiredHeadNoExecution({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorMessage: input.errorMessage,
      executionAttemptId: input.executionAttemptId,
      failureAtMs: input.failureAtMs,
      message: input.message,
      ownerUserId,
      queueAttempt: input.queueAttempt,
    });
  }
  if (input.errorCode === "local_service.identity_mismatch") {
    return await recordLocalServiceIdentityMismatchHeadNoExecution({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorMessage: input.errorMessage,
      executionAttemptId: input.executionAttemptId,
      failureAtMs: input.failureAtMs,
      message: input.message,
      ownerUserId,
      queueAttempt: input.queueAttempt,
    });
  }
  return await recordPreExecutionHeadWaiting({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    executionAttemptId: input.executionAttemptId,
    failureAtMs: input.failureAtMs,
    message: input.message,
    ownerUserId,
    queueAttempt: input.queueAttempt,
  });
};
const recordPreExecutionOwnerUnresolvedVisibleFailure = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorCode: string;
  errorMessage: string;
  executionAttemptId: string;
  failureAtMs: number;
}): Promise<{
  handled: boolean;
  shouldAck: boolean;
}> => {
  const targetLabel = resolvePreExecutionVisibleFailureTargetLabel(
    input.dispatchMessage
  );
  const text = `OpenMeld could not wake ${targetLabel} because OpenMeld could not confirm the agent's account right now. Try again in a moment.`;
  await emitSpaceSystemNoticeSignal({
    env: input.env,
    spaceId: input.dispatchMessage.spaceId,
    profile: {
      kind: "system",
      profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
      profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
    },
    data: {
      noticeType: "terminal_failure",
      actorProfileId: input.dispatchMessage.targetProfileId,
      ...(input.dispatchMessage.targetProfileNameSnapshot
        ? { actorName: input.dispatchMessage.targetProfileNameSnapshot }
        : {}),
      coreReadinessFactsChanged: {
        agentProfileId: input.dispatchMessage.targetProfileId,
        kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
      },
      dispatchId: input.dispatchMessage.dispatchId,
      ...(input.dispatchMessage.replyToSnapshot
        ? { replyTo: input.dispatchMessage.replyToSnapshot }
        : {}),
      reason: PRE_EXECUTION_OWNER_UNRESOLVED_VISIBLE_FAILURE_CODE,
      text,
      generatedBy: "openmeld",
    },
    spaceAccess: buildDispatchSystemSpaceAccess({
      message: input.dispatchMessage,
      requestIdPrefix: "openMeldDaemon-owner-unresolved-visible-failure",
    }),
    ...(input.dispatchMessage.threadContext
      ? { threadContext: input.dispatchMessage.threadContext }
      : {}),
  });
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode: PRE_EXECUTION_OWNER_UNRESOLVED_VISIBLE_FAILURE_CODE,
    errorMessage:
      input.errorMessage ||
      "RuntimeCoordinator head waiting owner could not be resolved before retry budget was exhausted",
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.failureAtMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  });
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode: "runtime_coordinator.head_owner_unresolved_visible_failure",
    decisionPayload: {
      dispatchId: input.dispatchMessage.dispatchId,
      originalErrorCode: input.errorCode,
      reasonCode: PRE_EXECUTION_OWNER_UNRESOLVED_VISIBLE_FAILURE_CODE,
      sourceClientMessageId:
        input.dispatchMessage.sourceClientMessageId ?? null,
      sourceEventId: input.dispatchMessage.sourceEventId,
      targetProfileId: input.dispatchMessage.targetProfileId,
    },
    decidedBy: "core.dispatch_queue.runtime_coordinator_head",
    decidedAtMs: input.failureAtMs,
    expectedRecoveryCriteria:
      "Queue retry budget was exhausted before the target owner could be resolved; Space now has a persisted failure notice instead of an unread DLQ-only outcome.",
    source: "dispatch_queue",
    correlationId: input.dispatchMessage.dispatchId,
  });
  return { handled: true, shouldAck: true };
};
const resolvePreExecutionVisibleFailureTargetLabel = (
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage
): string => {
  const displayName =
    normalizeOptionalText(dispatchMessage.targetProfileNameSnapshot) ??
    normalizeOptionalText(dispatchMessage.targetProfileMentionLabel);
  return displayName
    ? `@${displayName.replace(LEADING_AT_SIGNS_PATTERN, "")}`
    : "the agent";
};
const recordPreExecutionHeadWaiting = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorCode:
    | "daemon.profile.offline"
    | "daemon.profile.pending_first_report"
    | "daemon.service.draining"
    | "wake.device_wait.access_check_unavailable"
    | "wake.device_wait.readiness_checking";
  errorMessage: string;
  executionAttemptId: string;
  failureAtMs: number;
  message: QueueBatchMessage;
  ownerUserId: string;
  queueAttempt: number;
}): Promise<{
  handled: boolean;
  shouldAck: boolean;
}> => {
  const waitingPolicy = resolveRuntimeCoordinatorHeadWaitingPolicy(
    input.errorCode
  );
  const waitingDecision = resolveRuntimeCoordinatorHeadWaitingDecision(
    input.errorCode
  );
  const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
    clientMessageId: input.dispatchMessage.sourceClientMessageId ?? null,
    dispatchId: input.dispatchMessage.dispatchId,
    sourceSignalId: input.dispatchMessage.sourceEventId,
    spaceId: input.dispatchMessage.spaceId,
    targetProfileId: input.dispatchMessage.targetProfileId,
  });
  const response = await recordRuntimeTransportRuntimeCoordinatorHeadWaiting({
    env: input.env,
    ownerUserId: input.ownerUserId,
    waiting: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: input.dispatchMessage.dispatchId,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      observedAtMs: input.failureAtMs,
      ownerUserId: input.ownerUserId,
      targetWakeLifecycleIdentity,
      ...waitingDecision,
    },
  });
  if (!response.ok) {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.head_waiting_retry_later",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        reasonCode: response.reasonCode,
        sourceClientMessageId:
          input.dispatchMessage.sourceClientMessageId ?? null,
        sourceEventId: input.dispatchMessage.sourceEventId,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.failureAtMs,
      expectedRecoveryCriteria:
        "RuntimeCoordinator head waiting boundary must be durable before Queue can stop retrying this target Wake.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      response.reasonCode
    );
    return { handled: true, shouldAck: false };
  }
  if (response.status === "publication_intent_ready") {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
      db: input.db,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator head waiting deadline produced a Phase 6 publication intent",
      nowMs: input.failureAtMs,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.head_waiting_deadline_intent_ready",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        publicationIntentId: response.publicationIntentId,
        reasonCode: response.reasonCode,
        targetProfileId: input.dispatchMessage.targetProfileId,
        targetWakeLifecycleId: response.targetWakeLifecycleId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: input.failureAtMs,
      expectedRecoveryCriteria:
        "Phase 6 publication pipeline publishes the prepared service-offline failure notice; Phase 5 must not claim final Space visibility.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    return { handled: true, shouldAck: true };
  }
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    // Routing/ownership marker for outbox redrive, not the observed cause.
    // The exact cause remains in the Coordinator boundary and correlated
    // head_waiting_boundary_recorded decision below; errorMessage is unchanged.
    errorCode: input.dispatchMessage.deviceWait
      ? RUNTIME_COORDINATOR_DEVICE_WAITING_REASON_CODE
      : input.errorCode,
    errorMessage: input.errorMessage,
    nowMs: input.failureAtMs,
  });
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode: "runtime_coordinator.head_waiting_boundary_recorded",
    decisionPayload: {
      deadlineAtMs: response.deadlineAtMs,
      dispatchId: input.dispatchMessage.dispatchId,
      reasonCode: response.reasonCode,
      softDeadlineAtMs: response.softDeadlineAtMs,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetWakeLifecycleId: response.targetWakeLifecycleId,
      trigger: waitingPolicy.trigger,
      queueRedeliveryRole: "fallback_trigger",
      userRecoveryAction: response.userRecoveryAction,
      waitingCategory: response.waitingCategory,
    },
    decidedBy: "core.dispatch_queue.runtime_coordinator_head",
    decidedAtMs: input.failureAtMs,
    expectedRecoveryCriteria: `RuntimeCoordinator head owns this waiting boundary; ${waitingPolicy.trigger} is the primary recovery trigger and Queue redelivery is only a fallback.`,
    source: "dispatch_queue",
    correlationId: input.dispatchMessage.dispatchId,
  });
  if (input.dispatchMessage.deviceWait) {
    return { handled: true, shouldAck: true };
  }
  await emitRetryingActivitySignal({
    env: input.env,
    errorCode: input.errorCode,
    message: input.dispatchMessage,
  });
  retryQueueMessageWithBackoff(
    input.message,
    input.queueAttempt,
    input.errorCode
  );
  return { handled: true, shouldAck: false };
};
const recordServiceUpdateRequiredHeadNoExecution = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorMessage: string;
  executionAttemptId: string;
  failureAtMs: number;
  message: QueueBatchMessage;
  ownerUserId: string;
  queueAttempt: number;
}): Promise<{
  handled: boolean;
  shouldAck: boolean;
}> => {
  const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
    clientMessageId: input.dispatchMessage.sourceClientMessageId ?? null,
    dispatchId: input.dispatchMessage.dispatchId,
    sourceSignalId: input.dispatchMessage.sourceEventId,
    spaceId: input.dispatchMessage.spaceId,
    targetProfileId: input.dispatchMessage.targetProfileId,
  });
  const response =
    await recordRuntimeTransportRuntimeCoordinatorHeadNoExecution({
      env: input.env,
      ownerUserId: input.ownerUserId,
      noExecution: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        decisionSource: "dispatch_delivery_pre_execution",
        dispatchId: input.dispatchMessage.dispatchId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        ownerUserId: input.ownerUserId,
        publicationCategory: "update_required",
        reasonCode: "service.update_required",
        targetWakeLifecycleIdentity,
        userRecoveryAction: "update_openmeld_service",
      },
    });
  if (!response.ok && response.status === "retry_later") {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator service-update no-execution decision returned retry_later before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.failureAtMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      response.reasonCode
    );
    return { handled: true, shouldAck: false };
  }
  if (!response.ok) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator service-update no-execution decision conflicted before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.failureAtMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    });
    return { handled: true, shouldAck: true };
  }
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode:
      "runtime_coordinator.head_no_execution_publication_intent_ready",
    decisionPayload: {
      dispatchId: input.dispatchMessage.dispatchId,
      publicationCategory: "update_required",
      publicationIntentId: response.publicationIntentId,
      reasonCode: "service.update_required",
      status: response.status,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetWakeLifecycleId: response.targetWakeLifecycleId,
      userRecoveryAction: "update_openmeld_service",
    },
    decidedBy: "core.dispatch_queue.runtime_coordinator_head",
    decidedAtMs: input.failureAtMs,
    expectedRecoveryCriteria:
      "Phase 6 publication pipeline publishes the prepared service-update failure notice; Phase 5 must not claim final Space visibility.",
    source: "dispatch_queue",
    correlationId: input.dispatchMessage.dispatchId,
  });
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode: "service.update_required",
    errorMessage:
      input.errorMessage ||
      "RuntimeCoordinator no-execution publication intent is ready before execution creation",
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.failureAtMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  });
  return { handled: true, shouldAck: true };
};
const recordLocalServiceIdentityMismatchHeadNoExecution = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorMessage: string;
  executionAttemptId: string;
  failureAtMs: number;
  message: QueueBatchMessage;
  ownerUserId: string;
  queueAttempt: number;
}): Promise<{
  handled: boolean;
  shouldAck: boolean;
}> => {
  const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
    clientMessageId: input.dispatchMessage.sourceClientMessageId ?? null,
    dispatchId: input.dispatchMessage.dispatchId,
    sourceSignalId: input.dispatchMessage.sourceEventId,
    spaceId: input.dispatchMessage.spaceId,
    targetProfileId: input.dispatchMessage.targetProfileId,
  });
  const response =
    await recordRuntimeTransportRuntimeCoordinatorHeadNoExecution({
      env: input.env,
      ownerUserId: input.ownerUserId,
      noExecution: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        decisionSource: "dispatch_delivery_pre_execution",
        dispatchId: input.dispatchMessage.dispatchId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        ownerUserId: input.ownerUserId,
        publicationCategory: "local_connection_mismatch",
        reasonCode: "local_service.identity_mismatch",
        targetWakeLifecycleIdentity,
        userRecoveryAction: "reconnect_agent_binding",
      },
    });
  if (!response.ok && response.status === "retry_later") {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator local-service identity no-execution decision returned retry_later before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.failureAtMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
    });
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      response.reasonCode
    );
    return { handled: true, shouldAck: false };
  }
  if (!response.ok) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
      db: input.db,
      errorCode: response.reasonCode,
      errorMessage:
        "RuntimeCoordinator local-service identity no-execution decision conflicted before execution creation",
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: input.failureAtMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    });
    return { handled: true, shouldAck: true };
  }
  await writeOpenMeldDaemonOpsDecision({
    db: input.db,
    decisionCode:
      "runtime_coordinator.head_no_execution_publication_intent_ready",
    decisionPayload: {
      dispatchId: input.dispatchMessage.dispatchId,
      publicationCategory: "local_connection_mismatch",
      publicationIntentId: response.publicationIntentId,
      reasonCode: "local_service.identity_mismatch",
      status: response.status,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetWakeLifecycleId: response.targetWakeLifecycleId,
      userRecoveryAction: "reconnect_agent_binding",
    },
    decidedBy: "core.dispatch_queue.runtime_coordinator_head",
    decidedAtMs: input.failureAtMs,
    expectedRecoveryCriteria:
      "Phase 6 publication pipeline publishes the prepared local-connection mismatch failure notice; Phase 5 must not claim final Space visibility.",
    source: "dispatch_queue",
    correlationId: input.dispatchMessage.dispatchId,
  });
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode: "local_service.identity_mismatch",
    errorMessage:
      input.errorMessage ||
      "RuntimeCoordinator no-execution publication intent is ready before execution creation",
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.failureAtMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  });
  return { handled: true, shouldAck: true };
};
const resolveRuntimeCoordinatorHandoffExpectedRecoveryCriteria = (
  source: "offloaded_wait" | "queue_failure"
): string => {
  if (source === "offloaded_wait") {
    return "Queue message is already acknowledged; RuntimeCoordinator DO watchdog must make the next decision from durable run command state, not D1 status, trace, or queue retry";
  }
  return "Queue keeps the message retryable only to trigger a later RuntimeCoordinator decision; Queue must not decide execution terminal itself";
};
const settleRuntimeTaskDedupedCorrelationLost = async (input: {
  controllerKey: string | null;
  agentControllerRef: string | null;
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorCode: string;
  errorMessage: string;
  executionAttemptId: string;
  executionAttemptNo: number;
  executionContext: DispatchExecutionContext | null;
  nowMs: number;
  targetProfileName: string | null;
}): Promise<void> => {
  const correlationLostMessage = [
    RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE,
    "runtime returned a dedupe signal without a correlatable original attempt result",
    input.errorMessage,
  ]
    .filter((part) => part.trim().length > 0)
    .join(": ");
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode: RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE,
    errorMessage: correlationLostMessage,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.nowMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  });
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE,
      decisionPayload: {
        attemptId: input.executionAttemptId,
        attemptNo: input.executionAttemptNo,
        dispatchId: input.dispatchMessage.dispatchId,
        errorMessage: input.errorMessage,
        finalErrorCode: RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE,
        runtimeReasonCode: input.errorCode,
        sourceEventId: input.dispatchMessage.sourceEventId,
        targetProfileId: input.dispatchMessage.targetProfileId,
        taskId: input.dispatchMessage.taskId,
      },
      decidedBy: "core.dispatch_queue.runtime_result_correlation",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "runtime dedupe is diagnostic only; duplicate work must correlate through the original pending or completed attempt",
      source: "dispatch_queue_consumer",
      correlationId: input.dispatchMessage.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.runtime_dedupe_audit_failed]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(error),
        reasonCode: RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE,
      }
    );
  }
  if (input.executionContext) {
    await finalizeReplyingHintLifecycle({
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      executionContext: input.executionContext,
      targetProfileName: input.targetProfileName,
      transition: "clear_for_terminal_reply",
    });
  }
  console.warn(
    "[core.openMeldDaemon.dispatch_queue.runtime_dedupe_diagnostic]",
    {
      attemptId: input.executionAttemptId,
      attemptNo: input.executionAttemptNo,
      connectionGeneration:
        input.executionContext?.connectionGeneration ?? null,
      agentControllerRef: input.agentControllerRef,
      controllerKey: input.controllerKey,
      daemonSessionId: input.executionContext?.daemonSessionId ?? null,
      dispatchId: input.dispatchMessage.dispatchId,
      errorCode: RUNTIME_TASK_DEDUPED_CORRELATION_LOST_ERROR_CODE,
      errorMessage: input.errorMessage,
      leaseEpoch: input.executionContext?.leaseEpoch ?? null,
      result: "correlation_lost",
      runtimeReasonCode: input.errorCode,
      targetProfileId: input.dispatchMessage.targetProfileId,
      taskId: input.dispatchMessage.taskId,
    }
  );
};
const settleRetryableOffloadedWaitRecovery = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorCode: string;
  errorMessage: string;
  executionAttemptId: string;
  executionAttemptNo: number;
  executionContext: DispatchExecutionContext;
  failureAtMs: number;
  routeOwnershipState: RouteOwnershipState;
  targetProfileName: string | null;
}): Promise<void> => {
  await writeStaleLeaseAuditDecisionIfNeeded({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    executionContext: input.executionContext,
    errorCode: input.errorCode,
    retryCount: input.executionAttemptNo,
    nowMs: input.failureAtMs,
  });
  await writeRetryOpsDecisionIfNeeded({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    executionContext: input.executionContext,
    errorCode: input.errorCode,
    nowMs: input.failureAtMs,
    routeOwnershipState: input.routeOwnershipState,
    retryCount: input.executionAttemptNo,
    shouldRetry: true,
  });
  const attemptStatus = isDispatchAttemptTimeoutErrorCode(input.errorCode)
    ? OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut
    : OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus,
    db: input.db,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    nowMs: input.failureAtMs,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
  });
  await emitRetryingActivitySignal({
    env: input.env,
    errorCode: input.errorCode,
    message: input.dispatchMessage,
  });
  console.info("[core.openmeld.dispatch.retry_scheduled]", {
    event: "core.openmeld.dispatch.retry_scheduled",
    attemptId: input.executionAttemptId,
    attemptNo: input.executionAttemptNo,
    dispatchId: input.dispatchMessage.dispatchId,
    errorCode: input.errorCode,
    targetProfileId: input.dispatchMessage.targetProfileId,
  });
  console.warn(
    "[core.openMeldDaemon.dispatch_queue.wait_phase_retryable_recovery]",
    {
      attemptId: input.executionAttemptId,
      connectionGeneration: input.executionContext.connectionGeneration,
      daemonSessionId: input.executionContext.daemonSessionId,
      dispatchId: input.dispatchMessage.dispatchId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      leaseEpoch: input.executionContext.leaseEpoch,
      routeOwnershipState: input.routeOwnershipState,
      targetProfileId: input.dispatchMessage.targetProfileId,
      targetProfileName: input.targetProfileName,
      taskId: input.dispatchMessage.taskId,
    }
  );
};
const emitDispatchReplyingHintClearSignal = async (input: {
  env: CoreBindings;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  targetProfileName: string | null;
}): Promise<boolean> => {
  const targetProfileLabel =
    normalizeOptionalText(input.targetProfileName) ??
    input.dispatchMessage.targetProfileId;
  const hintText = buildReplyingHintText(targetProfileLabel);
  try {
    await emitDispatchActivitySignal({
      env: input.env,
      dispatchMessage: input.dispatchMessage,
      purpose: DISPATCH_REPLYING_HINT_END_PURPOSE,
      text: hintText,
      targetProfileName: input.targetProfileName,
    });
    return true;
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.replying_hint_clear_emit_failed]",
      {
        event: CORE_LOG_EVENTS.dispatchQueueReplyingHintClearEmitFailed,
        dispatchId: input.dispatchMessage.dispatchId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        error: toErrorMessage(error),
      }
    );
    return false;
  }
};
const finalizeReplyingHintLifecycle = async (input: {
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  executionContext: DispatchExecutionContext;
  targetProfileName: string | null;
  transition: ReplyingHintTransition;
}): Promise<DispatchExecutionContext> => {
  const finalizeDecision = resolveReplyingHintFinalizeDecision({
    replyingHintActive: input.executionContext.replyingHintActive,
    transition: input.transition,
  });
  let nextReplyingHintActive = finalizeDecision.nextReplyingHintActive;
  if (finalizeDecision.shouldEmitReplyingHintEnd) {
    const clearSucceeded = await emitDispatchReplyingHintClearSignal({
      env: input.env,
      dispatchMessage: input.dispatchMessage,
      targetProfileName: input.targetProfileName,
    });
    if (!clearSucceeded) {
      nextReplyingHintActive = input.executionContext.replyingHintActive;
    }
  }
  return {
    ...input.executionContext,
    replyingHintActive: nextReplyingHintActive,
  };
};
const resolveOffloadedWaitPhaseExecutionContext = (
  error: unknown,
  fallback: DispatchExecutionContext
): DispatchExecutionContext => {
  if (
    error instanceof DispatchExecutionValidationError &&
    error.executionContext
  ) {
    return error.executionContext;
  }
  return fallback;
};
const resolveDispatchTargetLabel = (input: {
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  targetProfileName: string | null;
  targetProfileMentionLabel: string | null;
}): string => {
  return (
    normalizeOptionalText(input.targetProfileMentionLabel) ??
    normalizeOptionalText(input.dispatchMessage.targetProfileMentionLabel) ??
    normalizeOptionalText(input.targetProfileName) ??
    normalizeOptionalText(input.dispatchMessage.targetProfileNameSnapshot) ??
    input.dispatchMessage.targetProfileId
  );
};
const handlePreflightDispatchCheckFailure = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  executionAttemptId: string;
  queueAttempt: number;
  preflightCheck: Extract<
    Awaited<ReturnType<typeof runDispatchExecutionPreflightGate>>,
    {
      ok: false;
    }
  >;
  nowMs: number;
  env: CoreBindings;
  message: QueueBatchMessage;
}): Promise<boolean> => {
  await writePreflightOpsDecisionIfNeeded({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    preflightCheck: input.preflightCheck,
    nowMs: input.nowMs,
  });
  const shouldRetryPreflightFailure =
    input.preflightCheck.finalStatus ===
      OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable &&
    shouldRetryDispatchAttemptForErrorCode({
      attempt: input.queueAttempt,
      errorCode: input.preflightCheck.errorCode,
    });
  if (shouldRetryPreflightFailure) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.db,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      errorCode: input.preflightCheck.errorCode,
      errorMessage: input.preflightCheck.errorMessage,
      nowMs: input.nowMs,
    });
    await emitRetryingActivitySignal({
      env: input.env,
      errorCode: input.preflightCheck.errorCode,
      message: input.dispatchMessage,
    });
    retryQueueMessageWithBackoff(
      input.message,
      input.queueAttempt,
      input.preflightCheck.errorCode
    );
    return false;
  }
  const finalStatus =
    input.preflightCheck.finalStatus ===
    OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable
      ? OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal
      : input.preflightCheck.finalStatus;
  return await settleVisiblePreHeadFailure({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    env: input.env,
    errorCode: input.preflightCheck.errorCode,
    errorMessage: input.preflightCheck.errorMessage,
    executionAttemptId: input.executionAttemptId,
    finalStatus,
    message: input.message,
    nowMs: input.nowMs,
    recordProfileNotFoundObservation:
      input.preflightCheck.targetProfileIdentityVerdict === "not_found",
  });
};
const settleVisiblePreHeadFailure = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  errorCode: string;
  errorMessage: string | null;
  executionAttemptId: string;
  finalStatus:
    | typeof OPENMELD_DAEMON_DISPATCH_STATE.blocked
    | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal;
  message: QueueBatchMessage;
  nowMs: number;
  recordProfileNotFoundObservation?: boolean;
}): Promise<boolean> => {
  await emitDispatchFailureActivitySignal({
    env: input.env,
    message: input.dispatchMessage,
    errorCode: input.errorCode,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  });
  const redriveMessage = createPreHeadFailureRedriveMessage(
    input.dispatchMessage
  );
  const publicationCommand = buildPreHeadFailurePublicationCommand({
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    message: redriveMessage,
  });
  const recoveryDb = getPostgresDatabase(input.env);
  if (!recoveryDb) {
    throw new Error("dispatch.pre_head_failure_publication_db_unavailable");
  }
  const intent = await ensurePreHeadFailurePublicationIntent({
    db: recoveryDb,
    intent: createPreHeadFailurePublicationIntent({
      attemptId: input.executionAttemptId,
      createdAtMs: input.nowMs,
      dispatchMessage: redriveMessage,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      finalStatus: input.finalStatus,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      publicationCommand,
      recordProfileNotFoundObservation:
        input.recordProfileNotFoundObservation === true,
    }),
  });
  return await resumePreHeadFailurePublication({
    evidenceDb: input.db,
    env: input.env,
    intent,
    message: input.message,
    nowMs: input.nowMs,
    recoveryDb,
  });
};
const resumePreHeadFailurePublication = async (input: {
  evidenceDb: PostgresDatabase;
  env: CoreBindings;
  intent: PreHeadFailurePublicationIntent;
  message: QueueBatchMessage;
  nowMs: number;
  recoveryDb: PostgresDatabase;
}): Promise<boolean> => {
  const claim = await claimPreHeadFailurePublicationIntent({
    claimId: `dispatch-pre-head-failure-publication:${crypto.randomUUID()}`,
    db: input.recoveryDb,
    dispatchId: input.intent.dispatchId,
    nowMs: input.nowMs,
  });
  if (
    claim.outcome === "busy" ||
    claim.outcome === "completed" ||
    claim.outcome === "needs_attention"
  ) {
    return true;
  }
  if (claim.outcome === "missing") {
    throw new Error("dispatch.pre_head_failure_publication_intent_missing");
  }
  let intent = claim.intent;
  let publication: "persisted" | "retry_required";
  try {
    if (!input.env.OPENMELD_SPACES) {
      throw new Error("dispatch.pre_head_failure_space_unavailable");
    }
    const identity = intent.publicationCommand.preHeadFailurePublication;
    const legacyClaim =
      !identity || identity.legacyUpgrade
        ? await readSpaceFinalOutcomeClaim({
            dispatchId: intent.dispatchId,
            env: input.env,
            spaceId: intent.redriveMessage.spaceId,
            targetProfileId: intent.redriveMessage.targetProfileId,
          })
        : null;
    if (
      legacyClaim &&
      legacyClaim.signalId !== identity?.signalId &&
      intent.redriveMessage.sourceClientMessageId
    ) {
      const stored = await readAgentTaskTerminalOutcome({
        db: input.recoveryDb,
        taskKey: buildAgentTaskKey({
          kind: "space_wake",
          sourceClientMessageId: intent.redriveMessage.sourceClientMessageId,
          spaceId: intent.redriveMessage.spaceId,
          targetProfileId: intent.redriveMessage.targetProfileId,
          v: 1,
        }),
      });
      if (!stored) {
        await recordLegacyPreHeadRecoveryAttention({
          db: input.recoveryDb,
          env: input.env,
          intent,
          nowMs: input.nowMs,
          publishedSignalId: legacyClaim.signalId,
          task: {
            kind: "space_wake",
            sourceClientMessageId: intent.redriveMessage.sourceClientMessageId,
            spaceId: intent.redriveMessage.spaceId,
            targetProfileId: intent.redriveMessage.targetProfileId,
            v: 1,
          },
        });
        return true;
      }
    }
    if (legacyClaim) {
      publication = "persisted";
    } else {
      intent = await freezePreHeadFailurePublicationIdentity({
        db: input.recoveryDb,
        intent,
        nowMs: input.nowMs,
      });
      publication = await emitFrozenPreHeadFailurePublication({
        env: input.env,
        intent,
      });
    }
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.pre_head_failure_prepare_failed]",
      {
        dispatchId: intent.dispatchId,
        error: toErrorMessage(error),
      }
    );
    return await redrivePreHeadFailurePublication({
      env: input.env,
      intent,
      message: input.message,
      nowMs: input.nowMs,
      recoveryDb: input.recoveryDb,
    });
  }
  if (publication === "retry_required") {
    await markDispatchStatus({
      attemptId: intent.attemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
      db: input.evidenceDb,
      idempotencyKey: intent.idempotencyKey,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      errorCode: PRE_HEAD_FAILURE_PUBLICATION_PENDING_ERROR_CODE,
      errorMessage: intent.errorMessage,
      nowMs: input.nowMs,
    });
    return await redrivePreHeadFailurePublication({
      env: input.env,
      intent,
      message: input.message,
      nowMs: input.nowMs,
      recoveryDb: input.recoveryDb,
    });
  }
  try {
    const taskStatus = await recordPreHeadPublicationTaskOutcome({
      db: input.recoveryDb,
      env: input.env,
      intent,
      nowMs: input.nowMs,
    });
    let status: OpenMeldDaemonDispatchState = intent.finalStatus;
    let errorCode = intent.errorCode;
    let errorMessage = intent.errorMessage;
    let attemptStatus: OpenMeldDaemonDispatchAttemptState =
      intent.finalStatus === OPENMELD_DAEMON_DISPATCH_STATE.blocked
        ? OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked
        : OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal;
    if (taskStatus === "succeeded") {
      status = OPENMELD_DAEMON_DISPATCH_STATE.deduped;
      errorCode = "space.final_outcome_already_claimed";
      errorMessage = "Space already has the authoritative final outcome";
      attemptStatus = OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded;
    } else if (taskStatus === "stopped") {
      status = OPENMELD_DAEMON_DISPATCH_STATE.cancelled;
      errorCode = RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE;
      errorMessage = "Space stopped this Wake before delivery";
      attemptStatus = OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded;
    } else {
      await writeDispatchDlq({
        db: input.evidenceDb,
        message: intent.redriveMessage,
        errorCode: intent.errorCode,
        errorMessage: intent.errorMessage,
        nowMs: input.nowMs,
      });
    }
    await markDispatchStatus({
      attemptId: intent.attemptId,
      attemptStatus,
      db: input.evidenceDb,
      idempotencyKey: intent.idempotencyKey,
      status,
      errorCode,
      errorMessage,
      nowMs: input.nowMs,
    });
    await markPreHeadFailurePublicationCompleted({
      completedAtMs: input.nowMs,
      db: input.recoveryDb,
      intent,
    });
    if (intent.recordProfileNotFoundObservation) {
      await recordSpaceMemberProfileNotFoundObservationBestEffort({
        env: input.env,
        message: intent.redriveMessage,
      });
    }
    return true;
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.pre_head_failure_terminalization_failed]",
      {
        dispatchId: intent.dispatchId,
        error: toErrorMessage(error),
        errorCode: intent.errorCode,
        idempotencyKey: intent.idempotencyKey,
      }
    );
    return await redrivePreHeadFailurePublication({
      env: input.env,
      intent,
      message: input.message,
      nowMs: input.nowMs,
      recoveryDb: input.recoveryDb,
    });
  }
};
const recordLegacyPreHeadRecoveryAttention = async (input: {
  db: PostgresDatabase;
  env: CoreBindings;
  intent: PreHeadFailurePublicationIntent;
  nowMs: number;
  publishedSignalId: string;
  task: Extract<AgentTaskHandle, { kind: "space_wake" }>;
}): Promise<void> => {
  const reasonCode = "dispatch.pre_head_failure_legacy_claim_unattributed";
  const eventId = `pre-head:${input.intent.dispatchId}:legacy-claim:${input.publishedSignalId}`;
  const priorObservation = await readAgentTaskNeedsAttentionObservation({
    db: input.db,
    eventId,
    taskKey: buildAgentTaskKey(input.task),
  });
  await recordAndEnqueueAgentTaskNeedsAttentionObservation({
    db: input.db,
    env: input.env,
    nowMs: input.nowMs,
    observation: {
      attentionCode: reasonCode,
      eventId,
      occurredAtMs: priorObservation?.observation.occurredAtMs ?? input.nowMs,
      status: "needs_attention",
    },
    task: input.task,
  });
  await markPreHeadFailurePublicationNeedsAttention({
    db: input.db,
    intent: input.intent,
    nowMs: input.nowMs,
    reasonCode,
  });
  console.warn(
    "[core.openMeldDaemon.dispatch_queue.pre_head_failure_needs_attention]",
    {
      dispatchId: input.intent.dispatchId,
      publishedSignalId: input.publishedSignalId,
      reasonCode,
    }
  );
};
const recordPreHeadPublicationTaskOutcome = async (input: {
  db: PostgresDatabase;
  env: CoreBindings;
  intent: PreHeadFailurePublicationIntent;
  nowMs: number;
}): Promise<AgentTaskTerminalOutcome["status"] | null> => {
  const message = input.intent.redriveMessage;
  if (!message.sourceClientMessageId) {
    return null;
  }
  // Space can reject a duplicate notice while returning a constructed signal.
  // Only its saved final claim supplies the task result locator and status.
  const claim = await readSpaceFinalOutcomeClaim({
    dispatchId: input.intent.dispatchId,
    env: input.env,
    spaceId: message.spaceId,
    targetProfileId: message.targetProfileId,
  });
  if (!claim || claim.outcome === "unknown") {
    throw new Error("dispatch.pre_head_failure_final_claim_required");
  }
  const task = {
    kind: "space_wake" as const,
    sourceClientMessageId: message.sourceClientMessageId,
    spaceId: message.spaceId,
    targetProfileId: message.targetProfileId,
    v: 1 as const,
  };
  const stored = await readAgentTaskTerminalOutcome({
    db: input.db,
    taskKey: buildAgentTaskKey(task),
  });
  let status: AgentTaskTerminalOutcome["status"] = "failed";
  let errorCode: string | null = input.intent.errorCode;
  if (claim.outcome === "success") {
    status = "succeeded";
    errorCode = null;
  } else if (claim.outcome === "stopped") {
    status = "stopped";
    errorCode = RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE;
  } else if (stored?.outcome.status === "publication_failed") {
    status = "publication_failed";
  }
  if (
    stored &&
    (stored.outcome.status !== status ||
      stored.outcome.publishedSignalId !== claim.signalId)
  ) {
    throw new Error("dispatch.pre_head_failure_task_outcome_conflict");
  }
  if (
    !stored &&
    (claim.outcome !== "failure" ||
      claim.signalId !==
        input.intent.publicationCommand.preHeadFailurePublication?.signalId)
  ) {
    // Space publication and the original producer's Task write are separate
    // durable steps. Do not invent that producer's event or completion time
    // in the gap: its frozen command must remain replayable without conflict.
    throw new Error("dispatch.pre_head_failure_task_outcome_owner_pending");
  }
  const outcome: AgentTaskTerminalOutcome = stored?.outcome ?? {
    errorCode,
    eventId: `pre-head-final-outcome:${input.intent.dispatchId}:${claim.signalId}`,
    occurredAtMs: input.intent.createdAtMs,
    publishedSignalId: claim.signalId,
    status,
  };
  const recorded = await recordAndEnqueueAgentTaskTerminalOutcomeIfMatching({
    db: input.db,
    env: input.env,
    nowMs: input.nowMs,
    outcome,
    task,
  });
  if (!recorded.matches) {
    throw new Error("dispatch.pre_head_failure_task_outcome_conflict");
  }
  return recorded.storedOutcome.status;
};
const redrivePreHeadFailurePublication = async (input: {
  env: CoreBindings;
  intent: PreHeadFailurePublicationIntent;
  message: QueueBatchMessage;
  nowMs: number;
  recoveryDb: PostgresDatabase;
}): Promise<boolean> => {
  const delaySeconds = resolveDispatchRetryDelaySeconds({
    attempt: input.intent.attemptCount + 1,
    errorCode: PRE_HEAD_FAILURE_PUBLICATION_PENDING_ERROR_CODE,
  });
  try {
    await reschedulePreHeadFailurePublicationIntent({
      db: input.recoveryDb,
      intent: input.intent,
      nextAttemptAtMs: input.nowMs + delaySeconds * 1000,
      nowMs: input.nowMs,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.pre_head_failure_reschedule_failed]",
      {
        dispatchId: input.intent.dispatchId,
        error: toErrorMessage(error),
        idempotencyKey: input.intent.idempotencyKey,
      }
    );
    retryQueueMessage(input.message, { delaySeconds });
    return false;
  }
  const queue = input.env.OPENMELD_DAEMON_DISPATCH_QUEUE;
  if (queue && typeof queue.send === "function") {
    try {
      await queue.send(input.intent.redriveMessage, { delaySeconds });
      return true;
    } catch (error) {
      console.warn(
        "[core.openMeldDaemon.dispatch_queue.pre_head_failure_redrive_enqueue_failed]",
        {
          delaySeconds,
          dispatchId: input.intent.dispatchId,
          error: toErrorMessage(error),
          idempotencyKey: input.intent.idempotencyKey,
        }
      );
    }
  }
  return true;
};
export const retryPendingPreHeadFailurePublications = async (input: {
  db: PostgresDatabase;
  env: CoreBindings;
  limit?: number;
  nowMs: number;
}): Promise<{
  enqueued: number;
  errors: number;
  scanned: number;
}> => {
  const intents = await listDuePreHeadFailurePublicationIntents({
    db: input.db,
    limit: input.limit ?? 50,
    nowMs: input.nowMs,
  });
  const queue = input.env.OPENMELD_DAEMON_DISPATCH_QUEUE;
  let enqueued = 0;
  let errors = 0;
  for (const intent of intents) {
    if (!(queue && typeof queue.send === "function")) {
      errors += 1;
      continue;
    }
    try {
      await queue.send(intent.redriveMessage);
      enqueued += 1;
    } catch (error) {
      errors += 1;
      console.warn(
        "[core.openMeldDaemon.dispatch_queue.pre_head_failure_scheduled_enqueue_failed]",
        {
          dispatchId: intent.dispatchId,
          error: toErrorMessage(error),
          idempotencyKey: intent.idempotencyKey,
        }
      );
    }
  }
  return { enqueued, errors, scanned: intents.length };
};
// Feed the authoritative Auth profile.not_found verdict into the Space
// membership liveness evidence ledger, so cleanup convergence is
// write-driven instead of depending on someone opening the members surface.
// Member removal stays owned by the Space background alarm (observation
// threshold + fresh Auth re-verification). Best-effort by design: an
// evidence write failure must never block dispatch terminalization or ack.
const recordSpaceMemberProfileNotFoundObservationBestEffort = async (input: {
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<void> => {
  try {
    const spaceStub = input.env.OPENMELD_SPACES
      ? resolveSpaceStub(input.env.OPENMELD_SPACES, input.message.spaceId)
      : null;
    if (!spaceStub) {
      return;
    }
    await spaceStub.rpcRecordMemberProfileNotFoundObservation({
      profileId: input.message.targetProfileId,
      spaceId: input.message.spaceId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.member_liveness_observation_failed]",
      {
        dispatchId: input.message.dispatchId,
        error: toErrorMessage(error),
        targetProfileId: input.message.targetProfileId,
      }
    );
  }
};
const handleDispatchQueueProcessingFailure = async (input: {
  db: PostgresDatabase;
  deliveryPath: "direct" | "queue";
  env: CoreBindings;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  executionAttemptId: string;
  message: QueueBatchMessage;
  queueAttempt: number;
  nowMs: number;
  error: unknown;
  executionContext: DispatchExecutionContext | null;
  runtimeExecutionDelivered: boolean;
}): Promise<boolean> => {
  const failureAtMs = Date.now();
  const errorMessage = toErrorMessage(input.error);
  const errorCode = resolveDispatchErrorCode(input.error, errorMessage);
  if (isRuntimeTaskDedupedErrorCode(errorCode)) {
    await settleRuntimeTaskDedupedCorrelationLost({
      controllerKey: null,
      agentControllerRef: null,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorCode,
      errorMessage,
      executionAttemptId: input.executionAttemptId,
      executionAttemptNo: input.queueAttempt,
      executionContext: input.executionContext,
      nowMs: failureAtMs,
      targetProfileName:
        input.dispatchMessage.targetProfileNameSnapshot ?? null,
    });
    return true;
  }
  if (errorCode === RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE) {
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
      db: input.db,
      errorCode,
      errorMessage,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      nowMs: failureAtMs,
      status: OPENMELD_DAEMON_DISPATCH_STATE.cancelled,
    });
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: "runtime_coordinator.pre_agent_stop_delivery_rejected",
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        errorCode,
        executionAttemptId: input.executionAttemptId,
        runtimeExecutionDelivered: input.runtimeExecutionDelivered,
        targetProfileId: input.dispatchMessage.targetProfileId,
      },
      decidedBy: "core.dispatch_queue.runtime_coordinator_head",
      decidedAtMs: failureAtMs,
      expectedRecoveryCriteria:
        "RuntimeCoordinator rejected local delivery because the Wake was stopped before execution.",
      source: "dispatch_queue",
      correlationId: input.dispatchMessage.dispatchId,
    });
    return true;
  }
  const routeOwnershipState = await resolveRouteOwnershipStateForRetryableError(
    {
      env: input.env,
      dispatchMessage: input.dispatchMessage,
      errorCode,
      executionContext: input.executionContext,
    }
  );
  const errorCategory = classifyDispatchError(input.error, errorMessage);
  const shouldRetry =
    (errorCategory === "retryable" &&
      shouldRetryDispatchAttemptForErrorCode({
        attempt: input.queueAttempt,
        errorCode,
      })) ||
    (errorCategory === "unknown" &&
      shouldRetryUnknownDispatchAttempt(input.queueAttempt));
  console.warn("[core.openmeld.dispatch.failure_classified]", {
    event: "core.openmeld.dispatch.failure_classified",
    attemptId: input.executionAttemptId,
    attemptNo: input.queueAttempt,
    deliveryPath: input.deliveryPath,
    dispatchId: input.dispatchMessage.dispatchId,
    errorCategory,
    errorCode,
    errorMessage,
    errorName: toErrorName(input.error),
    shouldRetry,
    targetProfileId: input.dispatchMessage.targetProfileId,
  });
  const runtimeCoordinatorDecision =
    await decideRuntimeCoordinatorFailureForBackedExecution({
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorCode,
      executionAttemptId: input.executionAttemptId,
      executionContext: input.executionContext,
      runtimeExecutionDelivered: input.runtimeExecutionDelivered,
      source: "queue_failure",
    });
  const runtimeCoordinatorQueueFailureHandled =
    handleRuntimeCoordinatorQueueFailureDecision({
      decision: runtimeCoordinatorDecision,
      // A D1 schema fault must end terminal even on the RuntimeCoordinator-backed
      // path — retrying cannot create a missing table, so it must never be
      // re-queued via retry_later. (Scoped to schema faults specifically: other
      // non-retryable errors with a transient RC handoff issue still pend.)
      forceTerminal: isPostgresSchemaError(input.error),
      message: input.message,
      queueAttempt: input.queueAttempt,
    });
  if (runtimeCoordinatorQueueFailureHandled.handled) {
    return runtimeCoordinatorQueueFailureHandled.shouldAck;
  }
  const preExecutionHeadLifecycleFailureHandled =
    await handlePreExecutionHeadLifecycleFailureIfNeeded({
      runtimeExecutionDelivered: input.runtimeExecutionDelivered,
      db: input.db,
      dispatchMessage: input.dispatchMessage,
      env: input.env,
      errorCode,
      errorMessage,
      executionAttemptId: input.executionAttemptId,
      failureAtMs,
      message: input.message,
      queueAttempt: input.queueAttempt,
    });
  if (preExecutionHeadLifecycleFailureHandled.handled) {
    return preExecutionHeadLifecycleFailureHandled.shouldAck;
  }
  await writeStaleLeaseAuditDecisionIfNeeded({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    executionContext: input.executionContext,
    errorCode,
    retryCount: input.queueAttempt,
    nowMs: failureAtMs,
  });
  await writeRetryOpsDecisionIfNeeded({
    db: input.db,
    dispatchMessage: input.dispatchMessage,
    executionContext: input.executionContext,
    errorCode,
    nowMs: failureAtMs,
    routeOwnershipState,
    retryCount: input.queueAttempt,
    shouldRetry,
  });
  if (shouldRetry) {
    const attemptStatus = isDispatchAttemptTimeoutErrorCode(errorCode)
      ? OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut
      : OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;
    await markDispatchStatus({
      attemptId: input.executionAttemptId,
      attemptStatus,
      db: input.db,
      idempotencyKey: input.dispatchMessage.idempotencyKey,
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
      errorCode,
      errorMessage,
      nowMs: failureAtMs,
    });
    await emitRetryingActivitySignal({
      env: input.env,
      errorCode,
      message: input.dispatchMessage,
    });
    console.info("[core.openmeld.dispatch.retry_scheduled]", {
      event: "core.openmeld.dispatch.retry_scheduled",
      attemptId: input.executionAttemptId,
      attemptNo: input.queueAttempt,
      dispatchId: input.dispatchMessage.dispatchId,
      errorCode,
      targetProfileId: input.dispatchMessage.targetProfileId,
    });
    retryQueueMessageWithBackoff(input.message, input.queueAttempt, errorCode);
    return false;
  }
  if (input.error instanceof HostedNativeDeliverySubmissionError) {
    try {
      await publishRemoteAgentFailureNotice({
        env: input.env,
        errorCode,
        message: input.dispatchMessage,
        text: buildHostedNativeDeliverySystemFailureText(
          input.dispatchMessage.targetProfileNameSnapshot
        ),
      });
    } catch (publicationError) {
      throw new HostedNativeDeliveryFailurePublicationError({
        cause: publicationError,
        dispatchId: input.dispatchMessage.dispatchId,
      });
    }
  }
  await writeDispatchDlq({
    db: input.db,
    message: input.dispatchMessage,
    errorCode,
    errorMessage,
    nowMs: failureAtMs,
  });
  await markDispatchStatus({
    attemptId: input.executionAttemptId,
    attemptStatus: isDispatchAttemptTimeoutErrorCode(errorCode)
      ? OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut
      : OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    errorCode,
    errorMessage,
    nowMs: failureAtMs,
  });
  await emitDispatchFailureActivitySignal({
    env: input.env,
    message: input.dispatchMessage,
    errorCode,
    ...(errorMessage ? { errorMessage } : {}),
  });
  await emitDispatchFailureHintSignal({
    db: input.db,
    env: input.env,
    message: input.dispatchMessage,
    errorCode,
    errorMessage,
    failureContext: "execution_terminal",
  });
  return true;
};
const handleInvalidDispatchQueuePayload = async (input: {
  db: PostgresDatabase;
  message: QueueBatchMessage;
  payload: Extract<
    ResolvedIncomingQueueMessage,
    {
      kind: "invalid" | "legacy_v1";
    }
  >;
}): Promise<void> => {
  console.error("[core.openMeldDaemon.dispatch_queue.invalid_payload]", {
    event: CORE_LOG_EVENTS.dispatchQueueInvalidPayload,
    issues: input.payload.issues,
  });
  try {
    await writeInvalidDispatchPayloadDlq({
      db: input.db,
      body: input.message.body,
      issues: input.payload.issues,
      nowMs: Date.now(),
    });
  } catch (error) {
    console.error(
      "[core.openMeldDaemon.dispatch_queue.invalid_payload_audit_failed]",
      {
        event: CORE_LOG_EVENTS.dispatchQueueInvalidPayloadAuditFailed,
        error: toErrorMessage(error),
      }
    );
    input.message.retry();
    return;
  }
  input.message.ack();
};
const resolveIncomingQueueMessage = (
  body: unknown
): ResolvedIncomingQueueMessage => {
  const parsed = parseOpenMeldDaemonDispatchQueueIngress(body);
  if (parsed.kind === "current_v2") {
    return parsed;
  }
  if (parsed.kind === "remote_agent_deadline_probe") {
    return parsed;
  }
  if (parsed.kind === "agent_task_continuation") {
    return parsed;
  }
  if (parsed.kind === "agent_task_observation_redrive") {
    return parsed;
  }
  if (parsed.kind === "legacy_v1") {
    return {
      kind: "legacy_v1",
      issues: parsed.issues,
      receivedQueueSchemaVersion: parsed.receivedQueueSchemaVersion,
    };
  }
  return {
    kind: "invalid",
    issues: parsed.issues,
    receivedQueueSchemaVersion: parsed.receivedQueueSchemaVersion,
  };
};
const retryBatchMessages = (batch: MessageBatch<unknown>): void => {
  for (const message of batch.messages) {
    retryQueueMessage(message);
  }
};
const retryQueueMessage = (
  message: QueueBatchMessage,
  input?: {
    delaySeconds?: number;
  }
): void => {
  const retryWithThis = message.retry.bind(message);
  try {
    retryWithThis(input);
  } catch (error) {
    // Keep compatibility with runtime implementations that do not support retry options.
    console.error("[core.openMeldDaemon.dispatch_queue.retry_failed]", {
      event: CORE_LOG_EVENTS.dispatchQueueRetryFailed,
      error: toErrorMessage(error),
      attempts: (
        message as {
          attempts?: number;
        }
      ).attempts,
    });
    if (typeof input === "undefined") {
      return;
    }
    try {
      retryWithThis();
    } catch (fallbackError) {
      console.error(
        "[core.openMeldDaemon.dispatch_queue.retry_failed_no_options]",
        {
          event: CORE_LOG_EVENTS.dispatchQueueRetryFailedNoOptions,
          error: toErrorMessage(fallbackError),
          attempts: (
            message as {
              attempts?: number;
            }
          ).attempts,
        }
      );
    }
  }
};
const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
const toErrorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;
const buildUnsupportedVersionErrorMessage = (input: {
  receivedDispatchContractVersion: number;
  receivedQueueSchemaVersion?: number;
}): string => {
  return JSON.stringify({
    expectedDispatchContractVersion: OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION,
    receivedDispatchContractVersion: input.receivedDispatchContractVersion,
    ...(typeof input.receivedQueueSchemaVersion === "number"
      ? { receivedQueueSchemaVersion: input.receivedQueueSchemaVersion }
      : {}),
    summary: "dispatch contract version unsupported",
  });
};
const handleUnsupportedDispatchContractVersion = async (input: {
  attempt: number;
  db: PostgresDatabase;
  message: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
  receivedQueueSchemaVersion?: number;
}): Promise<void> => {
  const claimState = await claimDispatchAttempt({
    db: input.db,
    message: input.message,
    attempt: input.attempt,
    nowMs: input.nowMs,
  });
  if (claimState.status === "deduped") {
    return;
  }
  await writeDispatchDlq({
    db: input.db,
    message: input.message,
    errorCode: "unsupported_version",
    errorMessage: buildUnsupportedVersionErrorMessage({
      receivedDispatchContractVersion: input.message.dispatchContractVersion,
      receivedQueueSchemaVersion: input.receivedQueueSchemaVersion,
    }),
    nowMs: input.nowMs,
  });
  await markDispatchStatus({
    attemptId: claimState.attemptId,
    attemptStatus: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    db: input.db,
    errorCode: "unsupported_version",
    errorMessage: buildUnsupportedVersionErrorMessage({
      receivedDispatchContractVersion: input.message.dispatchContractVersion,
      receivedQueueSchemaVersion: input.receivedQueueSchemaVersion,
    }),
    idempotencyKey: input.message.idempotencyKey,
    status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    nowMs: input.nowMs,
  });
};
const resolveRouteOwnershipStateForRetryableError = async (input: {
  env: CoreBindings;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  errorCode: string;
  executionContext: DispatchExecutionContext | null;
}): Promise<RouteOwnershipState> => {
  if (input.errorCode !== "daemon.session.not_found") {
    return "unknown";
  }
  const daemonSessionId = normalizeOptionalText(
    input.executionContext?.daemonSessionId
  );
  const connectionGeneration =
    input.executionContext?.connectionGeneration ?? null;
  const leaseEpoch = input.executionContext?.leaseEpoch ?? null;
  if (
    !(
      daemonSessionId &&
      typeof connectionGeneration === "number" &&
      connectionGeneration > 0 &&
      typeof leaseEpoch === "number" &&
      leaseEpoch > 0
    )
  ) {
    return "unknown";
  }
  const preflightCheck = await runDispatchExecutionPreflightGate({
    env: input.env,
    message: input.dispatchMessage,
  }).catch(() => null);
  if (!preflightCheck?.ok) {
    return "unknown";
  }
  const ownerUserId = normalizeOptionalText(
    preflightCheck.effectiveTargetBindingSnapshot.ownerUserId
  );
  if (!ownerUserId) {
    return "unknown";
  }
  const route = await lookupRuntimeTransportRoute({
    blockForgottenDevices: true,
    env: input.env,
    ownerUserId,
    profileId: input.dispatchMessage.targetProfileId,
  }).catch(() => null);
  if (!route) {
    return "unknown";
  }
  if (!route.online) {
    return "lost";
  }
  if (
    route.daemonSessionId === daemonSessionId &&
    route.connectionGeneration === connectionGeneration &&
    route.leaseEpoch === leaseEpoch
  ) {
    return "active";
  }
  return "lost";
};
const writeStaleLeaseAuditDecisionIfNeeded = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  executionContext: DispatchExecutionContext | null;
  errorCode: string;
  retryCount: number;
  nowMs: number;
}): Promise<void> => {
  if (
    input.errorCode !== "stale_lease_result_rejected" &&
    input.errorCode !== "daemon.session.stale_lease" &&
    input.errorCode !== "daemon.session.connection_replaced"
  ) {
    return;
  }
  const resolvedContext = input.executionContext ?? {
    connectionGeneration: null,
    daemonSessionId: AUDIT_UNKNOWN_DAEMON_SESSION_ID,
    leaseEpoch: AUDIT_UNKNOWN_LEASE_EPOCH,
  };
  if (!input.executionContext) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.stale_lease_audit_fallback_context]",
      {
        event: CORE_LOG_EVENTS.dispatchQueueStaleLeaseAuditFallbackContext,
        dispatchId: input.dispatchMessage.dispatchId,
        profileId: input.dispatchMessage.targetProfileId,
        reasonCode: input.errorCode,
        retryCount: input.retryCount,
      }
    );
  }
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: SESSION_REPLACED_DECISION_CODE,
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        profileId: input.dispatchMessage.targetProfileId,
        connectionGeneration: resolvedContext.connectionGeneration,
        daemonSessionId: resolvedContext.daemonSessionId,
        leaseEpoch: resolvedContext.leaseEpoch,
        reasonCode: input.errorCode,
        retryCount: input.retryCount,
      },
      decidedBy: SESSION_REPLACED_DECIDED_BY,
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "owner rebinds active session and receives current daemon lease event",
      source: "dispatch_queue_consumer",
      correlationId: input.dispatchMessage.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.stale_lease_audit_failed]",
      {
        event: CORE_LOG_EVENTS.dispatchQueueStaleLeaseAuditFailed,
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(error),
        reasonCode: input.errorCode,
      }
    );
  }
};
const writeRetryOpsDecisionIfNeeded = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  executionContext: DispatchExecutionContext | null;
  errorCode: string;
  nowMs: number;
  routeOwnershipState: RouteOwnershipState;
  retryCount: number;
  shouldRetry: boolean;
}): Promise<void> => {
  if (!input.shouldRetry) {
    return;
  }
  const resolvedContext = input.executionContext ?? {
    connectionGeneration: null,
    daemonSessionId: AUDIT_UNKNOWN_DAEMON_SESSION_ID,
    leaseEpoch: AUDIT_UNKNOWN_LEASE_EPOCH,
  };
  let decisionCode: string | null = null;
  let decidedBy: string | null = null;
  if (
    input.routeOwnershipState === "lost" &&
    (input.errorCode === "daemon.delivery.timeout" ||
      input.errorCode === "daemon.session.not_found")
  ) {
    decisionCode = ROUTE_LOST_REDRIVE_DECISION_CODE;
    decidedBy = ROUTE_LOST_REDRIVE_DECIDED_BY;
  } else if (input.errorCode === "daemon.session.connection_replaced") {
    decisionCode = CONNECTION_REPLACED_REDRIVE_DECISION_CODE;
    decidedBy = CONNECTION_REPLACED_REDRIVE_DECIDED_BY;
  }
  if (!(decisionCode && decidedBy)) {
    return;
  }
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode,
      decisionPayload: {
        attemptId:
          input.executionContext?.attemptId ??
          `missing-attempt:${input.dispatchMessage.dispatchId}`,
        connectionGeneration: resolvedContext.connectionGeneration,
        daemonSessionId: resolvedContext.daemonSessionId,
        dispatchId: input.dispatchMessage.dispatchId,
        leaseEpoch: resolvedContext.leaseEpoch,
        reasonCode: input.errorCode,
        retryCount: input.retryCount,
      },
      decidedBy,
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "redrive only after the active daemon route is lost or replaced",
      source: "dispatch_queue_consumer",
      correlationId: input.dispatchMessage.dispatchId,
    });
  } catch (error) {
    console.warn(
      "[core.openMeldDaemon.dispatch_queue.route_lost_redrive_audit_failed]",
      {
        dispatchId: input.dispatchMessage.dispatchId,
        error: toErrorMessage(error),
        reasonCode: input.errorCode,
      }
    );
  }
};
const emitDispatchFailureHintSignal = async (input: {
  db: PostgresDatabase;
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  errorCode: string;
  errorMessage?: string;
  failureContext: DispatchFailureHintContext;
}): Promise<"not_required" | "persisted" | "retry_required"> => {
  if (
    !shouldPersistDispatchFailureHintToSpaceHistory({
      errorCode: input.errorCode,
      failureContext: input.failureContext,
    })
  ) {
    return "not_required";
  }
  try {
    const targetProfileName =
      normalizeOptionalText(input.message.targetProfileNameSnapshot) ??
      (await resolveDispatchTargetProfileName({
        authRpc: input.env.OPENMELD_AUTH_WORKER,
        targetProfileId: input.message.targetProfileId,
      }));
    const targetProfileLabel = targetProfileName
      ? `Agent "${targetProfileName}"`
      : "This agent";
    const text = resolveDispatchFailureHintText({
      errorCode: input.errorCode,
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      targetProfileLabel,
    });
    if (!text) {
      return "not_required";
    }
    const requestContext = buildDispatchSystemRequestContext({
      message: input.message,
      requestIdPrefix: "openMeldDaemon-dispatch-hint",
    });
    await emitSpaceSystemNoticeSignal({
      env: input.env,
      spaceId: input.message.spaceId,
      profile: {
        kind: "system",
        profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
        profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
      },
      data: {
        noticeType: "terminal_failure",
        actorProfileId: input.message.targetProfileId,
        ...(targetProfileName ? { actorName: targetProfileName } : {}),
        dispatchId: input.message.dispatchId,
        generatedBy: "openmeld",
        reason: input.errorCode,
        reasonCode: input.errorCode,
        // Queue failure hints only fire when no terminal reply has settled
        // for this Wake (callers gate on terminalReplySettled), so the
        // failure happened while executing/delivering the Wake, not while
        // publishing an already-settled agent outcome.
        failureStage: "execution",
        ...(input.message.replyToSnapshot
          ? { replyTo: input.message.replyToSnapshot }
          : {}),
        text,
      },
      spaceAccess: buildDispatchSystemSpaceAccess({
        message: input.message,
        requestIdPrefix: "openMeldDaemon-dispatch-hint",
      }),
      ...(input.message.threadContext
        ? { threadContext: input.message.threadContext }
        : {}),
      context: requestContext,
    });
    return "persisted";
  } catch (error) {
    console.warn("[core.openMeldDaemon.dispatch_queue.hint_emit_failed]", {
      event: CORE_LOG_EVENTS.dispatchQueueHintEmitFailed,
      dispatchId: input.message.dispatchId,
      errorCode: input.errorCode,
      error: toErrorMessage(error),
    });
    return "retry_required";
  }
};
const buildPreHeadFailurePublicationCommand = (input: {
  errorCode: string;
  errorMessage?: string | null;
  message: OpenMeldDaemonDispatchQueueMessage;
}): PreHeadFailurePublicationCommand => {
  const targetProfileName = normalizeOptionalText(
    input.message.targetProfileNameSnapshot
  );
  const targetProfileLabel = targetProfileName
    ? `Agent "${targetProfileName}"`
    : "This agent";
  const text = resolveDispatchFailureHintText({
    errorCode: input.errorCode,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    targetProfileLabel,
  });
  if (!text) {
    throw new Error(
      "dispatch.pre_head_failure_publication_visible_receipt_required"
    );
  }
  const requestContext = buildDispatchSystemRequestContext({
    message: input.message,
    requestIdPrefix: "openMeldDaemon-dispatch-hint",
  });
  return {
    context: requestContext,
    preHeadFailurePublication: { signalId: crypto.randomUUID() },
    data: {
      noticeType: "terminal_failure",
      actorProfileId: input.message.targetProfileId,
      ...(targetProfileName ? { actorName: targetProfileName } : {}),
      dispatchId: input.message.dispatchId,
      generatedBy: "openmeld",
      reason: input.errorCode,
      reasonCode: input.errorCode,
      failureStage: "execution",
      ...(input.message.replyToSnapshot
        ? { replyTo: input.message.replyToSnapshot }
        : {}),
      text,
    },
    profile: {
      kind: "system",
      profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
      profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
    },
    spaceAccess: buildDispatchSystemSpaceAccess({
      message: input.message,
      requestIdPrefix: "openMeldDaemon-dispatch-hint",
    }),
    spaceId: input.message.spaceId,
  };
};
const emitFrozenPreHeadFailurePublication = async (input: {
  env: CoreBindings;
  intent: PreHeadFailurePublicationIntent;
}): Promise<"persisted" | "retry_required"> => {
  try {
    await emitSpaceSystemNoticeSignal({
      env: input.env,
      ...input.intent.publicationCommand,
      finalOutcomeAuthority: "runtime_coordinator_failure_publication",
      ...(input.intent.redriveMessage.threadContext
        ? { threadContext: input.intent.redriveMessage.threadContext }
        : {}),
    });
    return "persisted";
  } catch (error) {
    console.warn("[core.openMeldDaemon.dispatch_queue.hint_emit_failed]", {
      event: CORE_LOG_EVENTS.dispatchQueueHintEmitFailed,
      dispatchId: input.intent.dispatchId,
      errorCode: input.intent.errorCode,
      error: toErrorMessage(error),
    });
    return "retry_required";
  }
};
const resolveDispatchActivityTargetLabel = (
  message: OpenMeldDaemonDispatchQueueMessage
): string => {
  return (
    normalizeOptionalText(message.targetProfileMentionLabel) ??
    normalizeOptionalText(message.targetProfileNameSnapshot) ??
    message.targetProfileId
  );
};
const emitDispatchingActivitySignal = async (input: {
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<void> => {
  try {
    await emitDispatchActivitySignal({
      env: input.env,
      dispatchMessage: input.message,
      purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
      text: buildDispatchingActivityText(
        resolveDispatchActivityTargetLabel(input.message)
      ),
      targetMentionLabel: input.message.targetProfileMentionLabel,
      targetProfileName: input.message.targetProfileNameSnapshot,
    });
  } catch (error) {
    console.warn("[core.openMeldDaemon.dispatch_queue.activity_emit_failed]", {
      dispatchId: input.message.dispatchId,
      purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
      error: toErrorMessage(error),
    });
  }
};
const logDispatchQueueServerTiming = (input: {
  deliveryPath: "direct" | "queue";
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  env: CoreBindings;
  metrics: readonly SpaceBootstrapTimingMetric[];
}): void => {
  if (input.metrics.length === 0) {
    return;
  }
  console.info("[core.openMeldDaemon.dispatch_queue.server_timing]", {
    deliveryPath: input.deliveryPath,
    dispatchId: input.dispatchMessage.dispatchId,
    event: "core.openMeldDaemon.dispatch_queue.server_timing",
    metrics: input.metrics,
    serverTiming: formatSpaceBootstrapServerTiming(input.metrics),
    sourceEventId: input.dispatchMessage.sourceEventId,
    targetProfileId: input.dispatchMessage.targetProfileId,
    taskId: input.dispatchMessage.taskId,
  });
  const runtimeKind =
    input.deliveryPath === "direct" ? "durable_object" : "queue";
  for (const metric of input.metrics) {
    emitCoreCloudflareRuntimeEvidence(input.env, {
      event: "core.openmeld.dispatch.queue_server_timing",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
      runtimeKind,
      status: "succeeded",
      operation: `openMeldDaemon-dispatch-${input.deliveryPath}`,
      durationMs: metric.durationMs,
      reasonCode: metric.name,
      spaceId: input.dispatchMessage.spaceId,
      clientMessageId: input.dispatchMessage.sourceClientMessageId ?? null,
      sourceSignalId: input.dispatchMessage.sourceEventId,
      targetProfileId: input.dispatchMessage.targetProfileId,
      dispatchId: input.dispatchMessage.dispatchId,
      messageCount: 1,
    });
  }
};
const emitRetryingActivitySignal = async (input: {
  env: CoreBindings;
  errorCode?: string | null;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<void> => {
  try {
    await emitDispatchActivitySignal({
      env: input.env,
      errorCode: input.errorCode,
      dispatchMessage: input.message,
      purpose: DISPATCH_ACTIVITY_RETRYING_PURPOSE,
      text: buildRetryingActivityText({
        errorCode: input.errorCode,
        targetProfileLabel: resolveDispatchActivityTargetLabel(input.message),
      }),
      targetProfileName: input.message.targetProfileNameSnapshot,
    });
  } catch (error) {
    console.warn("[core.openMeldDaemon.dispatch_queue.activity_emit_failed]", {
      dispatchId: input.message.dispatchId,
      purpose: DISPATCH_ACTIVITY_RETRYING_PURPOSE,
      error: toErrorMessage(error),
    });
  }
};
const emitDispatchFailureActivitySignal = async (input: {
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  errorCode: string;
  errorMessage?: string;
}): Promise<void> => {
  const targetProfileLabel = resolveDispatchActivityTargetLabel(input.message);
  const text = resolveDispatchFailureActivityText({
    errorCode: input.errorCode,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    targetProfileLabel,
  });
  if (!text) {
    return;
  }
  try {
    await emitDispatchActivitySignal({
      env: input.env,
      errorCode: input.errorCode,
      dispatchMessage: input.message,
      purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
      text,
      targetProfileName: input.message.targetProfileNameSnapshot,
    });
  } catch (error) {
    console.warn("[core.openMeldDaemon.dispatch_queue.activity_emit_failed]", {
      dispatchId: input.message.dispatchId,
      purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
      error: toErrorMessage(error),
    });
  }
};
const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};
const resolveQueueAttempt = (message: QueueBatchMessage): number => {
  const rawAttempts = (
    message as {
      attempts?: unknown;
    }
  ).attempts;
  if (typeof rawAttempts !== "number" || !Number.isFinite(rawAttempts)) {
    return 1;
  }
  return Math.max(1, Math.trunc(rawAttempts));
};
const createDirectDispatchQueueMessage = (
  body: OpenMeldDaemonDispatchQueueMessage
): DirectDispatchQueueMessage => {
  let acked = false;
  let retryDelaySeconds: number | null = null;
  let retryRequested = false;
  const message = {
    ack: () => {
      acked = true;
    },
    attempts: 1,
    body,
    id: `direct:${body.dispatchId}`,
    retry: (options?: Parameters<QueueBatchMessage["retry"]>[0]) => {
      retryRequested = true;
      retryDelaySeconds = normalizeQueueRetryDelaySeconds(
        options?.delaySeconds
      );
    },
    timestamp: new Date(body.enqueuedAtMs),
  };
  return Object.defineProperties(message, {
    acked: {
      get: () => acked,
    },
    retryDelaySeconds: {
      get: () => retryDelaySeconds,
    },
    retryRequested: {
      get: () => retryRequested,
    },
  }) as DirectDispatchQueueMessage;
};
const normalizeQueueRetryDelaySeconds = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
};
const retryQueueMessageWithBackoff = (
  message: QueueBatchMessage,
  attempt: number,
  errorCode: string
): void => {
  const delaySeconds = resolveDispatchRetryDelaySeconds({
    attempt,
    errorCode,
  });
  retryQueueMessage(message, { delaySeconds });
};
const writePreflightOpsDecisionIfNeeded = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  preflightCheck: Extract<
    Awaited<ReturnType<typeof runDispatchExecutionPreflightGate>>,
    {
      ok: false;
    }
  >;
  nowMs: number;
}): Promise<void> => {
  if (
    input.preflightCheck.errorCode !== "agent_profile_binding.lookup_failed" &&
    input.preflightCheck.errorCode !==
      "agent_profile_binding.profile_owner_unavailable"
  ) {
    return;
  }
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: input.preflightCheck.errorCode,
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        targetProfileId: input.dispatchMessage.targetProfileId,
        sourceEventId: input.dispatchMessage.sourceEventId,
        bindingSource: input.preflightCheck.bindingSource ?? null,
        errorMessage: input.preflightCheck.errorMessage,
      },
      decidedBy: "core.dispatch_queue.preflight",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "Core primary binding and target profile identity resolution path becomes healthy",
      source: "dispatch_queue_consumer",
      correlationId: input.dispatchMessage.dispatchId,
    });
  } catch (error) {
    console.warn("[core.openMeldDaemon.ops_decision_write_failed]", {
      event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
      decisionCode: input.preflightCheck.errorCode,
      dispatchId: input.dispatchMessage.dispatchId,
      error: toErrorMessage(error),
    });
  }
};
const emitDedupeWindowRiskIfNeeded = async (input: {
  db: PostgresDatabase;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  nowMs: number;
  queueAttempt: number;
}): Promise<void> => {
  const queueLagMs = Math.max(
    0,
    input.nowMs - input.dispatchMessage.enqueuedAtMs
  );
  if (!isDispatchDedupeWindowRisk(queueLagMs)) {
    return;
  }
  console.warn("[core.openMeldDaemon.dispatch_queue.risk]", {
    event: CORE_LOG_EVENTS.dispatchQueueRisk,
    code: DISPATCH_DEDUPE_WINDOW_RISK_CODE,
    dispatchId: input.dispatchMessage.dispatchId,
    idempotencyKey: input.dispatchMessage.idempotencyKey,
    queueAttempt: input.queueAttempt,
    queueLagMs,
  });
  try {
    await writeOpenMeldDaemonOpsDecision({
      db: input.db,
      decisionCode: DISPATCH_DEDUPE_WINDOW_RISK_CODE,
      decisionPayload: {
        dispatchId: input.dispatchMessage.dispatchId,
        idempotencyKey: input.dispatchMessage.idempotencyKey,
        queueAttempt: input.queueAttempt,
        queueLagMs,
      },
      decidedBy: "core.dispatch_queue.risk",
      decidedAtMs: input.nowMs,
      expectedRecoveryCriteria:
        "queue lag recovers below dedupe-window risk threshold",
      source: "dispatch_queue_consumer",
      correlationId: input.dispatchMessage.dispatchId,
    });
  } catch (error) {
    console.warn("[core.openMeldDaemon.ops_decision_write_failed]", {
      event: CORE_LOG_EVENTS.opsDecisionWriteFailed,
      decisionCode: DISPATCH_DEDUPE_WINDOW_RISK_CODE,
      dispatchId: input.dispatchMessage.dispatchId,
      error: toErrorMessage(error),
    });
  }
};
