import type {
  AgentTaskContinuation,
  AgentTaskHandle,
  SubmitAgentControllerTaskLifecycleEventItem,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { acceptAgentControllerTaskLifecycleEventBatch } from "../src/agent-task-coordination/application/agent-controller-task-lifecycle-service";
import {
  listRegisteredAgentControllerTasks,
  registerAgentControllerTask,
} from "../src/agent-task-coordination/infrastructure/d1/agent-controller-task-lifecycle-repo";
import {
  readAgentTaskCompletionSubscription,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import type { CoreBindings } from "../src/lib/bindings";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const NOW_MS = 2_000_000;
const runtime = {
  deviceId: "device-1",
  ownerUserId: "user-1",
  openMeldServiceRuntimeId: "runtime-1",
};
const observerTask: AgentTaskHandle = {
  deliveryId: "delivery-parent-1",
  kind: "native_delivery",
  v: 1,
};
const taskWatchContinuation: Extract<
  AgentTaskContinuation,
  { kind: "resume_task_watch" }
> = {
  instruction: "Continue after the exact controller event.",
  kind: "resume_task_watch",
  sourceSignalId: "signal-parent-1",
  spaceId: "space-1",
  threadContext: null,
  watchId: "watch-1",
};

describe("Agent Controller task lifecycle service", () => {
  it("lists only the requester's recent tasks with terminal evidence", async () => {
    const harness = createLifecycleHarness();
    try {
      await acceptBatch({
        db: harness.db,
        env: createEnv([]),
        events: [
          buildEvent({
            agentControllerRef: "builtin:claude-code",
            eventId: "claude:task-owned:registered",
            eventType: "registered",
            occurredAtMs: NOW_MS + 10,
            source: "claude_task_created",
            taskId: "task-owned",
          }),
          buildEvent({
            agentControllerRef: "builtin:claude-code",
            eventId: "claude:task-owned:completed",
            eventType: "completed",
            occurredAtMs: NOW_MS + 20,
            source: "claude_task_completed",
            taskId: "task-owned",
          }),
        ],
        nowMs: NOW_MS + 20,
      });
      await registerAgentControllerTask({
        db: harness.db,
        event: buildEvent({
          eventId: "codex:task-other-user:registered",
          eventType: "registered",
          occurredAtMs: NOW_MS + 30,
          source: "codex_user_prompt_submit",
          taskId: "task-other-user",
        }),
        hostId: "device-2",
        nowMs: NOW_MS + 30,
        ownerUserId: "user-2",
        openMeldServiceRuntimeId: "runtime-2",
      });

      await expect(
        listRegisteredAgentControllerTasks({
          db: harness.db,
          limit: 21,
          organizationId: "org-1",
          ownerUserId: "user-1",
        })
      ).resolves.toMatchObject([
        {
          outcome: {
            eventId: "claude:task-owned:completed",
            status: "succeeded",
          },
          registeredTask: {
            ownerUserId: "user-1",
            registrationSource: "claude_task_created",
            task: {
              agentControllerRef: "builtin:claude-code",
              taskId: "task-owned",
            },
          },
        },
      ]);
      await expect(
        listRegisteredAgentControllerTasks({
          agentControllerRef: "builtin:codex",
          db: harness.db,
          limit: 21,
          organizationId: "org-1",
          ownerUserId: "user-1",
        })
      ).resolves.toEqual([]);
      await expect(
        listRegisteredAgentControllerTasks({
          db: harness.db,
          limit: 21,
          organizationId: "org-1",
          ownerUserId: "user-2",
        })
      ).resolves.toMatchObject([
        {
          outcome: null,
          registeredTask: {
            ownerUserId: "user-2",
            task: { taskId: "task-other-user" },
          },
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("resumes an attention watch exactly once across event replay", async () => {
    const harness = createLifecycleHarness();
    const queued: unknown[] = [];
    try {
      const registeredEvent = buildEvent({
        eventId: "codex:turn-1:registered",
        eventType: "registered",
        source: "codex_user_prompt_submit",
        taskId: "turn-1",
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv(queued),
          events: [registeredEvent],
        })
      ).resolves.toMatchObject({
        events: [{ outcome: "accepted", status: "accepted" }],
      });

      const watchedTask: AgentTaskHandle = {
        agentControllerRef: "builtin:codex",
        hostId: runtime.deviceId,
        kind: "controller_task",
        taskId: "turn-1",
        v: 1,
      };
      await registerAttentionWatch({
        db: harness.db,
        id: "first",
        watchedTask,
      });
      const attentionEvent = buildEvent({
        attentionCode: "permission_request",
        eventId: "codex:turn-1:permission",
        eventType: "needs_attention",
        source: "codex_permission_request",
        taskId: "turn-1",
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv(queued),
          events: [attentionEvent],
        })
      ).resolves.toMatchObject({
        events: [{ outcome: "accepted", status: "accepted" }],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-first",
        })
      ).resolves.toMatchObject({
        outcome: { status: "needs_attention" },
        state: "ready",
      });

      await registerAttentionWatch({
        db: harness.db,
        id: "late",
        watchedTask,
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv(queued),
          events: [attentionEvent],
        })
      ).resolves.toMatchObject({
        events: [{ outcome: "reused", status: "accepted" }],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-late",
        })
      ).resolves.toMatchObject({
        outcome: {
          eventId: "codex:turn-1:permission",
          status: "needs_attention",
        },
        state: "ready",
      });
      expect(queued).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("persists controller completion for a later terminal watch", async () => {
    const harness = createLifecycleHarness();
    try {
      await acceptBatch({
        db: harness.db,
        env: createEnv([]),
        events: [
          buildEvent({
            agentControllerRef: "builtin:claude-code",
            eventId: "claude:task-1:registered",
            eventType: "registered",
            source: "claude_task_created",
            taskId: "task-1",
          }),
          buildEvent({
            agentControllerRef: "builtin:claude-code",
            eventId: "claude:task-1:completed",
            eventType: "completed",
            source: "claude_task_completed",
            taskId: "task-1",
          }),
        ],
      });
      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: taskWatchContinuation,
          controllerTaskRegistration: {
            ownerUserId: "user-1",
            registrationSource: "claude_task_created",
          },
          db: harness.db,
          idempotencyKey: "subscription-key-terminal-late",
          nowMs: NOW_MS + 100,
          observerTask,
          organizationId: "org-1",
          subscriptionId: "subscription-terminal-late",
          watchedTask: {
            agentControllerRef: "builtin:claude-code",
            hostId: runtime.deviceId,
            kind: "controller_task",
            taskId: "task-1",
            v: 1,
          },
        })
      ).resolves.toMatchObject({
        outcome: {
          eventId: "claude:task-1:completed",
          status: "succeeded",
        },
        state: "ready",
      });
    } finally {
      harness.close();
    }
  });

  it("records response-stop evidence as completed without claiming success", async () => {
    const harness = createLifecycleHarness();
    try {
      await acceptBatch({
        db: harness.db,
        env: createEnv([]),
        events: [
          buildEvent({
            eventId: "codex:turn-neutral:registered",
            eventType: "registered",
            source: "codex_user_prompt_submit",
            taskId: "turn-neutral",
          }),
          buildEvent({
            eventId: "codex:turn-neutral:completed",
            eventType: "completed",
            source: "codex_stop",
            taskId: "turn-neutral",
          }),
        ],
      });
      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: taskWatchContinuation,
          controllerTaskRegistration: {
            ownerUserId: "user-1",
            registrationSource: "codex_user_prompt_submit",
          },
          db: harness.db,
          idempotencyKey: "subscription-key-neutral-terminal",
          nowMs: NOW_MS + 100,
          observerTask,
          organizationId: "org-1",
          subscriptionId: "subscription-neutral-terminal",
          watchedTask: {
            agentControllerRef: "builtin:codex",
            hostId: runtime.deviceId,
            kind: "controller_task",
            taskId: "turn-neutral",
            v: 1,
          },
        })
      ).resolves.toMatchObject({
        outcome: { status: "completed" },
        state: "ready",
      });
      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "succeeded",
          continuation: taskWatchContinuation,
          controllerTaskRegistration: {
            ownerUserId: "user-1",
            registrationSource: "codex_user_prompt_submit",
          },
          db: harness.db,
          idempotencyKey: "subscription-key-neutral-success",
          nowMs: NOW_MS + 100,
          observerTask,
          organizationId: "org-1",
          subscriptionId: "subscription-neutral-success",
          watchedTask: {
            agentControllerRef: "builtin:codex",
            hostId: runtime.deviceId,
            kind: "controller_task",
            taskId: "turn-neutral",
            v: 1,
          },
        })
      ).resolves.toMatchObject({
        continuationTask: null,
        outcome: { status: "completed" },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("does not let a delayed old attention event settle a later watch", async () => {
    const harness = createLifecycleHarness();
    try {
      const attentionEvent = buildEvent({
        attentionCode: "permission_request",
        eventId: "codex:turn-delayed:permission",
        eventType: "needs_attention",
        source: "codex_permission_request",
        taskId: "turn-delayed",
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [attentionEvent],
        })
      ).resolves.toMatchObject({
        events: [
          {
            reason: "registered_task_missing",
            status: "retryable_rejected",
          },
        ],
      });
      await acceptBatch({
        db: harness.db,
        env: createEnv([]),
        events: [
          buildEvent({
            eventId: "codex:turn-delayed:registered",
            eventType: "registered",
            occurredAtMs: NOW_MS + 10,
            source: "codex_user_prompt_submit",
            taskId: "turn-delayed",
          }),
        ],
        nowMs: NOW_MS + 10,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "needs_attention",
        continuation: taskWatchContinuation,
        controllerTaskRegistration: {
          ownerUserId: "user-1",
          registrationSource: "codex_user_prompt_submit",
        },
        db: harness.db,
        idempotencyKey: "subscription-key-delayed",
        nowMs: NOW_MS + 20,
        observerTask,
        organizationId: "org-1",
        subscriptionId: "subscription-delayed",
        watchedTask: {
          agentControllerRef: "builtin:codex",
          hostId: runtime.deviceId,
          kind: "controller_task",
          taskId: "turn-delayed",
          v: 1,
        },
      });

      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [attentionEvent],
          nowMs: NOW_MS + 30,
        })
      ).resolves.toMatchObject({
        events: [{ outcome: "accepted", status: "accepted" }],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-delayed",
        })
      ).resolves.toMatchObject({
        outcome: null,
        state: "pending",
      });
    } finally {
      harness.close();
    }
  });

  it("retries a previously admitted lifecycle event after its normal age window", async () => {
    const harness = createLifecycleHarness();
    try {
      const completionEvent = buildEvent({
        eventId: "codex:turn-retry:completed",
        eventType: "completed",
        source: "codex_stop",
        taskId: "turn-retry",
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [completionEvent],
        })
      ).resolves.toMatchObject({
        events: [
          {
            reason: "registered_task_missing",
            status: "retryable_rejected",
          },
        ],
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [
            buildEvent({
              eventId: "codex:turn-retry:registered",
              eventType: "registered",
              source: "codex_user_prompt_submit",
              taskId: "turn-retry",
            }),
          ],
        })
      ).resolves.toMatchObject({
        events: [{ status: "accepted" }],
      });

      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [completionEvent],
          nowMs: NOW_MS + 8 * 24 * 60 * 60 * 1000,
        })
      ).resolves.toMatchObject({
        events: [{ outcome: "accepted", status: "accepted" }],
      });
    } finally {
      harness.close();
    }
  });

  it("fails closed for source mismatches and retries missing registration", async () => {
    const harness = createLifecycleHarness();
    try {
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [
            buildEvent({
              eventId: "invalid-source",
              eventType: "completed",
              source: "claude_task_completed",
              taskId: "turn-1",
            }),
            buildEvent({
              eventId: "missing-registration",
              eventType: "completed",
              source: "codex_stop",
              taskId: "turn-missing",
            }),
          ],
        })
      ).resolves.toMatchObject({
        events: [
          {
            reason: "event_source_invalid",
            status: "permanently_rejected",
          },
          {
            reason: "registered_task_missing",
            status: "retryable_rejected",
          },
        ],
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects completion from a different Runtime or registration source", async () => {
    const harness = createLifecycleHarness();
    try {
      await acceptBatch({
        db: harness.db,
        env: createEnv([]),
        events: [
          buildEvent({
            eventId: "claude:task-authority:registered",
            eventType: "registered",
            agentControllerRef: "builtin:claude-code",
            source: "claude_task_created",
            taskId: "task-authority",
          }),
        ],
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [
            buildEvent({
              eventId: "claude:task-authority:wrong-source",
              eventType: "completed",
              agentControllerRef: "builtin:claude-code",
              source: "claude_subagent_stop",
              taskId: "task-authority",
            }),
          ],
        })
      ).resolves.toMatchObject({
        events: [
          {
            reason: "event_source_invalid",
            status: "permanently_rejected",
          },
        ],
      });
      await expect(
        acceptBatch({
          db: harness.db,
          env: createEnv([]),
          events: [
            buildEvent({
              eventId: "claude:task-authority:wrong-runtime",
              eventType: "completed",
              agentControllerRef: "builtin:claude-code",
              source: "claude_task_completed",
              taskId: "task-authority",
            }),
          ],
          runtimeOverride: {
            ...runtime,
            openMeldServiceRuntimeId: "runtime-2",
          },
        })
      ).resolves.toMatchObject({
        events: [
          {
            reason: "event_source_invalid",
            status: "permanently_rejected",
          },
        ],
      });
    } finally {
      harness.close();
    }
  });
});

