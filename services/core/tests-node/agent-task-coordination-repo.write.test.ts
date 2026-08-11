import { buildAgentTaskKey } from "@openmeld/schemas";
import type {
  AgentTaskContinuation,
  AgentTaskHandle,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  activateAgentDelegationChildren,
  cancelAgentDelegation,
  createAgentDelegation,
  readAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import {
  claimReadyAgentTaskCompletionSubscription,
  listAgentTaskCompletionSubscriptionsNeedingEnqueue,
  readAgentTaskCompletionSubscription,
  recordAgentTaskNeedsAttentionObservation,
  recordAgentTaskTerminalOutcome,
  recordAgentTaskTerminalOutcomeIfMatching,
  registerAgentTaskCompletionSubscription,
  settleAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CHILD_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000001";

const childTask: AgentTaskHandle = {
  kind: "space_wake",
  sourceClientMessageId: "center-agent-wake-1",
  spaceId: "space-1",
  targetProfileId: CHILD_PROFILE_ID,
  v: 1,
};

const parentTask: AgentTaskHandle = {
  deliveryId: "delivery-parent-1",
  kind: "native_delivery",
  v: 1,
};

const continuation: Extract<AgentTaskContinuation, { kind: "resume_agent" }> = {
  delegationId: "delegation-1",
  instruction: "Summarize the completed child task for the requester.",
  kind: "resume_agent",
  sourceSignalId: "signal-source-1",
  spaceId: "space-1",
  threadContext: null,
};

describe("Agent task coordination repo", () => {
  it("does not release a continuation when a guarded terminal write finds a conflicting outcome", async () => {
    const harness = createCoordinationHarness();
    try {
      const subscription = await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation,
        db: harness.db,
        idempotencyKey: "guarded-conflict-subscription-key",
        nowMs: 100,
        observerTask: parentTask,
        organizationId: "organization-1",
        subscriptionId: "guarded-conflict-subscription",
        watchedTask: childTask,
      });
      expect(subscription.state).toBe("pending");
      const existingOutcome = {
        errorCode: null,
        eventId: "existing-success-event",
        occurredAtMs: 110,
        publishedSignalId: "signal-existing-success",
        status: "succeeded" as const,
      };
      await harness.db
        .prepare(
          `
            INSERT INTO agent_task_terminal_outcomes (
              task_key,
              task_handle_json,
              status,
              event_id,
              outcome_json,
              occurred_at_ms,
              observed_at_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          buildAgentTaskKey(childTask),
          JSON.stringify(childTask),
          existingOutcome.status,
          existingOutcome.eventId,
          JSON.stringify(existingOutcome),
          existingOutcome.occurredAtMs,
          120
        )
        .run();

      const result = await recordAgentTaskTerminalOutcomeIfMatching({
        db: harness.db,
        nowMs: 130,
        outcome: {
          errorCode: "runtime_coordinator.publication_retry_exhausted",
          eventId: "publication-failed-event",
          occurredAtMs: 110,
          publishedSignalId: "signal-publication-failed",
          status: "publication_failed",
        },
        task: childTask,
      });

      expect(result).toEqual({
        matches: false,
        outcome: existingOutcome,
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: subscription.subscriptionId,
        })
      ).resolves.toMatchObject({ state: "pending" });
    } finally {
      harness.close();
    }
  });

  it("settles only needs-attention subscriptions from a nonterminal observation", async () => {
    const harness = createCoordinationHarness();
    try {
      const taskWatchContinuation: Extract<
        AgentTaskContinuation,
        { kind: "resume_task_watch" }
      > = {
        instruction: "Help the requester resolve the task blocker.",
        kind: "resume_task_watch",
        sourceSignalId: "signal-source-attention-1",
        spaceId: "space-1",
        threadContext: null,
        watchId: "watch-attention-1",
      };
      await registerAgentTaskCompletionSubscription({
        completionCondition: "needs_attention",
        continuation: taskWatchContinuation,
        db: harness.db,
        idempotencyKey: "subscription-key-attention-1",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-attention-1",
        watchedTask: childTask,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: taskWatchContinuation,
        db: harness.db,
        idempotencyKey: "subscription-key-terminal-1",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-terminal-1",
        watchedTask: childTask,
      });

      await expect(
        recordAgentTaskNeedsAttentionObservation({
          db: harness.db,
          nowMs: 1100,
          observation: {
            attentionCode: "permission_request",
            eventId: "attention-event-1",
            occurredAtMs: 1090,
            status: "needs_attention",
          },
          task: childTask,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: ["subscription-attention-1"],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-attention-1",
        })
      ).resolves.toMatchObject({
        outcome: {
          attentionCode: "permission_request",
          status: "needs_attention",
        },
        state: "ready",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-terminal-1",
        })
      ).resolves.toMatchObject({
        outcome: null,
        state: "pending",
      });
    } finally {
      harness.close();
    }
  });

  it("settles a needs-attention watch registered after the durable observation exactly once", async () => {
    const harness = createCoordinationHarness();
    try {
      const taskWatchContinuation: Extract<
        AgentTaskContinuation,
        { kind: "resume_task_watch" }
      > = {
        instruction: "Help the requester resolve the task blocker.",
        kind: "resume_task_watch",
        sourceSignalId: "signal-source-attention-late-watch",
        spaceId: "space-1",
        threadContext: null,
        watchId: "watch-attention-late-watch",
      };
      const observation = {
        attentionCode: "permission_request",
        eventId: "attention-event-before-watch",
        occurredAtMs: 1000,
        status: "needs_attention" as const,
      };

      await expect(
        recordAgentTaskNeedsAttentionObservation({
          db: harness.db,
          nowMs: 1010,
          observation,
          task: childTask,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: [],
      });

      const firstRegistration = await registerAgentTaskCompletionSubscription({
        completionCondition: "needs_attention",
        continuation: taskWatchContinuation,
        db: harness.db,
        idempotencyKey: "subscription-key-attention-late-watch",
        nowMs: 1020,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-attention-late-watch",
        watchedTask: childTask,
      });
      expect(firstRegistration).toMatchObject({
        outcome: observation,
        state: "ready",
      });

      await expect(
        recordAgentTaskNeedsAttentionObservation({
          db: harness.db,
          nowMs: 1030,
          observation,
          task: childTask,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: [],
        readySubscriptionIds: ["subscription-attention-late-watch"],
      });
      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "needs_attention",
          continuation: taskWatchContinuation,
          db: harness.db,
          idempotencyKey: "subscription-key-attention-late-watch",
          nowMs: 1040,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: "subscription-attention-late-watch",
          watchedTask: childTask,
        })
      ).resolves.toEqual(firstRegistration);
    } finally {
      harness.close();
    }
  });

  it("settles a registered subscription exactly once from a terminal event", async () => {
    const harness = createCoordinationHarness();
    try {
      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation,
          db: harness.db,
          idempotencyKey: "subscription-key-1",
          nowMs: 1000,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: "subscription-1",
          watchedTask: childTask,
        })
      ).resolves.toMatchObject({ state: "pending" });

      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: {
            errorCode: null,
            eventId: "terminal-event-1",
            occurredAtMs: 1090,
            publishedSignalId: "signal-final-1",
            status: "succeeded",
          },
          task: childTask,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: ["subscription-1"],
      });

      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal-event-duplicate",
            occurredAtMs: 1190,
            publishedSignalId: "signal-final-other",
            status: "succeeded",
          },
          task: childTask,
        })
      ).resolves.toMatchObject({ newlyReadySubscriptionIds: [] });

      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-1",
        })
      ).resolves.toMatchObject({
        outcome: {
          eventId: "terminal-event-1",
          publishedSignalId: "signal-final-1",
          status: "succeeded",
        },
        state: "ready",
      });
    } finally {
      harness.close();
    }
  });

  it("settles immediately when the exact task was already terminal", async () => {
    const harness = createCoordinationHarness();
    try {
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1000,
        outcome: {
          errorCode: "task.failed",
          eventId: "terminal-event-before-registration",
          occurredAtMs: 990,
          publishedSignalId: "signal-failure-1",
          status: "failed",
        },
        task: childTask,
      });

      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "failed",
          continuation,
          db: harness.db,
          idempotencyKey: "subscription-key-2",
          nowMs: 1100,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: "subscription-2",
          watchedTask: childTask,
        })
      ).resolves.toMatchObject({
        outcome: { eventId: "terminal-event-before-registration" },
        state: "ready",
      });
    } finally {
      harness.close();
    }
  });

  it("settles without continuation when the terminal outcome does not match", async () => {
    const harness = createCoordinationHarness();
    try {
      await registerAgentTaskCompletionSubscription({
        completionCondition: "succeeded",
        continuation,
        db: harness.db,
        idempotencyKey: "subscription-key-condition-not-met",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-condition-not-met",
        watchedTask: childTask,
      });

      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: {
            errorCode: "task.failed",
            eventId: "terminal-event-condition-not-met",
            occurredAtMs: 1090,
            publishedSignalId: null,
            status: "failed",
          },
          task: childTask,
        })
      ).resolves.toMatchObject({ newlyReadySubscriptionIds: [] });

      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-condition-not-met",
        })
      ).resolves.toMatchObject({
        outcome: { status: "failed" },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("claims and settles one continuation without duplicate execution", async () => {
    const harness = createCoordinationHarness();
    try {
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation,
        db: harness.db,
        idempotencyKey: "subscription-key-3",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-3",
        watchedTask: childTask,
      });
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: {
          errorCode: null,
          eventId: "terminal-event-3",
          occurredAtMs: 1090,
          publishedSignalId: "signal-final-3",
          status: "succeeded",
        },
        task: childTask,
      });

      await expect(
        claimReadyAgentTaskCompletionSubscription({
          claimId: "claim-1",
          claimLeaseMs: 30_000,
          db: harness.db,
          nowMs: 1200,
          subscriptionId: "subscription-3",
        })
      ).resolves.toMatchObject({
        claimId: "claim-1",
        continuationIdempotencyKey: "agent-task-continuation:subscription-3",
        state: "continuation_claimed",
      });
      await expect(
        claimReadyAgentTaskCompletionSubscription({
          claimId: "claim-2",
          claimLeaseMs: 30_000,
          db: harness.db,
          nowMs: 1300,
          subscriptionId: "subscription-3",
        })
      ).resolves.toBeNull();

      await expect(
        claimReadyAgentTaskCompletionSubscription({
          claimId: "claim-3",
          claimLeaseMs: 30_000,
          db: harness.db,
          nowMs: 31_201,
          subscriptionId: "subscription-3",
        })
      ).resolves.toMatchObject({
        claimId: "claim-3",
        continuationIdempotencyKey: "agent-task-continuation:subscription-3",
      });

      await expect(
        settleAgentTaskCompletionSubscription({
          claimId: "claim-3",
          continuationTask: {
            deliveryId: "delivery-continuation-1",
            kind: "native_delivery",
            v: 1,
          },
          db: harness.db,
          nowMs: 1400,
          subscriptionId: "subscription-3",
        })
      ).resolves.toMatchObject({
        continuationTask: {
          deliveryId: "delivery-continuation-1",
        },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("lists ready and expired claims for durable continuation redrive", async () => {
    const harness = createCoordinationHarness();
    try {
      for (const subscriptionId of [
        "subscription-ready",
        "subscription-claimed",
      ]) {
        await registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: {
            ...continuation,
            delegationId: `delegation:${subscriptionId}`,
          },
          db: harness.db,
          idempotencyKey: `subscription-key:${subscriptionId}`,
          nowMs: 1000,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId,
          watchedTask: {
            ...childTask,
            sourceClientMessageId: `client:${subscriptionId}`,
          },
        });
        await recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: {
            errorCode: null,
            eventId: `terminal:${subscriptionId}`,
            occurredAtMs: 1090,
            publishedSignalId: `signal:${subscriptionId}`,
            status: "succeeded",
          },
          task: {
            ...childTask,
            sourceClientMessageId: `client:${subscriptionId}`,
          },
        });
      }
      await claimReadyAgentTaskCompletionSubscription({
        claimId: "claim-expiring",
        claimLeaseMs: 100,
        db: harness.db,
        nowMs: 1200,
        subscriptionId: "subscription-claimed",
      });

      await expect(
        listAgentTaskCompletionSubscriptionsNeedingEnqueue({
          db: harness.db,
          limit: 10,
          nowMs: 1250,
        })
      ).resolves.toEqual(["subscription-ready"]);
      await expect(
        listAgentTaskCompletionSubscriptionsNeedingEnqueue({
          db: harness.db,
          limit: 10,
          nowMs: 1300,
        })
      ).resolves.toEqual(["subscription-ready", "subscription-claimed"]);
    } finally {
      harness.close();
    }
  });

  it("settles direct-report subscriptions without creating continuation work", async () => {
    const harness = createCoordinationHarness();
    try {
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: "subscription-key-direct",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-direct",
        watchedTask: childTask,
      });
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: {
          errorCode: null,
          eventId: "terminal-event-direct",
          occurredAtMs: 1090,
          publishedSignalId: "signal-final-direct",
          status: "succeeded",
        },
        task: childTask,
      });

      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-direct",
        })
      ).resolves.toMatchObject({
        continuation: null,
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("accepts provider event ids reused by different exact tasks", async () => {
    const harness = createCoordinationHarness();
    const otherChildTask: AgentTaskHandle = {
      ...childTask,
      sourceClientMessageId: "center-agent-wake-2",
    };
    try {
      await expect(
        Promise.all([
          recordAgentTaskTerminalOutcome({
            db: harness.db,
            nowMs: 1100,
            outcome: {
              errorCode: null,
              eventId: "provider-terminal",
              occurredAtMs: 1090,
              publishedSignalId: "signal-final-1",
              status: "succeeded",
            },
            task: childTask,
          }),
          recordAgentTaskTerminalOutcome({
            db: harness.db,
            nowMs: 1100,
            outcome: {
              errorCode: null,
              eventId: "provider-terminal",
              occurredAtMs: 1090,
              publishedSignalId: "signal-final-2",
              status: "succeeded",
            },
            task: otherChildTask,
          }),
        ])
      ).resolves.toHaveLength(2);
    } finally {
      harness.close();
    }
  });

  it("does not reject terminal evidence because a provider clock is ahead", async () => {
    const harness = createCoordinationHarness();
    try {
      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1000,
          outcome: {
            errorCode: null,
            eventId: "terminal-event-clock-skew",
            occurredAtMs: 1500,
            publishedSignalId: "signal-final-clock-skew",
            status: "succeeded",
          },
          task: childTask,
        })
      ).resolves.toMatchObject({
        outcome: { eventId: "terminal-event-clock-skew" },
      });
    } finally {
      harness.close();
    }
  });

  it("projects one exact child terminal outcome into its delegation", async () => {
    const harness = createCoordinationHarness();
    try {
      await expect(
        createAgentDelegation({
          children: [
            {
              agentProfileId: CHILD_PROFILE_ID,
              role: "primary",
              task: childTask,
            },
          ],
          completionPolicy: {
            mode: "resume_parent",
            when: "all_terminal",
          },
          db: harness.db,
          delegationId: "delegation-projection",
          idempotencyKey: "delegation-key-projection",
          nowMs: 1000,
          organizationId: "org-1",
          parentTask,
          spaceId: "space-1",
        })
      ).resolves.toMatchObject({
        children: [{ state: "planned" }],
        state: "active",
      });
      await expect(
        activateAgentDelegationChildren({
          db: harness.db,
          delegationId: "delegation-projection",
          nowMs: 1050,
        })
      ).resolves.toMatchObject({
        children: [{ state: "active" }],
      });

      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: {
          errorCode: null,
          eventId: "terminal-event-delegation",
          occurredAtMs: 1090,
          publishedSignalId: "signal-final-delegation",
          status: "succeeded",
        },
        task: childTask,
      });

      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: "delegation-projection",
        })
      ).resolves.toMatchObject({
        children: [
          {
            state: "terminal",
            terminalOutcome: { status: "succeeded" },
          },
        ],
        state: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("cancels an undispatched delegation and its active child", async () => {
    const harness = createCoordinationHarness();
    try {
      await createAgentDelegation({
        children: [
          {
            agentProfileId: CHILD_PROFILE_ID,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "child_reports_directly" },
        db: harness.db,
        delegationId: "delegation-cancel",
        idempotencyKey: "delegation-key-cancel",
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-1",
      });

      await expect(
        cancelAgentDelegation({
          db: harness.db,
          delegationId: "delegation-cancel",
          nowMs: 1100,
        })
      ).resolves.toMatchObject({
        children: [{ state: "cancelled" }],
        state: "cancelled",
      });
    } finally {
      harness.close();
    }
  });

  it("readies exactly one continuation after every child is terminal", async () => {
    const harness = createCoordinationHarness();
    const arranged = buildBarrierChildren("all-terminal");
    try {
      await arrangeBarrierDelegation({
        barrier: "all_terminal",
        children: arranged,
        db: harness.db,
        delegationId: "delegation-all-terminal",
      });

      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: buildOutcome("all-terminal-first", "succeeded"),
          task: arranged[0].task,
        })
      ).resolves.toMatchObject({ newlyReadySubscriptionIds: [] });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: arranged[0].subscriptionId,
        })
      ).resolves.toMatchObject({ state: "pending" });

      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1200,
          outcome: buildOutcome("all-terminal-second", "failed"),
          task: arranged[1].task,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: [arranged[1].subscriptionId],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: arranged[0].subscriptionId,
        })
      ).resolves.toMatchObject({ state: "settled" });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: "delegation-all-terminal",
        })
      ).resolves.toMatchObject({
        children: [
          { terminalOutcome: { status: "succeeded" } },
          { terminalOutcome: { status: "failed" } },
        ],
        state: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("reconstructs an all-terminal barrier when outcomes arrived before subscriptions", async () => {
    const harness = createCoordinationHarness();
    const arranged = buildBarrierChildren("late-all-terminal");
    const delegationId = "delegation-late-all-terminal";
    try {
      await createAgentDelegation({
        children: arranged.map((child) => ({
          agentProfileId: child.agentProfileId,
          role: "primary",
          task: child.task,
        })),
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId,
        idempotencyKey: `key:${delegationId}`,
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-1",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId,
        nowMs: 1001,
      });
      for (const [index, child] of arranged.entries()) {
        await recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100 + index,
          outcome: buildOutcome(`late-all-terminal-${index}`, "succeeded"),
          task: child.task,
        });
      }

      for (const child of arranged) {
        await registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: { ...continuation, delegationId },
          db: harness.db,
          idempotencyKey: `key:${child.subscriptionId}`,
          nowMs: 1200,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: child.subscriptionId,
          watchedTask: child.task,
        });
      }

      await expect(
        listAgentTaskCompletionSubscriptionsNeedingEnqueue({
          db: harness.db,
          limit: 10,
          nowMs: 1300,
        })
      ).resolves.toEqual([arranged[0].subscriptionId]);
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: arranged[1].subscriptionId,
        })
      ).resolves.toMatchObject({ state: "settled" });
    } finally {
      harness.close();
    }
  });

  it("uses the first successful child as the one-shot barrier winner", async () => {
    const harness = createCoordinationHarness();
    const arranged = buildBarrierChildren("first-success");
    try {
      await arrangeBarrierDelegation({
        barrier: "first_success",
        children: arranged,
        db: harness.db,
        delegationId: "delegation-first-success",
      });
      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: buildOutcome("first-success-failure", "failed"),
          task: arranged[0].task,
        })
      ).resolves.toMatchObject({ newlyReadySubscriptionIds: [] });
      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1200,
          outcome: buildOutcome("first-success-winner", "succeeded"),
          task: arranged[1].task,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: [arranged[1].subscriptionId],
      });
    } finally {
      harness.close();
    }
  });

  it("uses the first authoritative failure as the one-shot barrier winner", async () => {
    const harness = createCoordinationHarness();
    const arranged = buildBarrierChildren("on-failure");
    try {
      await arrangeBarrierDelegation({
        barrier: "on_failure",
        children: arranged,
        db: harness.db,
        delegationId: "delegation-on-failure",
      });
      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: buildOutcome("on-failure-success", "succeeded"),
          task: arranged[0].task,
        })
      ).resolves.toMatchObject({ newlyReadySubscriptionIds: [] });
      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1200,
          outcome: buildOutcome("on-failure-winner", "failed"),
          task: arranged[1].task,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: [arranged[1].subscriptionId],
      });
    } finally {
      harness.close();
    }
  });

  it("creates one independent continuation for each terminal child", async () => {
    const harness = createCoordinationHarness();
    const arranged = buildBarrierChildren("on-each");
    try {
      await arrangeBarrierDelegation({
        barrier: "on_each_terminal",
        children: arranged,
        db: harness.db,
        delegationId: "delegation-on-each",
      });
      for (const [index, child] of arranged.entries()) {
        await expect(
          recordAgentTaskTerminalOutcome({
            db: harness.db,
            nowMs: 1100 + index * 100,
            outcome: buildOutcome(`on-each-${index}`, "succeeded"),
            task: child.task,
          })
        ).resolves.toMatchObject({
          newlyReadySubscriptionIds: [child.subscriptionId],
        });
      }
      await expect(
        listAgentTaskCompletionSubscriptionsNeedingEnqueue({
          db: harness.db,
          limit: 10,
          nowMs: 1400,
        })
      ).resolves.toEqual(arranged.map((child) => child.subscriptionId).sort());
    } finally {
      harness.close();
    }
  });

  it("settles a fallback result registered after the primary already succeeded", async () => {
    const harness = createCoordinationHarness();
    const delegationId = "delegation-late-fallback-result";
    const primaryTask = {
      ...childTask,
      sourceClientMessageId: "primary-late-fallback-result",
    };
    const fallbackTask = {
      ...childTask,
      sourceClientMessageId: "fallback-late-fallback-result",
      targetProfileId: "agt_00000000-0000-4000-8000-000000000009",
    };
    try {
      await createAgentDelegation({
        children: [
          {
            agentProfileId: primaryTask.targetProfileId,
            role: "primary",
            task: primaryTask,
          },
          {
            agentProfileId: fallbackTask.targetProfileId,
            role: "fallback",
            task: fallbackTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId,
        idempotencyKey: `key:${delegationId}`,
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-1",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId,
        nowMs: 1001,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: { ...continuation, delegationId },
        db: harness.db,
        idempotencyKey: "key:late-primary-result",
        nowMs: 1002,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-late-primary-result",
        watchedTask: primaryTask,
      });
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: buildOutcome("late-primary-success", "succeeded"),
        task: primaryTask,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "failed",
        continuation: {
          agentProfileId: fallbackTask.targetProfileId,
          delegationId,
          kind: "activate_fallback",
          spaceId: "space-1",
          text: "Run only if the primary fails.",
        },
        db: harness.db,
        idempotencyKey: "key:late-fallback-activation",
        nowMs: 1200,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-late-fallback-activation",
        watchedTask: primaryTask,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: { ...continuation, delegationId },
        db: harness.db,
        idempotencyKey: "key:late-fallback-result",
        nowMs: 1201,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-late-fallback-result",
        watchedTask: fallbackTask,
      });

      await expect(
        readAgentDelegation({ db: harness.db, delegationId })
      ).resolves.toMatchObject({
        children: [
          { role: "primary", state: "terminal" },
          { role: "fallback", state: "skipped" },
        ],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-late-fallback-result",
        })
      ).resolves.toMatchObject({ state: "settled" });
    } finally {
      harness.close();
    }
  });

  it("readies a general watch when its observer also owns the child delegation", async () => {
    const harness = createCoordinationHarness();
    const delegationId = "delegation-with-general-watch";
    const taskWatchContinuation: Extract<
      AgentTaskContinuation,
      { kind: "resume_task_watch" }
    > = {
      instruction: "Continue after the delegated child finishes.",
      kind: "resume_task_watch",
      sourceSignalId: "signal-general-watch",
      spaceId: "space-1",
      threadContext: null,
      watchId: "watch-delegated-child",
    };
    try {
      await createAgentDelegation({
        children: [
          {
            agentProfileId: CHILD_PROFILE_ID,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId,
        idempotencyKey: `key:${delegationId}`,
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-1",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId,
        nowMs: 1001,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: { ...continuation, delegationId },
        db: harness.db,
        idempotencyKey: "key:delegation-result-with-general-watch",
        nowMs: 1002,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-delegation-result-with-general-watch",
        watchedTask: childTask,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: taskWatchContinuation,
        db: harness.db,
        idempotencyKey: "key:general-watch-for-delegated-child",
        nowMs: 1003,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-general-watch-for-delegated-child",
        watchedTask: childTask,
      });

      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: buildOutcome("delegated-child-complete", "succeeded"),
          task: childTask,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: [
          "subscription-delegation-result-with-general-watch",
          "subscription-general-watch-for-delegated-child",
        ],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-general-watch-for-delegated-child",
        })
      ).resolves.toMatchObject({
        outcome: { status: "succeeded" },
        state: "ready",
      });
    } finally {
      harness.close();
    }
  });

  it("readies a late general watch for an already-terminal delegated child", async () => {
    const harness = createCoordinationHarness();
    const delegationId = "delegation-with-late-general-watch";
    const taskWatchContinuation: Extract<
      AgentTaskContinuation,
      { kind: "resume_task_watch" }
    > = {
      instruction: "Continue after confirming the delegated child finished.",
      kind: "resume_task_watch",
      sourceSignalId: "signal-late-general-watch",
      spaceId: "space-1",
      threadContext: null,
      watchId: "watch-late-delegated-child",
    };
    try {
      await createAgentDelegation({
        children: [
          {
            agentProfileId: CHILD_PROFILE_ID,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "child_reports_directly" },
        db: harness.db,
        delegationId,
        idempotencyKey: `key:${delegationId}`,
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-1",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId,
        nowMs: 1001,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: null,
        db: harness.db,
        idempotencyKey: "key:direct-delegation-result",
        nowMs: 1002,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-direct-delegation-result",
        watchedTask: childTask,
      });
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: buildOutcome("delegated-child-already-complete", "succeeded"),
        task: childTask,
      });

      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: taskWatchContinuation,
          db: harness.db,
          idempotencyKey: "key:late-general-watch-for-delegated-child",
          nowMs: 1200,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: "subscription-late-general-watch-for-delegated-child",
          watchedTask: childTask,
        })
      ).resolves.toMatchObject({
        outcome: { status: "succeeded" },
        state: "ready",
      });
    } finally {
      harness.close();
    }
  });

  it("cancels a claimed general watch continuation when its observer is stopped", async () => {
    const harness = createCoordinationHarness();
    const taskWatchContinuation: Extract<
      AgentTaskContinuation,
      { kind: "resume_task_watch" }
    > = {
      instruction: "Continue after the parallel task.",
      kind: "resume_task_watch",
      sourceSignalId: "signal-parent",
      spaceId: "space-1",
      threadContext: null,
      watchId: "watch-parallel-1",
    };
    try {
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: taskWatchContinuation,
        db: harness.db,
        idempotencyKey: "watch-key-parallel-1",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-watch-parallel-1",
        watchedTask: childTask,
      });
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: buildOutcome("parallel-complete", "succeeded"),
        task: childTask,
      });
      await claimReadyAgentTaskCompletionSubscription({
        claimId: "claim-watch-parallel-1",
        claimLeaseMs: 60_000,
        db: harness.db,
        nowMs: 1101,
        subscriptionId: "subscription-watch-parallel-1",
      });

      const stopped = await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1200,
        outcome: {
          errorCode: "runtime_coordinator.wake_stop_pre_agent_requested",
          eventId: "parent-stopped",
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      });

      expect(stopped.cancelledChildTasks).toEqual([]);
      expect(stopped.cancelledContinuationIdempotencyKeys).toEqual([
        "agent-task-continuation:subscription-watch-parallel-1",
      ]);
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-watch-parallel-1",
        })
      ).resolves.toMatchObject({
        claimId: null,
        state: "cancelled",
      });
    } finally {
      harness.close();
    }
  });

  it("refuses a new general watch after its observer was already stopped", async () => {
    const harness = createCoordinationHarness();
    const taskWatchContinuation: Extract<
      AgentTaskContinuation,
      { kind: "resume_task_watch" }
    > = {
      instruction: "Continue after the parallel task.",
      kind: "resume_task_watch",
      sourceSignalId: "signal-parent",
      spaceId: "space-1",
      threadContext: null,
      watchId: "watch-after-stop",
    };
    try {
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1000,
        outcome: {
          errorCode: "runtime_coordinator.wake_stop_pre_agent_requested",
          eventId: "parent-already-stopped",
          occurredAtMs: 990,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      });

      await expect(
        registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: taskWatchContinuation,
          db: harness.db,
          idempotencyKey: "watch-key-after-stop",
          nowMs: 1100,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: "subscription-watch-after-stop",
          watchedTask: childTask,
        })
      ).resolves.toMatchObject({
        state: "cancelled",
      });
    } finally {
      harness.close();
    }
  });
});

function createCoordinationHarness() {
  const harness = createSqliteD1Harness();
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

function buildBarrierChildren(label: string) {
  const buildChild = (index: number) => ({
    agentProfileId: `agt_00000000-0000-4000-8000-00000000000${index + 2}`,
    subscriptionId: `subscription-${label}-${index}`,
    task: {
      kind: "space_wake" as const,
      sourceClientMessageId: `client-${label}-${index}`,
      spaceId: "space-1",
      targetProfileId: `agt_00000000-0000-4000-8000-00000000000${index + 2}`,
      v: 1 as const,
    },
  });
  return [buildChild(0), buildChild(1)] as const;
}

async function arrangeBarrierDelegation(input: {
  barrier: "all_terminal" | "first_success" | "on_each_terminal" | "on_failure";
  children: ReturnType<typeof buildBarrierChildren>;
  db: D1Database;
  delegationId: string;
}): Promise<void> {
  await createAgentDelegation({
    children: input.children.map((child) => ({
      agentProfileId: child.agentProfileId,
      role: "primary",
      task: child.task,
    })),
    completionPolicy: { mode: "resume_parent", when: input.barrier },
    db: input.db,
    delegationId: input.delegationId,
    idempotencyKey: `key:${input.delegationId}`,
    nowMs: 1000,
    organizationId: "org-1",
    parentTask,
    spaceId: "space-1",
  });
  await activateAgentDelegationChildren({
    db: input.db,
    delegationId: input.delegationId,
    nowMs: 1001,
  });
  for (const child of input.children) {
    await registerAgentTaskCompletionSubscription({
      completionCondition: "terminal",
      continuation: {
        ...continuation,
        delegationId: input.delegationId,
      },
      db: input.db,
      idempotencyKey: `key:${child.subscriptionId}`,
      nowMs: 1002,
      observerTask: parentTask,
      organizationId: "org-1",
      subscriptionId: child.subscriptionId,
      watchedTask: child.task,
    });
  }
}

function buildOutcome(eventId: string, status: "failed" | "succeeded") {
  return {
    errorCode: status === "failed" ? "task.failed" : null,
    eventId,
    occurredAtMs: 1090,
    publishedSignalId: status === "succeeded" ? `signal:${eventId}` : null,
    status,
  } as const;
}
