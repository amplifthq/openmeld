import type {
  CenterAgentAttribution,
  CenterAgentWakePublicationCommand,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readAgentDelegation } from "../src/agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import {
  readAgentTaskCompletionSubscription,
  recordAgentTaskTerminalOutcome,
} from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import { planCenterAgentWakeDelegation } from "../src/center-agent/application/center-agent-delegation-service";
import {
  executeCenterAgentWakePublication,
  prepareCenterAgentWakePublication,
  retryPendingCenterAgentWakePublications,
} from "../src/center-agent/application/center-agent-wake-publication-service";
import {
  claimCenterAgentWakePublication,
  markCenterAgentWakePublicationAccepted,
  prepareCenterAgentWakePublicationRecords,
  readCenterAgentWakePublication,
} from "../src/center-agent/infrastructure/d1/center-agent-wake-publication-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000001";
const CHILD_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000002";
const HUMAN_PROFILE_ID = "00000000-0000-4000-8000-000000000003";
const CLIENT_MESSAGE_ID = "ca-wake:durable-publication";

describe("Center Agent Wake publication recovery", () => {
  it.each([
    "accepted",
    "rejected",
  ])("recovers an unattempted second Space (%s) without repeating the first or losing its result", async (secondOutcome) => {
    const harness = createHarness();
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const ids = ["ca-wake:batch-alpha", "ca-wake:batch-beta"] as const;
      const plans = ids.map((clientMessageId, index) =>
        planCenterAgentWakeDelegation({
          childSpaceId: index === 0 ? "space-alpha" : "space-beta",
          clientMessageId,
          targetProfileIds: [CHILD_PROFILE_ID],
        })
      );
      const [alpha, beta] = plans;
      const alphaTask = alpha?.childTasks[0]?.task;
      const betaTask = beta?.childTasks[0]?.task;
      if (!(alpha && beta && alphaTask && betaTask)) {
        throw new Error("Missing batch fixture");
      }
      const commands = plans.map((plan, index) => ({
        ...buildCommand({
          clientMessageId: index === 0 ? ids[0] : ids[1],
          delegationId: alpha.delegationId,
          subscriptionIds: plan.subscriptionIds,
        }),
        batchRootPublicationId: ids[0],
        ...(index === 0 ? { batchPublicationIds: [...ids] } : {}),
        spaceId: index === 0 ? "space-alpha" : "space-beta",
      }));
      await prepareCenterAgentWakePublicationRecords({
        commands,
        db: harness.db,
        nowMs: 1000,
      });
      const publishSignal = vi.fn(
        (command: CenterAgentWakePublicationCommand) => {
          if (
            command.spaceId === "space-beta" &&
            secondOutcome === "rejected"
          ) {
            return Promise.reject(
              new Error(
                'HTTP 403: {"error":{"message":"Space access revoked"}}'
              )
            );
          }
          return Promise.resolve({
            ...buildSignal({
              clientMessageId: command.clientMessageId,
              signalId: `signal:${command.spaceId}`,
            }),
            spaceId: command.spaceId,
          });
        }
      );
      await executeCenterAgentWakePublication({
        db: harness.db,
        nowMs: 1010,
        publicationId: ids[0],
        publishSignal,
        resolveSignal: async () => null,
      });
      const firstResult = await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1020,
        task: alphaTask,
        outcome: {
          status: "succeeded",
          errorCode: null,
          eventId: "result-alpha",
          occurredAtMs: 1020,
          publishedSignalId: "result-alpha",
        },
      });
      expect(firstResult.readySubscriptionIds).toEqual([]);
      const partial = await readAgentDelegation({
        db: harness.db,
        delegationId: alpha.delegationId,
      });
      expect(partial?.children.map((child) => child.state)).toEqual([
        "terminal",
        "planned",
      ]);

      // The original scheduling turn is over. Only durable records survive;
      // the second destination has never been called by the original owner.
      await harness.db
        .prepare(
          "UPDATE openMeldRemoteAgent_native_delivery_ledger SET status = 'completed' WHERE delivery_id = 'delivery-parent'"
        )
        .run();
      await retryPendingCenterAgentWakePublications({
        db: harness.db,
        nowMs: 2000,
        publishSignal,
        resolveSignal: async () => null,
      });
      expect(
        publishSignal.mock.calls.map(([command]) => command.spaceId)
      ).toEqual(["space-alpha", "space-beta"]);
      if (secondOutcome === "accepted") {
        await recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 2010,
          task: betaTask,
          outcome: {
            status: "succeeded",
            errorCode: null,
            eventId: "result-beta",
            occurredAtMs: 2010,
            publishedSignalId: "result-beta",
          },
        });
      }
      const complete = await readAgentDelegation({
        db: harness.db,
        delegationId: alpha.delegationId,
      });
      expect(
        complete?.children.map((child) => child.terminalOutcome?.status)
      ).toEqual([
        "succeeded",
        secondOutcome === "accepted" ? "succeeded" : "publication_failed",
      ]);
      const subscriptions = await Promise.all(
        plans.map((plan) =>
          readAgentTaskCompletionSubscription({
            db: harness.db,
            subscriptionId: plan.subscriptionIds[0] ?? "",
          })
        )
      );
      expect(
        subscriptions.filter((subscription) => subscription?.state === "ready")
      ).toHaveLength(1);
      await retryPendingCenterAgentWakePublications({
        db: harness.db,
        nowMs: 3000,
        publishSignal,
        resolveSignal: async () => null,
      });
      expect(publishSignal).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });

  it("redrives an outcome-unknown Space publication and completes coordination once", async () => {
    const harness = createHarness();
    const publishSignal = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Durable Object transport failed"), {
          retryable: true,
        })
      )
      .mockResolvedValue(buildSignal());
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId: CLIENT_MESSAGE_ID,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          delegationId: prepared.delegationId,
          referenceTargets: [HUMAN_PROFILE_ID],
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toBeNull();

      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1010,
          publicationId: CLIENT_MESSAGE_ID,
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        attribution: expect.any(Object),
        retryAfterSeconds: 15,
        status: "pending",
      });

      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: CLIENT_MESSAGE_ID,
        })
      ).resolves.toMatchObject({
        attemptCount: 1,
        command: {
          referenceTargets: [HUMAN_PROFILE_ID],
        },
        state: "pending",
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "planned" }],
        state: "active",
      });

      await expect(
        retryPendingCenterAgentWakePublications({
          db: harness.db,
          nowMs: 61_010,
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        completed: 1,
        deferred: 0,
        failed: 0,
        rescheduled: 0,
      });
      expect(publishSignal).toHaveBeenCalledTimes(2);
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: CLIENT_MESSAGE_ID,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-child" },
        state: "completed",
      });
      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 61_020,
          publicationId: CLIENT_MESSAGE_ID,
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-child" },
        status: "accepted",
      });
      expect(publishSignal).toHaveBeenCalledTimes(2);
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "active" }],
        state: "active",
      });
      const auditRows = await harness.db
        .prepare(
          "SELECT id, action FROM center_agent_audit_journal ORDER BY id ASC"
        )
        .all<{ action: string; id: string }>();
      expect(auditRows.results).toEqual([
        {
          action: "wake_agent_profiles_in_space",
          id: `center-agent-wake:${CLIENT_MESSAGE_ID}`,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("cancels coordination only when Space definitely rejects the publication", async () => {
    const harness = createHarness();
    const resolveSignal = vi.fn().mockResolvedValue(null);
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:rejected",
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId: "ca-wake:rejected",
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });

      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1010,
          publicationId: "ca-wake:rejected",
          publishSignal: vi
            .fn()
            .mockRejectedValue(
              new Error(
                'HTTP 400: {"ok":false,"error":{"code":"space.activation_target.member_required","message":"Activation target is not a Space member"}}'
              )
            ),
          resolveSignal,
        })
      ).rejects.toThrow("HTTP 400");
      expect(resolveSignal).toHaveBeenCalledOnce();

      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:rejected",
        })
      ).resolves.toMatchObject({ state: "failed" });
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
          subscriptionId: prepared.subscriptionIds[0] ?? "",
        })
      ).resolves.toMatchObject({ state: "cancelled" });
    } finally {
      harness.close();
    }
  });

  it("reconciles an earlier outcome-unknown publication before handling a later rejection", async () => {
    const harness = createHarness();
    const clientMessageId = "ca-wake:reconciled";
    const reconciledSignal = buildSignal({
      clientMessageId,
      signalId: "signal-reconciled",
    });
    const publishSignal = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Durable Object transport failed"), {
          retryable: true,
        })
      )
      .mockRejectedValueOnce(
        new Error(
          'HTTP 403: {"ok":false,"error":{"message":"Space membership changed"}}'
        )
      );
    const resolveSignal = vi.fn().mockResolvedValue(reconciledSignal);
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId,
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });

      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1010,
          publicationId: clientMessageId,
          publishSignal,
          resolveSignal,
        })
      ).resolves.toMatchObject({ status: "pending" });
      expect(resolveSignal).not.toHaveBeenCalled();

      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 16_010,
          publicationId: clientMessageId,
          publishSignal,
          resolveSignal,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-reconciled" },
        status: "accepted",
      });
      expect(resolveSignal).toHaveBeenCalledOnce();
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: clientMessageId,
        })
      ).resolves.toMatchObject({ state: "completed" });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [{ state: "active" }],
        state: "active",
      });
    } finally {
      harness.close();
    }
  });

  it("leases one publication attempt and recovers it after the owner disappears", async () => {
    const harness = createHarness();
    const delayedSignal = createDeferred<ReturnType<typeof buildSignal>>();
    const publishSignal = vi
      .fn()
      .mockImplementationOnce(async () => await delayedSignal.promise)
      .mockResolvedValue(
        buildSignal({
          clientMessageId: "ca-wake:leased",
          signalId: "signal-leased",
        })
      );
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId: "ca-wake:leased",
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId: "ca-wake:leased",
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });

      const firstAttempt = executeCenterAgentWakePublication({
        db: harness.db,
        nowMs: 1010,
        publicationId: "ca-wake:leased",
        publishSignal,
        resolveSignal: async () => null,
      });
      await vi.waitFor(() => {
        expect(publishSignal).toHaveBeenCalledTimes(1);
      });

      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1011,
          publicationId: "ca-wake:leased",
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toMatchObject({
        status: "pending",
      });

      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 301_011,
          publicationId: "ca-wake:leased",
          publishSignal,
          resolveSignal: async () => null,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-leased" },
      });

      delayedSignal.resolve(
        buildSignal({
          clientMessageId: "ca-wake:leased",
          signalId: "signal-late",
        })
      );
      await expect(firstAttempt).resolves.toMatchObject({
        signal: { id: "signal-leased" },
        status: "accepted",
      });
      expect(publishSignal).toHaveBeenCalledTimes(2);
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:leased",
        })
      ).resolves.toMatchObject({
        claimId: null,
        state: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("bounds a stuck publication attempt without starving the next due Wake", async () => {
    const harness = createHarness();
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      for (const clientMessageId of [
        "ca-wake:stuck",
        "ca-wake:batch-success",
      ]) {
        const prepared = planCenterAgentWakeDelegation({
          childSpaceId: "space-child",
          clientMessageId,
          targetProfileIds: [CHILD_PROFILE_ID],
        });
        await prepareCenterAgentWakePublication({
          command: buildCommand({
            clientMessageId,
            delegationId: prepared.delegationId,
            subscriptionIds: prepared.subscriptionIds,
          }),
          db: harness.db,
          nowMs: 1000,
        });
      }
      const publishSignal = vi.fn(
        async (command: CenterAgentWakePublicationCommand) => {
          if (command.clientMessageId === "ca-wake:stuck") {
            return await new Promise<never>(() => undefined);
          }
          return buildSignal({
            clientMessageId: command.clientMessageId,
            signalId: "signal-batch-success",
          });
        }
      );

      await expect(
        retryPendingCenterAgentWakePublications({
          db: harness.db,
          nowMs: 1010,
          publishSignal,
          publishTimeoutMs: 5,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        completed: 1,
        deferred: 0,
        failed: 0,
        rescheduled: 1,
      });
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:stuck",
        })
      ).resolves.toMatchObject({
        attemptCount: 1,
        state: "pending",
      });
      await expect(
        readCenterAgentWakePublication({
          db: harness.db,
          publicationId: "ca-wake:batch-success",
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-batch-success" },
        state: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("reports a persisted Space acceptance while another owner finalizes coordination", async () => {
    const harness = createHarness();
    const clientMessageId = "ca-wake:accepted";
    const publishSignal = vi.fn();
    const resolveSignal = vi.fn();
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId,
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      const claimed = await claimCenterAgentWakePublication({
        claimExpiresAtMs: 301_010,
        claimId: "claim-owner",
        db: harness.db,
        nowMs: 1010,
        publicationId: clientMessageId,
      });
      expect(claimed).not.toBeNull();
      await markCenterAgentWakePublicationAccepted({
        claimId: "claim-owner",
        db: harness.db,
        nowMs: 1010,
        publicationId: clientMessageId,
        signal: buildSignal({
          clientMessageId,
          signalId: "signal-accepted",
        }),
      });

      await expect(
        executeCenterAgentWakePublication({
          db: harness.db,
          nowMs: 1011,
          publicationId: clientMessageId,
          publishSignal,
          resolveSignal,
        })
      ).resolves.toMatchObject({
        signal: { id: "signal-accepted" },
        status: "accepted",
      });
      expect(publishSignal).not.toHaveBeenCalled();
      expect(resolveSignal).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("stops a redrive batch before multiple hung publications consume the minute", async () => {
    const harness = createHarness();
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      for (const clientMessageId of [
        "ca-wake:budget-1",
        "ca-wake:budget-2",
        "ca-wake:budget-3",
      ]) {
        const prepared = planCenterAgentWakeDelegation({
          childSpaceId: "space-child",
          clientMessageId,
          targetProfileIds: [CHILD_PROFILE_ID],
        });
        await prepareCenterAgentWakePublication({
          command: buildCommand({
            clientMessageId,
            delegationId: prepared.delegationId,
            subscriptionIds: prepared.subscriptionIds,
          }),
          db: harness.db,
          nowMs: 1000,
        });
      }
      let clockMs = 0;
      const publishSignal = vi.fn(
        async () => await new Promise<never>(() => undefined)
      );

      await expect(
        retryPendingCenterAgentWakePublications({
          batchBudgetMs: 10,
          clock: () => {
            const current = clockMs;
            clockMs += 6;
            return current;
          },
          db: harness.db,
          nowMs: 1010,
          publishSignal,
          publishTimeoutMs: 1,
          resolveSignal: async () => null,
        })
      ).resolves.toEqual({
        completed: 0,
        deferred: 3,
        failed: 0,
        rescheduled: 0,
      });
      expect(publishSignal).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });

  it("enforces the batch deadline across publish and reconciliation", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const clientMessageId = "ca-wake:whole-batch-deadline";
    try {
      await insertAuditIdentity(harness.db);
      await insertParentDelivery(harness.db);
      const prepared = planCenterAgentWakeDelegation({
        childSpaceId: "space-child",
        clientMessageId,
        targetProfileIds: [CHILD_PROFILE_ID],
      });
      await prepareCenterAgentWakePublication({
        command: buildCommand({
          clientMessageId,
          delegationId: prepared.delegationId,
          subscriptionIds: prepared.subscriptionIds,
        }),
        db: harness.db,
        nowMs: 1000,
      });
      const publishSignal = vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
        throw new Error('HTTP 400: {"error":{"message":"rejected"}}');
      });
      const resolveSignal = vi.fn(
        async () => await new Promise<never>(() => undefined)
      );

      const redrive = retryPendingCenterAgentWakePublications({
        batchBudgetMs: 100,
        db: harness.db,
        nowMs: 1010,
        publishSignal,
        publishTimeoutMs: 100,
        resolveSignal,
      });
      let settled = false;
      const settlement = redrive.then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(99);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(settlement).resolves.toEqual({
        completed: 0,
        deferred: 1,
        failed: 0,
        rescheduled: 0,
      });
      expect(publishSignal).toHaveBeenCalledOnce();
      expect(resolveSignal).toHaveBeenCalledOnce();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      harness.close();
    }
  });
});

function buildCommand(input: {
  clientMessageId?: string;
  delegationId: string;
  referenceTargets?: string[];
  subscriptionIds: string[];
}) {
  const clientMessageId = input.clientMessageId ?? CLIENT_MESSAGE_ID;
  const attribution: CenterAgentAttribution = {
    actorProfileId: CENTER_AGENT_PROFILE_ID,
    onBehalfOf: {
      displayName: "Felix",
      profileId: HUMAN_PROFILE_ID,
      userId: "user-parent",
    },
  };
  return {
    activationTargets: [CHILD_PROFILE_ID],
    attribution,
    clientMessageId,
    completionMode: "resume_parent_when_all_terminal" as const,
    context: {
      actorContext: {
        profileKind: "agent" as const,
        profileName: "Center Agent",
        requestId: "request-parent",
        openMeldProfileId: CENTER_AGENT_PROFILE_ID,
      },
      activeOrganizationId: "org-1",
      agentControllerConversationId: "submission-parent",
    },
    delegationId: input.delegationId,
    fallbackAgentProfileId: null,
    organizationId: "org-1",
    parentSubmissionId: "submission-parent",
    profile: {
      kind: "agent" as const,
      profileId: CENTER_AGENT_PROFILE_ID,
      profileName: "Center Agent",
    },
    mentionTargets: [],
    referenceTargets: input.referenceTargets ?? [],
    spaceId: "space-child",
    subscriptionIds: input.subscriptionIds,
    text: "Complete the delegated work.",
    v: 1 as const,
  };
}

function buildSignal(
  input: { clientMessageId?: string; signalId?: string } = {}
) {
  return {
    data: {
      messageEnvelope: {
        activationTargets: [CHILD_PROFILE_ID],
        referenceTargets: [],
        text: "Complete the delegated work.",
      },
      meta: { clientMessageId: input.clientMessageId ?? CLIENT_MESSAGE_ID },
      text: "Complete the delegated work.",
    },
    id: input.signalId ?? "signal-child",
    profile: {
      kind: "agent" as const,
      profileId: CENTER_AGENT_PROFILE_ID,
      profileName: "Center Agent",
    },
    spaceId: "space-child",
    ts: 1000,
    type: "signal.text" as const,
    v: 1 as const,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createHarness() {
  const harness = createSqliteD1Harness();
  harness.run({ sql: "CREATE TABLE users (id TEXT PRIMARY KEY)" });
  harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
  harness.run({
    sql: "CREATE TABLE openmeld_profiles (profile_id TEXT PRIMARY KEY)",
  });
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_native_delivery_ledger"
  );
  applyDrizzleMigrationForTable(harness, "center_agent_audit_journal");
  applyDrizzleMigrationForTable(harness, "agent_task_terminal_outcomes");
  applyDrizzleMigrationForTable(harness, "agent_task_completion_subscriptions");
  applyDrizzleMigrationForTable(harness, "agent_delegations");
  applyDrizzleMigrationForTable(harness, "agent_delegation_children");
  applyDrizzleMigrationForTable(harness, "center_agent_wake_publications");
  return harness;
}

async function insertAuditIdentity(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO users (id) VALUES (?)").bind("user-parent"),
    db.prepare("INSERT INTO organizations (id) VALUES ('org-1')"),
    db
      .prepare("INSERT INTO openmeld_profiles (profile_id) VALUES (?)")
      .bind(CENTER_AGENT_PROFILE_ID),
    db
      .prepare("INSERT INTO openmeld_profiles (profile_id) VALUES (?)")
      .bind(HUMAN_PROFILE_ID),
  ]);
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
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, 'space', ?, ?, ?, ?, NULL, ?, ?, ?, 'accepted', ?, ?, ?, NULL, ?, ?)
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
      "submission-parent",
      HUMAN_PROFILE_ID,
      "user-parent",
      "Felix",
      900,
      900
    )
    .run();
}