function buildEvent(
  input: Partial<SubmitAgentControllerTaskLifecycleEventItem> &
    Pick<
      SubmitAgentControllerTaskLifecycleEventItem,
      "eventId" | "eventType" | "source" | "taskId"
    >
): SubmitAgentControllerTaskLifecycleEventItem {
  return {
    agentControllerRef: "builtin:codex",
    attentionCode: null,
    occurredAtMs: NOW_MS,
    organizationId: "org-1",
    ...input,
  };
}

async function acceptBatch(input: {
  db: D1Database;
  env: CoreBindings;
  events: SubmitAgentControllerTaskLifecycleEventItem[];
  nowMs?: number;
  runtimeOverride?: typeof runtime;
}) {
  return await acceptAgentControllerTaskLifecycleEventBatch({
    ...input,
    now: () => input.nowMs ?? NOW_MS,
    resolveMembership: async () => ({ ok: true, userId: "user-1" }),
    runtime: input.runtimeOverride ?? runtime,
  });
}

async function registerAttentionWatch(input: {
  db: D1Database;
  id: string;
  watchedTask: AgentTaskHandle;
}) {
  return await registerAgentTaskCompletionSubscription({
    completionCondition: "needs_attention",
    continuation: {
      ...taskWatchContinuation,
      watchId: `watch-${input.id}`,
    },
    controllerTaskRegistration: {
      ownerUserId: "user-1",
      registrationSource: "codex_user_prompt_submit",
    },
    db: input.db,
    idempotencyKey: `subscription-key-${input.id}`,
    nowMs: NOW_MS,
    observerTask,
    organizationId: "org-1",
    subscriptionId: `subscription-${input.id}`,
    watchedTask: input.watchedTask,
  });
}

function createEnv(queued: unknown[]): CoreBindings {
  return {
    OPENMELD_DAEMON_DISPATCH_QUEUE: {
      send: (message: unknown) => {
        queued.push(message);
        return Promise.resolve();
      },
    },
  } as unknown as CoreBindings;
}

function createLifecycleHarness() {
  const harness = createSqliteD1Harness();
  applyDrizzleMigrationForTable(
    harness,
    "agent_controller_task_lifecycle_events"
  );
  applyDrizzleMigrationForTable(harness, "agent_controller_tasks");
  applyDrizzleMigrationForTable(harness, "agent_task_terminal_outcomes");
  applyDrizzleMigrationForTable(
    harness,
    "agent_task_needs_attention_observations"
  );
  applyDrizzleMigrationForTable(harness, "agent_task_completion_subscriptions");
  applyDrizzleMigrationForTable(harness, "agent_delegations");
  applyDrizzleMigrationForTable(harness, "agent_delegation_children");
  return harness;
}
