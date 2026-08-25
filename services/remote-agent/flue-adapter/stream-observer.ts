import type { FlueObservation } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import {
  REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
} from "@openmeld/schemas";
import type { RemoteAgentRuntimeEvidenceOutcomeReasonCode } from "@openmeld/schemas/types";
import {
  buildRemoteAgentUsageRecord,
  handleRemoteAgentChatResponse,
  REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS,
  type RemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  waitForRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  completeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
} from "../agent-core/execution-state";
import { normalizeFluePromptUsage } from "../agent-core/usage";
import {
  classifyRemoteAgentTurnFailure,
  emitRemoteAgentCloudflareRuntimeEvidence,
  emitRemoteAgentExecutionStageEvidence,
} from "./cloudflare-runtime-evidence";
import {
  isConversationCompactionObservation,
  type RemoteAgentConversationCompactionObserver,
  remoteAgentConversationCompactionObserver,
} from "./conversation-compaction";
import { getRemoteAgentExecutionSubmissionId } from "./execution-context";
import {
  extractAssistantText,
  extractFlueStreamDelta,
  extractFlueToolLifecyclePart,
  extractModelId,
  type FlueStreamDelta,
  type FlueToolLifecyclePart,
} from "./observation";
import { recordOrganizationSkillActivation } from "./organization-skills";
import { createRemoteAgentSqlStorage } from "./storage";
import {
  isRemoteAgentStreamEligible,
  type RemoteAgentStreamPublisher,
  resolveRemoteAgentStreamContext,
} from "./streaming";
import { preserveToolWorkThroughCompletion } from "./tool-work-lifecycle";
import { emitRemoteAgentUsageRecord } from "./usage-observability";

type RemoteAgentObservationDependencies = {
  coreWorker: RemoteAgentCoreWorkerBinding;
  env: CloudflareBindings;
  storage: RemoteAgentStorage;
};

const ORGANIZATION_SKILL_ACTIVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ORGANIZATION_SKILL_ACTIVATION_PREFIX =
  "openmeld:remote-agent:organization-skill-activation:";

export async function handleCenterAgentObservation(input: {
  conversationCompactionObserver?: RemoteAgentConversationCompactionObserver;
  event: FlueObservation;
  resolveDependencies?: () => RemoteAgentObservationDependencies;
  scheduleBackground?: (task: Promise<void>) => void;
  streamPublisher: RemoteAgentStreamPublisher;
}): Promise<void> {
  if (input.event.agentName !== "center-agent") {
    return;
  }
  const event = isRemoteAgentExecutionObservation(input.event)
    ? correlateRemoteAgentObservation(input.event)
    : input.event;
  const conversationCompactionObserver =
    input.conversationCompactionObserver ??
    remoteAgentConversationCompactionObserver;
  if (isConversationCompactionObservation(event)) {
    conversationCompactionObserver.enqueue({
      event,
      storage: resolveDependencies(input.resolveDependencies).storage,
    });
    return;
  }
  const streamDelta = extractFlueStreamDelta(event);
  if (streamDelta) {
    await handleCenterAgentStreamDelta({
      dependencies: resolveDependencies(input.resolveDependencies),
      eventIndex: event.eventIndex,
      streamPublisher: input.streamPublisher,
      streamDelta,
    });
    return;
  }
  const toolPart = extractFlueToolLifecyclePart(event);
  if (toolPart) {
    await handleCenterAgentToolPart({
      dependencies: resolveDependencies(input.resolveDependencies),
      eventIndex: event.eventIndex,
      streamPublisher: input.streamPublisher,
      toolPart,
    });
    return;
  }
  if (!isPromptOperation(event)) {
    return;
  }
  await handleCenterAgentPromptCompletion({
    conversationCompactionObserver,
    dependencies: resolveDependencies(input.resolveDependencies),
    event,
    scheduleBackground: input.scheduleBackground,
    streamPublisher: input.streamPublisher,
  });
}

