import {
  CENTER_AGENT_TASK_EVENT_TEXT_MAX_CHARS,
  REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE,
} from "@openmeld/schemas";
import type { CenterAgentTaskStatus } from "@openmeld/schemas/types";
import { truncateInboxText } from "../../inbox/application/inbox-text";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../../runtime-transport/application/runtime-coordinator-authority";
import {
  listCenterAgentTaskEvents,
  projectCenterAgentTaskAttemptEvent,
  readActiveCenterAgentTaskStopIntentByDeliveryId,
  readCenterAgentTask,
  readCenterAgentTaskAttemptByTaskHandle,
} from "../infrastructure/d1/center-agent-task-repo";
import { findCenterAgentTaskNeedsAttentionEvent } from "./center-agent-task-attention-projector";
import {
  projectCenterAgentTaskInboxItem,
  resolveCenterAgentTaskNeedsAttentionInboxItem,
} from "./center-agent-task-inbox-producer";

type TerminalDelivery = {
  deliveryId: string;
  failureCode: string | null;
  failureDetail: string | null;
  finalPublicationPayload: { text: string } | null;
  organizationId: string;
  status: string;
};

export type CenterAgentTaskTerminalProjectionResult =
  | {
      outcome: "canonicalized";
      payloadDisposition: "erase";
    }
  | {
      outcome: "owner_rejected";
      payloadDisposition: "erase";
      reason:
        | "active_stop_fence"
        | "completed_while_needs_attention"
        | "stale_generation"
        | "terminal_conflict";
    }
  | {
      outcome: "not_ready";
      payloadDisposition: "retain_for_replay";
      reason: "attempt_not_found" | "non_terminal_status";
    };

export async function projectCenterAgentTaskTerminal(input: {
  delivery: TerminalDelivery;
  expectedTaskId?: string;
  inboxDb: D1Database;
  nowMs: number;
  taskDb: D1Database;
}): Promise<CenterAgentTaskTerminalProjectionResult> {
  if (!isProjectableTerminalStatus(input.delivery.status)) {
    return {
      outcome: "not_ready",
      payloadDisposition: "retain_for_replay",
      reason: "non_terminal_status",
    };
  }
  const taskHandle = {
    deliveryId: input.delivery.deliveryId,
    kind: "native_delivery" as const,
    v: 1 as const,
  };
  const attempt = await readCenterAgentTaskAttemptByTaskHandle({
    db: input.taskDb,
    organizationId: input.delivery.organizationId,
    taskHandle,
  });
  if (!attempt) {
    return {
      outcome: "not_ready",
      payloadDisposition: "retain_for_replay",
      reason: "attempt_not_found",
    };
  }
  if (input.expectedTaskId && attempt.taskId !== input.expectedTaskId) {
    throw new Error("center_agent_task.delivery_identity_mismatch");
  }
  const task = await readCenterAgentTask({
    db: input.taskDb,
    organizationId: input.delivery.organizationId,
    taskId: attempt.taskId,
  });
  if (!task) {
    throw new Error("center_agent_task.terminal_projection_task_missing");
  }
  const activeStopIntent =
    await readActiveCenterAgentTaskStopIntentByDeliveryId({
      db: input.taskDb,
      deliveryId: input.delivery.deliveryId,
    });
  if (
    activeStopIntent &&
    input.delivery.failureCode !==
      RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE
  ) {
    return {
      outcome: "owner_rejected",
      payloadDisposition: "erase",
      reason: "active_stop_fence",
    };
  }
  if (
    input.delivery.status === "completed" &&
    (attempt.status === "needs_attention" || task.status === "needs_attention")
  ) {
    const events = await listCenterAgentTaskEvents({
      db: input.taskDb,
      organizationId: input.delivery.organizationId,
      taskId: task.id,
    });
    const attentionEvent = findCenterAgentTaskNeedsAttentionEvent({
      attemptGeneration: attempt.generation,
      events,
    });
    if (!attentionEvent) {
      throw new Error("center_agent_task.needs_attention_event_missing");
    }
    await projectCenterAgentTaskInboxItem({
      db: input.inboxDb,
      event: attentionEvent,
      nowMs: input.nowMs,
      task,
    });
    return {
      outcome: "owner_rejected",
      payloadDisposition: "erase",
      reason: "completed_while_needs_attention",
    };
  }
  const terminal = resolveTaskTerminal(input.delivery);
  if (attempt.status === terminal.status) {
    const events = await listCenterAgentTaskEvents({
      db: input.taskDb,
      organizationId: input.delivery.organizationId,
      taskId: task.id,
    });
    const existingTerminalEvent = events.find(
      (event) =>
        event.attemptGeneration === attempt.generation &&
        event.kind === terminal.eventKind
    );
    if (existingTerminalEvent) {
      await projectCenterAgentTaskInboxItem({
        db: input.inboxDb,
        event: existingTerminalEvent,
        nowMs: input.nowMs,
        task,
      });
      return { outcome: "canonicalized", payloadDisposition: "erase" };
    }
  }
  const identity = await buildTerminalEventIdentity(input.delivery.deliveryId);
  const projected = await projectCenterAgentTaskAttemptEvent({
    db: input.taskDb,
    event: {
      actor: "center_agent",
      attemptGeneration: attempt.generation,
      eventId: identity,
      idempotencyKey: identity,
      kind: terminal.eventKind,
      observedAtMs: input.nowMs,
      occurredAtMs: input.nowMs,
      text: terminal.text,
    },
    expectedTaskVersion: task.version,
    failureCode: terminal.failureCode,
    generation: attempt.generation,
    nowMs: input.nowMs,
    organizationId: input.delivery.organizationId,
    status: terminal.status,
    taskId: task.id,
  });
  if (
    projected.outcome === "stale_generation" ||
    projected.outcome === "terminal_conflict"
  ) {
    return {
      outcome: "owner_rejected",
      payloadDisposition: "erase",
      reason: projected.outcome,
    };
  }
  await projectCenterAgentTaskInboxItem({
    db: input.inboxDb,
    event: projected.event,
    nowMs: input.nowMs,
    task: projected.task,
  });
  if (task.status === "needs_attention") {
    const events = await listCenterAgentTaskEvents({
      db: input.taskDb,
      organizationId: input.delivery.organizationId,
      taskId: task.id,
    });
    const attentionEvent = findCenterAgentTaskNeedsAttentionEvent({
      attemptGeneration: attempt.generation,
      events,
    });
    if (attentionEvent) {
      await resolveCenterAgentTaskNeedsAttentionInboxItem({
        db: input.inboxDb,
        eventId: attentionEvent.id,
        organizationId: input.delivery.organizationId,
        resolvedAtMs: input.nowMs,
        taskId: task.id,
      });
    }
  }
  return { outcome: "canonicalized", payloadDisposition: "erase" };
}

function isProjectableTerminalStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "flag_rejected" ||
    status === "guardrail_rejected" ||
    status === "worker_unavailable" ||
    status === "callback_rejected"
  );
}

function resolveTaskTerminal(delivery: TerminalDelivery): {
  eventKind: "task_failed" | "task_stopped" | "task_succeeded";
  failureCode: string | null;
  status: Exclude<
    CenterAgentTaskStatus,
    "needs_attention" | "queued" | "running" | "stopping"
  >;
  text: string;
} {
  if (delivery.status === "completed") {
    return {
      eventKind: "task_succeeded",
      failureCode: null,
      status: "succeeded",
      text: truncateInboxText(
        delivery.finalPublicationPayload?.text ?? "Task completed.",
        CENTER_AGENT_TASK_EVENT_TEXT_MAX_CHARS
      ),
    };
  }
  if (
    delivery.failureCode ===
    RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE
  ) {
    return {
      eventKind: "task_stopped",
      failureCode: null,
      status: "stopped",
      text: "Task stopped.",
    };
  }
  const failureCode =
    delivery.failureCode ?? "center_agent_task.execution_failed";
  return {
    eventKind: "task_failed",
    failureCode,
    status: "failed",
    text: resolvePublicTaskFailureText(delivery),
  };
}

function resolvePublicTaskFailureText(delivery: TerminalDelivery): string {
  if (
    delivery.failureCode ===
    REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE
  ) {
    return "Center Agent could not continue this Task automatically. Retry it or open diagnostics.";
  }
  if (delivery.status === "worker_unavailable") {
    return "Center Agent could not start this Task. Try again.";
  }
  if (
    delivery.status === "flag_rejected" ||
    delivery.status === "guardrail_rejected"
  ) {
    return "Center Agent could not complete this Task because the request was not allowed.";
  }
  return "Center Agent could not finish this Task. Retry it or open diagnostics.";
}

async function buildTerminalEventIdentity(deliveryId: string): Promise<string> {
  const bytes = new TextEncoder().encode(deliveryId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `center-agent-task-terminal:${hex}`;
}
