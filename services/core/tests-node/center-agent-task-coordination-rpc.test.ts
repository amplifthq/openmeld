import type {
  OpenMeldRequestContext,
  SubmitAgentControllerTaskLifecycleEventItem,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { registerAgentControllerTask } from "../src/agent-task-coordination/infrastructure/d1/agent-controller-task-lifecycle-repo";
import {
  activateAgentDelegationChildren,
  cancelAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import {
  readAgentTaskCompletionSubscription,
  recordAgentTaskTerminalOutcome,
} from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import { prepareCenterAgentWakeDelegation } from "../src/center-agent/application/center-agent-delegation-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCenterAgentListAgentTasks,
  rpcCenterAgentWatchAgentTask,
  rpcListCenterAgentAuditJournal,
} from "../src/rpc/methods";
import {
  applyDrizzleMigrationForTable,
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const HUMAN_PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const NOW_MS = 2_000_000;

describe("Center Agent task coordination RPC", () => {
  it("isolates discovery by Organization and represented requester", async () => {
    const harness = createHarness();
    try {
      await Promise.all([
        registerTask({
          db: harness.db,
          occurredAtMs: NOW_MS + 10,
          ownerUserId: "user-1",
          source: "claude_task_created",
          taskId: "claude-task-owned",
        }),
        registerTask({
          db: harness.db,
          occurredAtMs: NOW_MS + 20,
          ownerUserId: "user-1",
          source: "codex_user_prompt_submit",
          taskId: "codex-turn-owned",
        }),
        registerTask({
          db: harness.db,
          occurredAtMs: NOW_MS + 30,
          ownerUserId: "user-1",
          source: "claude_session_start",
          taskId: "claude-session-owned",
        }),
        registerTask({
          db: harness.db,
          hostId: "device-2",
          occurredAtMs: NOW_MS + 40,
          ownerUserId: "user-2",
          source: "codex_user_prompt_submit",
          taskId: "codex-turn-other-user",
        }),
        registerTask({
          db: harness.db,
          occurredAtMs: NOW_MS + 50,
          organizationId: "org-2",
          ownerUserId: "user-1",
          source: "codex_user_prompt_submit",
          taskId: "codex-turn-other-org",
        }),
      ]);
      const env = { OPENMELD_DB: harness.db } as CoreBindings;

      await expect(
        rpcCenterAgentListAgentTasks(env, {
          context: centerAgentContext("user-1"),
          limit: 20,
        })
      ).resolves.toMatchObject({
        hasMore: false,
        organizationId: "org-1",
        tasks: [
          {
            registrationSource: "claude_session_start",
            supportedCompletionConditions: [],
            task: { taskId: "claude-session-owned" },
          },
          {
            registrationSource: "codex_user_prompt_submit",
            supportedCompletionConditions: ["terminal"],
            task: { taskId: "codex-turn-owned" },
          },
          {
            registrationSource: "claude_task_created",
            supportedCompletionConditions: ["terminal", "succeeded"],
            task: { taskId: "claude-task-owned" },
          },
        ],
      });
      await expect(
        rpcCenterAgentListAgentTasks(env, {
          context: centerAgentContext("user-2"),
          limit: 20,
        })
      ).resolves.toMatchObject({
        tasks: [{ task: { taskId: "codex-turn-other-user" } }],
      });

      await expect(
        rpcListCenterAgentAuditJournal(env, {
          actionSet: "v9",
          context: centerAgentContext("user-1"),
        })
      ).resolves.toMatchObject({ entries: [] });
      await expect(
        rpcListCenterAgentAuditJournal(env, {
          actionSet: "v11",
          context: centerAgentContext("user-1"),
        })
      ).resolves.toMatchObject({
        entries: [
          expect.objectContaining({ action: "read_agent_tasks" }),
          expect.objectContaining({ action: "read_agent_tasks" }),
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("fails closed before watching another requester's task or an unsupported condition", async () => {
    const harness = createHarness();
    try {
      const env = { OPENMELD_DB: harness.db } as CoreBindings;
      const otherRequesterTask = await registerTask({
        db: harness.db,
        hostId: "device-2",
        ownerUserId: "user-2",
        source: "codex_user_prompt_submit",
        taskId: "codex-turn-other-user",
      });
      const ownCodexTask = await registerTask({
        db: harness.db,
        ownerUserId: "user-1",
        source: "codex_user_prompt_submit",
        taskId: "codex-turn-owned",
      });
      const ownClaudeTask = await registerTask({
        db: harness.db,
        ownerUserId: "user-1",
        source: "claude_task_created",
        taskId: "claude-task-owned",
      });

      await expect(
        rpcCenterAgentWatchAgentTask(env, {
          completionCondition: "terminal",
          context: centerAgentContext("user-1"),
          instruction: "Continue after this task.",
          task: otherRequesterTask.task,
        })
      ).rejects.toMatchObject({
        code: "center_agent.task_watch_target_not_found",
        status: 404,
      });
      await expect(
        rpcCenterAgentWatchAgentTask(env, {
          completionCondition: "succeeded",
          context: centerAgentContext("user-1"),
          instruction: "Continue only after success.",
          task: ownCodexTask.task,
        })
      ).rejects.toMatchObject({
        code: "center_agent.task_watch_controller_callback_unavailable",
        status: 409,
      });
      await expect(
        rpcCenterAgentWatchAgentTask(env, {
          completionCondition: "needs_attention",
          context: centerAgentContext("user-1"),
          instruction: "Continue when attention is needed.",
          task: ownClaudeTask.task,
        })
      ).rejects.toMatchObject({
        code: "center_agent.task_watch_controller_callback_unavailable",
        status: 409,
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a planned delegated Space Wake before it becomes an executable child", async () => {
    const harness = createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareDelegatedSpaceWake({
        clientMessageId: "ca-wake:planned",
        db: harness.db,
      });

      await expect(
        rpcCenterAgentWatchAgentTask(buildWatchEnv(harness.db), {
          completionCondition: "terminal",
          context: centerAgentContext("user-1"),
          instruction: "Continue after the exact child becomes terminal.",
          task: prepared.task,
        })
      ).rejects.toMatchObject({
        code: "center_agent.task_watch_target_not_found",
        status: 404,
      });
    } finally {
      harness.close();
    }
  });

  it("watches an active exact delegated Space Wake without Dispatch Ledger evidence", async () => {
    const harness = createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareDelegatedSpaceWake({
        clientMessageId: "ca-wake:active",
        db: harness.db,
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: prepared.delegationId,
        nowMs: NOW_MS + 10,
      });

      const response = await rpcCenterAgentWatchAgentTask(
        buildWatchEnv(harness.db),
        {
          completionCondition: "terminal",
          context: centerAgentContext("user-1"),
          instruction: "Continue after the exact child becomes terminal.",
          task: prepared.task,
        }
      );
      expect(response).toMatchObject({
        status: "watching",
        task: prepared.task,
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: response.subscriptionId,
        })
      ).resolves.toMatchObject({
        state: "pending",
        watchedTask: prepared.task,
      });
      const dispatchCount = await harness.db
        .prepare("SELECT COUNT(*) AS count FROM openMeldDaemon_dispatch_ledger")
        .first<{ count: number }>();
      expect(dispatchCount?.count).toBe(0);
    } finally {
      harness.close();
    }
  });

  it("reuses the exact watch and immediately projects an existing terminal child outcome", async () => {
    const harness = createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareDelegatedSpaceWake({
        clientMessageId: "ca-wake:terminal",
        db: harness.db,
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: prepared.delegationId,
        nowMs: NOW_MS + 10,
      });
      const outcome = {
        errorCode: "runtime.progress_stale",
        eventId: "terminal-event-existing-child",
        occurredAtMs: NOW_MS + 20,
        publishedSignalId: null,
        status: "failed" as const,
      };
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: NOW_MS + 30,
        outcome,
        task: prepared.task,
      });
      const input = {
        completionCondition: "terminal" as const,
        context: centerAgentContext("user-1"),
        instruction: "Continue after the exact child becomes terminal.",
        task: prepared.task,
      };

      const first = await rpcCenterAgentWatchAgentTask(
        buildWatchEnv(harness.db),
        input
      );
      const repeated = await rpcCenterAgentWatchAgentTask(
        buildWatchEnv(harness.db),
        input
      );

      expect(first).toMatchObject({
        outcome,
        status: "continuation_pending",
        task: prepared.task,
      });
      expect(repeated).toMatchObject({
        outcome,
        status: "continuation_pending",
        subscriptionId: first.subscriptionId,
        task: prepared.task,
        watchId: first.watchId,
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    ["skipped", "ca-wake:skipped"],
    ["cancelled", "ca-wake:cancelled"],
  ] as const)("rejects an exact delegated Space Wake in %s state", async (state, clientMessageId) => {
    const harness = createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareDelegatedSpaceWake({
        clientMessageId,
        db: harness.db,
      });
      if (state === "cancelled") {
        await cancelAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
          nowMs: NOW_MS + 10,
        });
      } else {
        await harness.db
          .prepare(
            `
              UPDATE agent_delegation_children
              SET state = 'skipped', updated_at_ms = ?
              WHERE delegation_id = ?
            `
          )
          .bind(NOW_MS + 10, prepared.delegationId)
          .run();
      }

      await expect(
        rpcCenterAgentWatchAgentTask(buildWatchEnv(harness.db), {
          completionCondition: "terminal",
          context: centerAgentContext("user-1"),
          instruction: "Continue after the exact child becomes terminal.",
          task: prepared.task,
        })
      ).rejects.toMatchObject({
        code: "center_agent.task_watch_target_not_found",
        status: 404,
      });
    } finally {
      harness.close();
    }
  });
});

async function registerTask(input: {
  db: D1Database;
  hostId?: string;
  occurredAtMs?: number;
  organizationId?: string;
  ownerUserId: string;
  source: Extract<
    SubmitAgentControllerTaskLifecycleEventItem["source"],
    "claude_session_start" | "claude_task_created" | "codex_user_prompt_submit"
  >;
  taskId: string;
}) {
  const agentControllerRef = input.source.startsWith("claude_")
    ? "builtin:claude-code"
    : "builtin:codex";
  const occurredAtMs = input.occurredAtMs ?? NOW_MS;
  return await registerAgentControllerTask({
    db: input.db,
    event: {
      agentControllerRef,
      attentionCode: null,
      eventId: `${agentControllerRef}:${input.taskId}:registered`,
      eventType: "registered",
      occurredAtMs,
      organizationId: input.organizationId ?? "org-1",
      source: input.source,
      taskId: input.taskId,
    },
    hostId: input.hostId ?? "device-1",
    nowMs: occurredAtMs,
    ownerUserId: input.ownerUserId,
    openMeldServiceRuntimeId: `runtime:${input.ownerUserId}`,
  });
}

function centerAgentContext(userId: string): OpenMeldRequestContext {
  return {
    activeOrganizationId: "org-1",
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: `request:${userId}`,
      openMeldProfileId: CENTER_AGENT_PROFILE_ID,
    },
    agentControllerConversationId: `submission:${userId}`,
  };
}

function buildWatchEnv(db: D1Database): CoreBindings {
  return {
    OPENMELD_DB: db,
    OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED: "true",
  } as CoreBindings;
}

async function prepareDelegatedSpaceWake(input: {
  clientMessageId: string;
  db: D1Database;
}) {
  const prepared = await prepareCenterAgentWakeDelegation({
    actorProfileId: CENTER_AGENT_PROFILE_ID,
    childSpaceId: "space-child",
    clientMessageId: input.clientMessageId,
    completionMode: "child_reports_directly",
    db: input.db,
    nowMs: NOW_MS,
    organizationId: "org-1",
    parentSubmissionId: "submission:user-1",
    targetProfileIds: ["agt_22222222-2222-4222-8222-222222222222"],
    text: "Review the retained recovery result.",
  });
  const task = prepared.childTasks[0]?.task;
  if (!task) {
    throw new Error("Expected the prepared exact child task.");
  }
  return {
    delegationId: prepared.delegationId,
    task,
  };
}

function createHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)",
  });
  harness.run({
    sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)",
  });
  harness.run({
    sql: `
      CREATE TABLE members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE openmeld_profiles (
        profile_id TEXT PRIMARY KEY,
        profile_name TEXT NOT NULL,
        profile_kind TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        organization_id TEXT,
        owner_user_id TEXT NOT NULL,
        managed_role TEXT
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE center_agent_designations (
        organization_id TEXT PRIMARY KEY,
        agent_profile_id TEXT NOT NULL,
        duty TEXT,
        designated_by TEXT NOT NULL,
        operating_state TEXT NOT NULL DEFAULT 'active',
        paused_at INTEGER,
        paused_by_user_id TEXT,
        created_at INTEGER NOT NULL
      )
    `,
  });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_audit_journal",
    "center_agent_context_manifests",
    "center_agent_context_load_receipts",
  ]);
  applyDrizzleMigrationForTable(harness, "agent_controller_tasks");
  applyDrizzleMigrationForTable(harness, "agent_task_terminal_outcomes");
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_native_delivery_ledger"
  );
  applyDrizzleMigrationForTable(harness, "agent_task_completion_subscriptions");
  applyDrizzleMigrationForTable(harness, "agent_delegations");
  applyDrizzleMigrationForTable(harness, "agent_delegation_children");
  applyDrizzleMigrationForTable(harness, "openMeldDaemon_dispatch_ledger");
  applyDrizzleMigrationForTable(harness, "openMeldDaemon_dispatch_attempts");
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_agent_profile_bindings"
  );
  harness.run({
    sql: `
      CREATE TABLE space_index_spaces (
        space_id TEXT PRIMARY KEY,
        organization_id TEXT,
        organization_visibility TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      INSERT INTO space_index_spaces (
        space_id,
        organization_id,
        organization_visibility,
        status
      )
      VALUES ('space-child', 'org-1', 'organization', 'active')
    `,
  });
  harness.run({
    sql: `
      INSERT INTO organizations (id)
      VALUES ('org-1'), ('org-2')
    `,
  });
  harness.run({
    sql: `
      INSERT INTO members (id, organization_id, user_id, role)
      VALUES
        ('member-1', 'org-1', 'user-1', 'owner'),
        ('member-2', 'org-1', 'user-2', 'member')
    `,
  });
  harness.run({
    sql: `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_kind,
        status,
        organization_id,
        owner_user_id,
        managed_role
      )
      VALUES (?, 'Center Agent', 'agent', 'active', 'org-1', 'user-1', 'center_agent')
    `,
    params: [CENTER_AGENT_PROFILE_ID],
  });
  harness.run({
    sql: `
      INSERT INTO users (id, name)
      VALUES ('user-1', 'Felix')
    `,
  });
  harness.run({
    sql: `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        managed_role
      )
      VALUES (
        ?,
        'Felix',
        'human',
        1,
        'active',
        'org-1',
        'user-1',
        NULL
      )
    `,
    params: [HUMAN_PROFILE_ID],
  });
  harness.run({
    sql: `
      INSERT INTO center_agent_designations (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      )
      VALUES ('org-1', ?, NULL, 'user-1', ?)
    `,
    params: [CENTER_AGENT_PROFILE_ID, NOW_MS],
  });
  return harness;
}

async function insertParentDelivery(db: D1Database): Promise<void> {
  await db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          routine_run_id,
          dispatch_id,
          idempotency_key,
          submission_id,
          status,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          thread_context_json,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, 'space', ?, ?, ?, ?, NULL, ?, ?, ?, 'accepted', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      `
    )
    .bind(
      "delivery-parent",
      "org-1",
      "space-parent",
      CENTER_AGENT_PROFILE_ID,
      "binding-parent",
      "signal-parent",
      "dispatch-parent",
      "idempotency-parent",
      "submission:user-1",
      HUMAN_PROFILE_ID,
      "user-1",
      "Felix",
      JSON.stringify({
        rootSignalId: "signal-thread-root",
        threadId: "thr_00000000-0000-4000-8000-000000000001",
      }),
      NOW_MS,
      NOW_MS
    )
    .run();
}
