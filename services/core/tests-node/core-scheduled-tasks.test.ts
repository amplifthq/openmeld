import { beforeEach, describe, expect, it, vi } from "vitest";
import type { runAgentActivityDigestTick } from "../src/agent-activity/activity-digest-service";
import type { deleteExpiredServiceConnectionIncidents } from "../src/computers/service-connection-evidence-repo";
import type { retryInboxUrgentEmailDeliveries } from "../src/inbox/application/inbox-email-delivery-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  AGENT_ACTIVITY_RETENTION_CRON,
  EVAL_WEEKLY_REPORT_CRON,
  ROUTINE_TICK_CRON,
  runCoreScheduledTasks,
  WAKE_EVIDENCE_RETENTION_CRON,
} from "../src/scheduled/core-scheduled-tasks";

const { deleteExpiredConnectionIncidents } = vi.hoisted(() => ({
  deleteExpiredConnectionIncidents:
    vi.fn<typeof deleteExpiredServiceConnectionIncidents>(),
}));

vi.mock("../src/computers/service-connection-evidence-repo", () => ({
  deleteExpiredServiceConnectionIncidents: deleteExpiredConnectionIncidents,
}));

describe("Core scheduled task dispatcher", () => {
  beforeEach(() => {
    deleteExpiredConnectionIncidents
      .mockReset()
      .mockResolvedValue({ deleted: 0 });
  });

  it("routes the weekly eval Cron without running unrelated retention", async () => {
    const runWeeklyEvalReport = vi.fn(async () => ({
      organizationId: "org-official",
      periodEndMs: 2000,
      periodStartMs: 1000,
      reportSignalId: "signal-report",
      spaceId: "space-quality",
      status: "published" as const,
    }));
    const runWakeEvidenceRetention = vi.fn(async () => ({
      ran: false,
      results: [],
    }));
    await runCoreScheduledTasks({
      cron: EVAL_WEEKLY_REPORT_CRON,
      env: {} as CoreBindings,
      nowMs: 3000,
      runWeeklyEvalReport,
      runWakeEvidenceRetention,
    });

    expect(runWeeklyEvalReport).toHaveBeenCalledWith({
      env: expect.anything(),
      nowMs: 3000,
    });
    expect(runWakeEvidenceRetention).not.toHaveBeenCalled();
  });

  it("routes the minute Cron to Routine scheduling without running retention", async () => {
    const localStateDatabase = {} as D1Database;
    const routineDatabase = {} as D1Database;
    const countStrandedSlackIngress = vi.fn(async () => 0);
    const runMemberResearchTick = vi.fn(async () => undefined);
    const runSlackChannelIntroductionTick = vi.fn(async () => ({
      failed: 0,
      outcomeUnknown: 0,
      submitted: 1,
    }));
    const runSlackWelcomePreparationTick = vi.fn(async () => undefined);
    const runRoutineTick = vi.fn(async () => emptyRoutineTickSummary());
    const runLarkPlatformRegistrationTick = vi.fn(async () => ({
      errors: 0,
      processed: 1,
      scanned: 1,
    }));
    const retrySessionInventoryMemberCleanups = vi.fn(async () => ({
      errors: 0,
      finalized: 1,
      scanned: 1,
      waitingForRemoval: 0,
    }));
    const retryRoutineSubmissions = vi.fn(async () => ({
      errors: 0,
      recovered: 0,
      scanned: 0,
    }));
    const retryRoutineFailurePublications = vi.fn(async () => ({
      errors: 0,
      published: 0,
      scanned: 0,
    }));
    const retryRoutineWorkflowStarts = vi.fn(async () => ({
      errors: 0,
      scanned: 0,
      started: 0,
    }));
    const retryAgentTaskContinuations = vi.fn(async () => ({
      enqueuedCount: 1,
    }));
    const retryCenterAgentWakePublications = vi.fn(async () => ({
      completed: 1,
      deferred: 0,
      failed: 0,
      rescheduled: 0,
    }));
    const retryPreHeadFailurePublications = vi.fn(async () => ({
      enqueued: 1,
      errors: 0,
      scanned: 1,
    }));
    const runWakeEvidenceRetention = vi.fn(async () => ({
      ran: false,
      results: [],
    }));
    const retryInboxEmailDeliveries = vi.fn<
      typeof retryInboxUrgentEmailDeliveries
    >(async () => ({
      attempted: 1,
      failed: 0,
      sent: 1,
      suppressed: 0,
    }));
    const retryAgentProfileCreationRequestInboxProjections = vi.fn(
      async () => ({ completed: 1, failed: 0, scanned: 1 })
    );
    const recoverAgentProfileCreationRequests = vi.fn(async () => ({
      markedFailed: 1,
      redelivered: 0,
      scanned: 1,
      superseded: 0,
    }));
    const reconcileOrganizationDocumentInbox = vi.fn(async () => ({
      attempted: 0,
      errors: 0,
      projected: 0,
    }));
    const reconcileSlackNativeDeliveryInbox = vi.fn(async () => ({
      attempted: 0,
      errors: 0,
      projected: 0,
    }));
    const directSendInboxUrgentEmail = vi.fn(
      async (input: { deliveryId: string }) => ({
        deliveryId: input.deliveryId,
        messageId: "email-message-1",
        status: "sent" as const,
      })
    );
    const sendInboxUrgentEmail = new Proxy(directSendInboxUrgentEmail, {
      get(target, property, receiver) {
        if (property === "call") {
          return () => {
            throw new Error(
              'The RPC receiver does not implement the method "call".'
            );
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const resolveOrganizationDirectoryMembers = vi.fn(
      async (input: { organizationId: string }) => ({
        members: [
          {
            humanProfile: null,
            joinedAt: "1970-01-01T00:00:01.000Z",
            memberId: "member-1",
            organizationId: input.organizationId,
            role: "member",
            user: {
              email: "user@example.com",
              id: "user-1",
              image: null,
              name: "User One",
            },
            userId: "user-1",
          },
        ],
        ok: true as const,
        organizationId: input.organizationId,
      })
    );

    await runCoreScheduledTasks({
      cron: ROUTINE_TICK_CRON,
      env: {
        OPENMELD_DB: routineDatabase,
        OPENMELD_LOCAL_STATE_DB: localStateDatabase,
        OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
        OPENMELD_AUTH_WORKER: {
          resolveOrganizationDirectoryMembers,
          sendInboxUrgentEmail,
        },
      } as unknown as CoreBindings,
      nowMs: 1000,
      countStrandedSlackIngress,
      recoverAgentProfileCreationRequests,
      reconcileOrganizationDocumentInbox,
      reconcileSlackNativeDeliveryInbox,
      retryAgentTaskContinuations,
      retryAgentProfileCreationRequestInboxProjections,
      retryCenterAgentWakePublications,
      retryInboxEmailDeliveries,
      retryPreHeadFailurePublications,
      retryRoutineFailurePublications,
      retrySessionInventoryMemberCleanups,
      retryRoutineSubmissions,
      retryRoutineWorkflowStarts,
      runMemberResearchTick,
      runSlackChannelIntroductionTick,
      runSlackWelcomePreparationTick,
      runLarkPlatformRegistrationTick,
      runRoutineTick,
      runWakeEvidenceRetention,
    });

    expect(runRoutineTick).toHaveBeenCalledTimes(1);
    expect(recoverAgentProfileCreationRequests).toHaveBeenCalledWith({
      db: routineDatabase,
      env: expect.objectContaining({ OPENMELD_DB: routineDatabase }),
      nowMs: 1000,
    });
    expect(
      retryAgentProfileCreationRequestInboxProjections
    ).toHaveBeenCalledWith({
      db: routineDatabase,
      nowMs: 1000,
    });
    expect(retrySessionInventoryMemberCleanups).toHaveBeenCalledWith({
      db: routineDatabase,
      nowMs: 1000,
      resolveMembershipState: expect.any(Function),
    });
    expect(runLarkPlatformRegistrationTick).toHaveBeenCalledWith({
      classifyOrganization: expect.any(Function),
      clock: Date.now,
      db: localStateDatabase,
      env: expect.anything(),
      nowMs: 1000,
    });
    expect(runMemberResearchTick).toHaveBeenCalledWith({
      db: routineDatabase,
      env: expect.anything(),
      nowMs: 1000,
    });
    expect(runSlackWelcomePreparationTick).toHaveBeenCalledTimes(2);
    expect(runSlackWelcomePreparationTick).toHaveBeenNthCalledWith(1, {
      db: routineDatabase,
      env: expect.anything(),
      nowMs: 1000,
    });
    expect(runSlackChannelIntroductionTick).toHaveBeenCalledWith({
      db: routineDatabase,
      env: expect.anything(),
      nowMs: 1000,
    });
    expect(countStrandedSlackIngress).toHaveBeenCalledWith({
      db: expect.anything(),
      nowMs: 1000,
    });
    expect(retryRoutineSubmissions).toHaveBeenCalledTimes(1);
    expect(retryRoutineFailurePublications).toHaveBeenCalledTimes(1);
    expect(retryRoutineWorkflowStarts).toHaveBeenCalledTimes(1);
    expect(retryInboxEmailDeliveries).toHaveBeenCalledWith({
      db: routineDatabase,
      nowMs: 1000,
      resolveOrganizationAccess: expect.any(Function),
      send: expect.any(Function),
    });
    const inboxEmailRetryInput = retryInboxEmailDeliveries.mock.calls[0]?.[0];
    if (!inboxEmailRetryInput) {
      throw new Error("expected Inbox email redrive to run");
    }
    await expect(
      inboxEmailRetryInput.send({
        deliveryId: "delivery-1",
        itemId: "item-1",
        organizationId: "org-1",
        preview: "Approval is required.",
        title: "Approval needed",
        userId: "user-1",
      })
    ).resolves.toEqual({
      deliveryId: "delivery-1",
      messageId: "email-message-1",
      status: "sent",
    });
    await expect(
      inboxEmailRetryInput.resolveOrganizationAccess({
        organizationId: "org-1",
        recipientUserId: "user-1",
      })
    ).resolves.toBe("allowed");
    await expect(
      inboxEmailRetryInput.resolveOrganizationAccess({
        organizationId: "org-1",
        recipientUserId: "user-2",
      })
    ).resolves.toBe("denied");
    expect(resolveOrganizationDirectoryMembers).toHaveBeenCalledTimes(1);
    expect(directSendInboxUrgentEmail).toHaveBeenCalledTimes(1);
    expect(reconcileOrganizationDocumentInbox).toHaveBeenCalledWith({
      authWorker: expect.anything(),
      db: routineDatabase,
      nowMs: 1000,
    });
    expect(reconcileSlackNativeDeliveryInbox).toHaveBeenCalledWith({
      db: localStateDatabase,
      env: expect.anything(),
      nowMs: 1000,
    });
    expect(retryAgentTaskContinuations).toHaveBeenCalledWith({
      db: expect.anything(),
      env: expect.anything(),
      nowMs: 1000,
    });
    expect(retryCenterAgentWakePublications).toHaveBeenCalledWith({
      db: expect.anything(),
      destinationNeutralContinuations: false,
      nowMs: 1000,
      publishSignal: expect.any(Function),
      resolveSignal: expect.any(Function),
    });
    expect(retryPreHeadFailurePublications).toHaveBeenCalledWith({
      db: routineDatabase,
      env: expect.anything(),
      nowMs: 1000,
    });
    const continuationCallOrder =
      retryAgentTaskContinuations.mock.invocationCallOrder[0];
    const publicationCallOrder =
      retryCenterAgentWakePublications.mock.invocationCallOrder[0];
    if (
      continuationCallOrder === undefined ||
      publicationCallOrder === undefined
    ) {
      throw new Error("expected both coordination redrives to run");
    }
    expect(continuationCallOrder).toBeLessThan(publicationCallOrder);
    expect(runWakeEvidenceRetention).not.toHaveBeenCalled();
  });

  it("runs Lark registration continuation before unrelated minute diagnostics fail", async () => {
    const runLarkPlatformRegistrationTick = vi.fn(async () => ({
      errors: 0,
      processed: 0,
      scanned: 0,
    }));

    await expect(
      runCoreScheduledTasks({
        cron: ROUTINE_TICK_CRON,
        env: {
          OPENMELD_DB: {} as D1Database,
          OPENMELD_LOCAL_STATE_DB: {} as D1Database,
          OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
        } as CoreBindings,
        nowMs: 1400,
        countStrandedSlackIngress: vi.fn(() =>
          Promise.reject(new Error("Slack diagnostic unavailable"))
        ),
        runLarkPlatformRegistrationTick,
      })
    ).rejects.toThrow("Slack diagnostic unavailable");

    expect(runLarkPlatformRegistrationTick).toHaveBeenCalledTimes(1);
  });

  it("keeps running minute work when continuation redrive is unavailable", async () => {
    const runRoutineTick = vi.fn(async () => emptyRoutineTickSummary());
    const retry = vi.fn(async () => ({ errors: 0, scanned: 0 }));

    await expect(
      runCoreScheduledTasks({
        cron: ROUTINE_TICK_CRON,
        env: {
          OPENMELD_DB: {} as D1Database,
          OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
        } as CoreBindings,
        nowMs: 1500,
        countStrandedSlackIngress: vi.fn(async () => 0),
        retryAgentTaskContinuations: vi.fn(() =>
          Promise.reject(new Error("Queue unavailable"))
        ),
        retryCenterAgentWakePublications: vi.fn(async () => ({
          completed: 0,
          deferred: 0,
          failed: 0,
          rescheduled: 0,
        })),
        retryRoutineFailurePublications: retry as never,
        retryRoutineSubmissions: retry as never,
        retryRoutineWorkflowStarts: retry as never,
        runMemberResearchTick: vi.fn(async () => undefined),
        runRoutineTick,
      })
    ).resolves.toBeUndefined();

    expect(runRoutineTick).toHaveBeenCalledTimes(1);
  });

  it("keeps running minute work when Wake publication redrive is unavailable", async () => {
    const runRoutineTick = vi.fn(async () => emptyRoutineTickSummary());
    const retry = vi.fn(async () => ({ errors: 0, scanned: 0 }));

    await expect(
      runCoreScheduledTasks({
        cron: ROUTINE_TICK_CRON,
        env: {
          OPENMELD_DB: {} as D1Database,
          OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
        } as CoreBindings,
        nowMs: 1600,
        countStrandedSlackIngress: vi.fn(async () => 0),
        retryAgentTaskContinuations: vi.fn(async () => ({
          enqueuedCount: 0,
        })),
        retryCenterAgentWakePublications: vi.fn(() =>
          Promise.reject(new Error("Space unavailable"))
        ),
        retryRoutineFailurePublications: retry as never,
        retryRoutineSubmissions: retry as never,
        retryRoutineWorkflowStarts: retry as never,
        runMemberResearchTick: vi.fn(async () => undefined),
        runRoutineTick,
      })
    ).resolves.toBeUndefined();

    expect(runRoutineTick).toHaveBeenCalledTimes(1);
  });

  it("keeps running minute work when pre-head failure publication redrive is unavailable", async () => {
    const runRoutineTick = vi.fn(async () => emptyRoutineTickSummary());
    const retry = vi.fn(async () => ({ errors: 0, scanned: 0 }));

    await expect(
      runCoreScheduledTasks({
        cron: ROUTINE_TICK_CRON,
        env: {
          OPENMELD_DB: {} as D1Database,
          OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
        } as CoreBindings,
        nowMs: 1700,
        countStrandedSlackIngress: vi.fn(async () => 0),
        retryAgentTaskContinuations: vi.fn(async () => ({
          enqueuedCount: 0,
        })),
        retryCenterAgentWakePublications: vi.fn(async () => ({
          completed: 0,
          deferred: 0,
          failed: 0,
          rescheduled: 0,
        })),
        retryPreHeadFailurePublications: vi.fn(() =>
          Promise.reject(new Error("Dispatch queue unavailable"))
        ),
        retryRoutineFailurePublications: retry as never,
        retryRoutineSubmissions: retry as never,
        retryRoutineWorkflowStarts: retry as never,
        runMemberResearchTick: vi.fn(async () => undefined),
        runRoutineTick,
      })
    ).resolves.toBeUndefined();

    expect(runRoutineTick).toHaveBeenCalledTimes(1);
  });

  it("preserves the split-gated wake-evidence retention responsibility", async () => {
    const runRoutineTick = vi.fn(async () => emptyRoutineTickSummary());
    const retryRoutineSubmissions = vi.fn(async () => ({
      errors: 0,
      recovered: 0,
      scanned: 0,
    }));
    const retryRoutineFailurePublications = vi.fn(async () => ({
      errors: 0,
      published: 0,
      scanned: 0,
    }));
    const retryRoutineWorkflowStarts = vi.fn(async () => ({
      errors: 0,
      scanned: 0,
      started: 0,
    }));
    const runWakeEvidenceRetention = vi.fn(async () => ({
      ran: false,
      results: [],
    }));
    const runAgentActivityRetention = vi.fn(async () => ({
      aggregates: 0,
      dailySessionKeys: 0,
      digests: 0,
      events: 0,
      executionLinks: 0,
      sessions: 0,
    }));
    const runAgentActivityDailyAggregation = vi.fn(async () => ({
      aggregates: 0,
      events: 0,
      sessionKeys: 0,
    }));
    const runAgentControllerTaskRetention = vi.fn(async () => ({
      lifecycleEventsDeleted: 1,
      registeredTasksDeleted: 2,
      terminalOutcomesDeleted: 2,
      wakePublicationsDeleted: 1,
    }));

    await runCoreScheduledTasks({
      cron: WAKE_EVIDENCE_RETENTION_CRON,
      env: {
        OPENMELD_DB: {
          owner: "coordination",
        } as unknown as D1Database,
        OPENMELD_WAKE_EVIDENCE_DB: {
          owner: "wake-evidence",
        } as unknown as D1Database,
        OPENMELD_SPLIT_ACTIVE: "true",
      } as CoreBindings,
      nowMs: 2000,
      retryRoutineFailurePublications,
      retryRoutineSubmissions,
      retryRoutineWorkflowStarts,
      runRoutineTick,
      runAgentActivityDailyAggregation,
      runAgentActivityRetention,
      runAgentControllerTaskRetention,
      runWakeEvidenceRetention,
    });

    expect(runRoutineTick).not.toHaveBeenCalled();
    expect(retryRoutineSubmissions).not.toHaveBeenCalled();
    expect(retryRoutineFailurePublications).not.toHaveBeenCalled();
    expect(retryRoutineWorkflowStarts).not.toHaveBeenCalled();
    expect(runWakeEvidenceRetention).toHaveBeenCalledWith(
      expect.objectContaining({
        cron: WAKE_EVIDENCE_RETENTION_CRON,
        nowMs: 2000,
      })
    );
    expect(runAgentActivityRetention).toHaveBeenCalledWith({
      db: expect.anything(),
      nowMs: 2000,
    });
    expect(runAgentActivityDailyAggregation).toHaveBeenCalledWith({
      db: expect.anything(),
      nowMs: 2000,
    });
    expect(runAgentControllerTaskRetention).toHaveBeenCalledWith({
      db: expect.objectContaining({ owner: "coordination" }),
      nowMs: 2000,
    });
    expect(deleteExpiredConnectionIncidents).toHaveBeenCalledWith({
      db: expect.objectContaining({ owner: "wake-evidence" }),
      nowMs: 2000,
    });
  });

  it("runs digest production only behind its explicit consumer fence", async () => {
    const countStrandedSlackIngress = vi.fn(async () => 0);
    const runAgentActivityDigest = vi.fn<typeof runAgentActivityDigestTick>(
      async (input) => {
        await input.summarize({} as never);
        return {
          completed: 1,
          failed: 0,
          inspected: 1,
          recoveredPending: 0,
        };
      }
    );
    const runRoutineTick = vi.fn(async () => emptyRoutineTickSummary());
    const runMemberResearchTick = vi.fn(async () => undefined);
    const retry = vi.fn(async () => ({ errors: 0, scanned: 0 }));
    const retryAgentTaskContinuations = vi.fn(async () => ({
      enqueuedCount: 0,
    }));
    const summarizeAgentActivityDigest = vi.fn(async () => ({ summary: "ok" }));
    await runCoreScheduledTasks({
      cron: ROUTINE_TICK_CRON,
      env: {
        OPENMELD_AGENT_ACTIVITY_DIGEST_ENABLED: "true",
        OPENMELD_DB: {} as D1Database,
        OPENMELD_REMOTE_AGENT_WORKER: { summarizeAgentActivityDigest },
        OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
      } as unknown as CoreBindings,
      nowMs: 3000,
      countStrandedSlackIngress,
      retryAgentTaskContinuations,
      retryCenterAgentWakePublications: vi.fn(async () => ({
        completed: 0,
        deferred: 0,
        failed: 0,
        rescheduled: 0,
      })),
      retryRoutineFailurePublications: retry as never,
      retryRoutineSubmissions: retry as never,
      retryRoutineWorkflowStarts: retry as never,
      runAgentActivityDigest,
      runMemberResearchTick,
      runRoutineTick,
    });

    expect(runAgentActivityDigest).toHaveBeenCalledWith({
      db: expect.anything(),
      nowMs: 3000,
      summarize: expect.any(Function),
    });
    expect(summarizeAgentActivityDigest).toHaveBeenCalledTimes(1);
    expect(AGENT_ACTIVITY_RETENTION_CRON).toBe(WAKE_EVIDENCE_RETENTION_CRON);
  });

  it("still runs wake-evidence retention when Agent Activity aggregation fails", async () => {
    const activityError = new Error("activity aggregation unavailable");
    const runAgentActivityDailyAggregation = vi.fn(() =>
      Promise.reject(activityError)
    );
    const runAgentActivityRetention = vi.fn(async () => ({
      aggregates: 0,
      dailySessionKeys: 0,
      digests: 0,
      events: 0,
      executionLinks: 0,
      sessions: 0,
    }));
    const runWakeEvidenceRetention = vi.fn(async () => ({
      ran: true,
      results: [],
    }));
    const runAgentControllerTaskRetention = vi.fn(async () => ({
      lifecycleEventsDeleted: 0,
      registeredTasksDeleted: 0,
      terminalOutcomesDeleted: 0,
      wakePublicationsDeleted: 0,
    }));

    await expect(
      runCoreScheduledTasks({
        cron: AGENT_ACTIVITY_RETENTION_CRON,
        env: {
          OPENMELD_DB: {} as D1Database,
          OPENMELD_SPLIT_ACTIVE: "true",
        } as CoreBindings,
        nowMs: 4000,
        runAgentActivityDailyAggregation,
        runAgentActivityRetention,
        runAgentControllerTaskRetention,
        runWakeEvidenceRetention,
      })
    ).rejects.toBe(activityError);
    expect(runWakeEvidenceRetention).toHaveBeenCalledTimes(1);
    expect(runAgentActivityRetention).not.toHaveBeenCalled();
    expect(runAgentControllerTaskRetention).toHaveBeenCalledTimes(1);
    expect(deleteExpiredConnectionIncidents).toHaveBeenCalledWith({
      db: expect.anything(),
      nowMs: 4000,
    });
  });

  it("preserves every scheduled retention failure with safe log context", async () => {
    const activityError = new Error("activity retention unavailable");
    const controllerError = new TypeError("controller retention unavailable");
    const connectionError = new Error("connection retention unavailable");
    const wakeError = new Error("wake retention unavailable");
    deleteExpiredConnectionIncidents.mockRejectedValueOnce(connectionError);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      runCoreScheduledTasks({
        cron: AGENT_ACTIVITY_RETENTION_CRON,
        env: {
          OPENMELD_DB: { owner: "coordination" } as unknown as D1Database,
          OPENMELD_WAKE_EVIDENCE_DB: {
            owner: "wake-evidence",
          } as unknown as D1Database,
        } as CoreBindings,
        nowMs: 5000,
        runAgentActivityDailyAggregation: vi.fn(() =>
          Promise.reject(activityError)
        ),
        runAgentActivityRetention: vi.fn(),
        runAgentControllerTaskRetention: vi.fn(() =>
          Promise.reject(controllerError)
        ),
        runWakeEvidenceRetention: vi.fn(() => Promise.reject(wakeError)),
      })
    ).rejects.toMatchObject({
      errors: [activityError, controllerError, connectionError, wakeError],
    });
    expect(error.mock.calls.flat().join(" ")).toContain(
      "controller retention unavailable"
    );
    error.mockRestore();
  });
});

function emptyRoutineTickSummary() {
  return {
    claimed: 0,
    errors: 0,
    failed: 0,
    lostRace: 0,
    pending: 0,
    scanned: 0,
    skipped: 0,
    submitted: 0,
    watchdogFailed: 0,
  };
}
