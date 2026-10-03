import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it, vi } from "vitest";
import {
  activateAgentDelegationChildren,
  readAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import {
  claimReadyAgentTaskCompletionSubscription,
  readAgentTaskCompletionSubscription,
  recordAgentTaskTerminalOutcome,
  settleAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import {
  type CenterAgentDelegationPreparationError,
  cancelPreparedCenterAgentWakeDelegation,
  prepareCenterAgentWakeDelegation,
} from "../src/center-agent/application/center-agent-delegation-service";
import { prepareCenterAgentTaskWatch } from "../src/center-agent/application/center-agent-task-watch-service";
import type { CoreBindings } from "../src/lib/bindings";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000001";
const CHILD_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000002";
describe("Center Agent delegation preparation", () => {
  it.each([
    undefined,
    "zh-Hans",
  ])("persists the child subscription and upstream language %s before returning dispatch work", async (replyLanguageTag) => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:one",
        completionMode: "resume_parent_when_all_terminal",
        replyLanguageTag,
        db: harness.db,
        destinationNeutralContinuations: true,
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [CHILD_PROFILE_ID],
        text: "Do the delegated work.",
      });
      expect(prepared).toMatchObject({
        childTasks: [
          {
            completionCondition: "terminal",
            task: {
              sourceClientMessageId: "ca-wake:one",
              spaceId: "space-child",
              targetProfileId: CHILD_PROFILE_ID,
            },
          },
        ],
        delegationId: "dlg:ca-wake:one",
      });
      const subscription = await readAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: prepared.childTasks[0]?.subscriptionId ?? "",
      });
      expect(subscription).toMatchObject({
        observerTask: {
          deliveryId: "delivery-parent",
          kind: "native_delivery",
        },
        state: "pending",
      });
      expect(subscription?.continuation).toEqual({
        delegationId: prepared.delegationId,
        instruction:
          "Continue the original request after the delegated Agent task. Use the exact child outcome and published result; do not repeat work that already completed.",
        kind: "resume_agent",
        ...(replyLanguageTag ? { replyLanguageTag } : {}),
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "planned" }],
        completionPolicy: {
          mode: "resume_parent",
          when: "all_terminal",
        },
        state: "active",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps writing the legacy destination snapshot while the rollout gate is disabled", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:legacy-rollout",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        destinationNeutralContinuations: false,
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [CHILD_PROFILE_ID],
        text: "Do the delegated work.",
      });
      const subscription = await readAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: prepared.childTasks[0]?.subscriptionId ?? "",
      });
      expect(subscription?.continuation).toEqual({
        delegationId: prepared.delegationId,
        instruction:
          "Continue the original request after the delegated Agent task. Use the exact child outcome and published result; do not repeat work that already completed.",
        kind: "resume_agent",
        sourceSignalId: "signal-parent",
        spaceId: "space-parent",
        threadContext: {
          rootSignalId: "signal-thread-root",
          threadId: "thr_00000000-0000-4000-8000-000000000001",
        },
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps ordinary Slack parent continuation unavailable while the rollout gate is disabled", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db, "slack");
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:slack-rollout-disabled",
          completionMode: "resume_parent_when_all_terminal",
          db: harness.db,
          destinationNeutralContinuations: false,
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [CHILD_PROFILE_ID],
          text: "Do the delegated work.",
        })
      ).rejects.toMatchObject({
        code: "center_agent.delegation_parent_continuation_unsupported",
      } satisfies Partial<CenterAgentDelegationPreparationError>);
    } finally {
      await harness.close();
    }
  });
  it("persists multiple primary children for an all-terminal barrier", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:many",
          completionMode: "resume_parent_when_all_terminal",
          db: harness.db,
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [
            CHILD_PROFILE_ID,
            "agt_00000000-0000-4000-8000-000000000003",
          ],
          text: "Run both checks.",
        })
      ).resolves.toMatchObject({
        childTasks: [
          { task: { targetProfileId: CHILD_PROFILE_ID } },
          {
            task: {
              targetProfileId: "agt_00000000-0000-4000-8000-000000000003",
            },
          },
        ],
        delegationId: "dlg:ca-wake:many",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects fallback delegation with more than one primary at the application boundary", async () => {
    const harness = await createHarness();
    try {
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:invalid-fallback",
          completionMode: "resume_parent_when_all_terminal",
          db: harness.db,
          fallbackAgentProfileId: "agt_00000000-0000-4000-8000-000000000004",
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [
            CHILD_PROFILE_ID,
            "agt_00000000-0000-4000-8000-000000000003",
          ],
          text: "Run both checks.",
        })
      ).rejects.toMatchObject({
        code: "center_agent.delegation_fallback_requires_one_primary",
      });
    } finally {
      await harness.close();
    }
  });
  it("atomically cancels the delegation and its completion subscription", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:cancel",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [CHILD_PROFILE_ID],
        text: "Do the delegated work.",
      });
      await cancelPreparedCenterAgentWakeDelegation({
        db: harness.db,
        delegationId: prepared.delegationId,
        nowMs: 1100,
        subscriptionIds: prepared.subscriptionIds,
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "cancelled" }],
        state: "cancelled",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: prepared.childTasks[0]?.subscriptionId ?? "",
        })
      ).resolves.toMatchObject({ state: "cancelled" });
    } finally {
      await harness.close();
    }
  });
  it("keeps a fallback planned behind a failure-only activation subscription", async () => {
    const harness = await createHarness();
    const fallbackProfileId = "agt_00000000-0000-4000-8000-000000000004";
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:fallback",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        fallbackAgentProfileId: fallbackProfileId,
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [CHILD_PROFILE_ID],
        text: "Clone the repository and report the exact result.",
      });
      expect(prepared.fallbackTask).toMatchObject({
        task: {
          sourceClientMessageId: "ca-fallback:ca-wake:fallback",
          targetProfileId: fallbackProfileId,
        },
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [
          { role: "primary", state: "planned" },
          { role: "fallback", state: "planned" },
        ],
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: prepared.fallbackTask?.activationSubscriptionId ?? "",
        })
      ).resolves.toMatchObject({
        completionCondition: "failed",
        continuation: {
          agentProfileId: fallbackProfileId,
          kind: "activate_fallback",
        },
        watchedTask: { targetProfileId: CHILD_PROFILE_ID },
      });
    } finally {
      await harness.close();
    }
  });
  it("skips a fallback without waking it when the primary succeeds", async () => {
    const harness = await createHarness();
    const fallbackProfileId = "agt_00000000-0000-4000-8000-000000000004";
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:fallback-skipped",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        fallbackAgentProfileId: fallbackProfileId,
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [CHILD_PROFILE_ID],
        text: "Complete the task.",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: prepared.delegationId,
        nowMs: 1010,
      });
      const primaryTask = prepared.childTasks[0];
      if (!primaryTask) {
        throw new Error("expected primary task fixture");
      }
      await expect(
        recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1100,
          outcome: {
            errorCode: null,
            eventId: "terminal:primary-succeeded",
            occurredAtMs: 1090,
            publishedSignalId: "signal-primary-result",
            status: "succeeded",
          },
          task: primaryTask.task,
        })
      ).resolves.toMatchObject({
        newlyReadySubscriptionIds: [primaryTask.subscriptionId],
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [
          { role: "primary", state: "terminal" },
          { role: "fallback", state: "skipped" },
        ],
        state: "completed",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: prepared.fallbackTask?.activationSubscriptionId ?? "",
        })
      ).resolves.toMatchObject({ state: "settled" });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: prepared.fallbackTask?.subscriptionId ?? "",
        })
      ).resolves.toMatchObject({ state: "settled" });
    } finally {
      await harness.close();
    }
  });
  it("lets an ordinary Slack parent resume from the exact observed task", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db, "slack");
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:slack-direct",
          completionMode: "child_reports_directly",
          db: harness.db,
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [CHILD_PROFILE_ID],
          text: "Do the delegated work.",
        })
      ).resolves.toMatchObject({
        childTasks: [{ completionCondition: "terminal" }],
      });
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:slack-resume",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        destinationNeutralContinuations: true,
        nowMs: 1100,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [CHILD_PROFILE_ID],
        text: "Do the delegated work.",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: prepared.childTasks[0]?.subscriptionId ?? "",
        })
      ).resolves.toMatchObject({
        continuation: {
          delegationId: prepared.delegationId,
          kind: "resume_agent",
        },
        observerTask: {
          deliveryId: "delivery-parent",
          kind: "native_delivery",
        },
      });
    } finally {
      await harness.close();
    }
  });
  it("allows one all-terminal continuation for a Workflow Routine", async () => {
    const harness = await createHarness();
    try {
      await insertRoutineRun(harness.db, {
        nativeDeliveryId: "delivery-parent",
        runId: "routine-run-1",
      });
      await insertParentDelivery(harness.db, "slack", "routine-run-1");
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:routine-resume",
          completionMode: "resume_parent_when_all_terminal",
          db: harness.db,
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [CHILD_PROFILE_ID],
          text: "Do the delegated work.",
        })
      ).resolves.toMatchObject({
        childTasks: [{ completionCondition: "terminal" }],
        delegationId: "dlg:ca-wake:routine-resume",
      });
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:routine-resume",
          completionMode: "resume_parent_when_all_terminal",
          db: harness.db,
          nowMs: 1100,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [CHILD_PROFILE_ID],
          text: "Retry the same delegated work.",
        })
      ).resolves.toMatchObject({
        delegationId: "dlg:ca-wake:routine-resume",
      });
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:routine-second-resume",
          completionMode: "resume_parent_when_all_terminal",
          db: harness.db,
          nowMs: 1200,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [CHILD_PROFILE_ID],
          text: "Start a second delegated continuation.",
        })
      ).rejects.toMatchObject({
        code: "center_agent.routine_delegation_limit_reached",
      } satisfies Partial<CenterAgentDelegationPreparationError>);
    } finally {
      await harness.close();
    }
  });
  it("releases the exact Workflow Routine continuation fence after cancellation", async () => {
    const harness = await createHarness();
    try {
      await insertRoutineRun(harness.db, {
        nativeDeliveryId: "delivery-parent",
        runId: "routine-run-cancelled-delegation",
      });
      await insertParentDelivery(
        harness.db,
        "space",
        "routine-run-cancelled-delegation"
      );
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:routine-cancelled",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [CHILD_PROFILE_ID],
        text: "Do the delegated work.",
      });
      await cancelPreparedCenterAgentWakeDelegation({
        db: harness.db,
        delegationId: prepared.delegationId,
        nowMs: 1100,
        subscriptionIds: prepared.subscriptionIds,
      });
      await expect(
        harness.db
          .query<{
            continuation_delegation_id: string | null;
          }>({
            ...{
              text: 'SELECT continuation_delegation_id FROM "openmeld"."routine_runs" WHERE id = $1',
              values: [],
            },
            values: ["routine-run-cancelled-delegation"],
          })
          .then((result) => result.rows[0] ?? null)
      ).resolves.toEqual({ continuation_delegation_id: null });
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:routine-retry",
          completionMode: "resume_parent_when_all_terminal",
          db: harness.db,
          nowMs: 1200,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [CHILD_PROFILE_ID],
          text: "Retry the delegated work.",
        })
      ).resolves.toMatchObject({
        delegationId: "dlg:ca-wake:routine-retry",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects non-deterministic continuation modes for a Routine", async () => {
    const harness = await createHarness();
    try {
      await insertRoutineRun(harness.db, {
        nativeDeliveryId: "delivery-parent",
        runId: "routine-run-1",
      });
      await insertParentDelivery(harness.db, "space", "routine-run-1");
      await expect(
        prepareCenterAgentWakeDelegation({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          childSpaceId: "space-child",
          clientMessageId: "ca-wake:routine-each",
          completionMode: "resume_parent_on_each_terminal",
          db: harness.db,
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          targetProfileIds: [CHILD_PROFILE_ID],
          text: "Do the delegated work.",
        })
      ).rejects.toMatchObject({
        code: "center_agent.routine_delegation_requires_all_terminal",
      } satisfies Partial<CenterAgentDelegationPreparationError>);
    } finally {
      await harness.close();
    }
  });
});
describe("Center Agent task watch preparation", () => {
  it("persists one exact watch without creating delegation ownership", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      const task = {
        kind: "space_wake" as const,
        sourceClientMessageId: "parallel-task-1",
        spaceId: "space-child",
        targetProfileId: CHILD_PROFILE_ID,
        v: 1 as const,
      };
      await expect(
        prepareCenterAgentTaskWatch({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          completionCondition: "terminal",
          db: harness.db,
          env: {
            OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED: "true",
          } as CoreBindings,
          instruction: "Continue after the exact parallel task completes.",
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          task,
          watchId: "watch-1",
        })
      ).resolves.toMatchObject({
        status: "watching",
        subscriptionId: "sub:watch-1",
        task,
        watchId: "watch-1",
      });
      const subscription = await readAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: "sub:watch-1",
      });
      expect(subscription).toMatchObject({
        observerTask: {
          deliveryId: "delivery-parent",
          kind: "native_delivery",
        },
        state: "pending",
        watchedTask: task,
      });
      expect(subscription?.continuation).toEqual({
        instruction: "Continue after the exact parallel task completes.",
        kind: "resume_task_watch",
        watchId: "watch-1",
      });
      const delegationCount = await harness.db
        .query<{
          count: number;
        }>({
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."agent_delegations"',
          values: [],
        })
        .then((result) => result.rows[0] ?? null);
      expect(delegationCount?.count).toBe(0);
    } finally {
      await harness.close();
    }
  });
  it("keeps the legacy watch destination snapshot while the rollout gate is disabled", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      const task = {
        kind: "space_wake" as const,
        sourceClientMessageId: "parallel-task-legacy",
        spaceId: "space-child",
        targetProfileId: CHILD_PROFILE_ID,
        v: 1 as const,
      };
      await prepareCenterAgentTaskWatch({
        actorProfileId: CENTER_AGENT_PROFILE_ID,
        completionCondition: "terminal",
        db: harness.db,
        env: {
          OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED: "false",
        } as CoreBindings,
        instruction: "Continue after the exact parallel task completes.",
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        task,
        watchId: "watch-legacy-rollout",
      });
      const subscription = await readAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: "sub:watch-legacy-rollout",
      });
      expect(subscription?.continuation).toEqual({
        instruction: "Continue after the exact parallel task completes.",
        kind: "resume_task_watch",
        sourceSignalId: "signal-parent",
        spaceId: "space-parent",
        threadContext: {
          rootSignalId: "signal-thread-root",
          threadId: "thr_00000000-0000-4000-8000-000000000001",
        },
        watchId: "watch-legacy-rollout",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps ordinary Slack task watches unavailable while the rollout gate is disabled", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db, "slack");
      await expect(
        prepareCenterAgentTaskWatch({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          completionCondition: "terminal",
          db: harness.db,
          env: {
            OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED: "false",
          } as CoreBindings,
          instruction: "Continue after the exact parallel task completes.",
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          task: {
            deliveryId: "delivery-parallel-slack-disabled",
            kind: "native_delivery",
            v: 1,
          },
          watchId: "watch-slack-rollout-disabled",
        })
      ).rejects.toMatchObject({
        code: "center_agent.delegation_parent_continuation_unsupported",
      } satisfies Partial<CenterAgentDelegationPreparationError>);
    } finally {
      await harness.close();
    }
  });
  it("immediately schedules a continuation when the exact task is already terminal", async () => {
    const harness = await createHarness();
    const send = vi.fn(async () => undefined);
    const task = {
      deliveryId: "delivery-watched",
      kind: "native_delivery" as const,
      v: 1 as const,
    };
    try {
      await insertParentDelivery(harness.db);
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 950,
        outcome: {
          errorCode: null,
          eventId: "watched-terminal",
          occurredAtMs: 900,
          publishedSignalId: "signal-watched",
          status: "succeeded",
        },
        task,
      });
      await expect(
        prepareCenterAgentTaskWatch({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          completionCondition: "succeeded",
          db: harness.db,
          env: {
            OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
          } as unknown as CoreBindings,
          instruction: "Continue from the completed task.",
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          task,
          watchId: "watch-already-terminal",
        })
      ).resolves.toMatchObject({ status: "continuation_pending" });
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "agent_task_continuation",
          subscriptionId: "sub:watch-already-terminal",
        })
      );
      await claimReadyAgentTaskCompletionSubscription({
        claimId: "claim-watch-already-terminal",
        claimLeaseMs: 60_000,
        db: harness.db,
        nowMs: 1100,
        subscriptionId: "sub:watch-already-terminal",
      });
      await settleAgentTaskCompletionSubscription({
        claimId: "claim-watch-already-terminal",
        continuationTask: {
          deliveryId: "delivery-watch-continuation",
          kind: "native_delivery",
          v: 1,
        },
        db: harness.db,
        nowMs: 1200,
        subscriptionId: "sub:watch-already-terminal",
      });
      await expect(
        prepareCenterAgentTaskWatch({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          completionCondition: "succeeded",
          db: harness.db,
          env: {} as CoreBindings,
          instruction: "Continue from the completed task.",
          nowMs: 1300,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          task,
          watchId: "watch-already-terminal",
        })
      ).resolves.toMatchObject({
        outcome: { eventId: "watched-terminal", status: "succeeded" },
        status: "continuation_created",
      });
    } finally {
      await harness.close();
    }
  });
  it("returns the authoritative terminal outcome when the watch condition cannot match", async () => {
    const harness = await createHarness();
    const task = {
      deliveryId: "delivery-failed-before-watch",
      kind: "native_delivery" as const,
      v: 1 as const,
    };
    try {
      await insertParentDelivery(harness.db);
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 950,
        outcome: {
          errorCode: "task.failed",
          eventId: "watched-failure",
          occurredAtMs: 900,
          publishedSignalId: null,
          status: "failed",
        },
        task,
      });
      await expect(
        prepareCenterAgentTaskWatch({
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          completionCondition: "succeeded",
          db: harness.db,
          env: {} as CoreBindings,
          instruction: "Continue only if the task succeeds.",
          nowMs: 1000,
          organizationId: "org-1",
          parentSubmissionId: "submission-parent",
          task,
          watchId: "watch-condition-not-met",
        })
      ).resolves.toMatchObject({
        outcome: {
          errorCode: "task.failed",
          eventId: "watched-failure",
          status: "failed",
        },
        status: "condition_not_met",
      });
    } finally {
      await harness.close();
    }
  });
});
async function createHarness() {
  const harness = await createPostgresHarness();
  await harness.query({
    text: 'INSERT INTO "openmeld"."organizations" (id, "name", "slug", "created_at") VALUES (\'org-1\', \'Test Organization\', (\'org-1\')::text, 1700000000000)',
  });
  return harness;
}
async function insertRoutineRun(
  db: PostgresDatabase,
  input: {
    nativeDeliveryId: string;
    runId: string;
  }
): Promise<void> {
  await db.query({
    ...{
      text: `
        INSERT INTO "openmeld"."routine_runs" (
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          target_space_id_snapshot,
          execution_engine,
          native_delivery_id,
          started_at_ms
        )
        VALUES ($1, 'routine-1', 'org-1', 900, 'submitted', 'space-parent',
          'workflow', $2, 900)
      `,
      values: [],
    },
    values: [input.runId, input.nativeDeliveryId],
  });
}
async function insertParentDelivery(
  db: PostgresDatabase,
  conversationKind: "slack" | "space" = "space",
  routineRunId: string | null = null
): Promise<void> {
  await db.query({
    ...{
      text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'accepted', $12, $13, $14, $15, $16, $17, $18, $19, $20)
      `,
      values: [],
    },
    values: [
      "delivery-parent",
      "org-1",
      conversationKind,
      "space-parent",
      CENTER_AGENT_PROFILE_ID,
      "binding-parent",
      "signal-parent",
      routineRunId,
      "dispatch-parent",
      routineRunId ?? "idempotency-parent",
      "submission-parent",
      "human-parent",
      "user-parent",
      "Felix",
      JSON.stringify({
        rootSignalId: "signal-thread-root",
        threadId: "thr_00000000-0000-4000-8000-000000000001",
      }),
      conversationKind === "slack" ? "team-parent" : null,
      conversationKind === "slack" ? "channel-parent" : null,
      conversationKind === "slack" ? "thread-parent" : null,
      900,
      900,
    ],
  });
}
