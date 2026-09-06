import type { FlueObservation } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import {
  REMOTE_AGENT_RUNTIME_EVIDENCE_EVENTS,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
} from "@openmeld/schemas";
import type { RemoteAgentRuntimeEvidenceOutcomeReasonCode } from "@openmeld/schemas/types";
import {
  buildRemoteAgentUsageRecord,
  REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS,
  type RemoteAgentAssistantCompletionResult,
  type RemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  waitForRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  completeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
  RemoteAgentTerminalExecutionOwnerMissingError,
  resolveRemoteAgentTerminalExecutionOutcome,
} from "../agent-core/execution-state";
import {
  buildRemoteAgentTerminalCallbackResult,
  projectRemoteAgentTerminalOutcomeToCallback,
} from "../agent-core/terminal-callback-projection";
import {
  createRemoteAgentTerminalFailureFact,
  type RemoteAgentTerminalFailureFact,
} from "../agent-core/terminal-failure";
import { recordRemoteAgentTurnObservabilityBestEffort } from "../agent-core/turn-observability";
import { normalizeFluePromptUsage } from "../agent-core/usage";
import { emitCenterAgentPerformanceMilestone } from "./center-agent-performance-observability";
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
  if (input.event.agentName !== "center-agent-v2") {
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
  const observation = await recordRemoteAgentTurnObservabilityBestEffort({
    event: {
      assistantText: false,
      observedAtMs: input.toolPart.observedAtMs,
      type: "model_event",
    },
    storage,
    submissionId: input.toolPart.submissionId,
  });
  if (observation?.firstModelEventRecorded) {
    emitCenterAgentPerformanceMilestone(env, {
      context,
      milestone: "first_model_event",
      observedAtMs: input.toolPart.observedAtMs,
    });
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
    if (result.status === "published") {
      await recordFirstVisibleCenterAgentContent({
        context,
        env,
        observedAtMs: Date.now(),
        storage,
        submissionId: input.toolPart.submissionId,
      });
    }
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
  const observation = await recordRemoteAgentTurnObservabilityBestEffort({
    event: {
      assistantText: input.streamDelta.kind === "text",
      observedAtMs: input.streamDelta.observedAtMs,
      type: "model_event",
    },
    storage,
    submissionId: input.streamDelta.submissionId,
  });
  if (observation?.firstModelEventRecorded) {
    emitCenterAgentPerformanceMilestone(env, {
      context,
      milestone: "first_model_event",
      observedAtMs: input.streamDelta.observedAtMs,
    });
  }
  if (
    input.streamDelta.kind === "text" &&
    observation?.firstAssistantTextRecorded
  ) {
    emitCenterAgentPerformanceMilestone(env, {
      context,
      milestone: "first_assistant_text",
      observedAtMs: input.streamDelta.observedAtMs,
    });
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
  if (context.workLoopCheckpoint) {
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
    if (result.status === "published") {
      await recordFirstVisibleCenterAgentContent({
        context,
        env,
        observedAtMs: Date.now(),
        storage,
        submissionId: input.streamDelta.submissionId,
      });
    }
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
  const completedAtMs = parseObservationTimestamp(input.event.timestamp);
  const assistantText = extractAssistantText(input.event);
  const hasAssistantText = assistantText.trim().length > 0;
  const modelEventObservation =
    await recordRemoteAgentTurnObservabilityBestEffort({
      event: {
        assistantText: hasAssistantText,
        observedAtMs: completedAtMs,
        type: "model_event",
      },
      storage,
      submissionId,
    });
  await recordRemoteAgentTurnObservabilityBestEffort({
    event: { observedAtMs: completedAtMs, type: "model_completed" },
    storage,
    submissionId,
  });
  await input.conversationCompactionObserver.drain(submissionId);
  const callbackContext = await waitForRemoteAgentCallbackContext({
    storage,
    submissionId,
    waitMs: REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS,
  });
  if (callbackContext) {
    if (modelEventObservation?.firstModelEventRecorded) {
      emitCenterAgentPerformanceMilestone(env, {
        context: callbackContext,
        milestone: "first_model_event",
        observedAtMs: completedAtMs,
      });
    }
    if (hasAssistantText && modelEventObservation?.firstAssistantTextRecorded) {
      emitCenterAgentPerformanceMilestone(env, {
        context: callbackContext,
        milestone: "first_assistant_text",
        observedAtMs: completedAtMs,
      });
    }
    emitCenterAgentPerformanceMilestone(env, {
      context: callbackContext,
      milestone: "model_completed",
      observedAtMs: completedAtMs,
      stageDurationMs: input.event.durationMs,
      status: input.event.isError ? "failed" : "succeeded",
    });
  }
  const executionIdentity = callbackContext
    ? buildRemoteAgentExecutionIdentity(callbackContext)
    : null;
  const usage = normalizeFluePromptUsage(input.event.usage);
  const terminalFailure = resolveObservedRemoteAgentTerminalFailure({
    event: input.event,
    hasAssistantText,
  });
  const settledExecution = await settleRemoteAgentPromptExecution({
    assistantText,
    executionIdentity,
    hasAssistantText,
    isError: input.event.isError,
    storage,
    terminalFailure,
  });
  await flushRemoteAgentStream({
    coreWorker,
    env,
    event: input.event,
    storage,
    streamPublisher: input.streamPublisher,
    submissionId,
  });
  const outcome = await resolveAuthoritativeRemoteAgentPromptOutcome({
    event: input.event,
    executionIdentity,
    settledExecution,
    storage,
  });
  if (!outcome) {
    console.error("[remote_agent.execution.terminal_owner_missing]", {
      submissionId,
    });
    throw new RemoteAgentTerminalExecutionOwnerMissingError(submissionId);
  }
  const result = buildRemoteAgentTerminalCallbackResult({
    modelId: extractModelId(input.event),
    outcome,
    requestId: submissionId,
    usage,
  });
  let completed: RemoteAgentCallbackContext | null = null;
  try {
    completed = (
      await projectRemoteAgentTerminalOutcomeToCallback({
        coreWorker,
        nowMs: completedAtMs,
        outcome,
        result,
        storage,
        submissionId,
      })
    ).context;
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
      result,
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

async function resolveAuthoritativeRemoteAgentPromptOutcome(input: {
  event: FlueObservation & { operationKind: "prompt"; type: "operation" };
  executionIdentity: ReturnType<
    typeof buildRemoteAgentExecutionIdentity
  > | null;
  settledExecution: Awaited<
    ReturnType<typeof completeRemoteAgentExecutionState>
  >;
  storage: RemoteAgentStorage;
}): Promise<
  Awaited<ReturnType<typeof resolveRemoteAgentTerminalExecutionOutcome>>
> {
  if (!(input.executionIdentity && input.settledExecution)) {
    return null;
  }
  return await resolveRemoteAgentTerminalExecutionOutcome({
    execution: input.settledExecution,
    identity: input.executionIdentity,
    nowMs: parseObservationTimestamp(input.event.timestamp),
    storage: input.storage,
  });
}

async function settleRemoteAgentPromptExecution(input: {
  assistantText: string;
  executionIdentity: ReturnType<
    typeof buildRemoteAgentExecutionIdentity
  > | null;
  hasAssistantText: boolean;
  isError: boolean;
  storage: RemoteAgentStorage;
  terminalFailure: RemoteAgentTerminalFailureFact | null;
}): Promise<Awaited<ReturnType<typeof completeRemoteAgentExecutionState>>> {
  if (!input.executionIdentity) {
    return null;
  }
  if (input.isError || !input.hasAssistantText) {
    return await completeRemoteAgentExecutionState({
      identity: input.executionIdentity,
      nowMs: Date.now(),
      status: "failed",
      storage: input.storage,
      terminalFailure:
        input.terminalFailure ??
        createRemoteAgentTerminalFailureFact({ status: "failed" }),
    });
  }
  return await completeRemoteAgentExecutionState({
    completedText: input.assistantText,
    identity: input.executionIdentity,
    nowMs: Date.now(),
    status: "completed",
    storage: input.storage,
  });
}

function resolveObservedRemoteAgentTerminalFailure(input: {
  event: FlueObservation & { operationKind: "prompt"; type: "operation" };
  hasAssistantText: boolean;
}): RemoteAgentTerminalFailureFact | null {
  if (input.event.isError) {
    const error = {
      error: input.event.error,
      errorInfo: input.event.errorInfo,
    };
    return createRemoteAgentTerminalFailureFact({
      error,
      reasonCode: classifyRemoteAgentTurnFailure(error).reasonCode,
      status: "failed",
    });
  }
  if (!input.hasAssistantText) {
    return createRemoteAgentTerminalFailureFact({
      reasonCode:
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_EMPTY_ASSISTANT_RESPONSE,
      status: "failed",
    });
  }
  return null;
}

async function recordFirstVisibleCenterAgentContent(input: {
  context: RemoteAgentCallbackContext;
  env: RemoteAgentObservationDependencies["env"];
  observedAtMs: number;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<void> {
  const observation = await recordRemoteAgentTurnObservabilityBestEffort({
    event: { observedAtMs: input.observedAtMs, type: "visible_content" },
    storage: input.storage,
    submissionId: input.submissionId,
  });
  if (observation?.firstVisibleContentRecorded) {
    emitCenterAgentPerformanceMilestone(input.env, {
      context: input.context,
      milestone: "first_visible_content",
      observedAtMs: input.observedAtMs,
    });
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

function emitRemoteAgentTurnCompletionEvidence(input: {
  completed: RemoteAgentCallbackContext | null;
  env: CloudflareBindings;
  event: FlueObservation & { operationKind: "prompt"; type: "operation" };
  result: Pick<
    RemoteAgentAssistantCompletionResult,
    "failureReasonCode" | "status"
  >;
  submissionId: string;
}): void {
  let failure: {
    errorName: string;
    reasonCode: RemoteAgentRuntimeEvidenceOutcomeReasonCode;
  } | null = null;
  if (input.result.status !== "completed") {
    failure = {
      errorName: "RemoteAgentTurnFailure",
      reasonCode:
        input.result.failureReasonCode ??
        REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.TURN_NOT_COMPLETED,
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
    const observedAtMs = parseObservationTimestamp(input.event.timestamp);
    const result = await input.streamPublisher.flush({
      context,
      coreWorker: input.coreWorker,
      observedAtMs,
      storage: input.storage,
    });
    logRemoteAgentStreamResult({
      context,
      env: input.env,
      eventIndex: input.event.eventIndex,
      observedAtMs,
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
        durationMs: Math.max(0, Date.now() - input.context.submissionCreatedAt),
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

function parseObservationTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
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
