import { describe, expect, it } from "vitest";
import {
  agentDelegationCompletionPolicySchema,
  agentDelegationSnapshotSchema,
  agentTaskCompletionObservationSchema,
  agentTaskContinuationSchema,
  agentTaskHandleSchema,
  agentTaskTerminalOutcomeSchema,
  areAgentTaskTerminalOutcomesEqual,
} from "../../src/index";

const CHILD_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000001";

describe("Agent task coordination contracts", () => {
  it("identifies one exact Space Wake before its dispatch exists", () => {
    expect(
      agentTaskHandleSchema.parse({
        v: 1,
        kind: "space_wake",
        sourceClientMessageId: "center-agent-wake-1",
        spaceId: "space-1",
        targetProfileId: CHILD_PROFILE_ID,
      })
    ).toEqual({
      v: 1,
      kind: "space_wake",
      sourceClientMessageId: "center-agent-wake-1",
      spaceId: "space-1",
      targetProfileId: CHILD_PROFILE_ID,
    });
  });

  it("does not accept an Agent Profile as a task handle", () => {
    expect(
      agentTaskHandleSchema.safeParse({
        v: 1,
        kind: "agent_profile",
        profileId: "profile-child-1",
      }).success
    ).toBe(false);
  });

  it("supports exact hosted and controller-native tasks", () => {
    expect(
      agentTaskHandleSchema.parse({
        v: 1,
        deliveryId: "delivery-parent-1",
        kind: "native_delivery",
      })
    ).toMatchObject({ kind: "native_delivery" });
    expect(
      agentTaskHandleSchema.parse({
        v: 1,
        agentControllerRef: "builtin:codex",
        hostId: "host-1",
        kind: "controller_task",
        taskId: "thread-1",
      })
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
      taskId: "thread-1",
    });
    expect(
      agentTaskHandleSchema.parse({
        v: 1,
        agentControllerRef: "builtin:claude-code",
        hostId: "host-1",
        kind: "controller_task",
        taskId: "task-1",
      })
    ).toMatchObject({
      agentControllerRef: "builtin:claude-code",
      taskId: "task-1",
    });
    expect(
      agentTaskHandleSchema.parse({
        v: 1,
        agentControllerRef: "custom:future-controller",
        hostId: "host-1",
        kind: "controller_task",
        taskId: "task-2",
      })
    ).toMatchObject({
      agentControllerRef: "custom:future-controller",
      taskId: "task-2",
    });
    expect(
      agentTaskHandleSchema.safeParse({
        v: 1,
        agentControllerRef: `custom:${"x".repeat(513)}`,
        hostId: "host-1",
        kind: "controller_task",
        taskId: "task-oversized",
      }).success
    ).toBe(false);
  });

  it("keeps terminal execution and publication outcomes distinct", () => {
    for (const status of [
      "succeeded",
      "failed",
      "stopped",
      "stayed_silent",
      "publication_failed",
    ] as const) {
      expect(
        agentTaskTerminalOutcomeSchema.parse({
          errorCode:
            status === "failed" || status === "publication_failed"
              ? `task.${status}`
              : null,
          eventId: `event-${status}`,
          occurredAtMs: 1000,
          publishedSignalId: status === "succeeded" ? "signal-final-1" : null,
          status,
        }).status
      ).toBe(status);
    }
  });

  it("compares every immutable terminal outcome field in one shared helper", () => {
    const outcome = {
      errorCode: null,
      eventId: "event-1",
      occurredAtMs: 1000,
      publishedSignalId: "signal-1",
      status: "succeeded" as const,
    };

    expect(areAgentTaskTerminalOutcomesEqual(outcome, { ...outcome })).toBe(
      true
    );
    for (const changed of [
      { ...outcome, errorCode: "task.failed" },
      { ...outcome, eventId: "event-2" },
      { ...outcome, occurredAtMs: 1001 },
      { ...outcome, publishedSignalId: "signal-2" },
      { ...outcome, status: "completed" as const },
    ]) {
      expect(areAgentTaskTerminalOutcomesEqual(outcome, changed)).toBe(false);
    }
  });

  it("models attention as a nonterminal completion observation", () => {
    expect(
      agentTaskCompletionObservationSchema.parse({
        attentionCode: "permission_request",
        eventId: "event-attention-1",
        occurredAtMs: 1000,
        status: "needs_attention",
      })
    ).toEqual({
      attentionCode: "permission_request",
      eventId: "event-attention-1",
      occurredAtMs: 1000,
      status: "needs_attention",
    });
  });

  it("requires an explicit continuation barrier", () => {
    expect(
      agentDelegationCompletionPolicySchema.parse({
        mode: "child_reports_directly",
      })
    ).toEqual({ mode: "child_reports_directly" });
    expect(
      agentDelegationCompletionPolicySchema.parse({
        mode: "resume_parent",
        when: "all_terminal",
      })
    ).toEqual({ mode: "resume_parent", when: "all_terminal" });
    expect(
      agentDelegationCompletionPolicySchema.safeParse({
        mode: "resume_parent",
      }).success
    ).toBe(false);
  });

  it("freezes a general task-watch continuation without inventing a delegation", () => {
    expect(
      agentTaskContinuationSchema.parse({
        instruction: "Continue the original request from this exact outcome.",
        kind: "resume_task_watch",
        watchId: "watch-1",
      })
    ).toEqual({
      instruction: "Continue the original request from this exact outcome.",
      kind: "resume_task_watch",
      watchId: "watch-1",
    });
  });

  it("reads legacy continuation rows while keeping all destination fields together", () => {
    expect(
      agentTaskContinuationSchema.parse({
        delegationId: "delegation-legacy",
        instruction: "Continue the original request.",
        kind: "resume_agent",
        sourceSignalId: "signal-parent-legacy",
        spaceId: "space-parent-legacy",
        threadContext: null,
      })
    ).toMatchObject({
      delegationId: "delegation-legacy",
      kind: "resume_agent",
      spaceId: "space-parent-legacy",
    });
    expect(
      agentTaskContinuationSchema.safeParse({
        delegationId: "delegation-invalid",
        instruction: "Continue the original request.",
        kind: "resume_agent",
        spaceId: "space-parent-only",
      }).success
    ).toBe(false);
  });

  it("carries one bounded exact delegation snapshot into a continuation", () => {
    expect(
      agentDelegationSnapshotSchema.parse({
        barrier: "all_terminal",
        children: [
          {
            agentProfileId: CHILD_PROFILE_ID,
            role: "primary",
            state: "terminal",
            task: {
              kind: "space_wake",
              sourceClientMessageId: "center-agent-wake-1",
              spaceId: "space-1",
              targetProfileId: CHILD_PROFILE_ID,
              v: 1,
            },
            terminalOutcome: {
              errorCode: null,
              eventId: "event-1",
              occurredAtMs: 1000,
              publishedSignalId: "signal-1",
              status: "succeeded",
            },
          },
        ],
        delegationId: "delegation-1",
        generation: 1,
      })
    ).toMatchObject({
      barrier: "all_terminal",
      children: [{ state: "terminal" }],
    });
  });

  it("preserves full Wake text for a deferred fallback", () => {
    const text = "x".repeat(5000);
    const continuation = agentTaskContinuationSchema.parse({
      agentProfileId: CHILD_PROFILE_ID,
      delegationId: "delegation-1",
      kind: "activate_fallback",
      spaceId: "space-1",
      text,
    });
    expect(continuation.kind).toBe("activate_fallback");
    if (continuation.kind !== "activate_fallback") {
      throw new Error("expected fallback continuation");
    }
    expect(continuation.text).toHaveLength(5000);
  });
});
