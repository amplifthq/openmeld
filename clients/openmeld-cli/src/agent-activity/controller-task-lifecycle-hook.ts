import { createHash } from "node:crypto";
import type {
  AgentControllerTaskLifecycleEventSource,
  SubmitAgentControllerTaskLifecycleEventItem,
} from "@openmeld/schemas/types";

type SupportedProvider = "claude-code" | "codex";

export function buildControllerTaskLifecycleEvent(input: {
  nowMs: number;
  organizationId: string;
  payload: Record<string, unknown>;
  provider: SupportedProvider;
}): SubmitAgentControllerTaskLifecycleEventItem | null {
  const hookName = text(input.payload.hook_event_name);
  if (!hookName) {
    return null;
  }
  const mapped =
    input.provider === "codex"
      ? mapCodexHook(input.payload, hookName)
      : mapClaudeHook(input.payload, hookName);
  if (!mapped) {
    return null;
  }
  const providerEventId =
    text(input.payload.hook_event_id) ?? text(input.payload.event_id);
  if (mapped.eventType === "needs_attention" && !providerEventId) {
    return null;
  }
  const eventId =
    (providerEventId
      ? createHash("sha256")
          .update(`${input.provider}\0${providerEventId}`)
          .digest("hex")
      : null) ??
    deterministicEventId({
      provider: input.provider,
      sessionId:
        text(input.payload.session_id) ?? text(input.payload.sessionId) ?? "",
      source: mapped.source,
      taskId: mapped.taskId,
    });
  return {
    agentControllerRef:
      input.provider === "codex" ? "builtin:codex" : "builtin:claude-code",
    attentionCode: mapped.attentionCode,
    eventId: `${input.provider}:${eventId}`,
    eventType: mapped.eventType,
    occurredAtMs: input.nowMs,
    organizationId: input.organizationId,
    source: mapped.source,
    taskId: mapped.taskId,
  };
}

function mapCodexHook(
  payload: Record<string, unknown>,
  hookName: string
): MappedLifecycleEvent | null {
  if (hookName === "UserPromptSubmit") {
    return mapped("registered", "codex_user_prompt_submit", payload.turn_id);
  }
  if (hookName === "Stop") {
    return mapped("completed", "codex_stop", payload.turn_id);
  }
  if (hookName === "PermissionRequest") {
    return mapped(
      "needs_attention",
      "codex_permission_request",
      payload.turn_id,
      "permission_request"
    );
  }
  if (hookName === "SubagentStart") {
    return mapped("registered", "codex_subagent_start", payload.agent_id);
  }
  if (hookName === "SubagentStop") {
    return mapped("completed", "codex_subagent_stop", payload.agent_id);
  }
  return null;
}

function mapClaudeHook(
  payload: Record<string, unknown>,
  hookName: string
): MappedLifecycleEvent | null {
  if (hookName === "SessionStart") {
    return mapped("registered", "claude_session_start", payload.session_id);
  }
  if (hookName === "TaskCreated") {
    return mapped("registered", "claude_task_created", payload.task_id);
  }
  if (hookName === "TaskCompleted") {
    return mapped("completed", "claude_task_completed", payload.task_id);
  }
  if (hookName === "SubagentStart") {
    return mapped("registered", "claude_subagent_start", payload.agent_id);
  }
  if (hookName === "SubagentStop") {
    return mapped("completed", "claude_subagent_stop", payload.agent_id);
  }
  if (hookName !== "Notification") {
    return null;
  }
  const notificationType = text(
    payload.notification_type ?? payload.notificationType
  );
  if (
    notificationType !== "permission_prompt" &&
    notificationType !== "idle_prompt" &&
    notificationType !== "elicitation_dialog"
  ) {
    return null;
  }
  return mapped(
    "needs_attention",
    "claude_notification",
    payload.session_id,
    notificationType
  );
}

type MappedLifecycleEvent = Pick<
  SubmitAgentControllerTaskLifecycleEventItem,
  "attentionCode" | "eventType" | "source" | "taskId"
>;

function mapped(
  eventType: MappedLifecycleEvent["eventType"],
  source: AgentControllerTaskLifecycleEventSource,
  taskIdValue: unknown,
  attentionCode: string | null = null
): MappedLifecycleEvent | null {
  const taskId = text(taskIdValue);
  return taskId ? { attentionCode, eventType, source, taskId } : null;
}

function deterministicEventId(input: {
  provider: SupportedProvider;
  sessionId: string;
  source: AgentControllerTaskLifecycleEventSource;
  taskId: string;
}): string {
  return createHash("sha256")
    .update(
      [input.provider, input.source, input.sessionId, input.taskId].join("\0")
    )
    .digest("hex");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