async function handleCenterAgentToolPart(input: {
  dependencies: RemoteAgentObservationDependencies;
  eventIndex: number;
  streamPublisher: RemoteAgentStreamPublisher;
  toolPart: FlueToolLifecyclePart;
}): Promise<void> {
  const { coreWorker, env, storage } = input.dependencies;
  const context = await resolveRemoteAgentStreamContext({
    storage,
    submissionId: input.toolPart.submissionId,
  });
  if (!context) {
    return;
  }
  await markRemoteAgentExecutionProgress({
    identity: buildRemoteAgentExecutionIdentity(context),
    nowMs: input.toolPart.observedAtMs,
    progressKind: resolveRemoteAgentToolProgressKind(input.toolPart),
    storage,
  });
  const activatedOrganizationSkillName =
    await resolveCompletedOrganizationSkillName({
      context,
      storage,
      toolPart: input.toolPart,
    });
  if (activatedOrganizationSkillName) {
    await recordOrganizationSkillActivation({
      context,
      coreWorker,
      skillName: activatedOrganizationSkillName,
    });
  }
  if (!isRemoteAgentStreamEligible(context)) {
    return;
  }
  try {
    const part = await preserveToolWorkThroughCompletion({
      storage,
      toolPart: input.toolPart,
    });
    if (!part.work) {
      return;
    }
    const result = await input.streamPublisher.pushPart({
      context,
      coreWorker,
      observedAtMs: input.toolPart.observedAtMs,
      part,
      storage,
    });
    logRemoteAgentStreamResult({
      context,
      env,
      eventIndex: input.eventIndex,
      observedAtMs: input.toolPart.observedAtMs,
      phase: "part",
      result,
      submissionId: input.toolPart.submissionId,
    });
  } catch (error) {
    logRemoteAgentStreamFailure({
      error,
      eventIndex: input.eventIndex,
      phase: "part",
      submissionId: input.toolPart.submissionId,
    });
  }
}

async function resolveCompletedOrganizationSkillName(input: {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
  toolPart: FlueToolLifecyclePart;
}): Promise<string | null> {
  if (input.toolPart.part.toolName !== "activate_skill") {
    return null;
  }
  const key = [
    ORGANIZATION_SKILL_ACTIVATION_PREFIX,
    input.context.submissionId,
    ":",
    input.toolPart.part.toolCallId,
  ].join("");
  if (input.toolPart.part.state === "input-available") {
    if (input.toolPart.organizationSkillName) {
      await input.storage.putExpiring(
        key,
        input.toolPart.organizationSkillName,
        input.toolPart.observedAtMs + ORGANIZATION_SKILL_ACTIVATION_MAX_AGE_MS
      );
    }
    return null;
  }
  const pendingName = await input.storage.takeUnexpired<string>(
    key,
    input.toolPart.observedAtMs
  );
  if (input.toolPart.part.state !== "output-available") {
    return null;
  }
  return input.toolPart.organizationSkillName ?? pendingName ?? null;
}

async function handleCenterAgentStreamDelta(input: {
  dependencies: RemoteAgentObservationDependencies;
  eventIndex: number;
  streamDelta: FlueStreamDelta;
  streamPublisher: RemoteAgentStreamPublisher;
}): Promise<void> {
  const { coreWorker, env, storage } = input.dependencies;
  const context = await resolveRemoteAgentStreamContext({
    storage,
    submissionId: input.streamDelta.submissionId,
  });
  if (!context) {
    return;
  }
  await markRemoteAgentExecutionProgress({
    identity: buildRemoteAgentExecutionIdentity(context),
    nowMs: input.streamDelta.observedAtMs,
    progressKind:
      input.streamDelta.kind === "thinking" ? "thinking_delta" : "text_delta",
    storage,
  });
  if (input.streamDelta.kind === "thinking") {
    return;
  }
  if (!isRemoteAgentStreamEligible(context)) {
    return;
  }
  try {
    const result = await input.streamPublisher.push({
      context,
      coreWorker,
      delta: input.streamDelta.delta,
      kind: input.streamDelta.kind,
      observedAtMs: input.streamDelta.observedAtMs,
      storage,
    });
    logRemoteAgentStreamResult({
      context,
      env,
      eventIndex: input.eventIndex,
      observedAtMs: input.streamDelta.observedAtMs,
      phase: "push",
      result,
      submissionId: input.streamDelta.submissionId,
    });
  } catch (error) {
    logRemoteAgentStreamFailure({
      error,
      eventIndex: input.eventIndex,
      phase: "push",
      submissionId: input.streamDelta.submissionId,
    });
  }
}

