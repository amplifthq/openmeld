import {
  submitAgentControllerTaskLifecycleEventItemSchema,
  submitAgentControllerTaskLifecycleEventsResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentControllerTaskLifecycleEventRejectedReason,
  AgentTaskHandle,
  SubmitAgentControllerTaskLifecycleEventItem,
  SubmitAgentControllerTaskLifecycleEventResult,
  SubmitAgentControllerTaskLifecycleEventsResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import {
  AgentControllerTaskLifecycleStorageConflictError,
  createAgentControllerTaskLifecycleEvent,
  hasAgentControllerTaskLifecycleEvent,
  markAgentControllerTaskLifecycleEventProcessed,
  readRegisteredAgentControllerTask,
  registerAgentControllerTask,
} from "../infrastructure/d1/agent-controller-task-lifecycle-repo";
import { recordAndEnqueueAgentTaskNeedsAttentionObservation } from "./agent-task-needs-attention-observation-service";
import { recordAndEnqueueAgentTaskTerminalOutcome } from "./agent-task-terminal-outcome-service";

const CONTROLLER_TASK_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CONTROLLER_TASK_EVENT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

type VerifiedControllerTaskRuntime = {
  deviceId: string;
  ownerUserId: string;
  openMeldServiceRuntimeId: string;
};

type ControllerTaskHandle = Extract<
  AgentTaskHandle,
  { kind: "controller_task" }
>;

type MembershipEvidence =
  | { ok: true; userId: string }
  | { ok: false; unavailable: boolean };

type EventProcessingInput = {
  db: D1Database;
  env: CoreBindings;
  event: SubmitAgentControllerTaskLifecycleEventItem;
  nowMs: number;
  resolveMembership: (organizationId: string) => Promise<MembershipEvidence>;
  runtime: VerifiedControllerTaskRuntime;
};

export async function acceptAgentControllerTaskLifecycleEventBatch(input: {
  db: D1Database;
  env: CoreBindings;
  events: readonly SubmitAgentControllerTaskLifecycleEventItem[];
  now?: () => number;
  resolveMembership: (organizationId: string) => Promise<MembershipEvidence>;
  runtime: VerifiedControllerTaskRuntime;
}): Promise<SubmitAgentControllerTaskLifecycleEventsResponse> {
  const nowMs = (input.now ?? Date.now)();
  const results: SubmitAgentControllerTaskLifecycleEventResult[] = [];
  for (const candidate of input.events) {
    const event =
      submitAgentControllerTaskLifecycleEventItemSchema.parse(candidate);
    results.push(
      await acceptValidatedEvent({
        db: input.db,
        env: input.env,
        event,
        nowMs,
        resolveMembership: input.resolveMembership,
        runtime: input.runtime,
      })
    );
  }
  return parseResponse({
    events: results,
    status: summarizeBatchStatus(results),
  });
}

async function acceptValidatedEvent(
  input: EventProcessingInput
): Promise<SubmitAgentControllerTaskLifecycleEventResult> {
  const rejected = await rejectInvalidEventAuthority(input);
  if (rejected) {
    return rejected;
  }
  const created = await createLifecycleEvent(input);
  if (!created.ok) {
    return created.result;
  }
  const lifecycleEvent = created.lifecycleEvent;
  if (lifecycleEvent.processedAtMs !== null) {
    return accepted(input.event, "reused");
  }
  if (input.event.eventType === "registered") {
    return await acceptRegistrationEvent(input);
  }
  return await acceptCompletionObservation({
    ...input,
    task: lifecycleEvent.task,
  });
}

async function rejectInvalidEventAuthority(
  input: EventProcessingInput
): Promise<SubmitAgentControllerTaskLifecycleEventResult | null> {
  if (
    !(
      isEventTimeAcceptable(input.event.occurredAtMs, input.nowMs) ||
      (await hasAgentControllerTaskLifecycleEvent({
        db: input.db,
        eventId: input.event.eventId,
      }))
    )
  ) {
    return reject(input.event, "event_time_invalid", "permanently_rejected");
  }
  if (!isEventSourceValid(input.event)) {
    return reject(input.event, "event_source_invalid", "permanently_rejected");
  }
  const membership = await input.resolveMembership(input.event.organizationId);
  if (!membership.ok) {
    return reject(
      input.event,
      membership.unavailable
        ? "organization_membership_unavailable"
        : "organization_membership_denied",
      membership.unavailable ? "retryable_rejected" : "permanently_rejected"
    );
  }
  return membership.userId === input.runtime.ownerUserId
    ? null
    : reject(
        input.event,
        "organization_membership_denied",
        "permanently_rejected"
      );
}

async function createLifecycleEvent(input: EventProcessingInput): Promise<
  | {
      lifecycleEvent: Awaited<
        ReturnType<typeof createAgentControllerTaskLifecycleEvent>
      >;
      ok: true;
    }
  | { ok: false; result: SubmitAgentControllerTaskLifecycleEventResult }
> {
  try {
    return {
      lifecycleEvent: await createAgentControllerTaskLifecycleEvent({
        db: input.db,
        event: input.event,
        hostId: input.runtime.deviceId,
        nowMs: input.nowMs,
      }),
      ok: true,
    };
  } catch (error) {
    if (!(error instanceof AgentControllerTaskLifecycleStorageConflictError)) {
      throw error;
    }
    return {
      ok: false,
      result: reject(
        input.event,
        error.code === "event_id_conflict"
          ? "event_id_conflict"
          : "event_source_invalid",
        "permanently_rejected"
      ),
    };
  }
}

async function acceptRegistrationEvent(
  input: EventProcessingInput
): Promise<SubmitAgentControllerTaskLifecycleEventResult> {
  try {
    await registerAgentControllerTask({
      db: input.db,
      event: input.event,
      hostId: input.runtime.deviceId,
      nowMs: input.nowMs,
      ownerUserId: input.runtime.ownerUserId,
      openMeldServiceRuntimeId: input.runtime.openMeldServiceRuntimeId,
    });
  } catch (error) {
    if (!(error instanceof AgentControllerTaskLifecycleStorageConflictError)) {
      throw error;
    }
    return reject(input.event, "event_source_invalid", "permanently_rejected");
  }
  await markProcessed(input);
  return accepted(input.event, "accepted");
}

async function acceptCompletionObservation(
  input: EventProcessingInput & {
    task: ControllerTaskHandle;
  }
): Promise<SubmitAgentControllerTaskLifecycleEventResult> {
  const registeredTask = await readRegisteredAgentControllerTask({
    db: input.db,
    task: input.task,
  });
  if (!registeredTask) {
    return reject(input.event, "registered_task_missing", "retryable_rejected");
  }
  if (
    registeredTask.organizationId !== input.event.organizationId ||
    registeredTask.ownerUserId !== input.runtime.ownerUserId
  ) {
    return reject(
      input.event,
      "organization_membership_denied",
      "permanently_rejected"
    );
  }
  if (
    registeredTask.openMeldServiceRuntimeId !==
      input.runtime.openMeldServiceRuntimeId ||
    !doesRegistrationSourceAllowEvent(
      registeredTask.registrationSource,
      input.event
    )
  ) {
    return reject(input.event, "event_source_invalid", "permanently_rejected");
  }

  if (input.event.eventType === "completed") {
    await recordAndEnqueueAgentTaskTerminalOutcome({
      db: input.db,
      env: input.env,
      nowMs: input.nowMs,
      outcome: {
        errorCode: null,
        eventId: input.event.eventId,
        occurredAtMs: input.event.occurredAtMs,
        publishedSignalId: null,
        status:
          input.event.source === "claude_task_completed"
            ? "succeeded"
            : "completed",
      },
      task: input.task,
    });
  } else {
    await recordAndEnqueueAgentTaskNeedsAttentionObservation({
      db: input.db,
      env: input.env,
      nowMs: input.nowMs,
      observation: {
        attentionCode: input.event.attentionCode,
        eventId: input.event.eventId,
        occurredAtMs: input.event.occurredAtMs,
        status: "needs_attention",
      },
      task: input.task,
    });
  }
  await markProcessed(input);
  return accepted(input.event, "accepted");
}

function doesRegistrationSourceAllowEvent(
  registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"],
  event: SubmitAgentControllerTaskLifecycleEventItem
): boolean {
  switch (registrationSource) {
    case "codex_user_prompt_submit":
      return (
        (event.eventType === "completed" && event.source === "codex_stop") ||
        (event.eventType === "needs_attention" &&
          event.source === "codex_permission_request")
      );
    case "codex_subagent_start":
      return (
        event.eventType === "completed" &&
        event.source === "codex_subagent_stop"
      );
    case "claude_session_start":
      return (
        event.eventType === "needs_attention" &&
        event.source === "claude_notification"
      );
    case "claude_task_created":
      return (
        event.eventType === "completed" &&
        event.source === "claude_task_completed"
      );
    case "claude_subagent_start":
      return (
        event.eventType === "completed" &&
        event.source === "claude_subagent_stop"
      );
    default:
      return false;
  }
}

async function markProcessed(input: {
  db: D1Database;
  event: SubmitAgentControllerTaskLifecycleEventItem;
  nowMs: number;
}): Promise<void> {
  await markAgentControllerTaskLifecycleEventProcessed({
    db: input.db,
    eventId: input.event.eventId,
    nowMs: input.nowMs,
  });
}

function isEventSourceValid(
  event: SubmitAgentControllerTaskLifecycleEventItem
): boolean {
  if (event.agentControllerRef === "builtin:codex") {
    if (!event.source.startsWith("codex_")) {
      return false;
    }
    if (event.eventType === "registered") {
      return (
        event.source === "codex_user_prompt_submit" ||
        event.source === "codex_subagent_start"
      );
    }
    if (event.eventType === "completed") {
      return (
        event.source === "codex_stop" || event.source === "codex_subagent_stop"
      );
    }
    return event.source === "codex_permission_request";
  }
  if (event.agentControllerRef === "builtin:claude-code") {
    if (!event.source.startsWith("claude_")) {
      return false;
    }
    if (event.eventType === "registered") {
      return (
        event.source === "claude_session_start" ||
        event.source === "claude_subagent_start" ||
        event.source === "claude_task_created"
      );
    }
    if (event.eventType === "completed") {
      return (
        event.source === "claude_subagent_stop" ||
        event.source === "claude_task_completed"
      );
    }
    return event.source === "claude_notification";
  }
  return false;
}

function isEventTimeAcceptable(occurredAtMs: number, nowMs: number): boolean {
  return (
    occurredAtMs >= nowMs - CONTROLLER_TASK_EVENT_MAX_AGE_MS &&
    occurredAtMs <= nowMs + CONTROLLER_TASK_EVENT_MAX_FUTURE_SKEW_MS
  );
}

function accepted(
  event: SubmitAgentControllerTaskLifecycleEventItem,
  outcome: "accepted" | "reused"
): SubmitAgentControllerTaskLifecycleEventResult {
  return { eventId: event.eventId, outcome, status: "accepted" };
}

function reject(
  event: SubmitAgentControllerTaskLifecycleEventItem,
  reason: AgentControllerTaskLifecycleEventRejectedReason,
  status: "permanently_rejected" | "retryable_rejected"
): SubmitAgentControllerTaskLifecycleEventResult {
  return { eventId: event.eventId, reason, status };
}

function summarizeBatchStatus(
  results: readonly SubmitAgentControllerTaskLifecycleEventResult[]
): "accepted" | "partial" | "rejected" {
  const acceptedCount = results.filter(
    (result) => result.status === "accepted"
  ).length;
  if (acceptedCount === results.length) {
    return "accepted";
  }
  return acceptedCount === 0 ? "rejected" : "partial";
}

function parseResponse(
  value: unknown
): SubmitAgentControllerTaskLifecycleEventsResponse {
  const parsed =
    submitAgentControllerTaskLifecycleEventsResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Failed to build a valid Agent Controller task lifecycle response."
    );
  }
  return parsed.data;
}
