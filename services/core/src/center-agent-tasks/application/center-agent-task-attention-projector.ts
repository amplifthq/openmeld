import type { CenterAgentTaskEvent } from "@openmeld/schemas/types";
import {
  listCenterAgentTaskEvents,
  projectCenterAgentTaskAttemptEvent,
  readCenterAgentTask,
  readCenterAgentTaskAttemptByTaskHandle,
} from "../infrastructure/d1/center-agent-task-repo";
import { projectCenterAgentTaskInboxItem } from "./center-agent-task-inbox-producer";

export async function projectCenterAgentTaskNeedsAttention(input: {
  deliveryId: string;
  importance: "normal" | "urgent";
  inboxDb: D1Database;
  nowMs: number;
  organizationId: string;
  prompt: string;
  requestId: string;
  taskDb: D1Database;
}): Promise<boolean> {
  const attempt = await readCenterAgentTaskAttemptByTaskHandle({
    db: input.taskDb,
    organizationId: input.organizationId,
    taskHandle: {
      deliveryId: input.deliveryId,
      kind: "native_delivery",
      v: 1,
    },
  });
  if (!attempt) {
    return false;
  }
  const task = await readCenterAgentTask({
    db: input.taskDb,
    organizationId: input.organizationId,
    taskId: attempt.taskId,
  });
  if (!task || task.requesterUserId === null) {
    return false;
  }
  const eventId = await buildAttentionEventId(input.requestId);
  const events = await listCenterAgentTaskEvents({
    db: input.taskDb,
    organizationId: input.organizationId,
    taskId: task.id,
  });
  const existing = events.find((event) => event.id === eventId);
  if (existing) {
    await projectCenterAgentTaskInboxItem({
      db: input.inboxDb,
      event: existing,
      importance: input.importance,
      nowMs: input.nowMs,
      task,
    });
    return true;
  }
  if (
    task.status === "failed" ||
    task.status === "stopping" ||
    task.status === "stopped" ||
    task.status === "succeeded"
  ) {
    return false;
  }

  const projected = await projectCenterAgentTaskAttemptEvent({
    db: input.taskDb,
    event: {
      actor: "center_agent",
      attemptGeneration: attempt.generation,
      eventId,
      idempotencyKey: eventId,
      kind: "needs_attention",
      observedAtMs: input.nowMs,
      occurredAtMs: input.nowMs,
      text: input.prompt,
    },
    expectedTaskVersion: task.version,
    failureCode: null,
    generation: attempt.generation,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    status: "needs_attention",
    taskId: task.id,
  });
  if (
    projected.outcome === "stale_generation" ||
    projected.outcome === "terminal_conflict"
  ) {
    return false;
  }
  await projectCenterAgentTaskInboxItem({
    db: input.inboxDb,
    event: projected.event,
    importance: input.importance,
    nowMs: input.nowMs,
    task: projected.task,
  });
  return true;
}

export function findCenterAgentTaskNeedsAttentionEvent(input: {
  attemptGeneration: number;
  events: CenterAgentTaskEvent[];
}): CenterAgentTaskEvent | null {
  for (let index = input.events.length - 1; index >= 0; index -= 1) {
    const event = input.events[index];
    if (
      event?.attemptGeneration === input.attemptGeneration &&
      event.kind === "needs_attention"
    ) {
      return event;
    }
  }
  return null;
}

async function buildAttentionEventId(requestId: string): Promise<string> {
  const bytes = new TextEncoder().encode(requestId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `center-agent-task-attention:${hex}`;
}