async function handleCenterAgentPromptCompletion(input: {
  conversationCompactionObserver: RemoteAgentConversationCompactionObserver;
  dependencies: RemoteAgentObservationDependencies;
  event: FlueObservation & { operationKind: "prompt"; type: "operation" };
  scheduleBackground?: (task: Promise<void>) => void;
  streamPublisher: RemoteAgentStreamPublisher;
}): Promise<void> {
  const { coreWorker, env, storage } = input.dependencies;
  const submissionId = resolveRemoteAgentObservationSubmissionId(
    input.event.submissionId
  );
  await input.conversationCompactionObserver.drain(submissionId);
  const callbackContext = await waitForRemoteAgentCallbackContext({
    storage,
    submissionId,
    waitMs: REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS,
  });
  const executionIdentity = callbackContext
    ? buildRemoteAgentExecutionIdentity(callbackContext)
    : null;
  await flushRemoteAgentStream({
    coreWorker,
    env,
    event: input.event,
    storage,
    streamPublisher: input.streamPublisher,
    submissionId,
  });

  const usage = normalizeFluePromptUsage(input.event.usage);
  const settledExecution = executionIdentity
    ? await completeRemoteAgentExecutionState({
        identity: executionIdentity,
        nowMs: Date.now(),
        status: input.event.isError ? "failed" : "completed",
        storage,
      })
    : null;
  const cancelled = settledExecution?.status === "aborted";
  const resultStatus = resolveRemoteAgentPromptResultStatus({
    cancelled,
    isError: input.event.isError,
  });
  const failureReasonCode = input.event.isError
    ? classifyRemoteAgentTurnFailure({
        error: input.event.error,
        errorInfo: input.event.errorInfo,
      }).reasonCode
    : undefined;
  let completed: RemoteAgentCallbackContext | null = null;
  try {
    completed = await handleRemoteAgentChatResponse({
      coreWorker,
      result: {
        continuation: false,
        error: input.event.isError
          ? {
              error: input.event.error,
              errorInfo: input.event.errorInfo,
            }
          : undefined,
        ...(failureReasonCode ? { failureReasonCode } : {}),
        message: {
          parts: [{ text: extractAssistantText(input.event), type: "text" }],
        },
        modelId: extractModelId(input.event),
        requestId: submissionId,
        status: resultStatus,
        usage,
      },
      storage,
    });
    if (completed?.lastUsage) {
      emitRemoteAgentUsageRecord(
        env,
        buildRemoteAgentUsageRecord({
          context: completed,
          modelId: completed.modelId ?? null,
          nowMs: Date.now(),
          usage: completed.lastUsage,
        })
      );
    }
  } finally {
    emitRemoteAgentTurnCompletionEvidence({
      completed,
      env,
      event: input.event,
      submissionId,
    });
    const cleanup = closeRemoteAgentStream({
      eventIndex: input.event.eventIndex,
      storage,
      streamPublisher: input.streamPublisher,
      submissionId,
    });
    if (input.scheduleBackground) {
      console.log("[remote_agent.stream_cleanup_scheduled]", {
        eventIndex: input.event.eventIndex,
        submissionId,
      });
      input.scheduleBackground(cleanup);
    } else {
      await cleanup;
    }
  }
}

export function resolveRemoteAgentObservationSubmissionId(
  eventSubmissionId?: string
): string {
  const normalizedEventSubmissionId = normalizeSubmissionId(eventSubmissionId);
  const executionSubmissionId = normalizeSubmissionId(
    getRemoteAgentExecutionSubmissionId()
  );
  if (
    normalizedEventSubmissionId &&
    executionSubmissionId &&
    normalizedEventSubmissionId !== executionSubmissionId
  ) {
    throw new Error(
      "Remote Agent observation submission identity does not match its Flue execution."
    );
  }
  const submissionId = normalizedEventSubmissionId ?? executionSubmissionId;
  if (!submissionId) {
    throw new Error(
      "Remote Agent observation is missing immutable submission identity."
    );
  }
  return submissionId;
}

function correlateRemoteAgentObservation(
  event: FlueObservation
): FlueObservation {
  const submissionId = resolveRemoteAgentObservationSubmissionId(
    event.submissionId
  );
  return event.submissionId === submissionId
    ? event
    : ({ ...event, submissionId } as FlueObservation);
}

