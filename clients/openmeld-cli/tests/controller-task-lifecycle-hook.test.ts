import { describe, expect, it } from "vitest";
import { buildControllerTaskLifecycleEvent } from "../src/agent-activity/controller-task-lifecycle-hook";

describe("Agent Controller task lifecycle hook adapters", () => {
  it.each([
    {
      eventType: "registered",
      hookName: "UserPromptSubmit",
      idField: "turn_id",
      provider: "codex",
      source: "codex_user_prompt_submit",
    },
    {
      eventType: "completed",
      hookName: "Stop",
      idField: "turn_id",
      provider: "codex",
      source: "codex_stop",
    },
    {
      eventType: "registered",
      hookName: "SubagentStart",
      idField: "agent_id",
      provider: "codex",
      source: "codex_subagent_start",
    },
    {
      eventType: "completed",
      hookName: "SubagentStop",
      idField: "agent_id",
      provider: "codex",
      source: "codex_subagent_stop",
    },
    {
      eventType: "registered",
      hookName: "SessionStart",
      idField: "session_id",
      provider: "claude-code",
      source: "claude_session_start",
    },
    {
      eventType: "registered",
      hookName: "TaskCreated",
      idField: "task_id",
      provider: "claude-code",
      source: "claude_task_created",
    },
    {
      eventType: "completed",
      hookName: "TaskCompleted",
      idField: "task_id",
      provider: "claude-code",
      source: "claude_task_completed",
    },
    {
      eventType: "registered",
      hookName: "SubagentStart",
      idField: "agent_id",
      provider: "claude-code",
      source: "claude_subagent_start",
    },
    {
      eventType: "completed",
      hookName: "SubagentStop",
      idField: "agent_id",
      provider: "claude-code",
      source: "claude_subagent_stop",
    },
  ] as const)("maps $provider $hookName to an exact $eventType task event", ({
    eventType,
    hookName,
    idField,
    provider,
    source,
  }) => {
    expect(
      buildControllerTaskLifecycleEvent({
        nowMs: 1000,
        organizationId: "org-1",
        payload: {
          [idField]: "task-1",
          cwd: "/work/repository",
          hook_event_name: hookName,
          session_id: "session-1",
        },
        provider,
      })
    ).toMatchObject({
      eventType,
      organizationId: "org-1",
      source,
      taskId: hookName === "SessionStart" ? "session-1" : "task-1",
    });
  });

  it("fails closed for attention hooks without a stable provider event id", () => {
    expect(
      buildControllerTaskLifecycleEvent({
        nowMs: 1000,
        organizationId: "org-1",
        payload: {
          hook_event_name: "PermissionRequest",
          session_id: "session-1",
          turn_id: "turn-1",
        },
        provider: "codex",
      })
    ).toBeNull();
    expect(
      buildControllerTaskLifecycleEvent({
        nowMs: 1000,
        organizationId: "org-1",
        payload: {
          hook_event_name: "Notification",
          notification_type: "auth_success",
          session_id: "session-1",
        },
        provider: "claude-code",
      })
    ).toBeNull();
  });

  it("uses a stable provider event id without copying private hook content", () => {
    const event = buildControllerTaskLifecycleEvent({
      nowMs: 1000,
      organizationId: "org-1",
      payload: {
        hook_event_name: "Notification",
        hook_event_id: "notification-1",
        message: "PRIVACY_CANARY",
        notification_type: "permission_prompt",
        session_id: "session-1",
        transcript_path: "/private/transcript.jsonl",
      },
      provider: "claude-code",
    });
    expect(event).toMatchObject({
      attentionCode: "permission_prompt",
      eventType: "needs_attention",
      taskId: "session-1",
    });
    expect(JSON.stringify(event)).not.toContain("PRIVACY_CANARY");
    expect(JSON.stringify(event)).not.toContain("/private/");
  });
});
