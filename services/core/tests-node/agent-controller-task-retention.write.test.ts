import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { buildAgentTaskKey } from "@openmeld/schemas";
import type {
  AgentTaskContinuation,
  AgentTaskHandle,
  SubmitAgentControllerTaskLifecycleEventItem,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  createAgentControllerTaskLifecycleEvent,
  markAgentControllerTaskLifecycleEventProcessed,
  registerAgentControllerTask,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-controller-task-lifecycle-repo";
import {
  AGENT_CONTROLLER_TASK_EVENT_RETENTION_MS,
  AGENT_CONTROLLER_TASK_REGISTRATION_RETENTION_MS,
  runAgentControllerTaskRetention,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-controller-task-retention";
import {
  AgentControllerTaskRegistrationMissingError,
  recordAgentTaskTerminalOutcome,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 200 * DAY_MS;
const observerTask: AgentTaskHandle = {
  deliveryId: "retention-observer",
  kind: "native_delivery",
  v: 1,
};
const continuation: Extract<
  AgentTaskContinuation,
  {
    kind: "resume_task_watch";
  }
> = {
  instruction: "Continue after the exact controller task finishes.",
  kind: "resume_task_watch",
  sourceSignalId: "signal-retention",
  spaceId: "space-retention",
  threadContext: null,
  watchId: "watch-retention",
};
const codexUserPromptRegistration = {
  ownerUserId: "user-1",
  registrationSource: "codex_user_prompt_submit" as const,
};
describe("Agent Controller task retention", () => {
  it("prunes only old, terminal, inactive task history", async () => {
    const harness = await createRetentionHarness();
    try {
      const oldEventAt = NOW_MS - AGENT_CONTROLLER_TASK_EVENT_RETENTION_MS - 1;
      await createProcessedLifecycleEvent({
        db: harness.db,
        eventId: "event-prunable",
        occurredAtMs: oldEventAt,
        taskId: "event-prunable",
      });
      await createProcessedLifecycleEvent({
        db: harness.db,
        eventId: "event-protected",
        occurredAtMs: oldEventAt,
        taskId: "event-protected",
      });
      await registerTask({
        db: harness.db,
        occurredAtMs: oldEventAt,
        taskId: "event-protected",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "needs_attention",
        continuation: null,
        controllerTaskRegistration: codexUserPromptRegistration,
        db: harness.db,
        idempotencyKey: "watch-event-protected",
        nowMs: oldEventAt,
        observerTask,
        organizationId: "org-1",
        subscriptionId: "watch-event-protected",
        watchedTask: controllerTask("event-protected"),
      });
      await createAgentControllerTaskLifecycleEvent({
        db: harness.db,
        event: lifecycleEvent({
          eventId: "event-unprocessed",
          occurredAtMs: oldEventAt,
          taskId: "event-unprocessed",
        }),
        hostId: "device-1",
        nowMs: oldEventAt,
      });
      await createAgentControllerTaskLifecycleEvent({
        db: harness.db,
        event: lifecycleEvent({
          eventId: "event-unprocessed-recent",
          occurredAtMs: NOW_MS - DAY_MS,
          taskId: "event-unprocessed-recent",
        }),
        hostId: "device-1",
        nowMs: NOW_MS - DAY_MS,
      });
      const oldTerminalAt =
        NOW_MS - AGENT_CONTROLLER_TASK_REGISTRATION_RETENTION_MS - 1;
      await insertWakePublication({
        completedAtMs: oldTerminalAt,
        db: harness.db,
        delegationId: "delegation-publication-prunable",
        publicationId: "publication-prunable",
        state: "completed",
      });
      await insertWakePublication({
        completedAtMs: null,
        db: harness.db,
        delegationId: "delegation-publication-pending",
        publicationId: "publication-pending",
        state: "pending",
      });
      await insertActiveDelegation({
        db: harness.db,
        delegationId: "delegation-publication-active",
        nowMs: oldTerminalAt,
      });
      await insertWakePublication({
        completedAtMs: oldTerminalAt,
        db: harness.db,
        delegationId: "delegation-publication-active",
        publicationId: "publication-active",
        state: "completed",
      });
      await registerTerminalTask({
        db: harness.db,
        taskId: "terminal-prunable",
        terminalAtMs: oldTerminalAt,
      });
      await registerTask({
        db: harness.db,
        occurredAtMs: oldTerminalAt - 1,
        taskId: "terminal-protected",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation,
        controllerTaskRegistration: codexUserPromptRegistration,
        db: harness.db,
        idempotencyKey: "watch-terminal-protected",
        nowMs: oldTerminalAt - 1,
        observerTask,
        organizationId: "org-1",
        subscriptionId: "watch-terminal-protected",
        watchedTask: controllerTask("terminal-protected"),
      });
      await recordTerminalOutcome({
        db: harness.db,
        taskId: "terminal-protected",
        terminalAtMs: oldTerminalAt,
      });
      await registerTask({
        db: harness.db,
        occurredAtMs: oldTerminalAt,
        taskId: "unterminated",
      });
      await registerTerminalTask({
        db: harness.db,
        taskId: "terminal-recent",
        terminalAtMs: NOW_MS - DAY_MS,
      });
      await registerTerminalTask({
        db: harness.db,
        taskId: "terminal-with-unprocessed",
        terminalAtMs: oldTerminalAt,
      });
      await createAgentControllerTaskLifecycleEvent({
        db: harness.db,
        event: {
          ...lifecycleEvent({
            eventId: "completion-unprocessed-recent",
            occurredAtMs: NOW_MS - DAY_MS,
            taskId: "terminal-with-unprocessed",
          }),
          eventType: "completed",
          source: "codex_stop",
        },
        hostId: "device-1",
        nowMs: NOW_MS - DAY_MS,
      });
      await expect(
        runAgentControllerTaskRetention({
          db: harness.db,
          limit: 100,
          nowMs: NOW_MS,
        })
      ).resolves.toEqual({
        lifecycleEventsDeleted: 2,
        registeredTasksDeleted: 1,
        terminalOutcomesDeleted: 1,
        wakePublicationsDeleted: 1,
      });
      await expect(
        listIds(
          harness.db,
          "agent_controller_task_lifecycle_events",
          "event_id"
        )
      ).resolves.toEqual([
        "completion-unprocessed-recent",
        "event-protected",
        "event-unprocessed-recent",
      ]);
      await expect(
        listIds(harness.db, "agent_controller_tasks", "task_id")
      ).resolves.toEqual([
        "event-protected",
        "terminal-protected",
        "terminal-recent",
        "terminal-with-unprocessed",
        "unterminated",
      ]);
      await expect(
        listIds(harness.db, "agent_task_terminal_outcomes", "task_key")
      ).resolves.toEqual([
        buildAgentTaskKey(controllerTask("terminal-protected")),
        buildAgentTaskKey(controllerTask("terminal-recent")),
        buildAgentTaskKey(controllerTask("terminal-with-unprocessed")),
      ]);
      await expect(
        listIds(harness.db, "center_agent_wake_publications", "publication_id")
      ).resolves.toEqual(["publication-active", "publication-pending"]);
      await expect(
        registerTask({
          db: harness.db,
          occurredAtMs: NOW_MS,
          ownerUserId: "user-2",
          source: "codex_subagent_start",
          taskId: "terminal-prunable",
        })
      ).resolves.toBeUndefined();
      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation,
          controllerTaskRegistration: codexUserPromptRegistration,
          db: harness.db,
          idempotencyKey: "watch-expired-controller-task",
          nowMs: NOW_MS,
          observerTask,
          organizationId: "org-1",
          subscriptionId: "watch-expired-controller-task",
          watchedTask: controllerTask("terminal-prunable"),
        })
      ).rejects.toBeInstanceOf(AgentControllerTaskRegistrationMissingError);
    } finally {
      await harness.close();
    }
  });
  it("bounds each cleanup pass", async () => {
    const harness = await createRetentionHarness();
    try {
      const terminalAtMs =
        NOW_MS - AGENT_CONTROLLER_TASK_REGISTRATION_RETENTION_MS - 1;
      await registerTerminalTask({
        db: harness.db,
        taskId: "terminal-1",
        terminalAtMs,
      });
      await registerTerminalTask({
        db: harness.db,
        taskId: "terminal-2",
        terminalAtMs,
      });
      await expect(
        runAgentControllerTaskRetention({
          db: harness.db,
          limit: 1,
          nowMs: NOW_MS,
        })
      ).resolves.toMatchObject({
        registeredTasksDeleted: 1,
        terminalOutcomesDeleted: 1,
      });
      await expect(
        listIds(harness.db, "agent_controller_tasks", "task_id")
      ).resolves.toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});
function controllerTask(taskId: string): AgentTaskHandle {
  return {
    agentControllerRef: "builtin:codex",
    hostId: "device-1",
    kind: "controller_task",
    taskId,
    v: 1,
  };
}
async function insertActiveDelegation(input: {
  db: PostgresDatabase;
  delegationId: string;
  nowMs: number;
}) {
  await input.db.query({
    ...{
      text: `
        INSERT INTO "openmeld"."agent_delegations" (
          delegation_id,
          idempotency_key,
          organization_id,
          space_id,
          parent_task_key,
          parent_task_handle_json,
          completion_policy_json,
          state,
          generation,
          created_at_ms,
          updated_at_ms,
          completed_at_ms
        )
        VALUES ($1, $2, 'org-1', 'space-retention', $3, '{}', '{}', 'active', 1, $4, $5, NULL)
      `,
      values: [],
    },
    values: [
      input.delegationId,
      `idempotency:${input.delegationId}`,
      buildAgentTaskKey(observerTask),
      input.nowMs,
      input.nowMs,
    ],
  });
}
async function insertWakePublication(input: {
  completedAtMs: number | null;
  db: PostgresDatabase;
  delegationId: string;
  publicationId: string;
  state: "completed" | "pending";
}) {
  const createdAtMs =
    input.completedAtMs ??
    NOW_MS - AGENT_CONTROLLER_TASK_REGISTRATION_RETENTION_MS - 1;
  await input.db.query({
    ...{
      text: `
        INSERT INTO "openmeld"."center_agent_wake_publications" (
          publication_id,
          delegation_id,
          organization_id,
          space_id,
          command_json,
          state,
          attempt_count,
          next_attempt_at_ms,
          last_error,
          accepted_at_ms,
          signal_json,
          completed_at_ms,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, 'org-1', 'space-retention', '{}', $3, 0, $4, NULL, $5, $6, $7, $8, $9)
      `,
      values: [],
    },
    values: [
      input.publicationId,
      input.delegationId,
      input.state,
      createdAtMs,
      input.completedAtMs,
      input.completedAtMs === null ? null : "{}",
      input.completedAtMs,
      createdAtMs,
      input.completedAtMs ?? createdAtMs,
    ],
  });
}
function lifecycleEvent(input: {
  eventId: string;
  occurredAtMs: number;
  taskId: string;
}): SubmitAgentControllerTaskLifecycleEventItem {
  return {
    agentControllerRef: "builtin:codex",
    attentionCode: null,
    eventId: input.eventId,
    eventType: "registered",
    occurredAtMs: input.occurredAtMs,
    organizationId: "org-1",
    source: "codex_user_prompt_submit",
    taskId: input.taskId,
  };
}
async function createProcessedLifecycleEvent(input: {
  db: PostgresDatabase;
  eventId: string;
  occurredAtMs: number;
  taskId: string;
}) {
  await createAgentControllerTaskLifecycleEvent({
    db: input.db,
    event: lifecycleEvent(input),
    hostId: "device-1",
    nowMs: input.occurredAtMs,
  });
  await markAgentControllerTaskLifecycleEventProcessed({
    db: input.db,
    eventId: input.eventId,
    nowMs: input.occurredAtMs,
  });
}
async function registerTask(input: {
  db: PostgresDatabase;
  occurredAtMs: number;
  ownerUserId?: string;
  source?: SubmitAgentControllerTaskLifecycleEventItem["source"];
  taskId: string;
}) {
  await registerAgentControllerTask({
    db: input.db,
    event: {
      ...lifecycleEvent({
        eventId: `registration:${input.taskId}`,
        occurredAtMs: input.occurredAtMs,
        taskId: input.taskId,
      }),
      source: input.source ?? "codex_user_prompt_submit",
    },
    hostId: "device-1",
    nowMs: input.occurredAtMs,
    ownerUserId: input.ownerUserId ?? "user-1",
    openMeldServiceRuntimeId: "runtime-1",
  });
}
async function registerTerminalTask(input: {
  db: PostgresDatabase;
  taskId: string;
  terminalAtMs: number;
}) {
  await registerTask({
    db: input.db,
    occurredAtMs: input.terminalAtMs - 1,
    taskId: input.taskId,
  });
  await recordTerminalOutcome(input);
}
async function recordTerminalOutcome(input: {
  db: PostgresDatabase;
  taskId: string;
  terminalAtMs: number;
}) {
  await recordAgentTaskTerminalOutcome({
    db: input.db,
    nowMs: input.terminalAtMs,
    outcome: {
      errorCode: null,
      eventId: `completion:${input.taskId}`,
      occurredAtMs: input.terminalAtMs,
      publishedSignalId: null,
      status: "completed",
    },
    task: controllerTask(input.taskId),
  });
}
async function listIds(
  db: PostgresDatabase,
  table: string,
  column: string
): Promise<string[]> {
  const rows = await db.query<{
    id: string;
  }>({
    text: `SELECT ${column} AS id FROM "openmeld"."${table}" ORDER BY ${column} ASC`,
    values: [],
  });
  return rows.rows.map((row) => row.id);
}
async function createRetentionHarness() {
  const harness = await createPostgresHarness();
  return harness;
}