function normalizeSubmissionId(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isRemoteAgentExecutionObservation(event: FlueObservation): boolean {
  return (
    event.type === "text_delta" ||
    event.type === "thinking_delta" ||
    event.type === "tool_start" ||
    event.type === "tool" ||
    event.type === "compaction_start" ||
    event.type === "compaction" ||
    (event.type === "operation" && event.operationKind === "prompt")
  );
}

function resolveRemoteAgentToolProgressKind(
  toolPart: FlueToolLifecyclePart
): "tool_completed" | "tool_failed" | "tool_started" {
  if (toolPart.part.state === "input-available") {
    return "tool_started";
  }
  if (toolPart.part.state === "output-error") {
    return "tool_failed";
  }
  return "tool_completed";
}

function resolveRemoteAgentPromptResultStatus(input: {
  cancelled: boolean;
  isError: boolean;
}): "aborted" | "completed" | "error" {
  if (input.cancelled) {
    return "aborted";
  }
  return input.isError ? "error" : "completed";
}

function emitRemoteAgentTurnCompletionEvidence(input: {
  completed: RemoteAgentCallbackContext | null;
  env: CloudflareBindings;
  event: FlueObservation & { operationKind: "prompt"; type: "operation" };
  submissionId: string;
}): void {
  let failure: {
    errorName: string;
    reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
  } | null = null;
  if (input.event.isError) {
    failure = classifyRemoteAgentTurnFailure({
      error: input.event.error,
      errorInfo: input.event.errorInfo,
    });
  } else if (input.completed?.terminalFailureFact) {
    failure = {
      errorName: "RemoteAgentTurnFailure",
      reasonCode: normalizeTerminalTurnFailureReasonCode(
        input.completed.terminalFailureFact.code
      ),
    };
  }
  emitRemoteAgentCloudflareRuntimeEvidence(input.env, {
    bindingId: input.completed?.bindingId,
    clientMessageId: input.completed?.sourceClientMessageId,
    dispatchId: input.completed?.dispatchId,
    durationMs: input.event.durationMs,
    errorName: failure?.errorName,
    event: REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS.TURN,
    operation: "center_agent_turn",
    reasonCode:
      failure?.reasonCode ??
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_COMPLETED,
    requestId: input.completed?.requestId ?? input.submissionId,
    runtimeKind: "durable_object",
    spaceId: input.completed?.spaceId,
    status: failure ? "failed" : "succeeded",
    targetProfileId: input.completed?.agentProfileId,
  });
}

function normalizeTerminalTurnFailureReasonCode(
  reasonCode: string
): RemoteAgentRuntimeEvidenceOutcomeReasonCode {
  if (
    reasonCode ===
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_EMPTY_ASSISTANT_RESPONSE ||
    reasonCode ===
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_CONTEXT_WINDOW_EXCEEDED ||
    reasonCode === REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_NOT_COMPLETED
  ) {
    return reasonCode;
  }
  return REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_FAILED;
}

async function flushRemoteAgentStream(input: {
  coreWorker: RemoteAgentCoreWorkerBinding;
  env: CloudflareBindings;
  event: FlueObservation;
  storage: RemoteAgentStorage;
  streamPublisher: RemoteAgentStreamPublisher;
  submissionId: string;
}): Promise<void> {
  const context = await resolveRemoteAgentStreamContext({
    storage: input.storage,
    submissionId: input.submissionId,
  });
  if (!(context && isRemoteAgentStreamEligible(context))) {
    return;
  }
  try {
    const observedAtMs = Date.parse(input.event.timestamp);
    const result = await input.streamPublisher.flush({
      context,
      coreWorker: input.coreWorker,
      observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : Date.now(),
      storage: input.storage,
    });
    logRemoteAgentStreamResult({
      context,
      env: input.env,
      eventIndex: input.event.eventIndex,
      observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : Date.now(),
      phase: "flush",
      result,
      submissionId: input.submissionId,
    });
  } catch (error) {
    logRemoteAgentStreamFailure({
      error,
      eventIndex: input.event.eventIndex,
      phase: "flush",
      submissionId: input.submissionId,
    });
  }
}

async function closeRemoteAgentStream(input: {
  eventIndex: number;
  storage: RemoteAgentStorage;
  streamPublisher: RemoteAgentStreamPublisher;
  submissionId: string;
}): Promise<void> {
  try {
    await input.streamPublisher.close({
      storage: input.storage,
      submissionId: input.submissionId,
    });
    console.log("[remote_agent.stream_cleanup_completed]", {
      eventIndex: input.eventIndex,
      submissionId: input.submissionId,
    });
  } catch (error) {
    logRemoteAgentStreamFailure({
      error,
      eventIndex: input.eventIndex,
      phase: "close",
      submissionId: input.submissionId,
    });
  }
}

function resolveDependencies(
  resolver?: () => RemoteAgentObservationDependencies
): RemoteAgentObservationDependencies {
  return resolver?.() ?? resolveCloudflareObservationDependencies();
}

function resolveCloudflareObservationDependencies(): RemoteAgentObservationDependencies {
  const cloudflare = getCloudflareContext();
  const env = cloudflare.env as unknown as CloudflareBindings;
  return {
    coreWorker:
      env.OPENMELD_CORE_WORKER as unknown as RemoteAgentCoreWorkerBinding,
    env,
    storage: createRemoteAgentSqlStorage(cloudflare.storage.sql),
  };
}

function isPromptOperation(
  event: FlueObservation
): event is FlueObservation & { operationKind: "prompt"; type: "operation" } {
  return event.type === "operation" && event.operationKind === "prompt";
}

function logRemoteAgentStreamResult(input: {
  context: RemoteAgentCallbackContext;
  env: CloudflareBindings;
  eventIndex: number;
  observedAtMs: number;
  phase: "flush" | "part" | "push";
  result: Awaited<ReturnType<RemoteAgentStreamPublisher["push"]>>;
  submissionId: string;
}): void {
  if (input.result.status === "disabled" || input.result.status === "dropped") {
    logRemoteAgentStreamFailure({
      errorName:
        input.result.status === "disabled"
          ? "RemoteAgentStreamDisabled"
          : "RemoteAgentStreamCallbackDropped",
      eventIndex: input.eventIndex,
      phase: input.phase,
      submissionId: input.submissionId,
      deltaLength:
        input.result.status === "dropped"
          ? input.result.deltaLength
          : undefined,
    });
    return;
  }
  if (input.result.status === "published") {
    console.info("[remote_agent.stream_content_published]", {
      contentKind: input.result.contentKind,
      event: "remote_agent.stream_content_published",
      eventIndex: input.eventIndex,
      phase: input.phase,
      reasonCode:
        input.result.response && "reasonCode" in input.result.response
          ? input.result.response.reasonCode
          : undefined,
      responseStatus: input.result.response?.status,
      sequence: input.result.sequence,
      streamId: input.result.streamId,
      submissionId: input.submissionId,
      deltaLength: input.result.deltaLength,
    });
    if (input.result.sequence === 1) {
      emitRemoteAgentExecutionStageEvidence(input.env, {
        bindingId: input.context.bindingId,
        category: "stream",
        clientMessageId: input.context.sourceClientMessageId,
        dispatchId: input.context.dispatchId,
        durationMs: Math.max(0, Date.now() - input.observedAtMs),
        operation: `first_content_${input.result.contentKind}`,
        requestId: input.submissionId,
        spaceId: input.context.spaceId,
        status: "succeeded",
        targetProfileId: input.context.agentProfileId,
      });
    }
    return;
  }
  console.debug("[remote_agent.stream_delta_buffered]", {
    event: "remote_agent.stream_delta_buffered",
    eventIndex: input.eventIndex,
    phase: input.phase,
    sequence: input.result.sequence,
    streamId: input.result.streamId,
    submissionId: input.submissionId,
  });
}

function logRemoteAgentStreamFailure(input: {
  error?: unknown;
  errorName?: string;
  eventIndex: number;
  phase: "close" | "flush" | "part" | "push";
  submissionId: string;
  deltaLength?: number;
}): void {
  console.warn("[remote_agent.stream_observation_failed]", {
    errorName:
      input.errorName ??
      (input.error instanceof Error ? input.error.name : "unknown"),
    event: "remote_agent.stream_observation_failed",
    eventIndex: input.eventIndex,
    phase: input.phase,
    submissionId: input.submissionId,
    deltaLength: input.deltaLength,
  });
}
