import { projectTargetWakeLifecycleIdentity } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  incrementRuntimeCoordinatorFinalizationRetryEntry,
  isRuntimeCoordinatorFinalizationRetryParkLimitReached,
  isRuntimeCoordinatorHeadWaitingRecoveryCandidate,
  isRuntimeCoordinatorLateResultRecoverable,
  normalizeLegacyRuntimeCoordinatorHeadAcceptanceTiming,
  parkRuntimeCoordinatorFinalizationRetryEntry,
  planRuntimeCoordinatorFinalizationRetryAlarmWork,
  planRuntimeCoordinatorHeadAcceptedHandoffAlarmWork,
  planRuntimeCoordinatorHeadFailurePublicationRetryAlarmWork,
  planRuntimeCoordinatorHeadWaitingAlarmWork,
  planRuntimeCoordinatorPreExecutionHandoffAlarmWork,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS,
  RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
  RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION,
  type RuntimeCoordinatorFinalizationRetryEntry,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorHeadWaitingBoundary,
  type RuntimeCoordinatorPreExecutionHandoffRecord,
  resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMsFromEntries,
  resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMsFromRecords,
  resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMsFromRecords,
  resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMsFromRecords,
  resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMsFromRecords,
} from "../runtime-transport/application/runtime-coordinator-authority";

const NOW_MS = 1_700_000_000_000;
const TARGET_WAKE_LIFECYCLE_IDENTITY = projectTargetWakeLifecycleIdentity({
  clientMessageId: null,
  dispatchId: "dispatch-1",
  sourceSignalId: "signal-1",
  spaceId: "space-1",
  targetProfileId: "agent-1",
});

const buildHeadLifecycleRecord = (
  overrides: Partial<RuntimeCoordinatorHeadLifecycleRecord> = {}
): RuntimeCoordinatorHeadLifecycleRecord => ({
  createdAtMs: NOW_MS - 10_000,
  duplicateDispatches: [],
  executionLinkedAtMs: null,
  modelVersion: RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
  ownerUserId: "owner-1",
  primaryDispatchId: "dispatch-1",
  primaryIdempotencyKey: "idempotency-1",
  runtimeCoordinatorExecutionId: null,
  status: "accepted",
  targetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_IDENTITY.targetWakeLifecycleId,
  targetWakeLifecycleIdentity: TARGET_WAKE_LIFECYCLE_IDENTITY,
  updatedAtMs: NOW_MS - 5000,
  ...overrides,
});

const buildWaitingBoundary = (
  overrides: Partial<
    Extract<
      RuntimeCoordinatorHeadWaitingBoundary,
      { reasonCode: "daemon.profile.offline" }
    >
  > = {}
): RuntimeCoordinatorHeadWaitingBoundary => ({
  deadlineAtMs: NOW_MS + 1000,
  deadlineOutcome: "publication_intent_ready",
  observedAtMs: NOW_MS,
  reasonCode: "daemon.profile.offline",
  softDeadlineAtMs: NOW_MS + 500,
  trigger: "openmeld_service_route_connected",
  triggerOwner: "runtime_coordinator",
  userRecoveryAction: "start_or_restart_openmeld_service",
  userVisibleState: "waiting_for_openmeld_service",
  waitingCategory: "service_not_connected",
  waitingFor: "openmeld_service_route_connection",
  waitingSinceMs: NOW_MS - 1000,
  ...overrides,
});

const buildFinalizationRetryEntry = (
  overrides: Partial<RuntimeCoordinatorFinalizationRetryEntry> = {}
): RuntimeCoordinatorFinalizationRetryEntry => ({
  attemptCount: 1,
  attemptId: "attempt-1",
  dispatchId: "dispatch-finalization-1",
  executionTokenRunId: "run-1",
  finalizationCommandId: "finalization-command-1",
  firstFailureAtMs: NOW_MS - 10_000,
  nextReplayAtMs: NOW_MS + 1000,
  runtimeCoordinatorExecutionId: "rce-1",
  spaceId: "space-1",
  targetProfileId: "agent-1",
  updatedAtMs: NOW_MS - 5000,
  ...overrides,
});

const buildPreExecutionHandoffRecord = (
  overrides: Partial<RuntimeCoordinatorPreExecutionHandoffRecord> = {}
): RuntimeCoordinatorPreExecutionHandoffRecord => ({
  attemptId: "attempt-1",
  autoRelayDepth: null,
  createdAtMs: NOW_MS - 10_000,
  deadlineAtMs: NOW_MS + 1000,
  dispatchChainId: null,
  dispatchId: "dispatch-pre-exec-1",
  firstSeenAtMs: NOW_MS - 10_000,
  idempotencyKey: "idempotency-pre-exec-1",
  modelVersion: RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION,
  nextAlarmAtMs: NOW_MS + 1000,
  nextPublicationRetryAtMs: null,
  observedAtMs: NOW_MS - 9000,
  publicationErrorCode: null,
  publicationStatus: "waiting_for_recovery",
  publishedSignalId: null,
  reasonCode: "daemon.profile.offline",
  resultRef: "pre-execution-handoff-failure:dispatch-pre-exec-1",
  sourceClientMessageId: "client-message-1",
  sourceEventId: "signal-1",
  spaceId: "space-1",
  spacePassword: null,
  targetProfileId: "agent-1",
  targetProfileMentionLabel: null,
  targetProfileName: "Agent One",
  taskId: "task-1",
  threadContext: null,
  updatedAtMs: NOW_MS - 5000,
  visitedProfileIds: [],
  visitedProfileIdsHash: null,
  ...overrides,
});

describe("RuntimeCoordinator late-result recovery policy", () => {
  it("allows only an exact completed result after recoverable runtime-loss terminalization", () => {
    expect(
      isRuntimeCoordinatorLateResultRecoverable({
        executionStatus: "failed_terminal",
        taskResultStatus: "success",
        terminalReasonCode: "runtime.progress_stale",
        tokenValidationReasonCode: "execution_token_terminal_late",
        tokenRunMatched: true,
      })
    ).toBe(true);
    expect(
      isRuntimeCoordinatorLateResultRecoverable({
        executionStatus: "failed_terminal",
        taskResultStatus: "partial_success",
        terminalReasonCode: "runtime.local_runtime_lost",
        tokenValidationReasonCode: "execution_token_terminal_late",
        tokenRunMatched: true,
      })
    ).toBe(true);
    expect(
      isRuntimeCoordinatorLateResultRecoverable({
        executionStatus: "failed_terminal",
        taskResultStatus: "success",
        terminalReasonCode: "runtime_coordinator.wake_stop_requested",
        tokenValidationReasonCode: "execution_token_terminal_late",
        tokenRunMatched: true,
      })
    ).toBe(false);
    expect(
      isRuntimeCoordinatorLateResultRecoverable({
        executionStatus: "failed_terminal",
        taskResultStatus: "failed",
        terminalReasonCode: "runtime.progress_stale",
        tokenValidationReasonCode: "execution_token_terminal_late",
        tokenRunMatched: true,
      })
    ).toBe(false);
    expect(
      isRuntimeCoordinatorLateResultRecoverable({
        executionStatus: "failed_terminal",
        taskResultStatus: "success",
        terminalReasonCode: "runtime.progress_stale",
        tokenValidationReasonCode: "execution_token_terminal_late",
        tokenRunMatched: false,
      })
    ).toBe(false);
  });
});

describe("RuntimeCoordinator head waiting recovery policy", () => {
  it("redrives a pending first-report Wake when its target route reports before the deadline", () => {
    const record = buildHeadLifecycleRecord({
      status: "waiting",
      waitingBoundary: {
        deadlineAtMs: NOW_MS + 1000,
        deadlineOutcome: "publication_intent_ready",
        observedAtMs: NOW_MS,
        reasonCode: "daemon.profile.pending_first_report",
        softDeadlineAtMs: NOW_MS + 500,
        trigger: "wake_route_reported",
        triggerOwner: "runtime_coordinator",
        userRecoveryAction: "wait_for_wake_route_report",
        userVisibleState: "waiting_for_wake_route_report",
        waitingCategory: "wake_route_registration_pending",
        waitingFor: "wake_route_report",
        waitingSinceMs: NOW_MS - 1000,
      },
    });

    expect(
      isRuntimeCoordinatorHeadWaitingRecoveryCandidate({
        nowMs: NOW_MS,
        ownerUserId: "owner-1",
        profileIdSet: new Set(["agent-1"]),
        record,
      })
    ).toBe(true);
    expect(
      isRuntimeCoordinatorHeadWaitingRecoveryCandidate({
        nowMs: NOW_MS,
        ownerUserId: "owner-1",
        profileIdSet: new Set(["another-agent"]),
        record,
      })
    ).toBe(false);
  });
});

describe("RuntimeCoordinator authority next-alarm resolvers", () => {
  it("returns the earliest head waiting deadline from waiting records only", () => {
    const earlierDeadlineAtMs = NOW_MS + 1000;
    const laterDeadlineAtMs = NOW_MS + 2000;

    const nextAlarmAtMs =
      resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMsFromRecords({
        nowMs: NOW_MS,
        records: [
          buildHeadLifecycleRecord(),
          buildHeadLifecycleRecord({
            status: "waiting",
            waitingBoundary: {
              deadlineAtMs: laterDeadlineAtMs,
              deadlineOutcome: "publication_intent_ready",
              observedAtMs: NOW_MS,
              reasonCode: "daemon.profile.offline",
              softDeadlineAtMs: NOW_MS + 500,
              trigger: "openmeld_service_route_connected",
              triggerOwner: "runtime_coordinator",
              userRecoveryAction: "start_or_restart_openmeld_service",
              userVisibleState: "waiting_for_openmeld_service",
              waitingCategory: "service_not_connected",
              waitingFor: "openmeld_service_route_connection",
              waitingSinceMs: NOW_MS - 1000,
            },
          }),
          buildHeadLifecycleRecord({
            status: "waiting",
            waitingBoundary: {
              deadlineAtMs: earlierDeadlineAtMs,
              deadlineOutcome: "publication_intent_ready",
              observedAtMs: NOW_MS,
              reasonCode: "daemon.profile.offline",
              softDeadlineAtMs: NOW_MS + 250,
              trigger: "openmeld_service_route_connected",
              triggerOwner: "runtime_coordinator",
              userRecoveryAction: "start_or_restart_openmeld_service",
              userVisibleState: "waiting_for_openmeld_service",
              waitingCategory: "service_not_connected",
              waitingFor: "openmeld_service_route_connection",
              waitingSinceMs: NOW_MS - 2000,
            },
          }),
        ],
      });

    expect(nextAlarmAtMs).toBe(earlierDeadlineAtMs);
  });

  it("returns the earliest accepted-head handoff deadline for records still awaiting execution", () => {
    const acceptedCreatedAtMs = NOW_MS - 20_000;
    const laterAcceptedCreatedAtMs = NOW_MS - 10_000;

    const nextAlarmAtMs =
      resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMsFromRecords({
        nowMs: NOW_MS,
        records: [
          buildHeadLifecycleRecord({
            acceptedAtMs: laterAcceptedCreatedAtMs,
            createdAtMs: laterAcceptedCreatedAtMs,
            runtimeCoordinatorExecutionId: null,
            status: "accepted",
          }),
          buildHeadLifecycleRecord({
            acceptedAtMs: acceptedCreatedAtMs,
            createdAtMs: acceptedCreatedAtMs,
            runtimeCoordinatorExecutionId: null,
            status: "accepted",
          }),
          buildHeadLifecycleRecord({
            createdAtMs: NOW_MS - 30_000,
            runtimeCoordinatorExecutionId: "rce-linked",
            status: "execution_linked",
          }),
        ],
      });

    expect(nextAlarmAtMs).toBe(
      acceptedCreatedAtMs + RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS
    );
  });

  it("starts a promoted head's handoff deadline when it becomes accepted", () => {
    const queuedAtMs = NOW_MS - 5 * 60_000;
    const promotedAtMs = NOW_MS - 5000;

    expect(
      resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMsFromRecords({
        nowMs: NOW_MS,
        records: [
          buildHeadLifecycleRecord({
            acceptedAtMs: promotedAtMs,
            createdAtMs: queuedAtMs,
            runtimeCoordinatorExecutionId: null,
            status: "accepted",
          }),
        ],
      })
    ).toBe(promotedAtMs + RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS);
  });

  it("returns the earliest head failure-publication retry from scheduled retries only", () => {
    const earlierRetryAtMs = NOW_MS + 3000;
    const laterRetryAtMs = NOW_MS + 7000;

    const nextAlarmAtMs =
      resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMsFromRecords(
        {
          nowMs: NOW_MS,
          records: [
            buildHeadLifecycleRecord({
              publicationRetry: {
                attemptCount: 1,
                firstFailureAtMs: NOW_MS - 1000,
                lastFailureAtMs: NOW_MS - 1000,
                lastReasonCode: "space.unavailable",
                nextRetryAtMs: NOW_MS + 1000,
                status: "retry_scheduled",
              },
              status: "accepted",
            }),
            buildHeadLifecycleRecord({
              publicationRetry: {
                attemptCount: 1,
                firstFailureAtMs: NOW_MS - 1000,
                lastFailureAtMs: NOW_MS - 1000,
                lastReasonCode: "space.unavailable",
                nextRetryAtMs: laterRetryAtMs,
                status: "retry_scheduled",
              },
              status: "publication_intent_ready",
            }),
            buildHeadLifecycleRecord({
              publicationRetry: {
                attemptCount: 2,
                firstFailureAtMs: NOW_MS - 2000,
                lastFailureAtMs: NOW_MS - 500,
                lastReasonCode: "space.unavailable",
                nextRetryAtMs: earlierRetryAtMs,
                status: "retry_scheduled",
              },
              status: "publication_intent_ready",
            }),
          ],
        }
      );

    expect(nextAlarmAtMs).toBe(earlierRetryAtMs);
  });

  it("returns null when no head lifecycle record requires an alarm", () => {
    const records = [
      buildHeadLifecycleRecord({
        runtimeCoordinatorExecutionId: "rce-linked",
        status: "execution_linked",
      }),
      buildHeadLifecycleRecord({
        status: "waiting",
        waitingBoundary: undefined,
      }),
    ];

    expect(
      resolveNextRuntimeCoordinatorHeadWaitingAlarmAtMsFromRecords({
        nowMs: NOW_MS,
        records,
      })
    ).toBeNull();
    expect(
      resolveNextRuntimeCoordinatorHeadAcceptedHandoffAlarmAtMsFromRecords({
        nowMs: NOW_MS,
        records,
      })
    ).toBeNull();
    expect(
      resolveNextRuntimeCoordinatorHeadFailurePublicationRetryAlarmAtMsFromRecords(
        {
          nowMs: NOW_MS,
          records,
        }
      )
    ).toBeNull();
  });

  it("returns the earliest pre-execution handoff alarm from active records only", () => {
    const earlierAlarmAtMs = NOW_MS + 500;
    const laterAlarmAtMs = NOW_MS + 5000;

    expect(
      resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMsFromRecords({
        nowMs: NOW_MS,
        records: [
          buildPreExecutionHandoffRecord({
            dispatchId: "dispatch-published",
            nextAlarmAtMs: NOW_MS - 1000,
            publicationStatus: "published",
          }),
          buildPreExecutionHandoffRecord({
            dispatchId: "dispatch-recovered",
            nextAlarmAtMs: NOW_MS - 1000,
            publicationStatus: "recovered",
          }),
          buildPreExecutionHandoffRecord({
            dispatchId: "dispatch-legacy",
            nextAlarmAtMs: NOW_MS - 1000,
            publicationStatus: "legacy_evidence_only",
          }),
          buildPreExecutionHandoffRecord({
            dispatchId: "dispatch-later",
            nextAlarmAtMs: laterAlarmAtMs,
            publicationStatus: "waiting_for_recovery",
          }),
          buildPreExecutionHandoffRecord({
            dispatchId: "dispatch-earlier",
            nextAlarmAtMs: earlierAlarmAtMs,
            publicationStatus: "publication_failed",
          }),
        ],
      })
    ).toBe(earlierAlarmAtMs);
  });

  it("returns null when no pre-execution handoff alarm is active", () => {
    expect(
      resolveNextRuntimeCoordinatorPreExecutionHandoffAlarmAtMsFromRecords({
        nowMs: NOW_MS,
        records: [
          buildPreExecutionHandoffRecord({
            publicationStatus: "published",
          }),
          buildPreExecutionHandoffRecord({
            publicationStatus: "recovered",
          }),
          buildPreExecutionHandoffRecord({
            publicationStatus: "legacy_evidence_only",
          }),
        ],
      })
    ).toBeNull();
  });

  it("returns the earliest finalization retry replay timestamp", () => {
    const earlierReplayAtMs = NOW_MS + 500;
    const laterReplayAtMs = NOW_MS + 5000;

    expect(
      resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMsFromEntries({
        nowMs: NOW_MS,
        retryEntries: [
          buildFinalizationRetryEntry({
            finalizationCommandId: "finalization-later",
            nextReplayAtMs: laterReplayAtMs,
          }),
          buildFinalizationRetryEntry({
            finalizationCommandId: "finalization-earlier",
            nextReplayAtMs: earlierReplayAtMs,
          }),
        ],
      })
    ).toBe(earlierReplayAtMs);
  });

  it("returns null when no finalization retry entry exists", () => {
    expect(
      resolveNextRuntimeCoordinatorFinalizationRetryAlarmAtMsFromEntries({
        nowMs: NOW_MS,
        retryEntries: [],
      })
    ).toBeNull();
  });
});

describe("RuntimeCoordinator finalization retry alarm planners", () => {
  it("plans due finalization retry entries in entry order", () => {
    const workItems = planRuntimeCoordinatorFinalizationRetryAlarmWork({
      nowMs: NOW_MS,
      retryEntries: [
        buildFinalizationRetryEntry({
          finalizationCommandId: "finalization-future",
          nextReplayAtMs: NOW_MS + 1000,
        }),
        buildFinalizationRetryEntry({
          finalizationCommandId: "finalization-input-first",
          nextReplayAtMs: NOW_MS - 1000,
        }),
        buildFinalizationRetryEntry({
          finalizationCommandId: "finalization-input-second",
          nextReplayAtMs: NOW_MS,
        }),
      ],
    });

    expect(
      workItems.map((retryEntry) => retryEntry.finalizationCommandId)
    ).toEqual(["finalization-input-first", "finalization-input-second"]);
  });

  it("returns an empty finalization retry work list when nothing is due", () => {
    expect(
      planRuntimeCoordinatorFinalizationRetryAlarmWork({
        nowMs: NOW_MS,
        retryEntries: [
          buildFinalizationRetryEntry({
            nextReplayAtMs: NOW_MS + 1000,
          }),
        ],
      })
    ).toEqual([]);
  });
});

describe("RuntimeCoordinator finalization retry parking", () => {
  it("increments short-period retry attempts before parking without double-counting the parked attempt", () => {
    const retryEntry = buildFinalizationRetryEntry({
      attemptCount: 59,
      firstFailureAtMs: NOW_MS - 20_000,
      nextReplayAtMs: NOW_MS,
      updatedAtMs: NOW_MS - 5000,
    });

    const incremented = incrementRuntimeCoordinatorFinalizationRetryEntry({
      nowMs: NOW_MS,
      retryEntry,
    });
    const parked = parkRuntimeCoordinatorFinalizationRetryEntry({
      nowMs: NOW_MS,
      retryEntry: incremented,
    });

    expect(incremented).toMatchObject({
      attemptCount: 60,
      nextReplayAtMs: NOW_MS + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS,
      updatedAtMs: NOW_MS,
    });
    expect(parked).toMatchObject({
      attemptCount: 60,
      firstFailureAtMs: retryEntry.firstFailureAtMs,
      nextReplayAtMs:
        NOW_MS + RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_DELAY_MS,
      updatedAtMs: NOW_MS,
    });
  });

  it("bounds parked finalization retry recovery to the configured maximum age", () => {
    expect(
      isRuntimeCoordinatorFinalizationRetryParkLimitReached({
        firstFailureAtMs:
          NOW_MS - RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS + 1,
        nowMs: NOW_MS,
      })
    ).toBe(false);
    expect(
      isRuntimeCoordinatorFinalizationRetryParkLimitReached({
        firstFailureAtMs:
          NOW_MS - RUNTIME_COORDINATOR_FINALIZATION_RETRY_PARK_MAX_AGE_MS,
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });
});

describe("RuntimeCoordinator pre-execution handoff alarm planners", () => {
  it("plans recovered deletes and due legacy-evidence handoffs in record order", () => {
    const workItems = planRuntimeCoordinatorPreExecutionHandoffAlarmWork({
      nowMs: NOW_MS,
      records: [
        buildPreExecutionHandoffRecord({
          deadlineAtMs: NOW_MS + 1000,
          dispatchId: "dispatch-future",
          publicationStatus: "waiting_for_recovery",
        }),
        buildPreExecutionHandoffRecord({
          dispatchId: "dispatch-recovered-first",
          publicationStatus: "recovered",
        }),
        buildPreExecutionHandoffRecord({
          deadlineAtMs: NOW_MS - 1000,
          dispatchId: "dispatch-due-middle",
          publicationStatus: "waiting_for_recovery",
        }),
        buildPreExecutionHandoffRecord({
          deadlineAtMs: NOW_MS,
          dispatchId: "dispatch-due-at-now",
          publicationStatus: "waiting_for_recovery",
        }),
        buildPreExecutionHandoffRecord({
          deadlineAtMs: NOW_MS - 2000,
          dispatchId: "dispatch-published",
          publicationStatus: "published",
        }),
        buildPreExecutionHandoffRecord({
          deadlineAtMs: NOW_MS - 3000,
          dispatchId: "dispatch-legacy",
          publicationStatus: "legacy_evidence_only",
        }),
        buildPreExecutionHandoffRecord({
          deadlineAtMs: NOW_MS - 4000,
          dispatchId: "dispatch-failed-last",
          publicationStatus: "publication_failed",
        }),
      ],
    });

    expect(
      workItems.map((workItem) => ({
        action: workItem.action,
        dispatchId: workItem.record.dispatchId,
      }))
    ).toEqual([
      {
        action: "delete_recovered",
        dispatchId: "dispatch-recovered-first",
      },
      {
        action: "mark_legacy_evidence_only",
        dispatchId: "dispatch-due-middle",
      },
      {
        action: "mark_legacy_evidence_only",
        dispatchId: "dispatch-due-at-now",
      },
      {
        action: "mark_legacy_evidence_only",
        dispatchId: "dispatch-failed-last",
      },
    ]);
  });

  it("returns an empty pre-execution handoff work list when nothing is due", () => {
    expect(
      planRuntimeCoordinatorPreExecutionHandoffAlarmWork({
        nowMs: NOW_MS,
        records: [
          buildPreExecutionHandoffRecord({
            deadlineAtMs: NOW_MS + 1000,
            publicationStatus: "waiting_for_recovery",
          }),
          buildPreExecutionHandoffRecord({
            deadlineAtMs: NOW_MS + 1000,
            publicationStatus: "publication_failed",
          }),
          buildPreExecutionHandoffRecord({
            deadlineAtMs: NOW_MS - 1000,
            publicationStatus: "published",
          }),
          buildPreExecutionHandoffRecord({
            deadlineAtMs: NOW_MS - 1000,
            publicationStatus: "legacy_evidence_only",
          }),
        ],
      })
    ).toEqual([]);
  });
});

describe("RuntimeCoordinator head lifecycle alarm planners", () => {
  it("plans due waiting records in record order", () => {
    const workItems = planRuntimeCoordinatorHeadWaitingAlarmWork({
      nowMs: NOW_MS,
      records: [
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-accepted",
          status: "accepted",
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-waiting-future",
          status: "waiting",
          waitingBoundary: buildWaitingBoundary({
            deadlineAtMs: NOW_MS + 1000,
          }),
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-waiting-no-boundary",
          status: "waiting",
          waitingBoundary: undefined,
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-waiting-input-first",
          status: "waiting",
          waitingBoundary: buildWaitingBoundary({
            deadlineAtMs: NOW_MS - 1000,
          }),
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-waiting-at-now",
          status: "waiting",
          waitingBoundary: buildWaitingBoundary({
            deadlineAtMs: NOW_MS,
          }),
        }),
        buildHeadLifecycleRecord({
          primaryDispatchId: "dispatch-waiting-input-second",
          status: "waiting",
          waitingBoundary: buildWaitingBoundary({
            deadlineAtMs: NOW_MS - 5000,
          }),
        }),
      ],
    });

    expect(workItems.map((record) => record.primaryDispatchId)).toEqual([
      "dispatch-waiting-input-first",
      "dispatch-waiting-at-now",
      "dispatch-waiting-input-second",
    ]);
  });

  it("plans due accepted-head handoff records in record order", () => {
    const workItems = planRuntimeCoordinatorHeadAcceptedHandoffAlarmWork({
      nowMs: NOW_MS,
      records: [
        buildHeadLifecycleRecord({
          acceptedAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 1000,
          createdAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 1000,
          primaryDispatchId: "dispatch-accepted-input-first",
          status: "accepted",
        }),
        buildHeadLifecycleRecord({
          acceptedAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS + 1000,
          createdAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS + 1000,
          primaryDispatchId: "dispatch-accepted-future",
          status: "accepted",
        }),
        buildHeadLifecycleRecord({
          createdAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 5000,
          primaryDispatchId: "dispatch-linked",
          runtimeCoordinatorExecutionId: "rce-linked",
          status: "execution_linked",
        }),
        buildHeadLifecycleRecord({
          acceptedAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS,
          createdAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS,
          primaryDispatchId: "dispatch-accepted-at-now",
          status: "accepted",
        }),
        buildHeadLifecycleRecord({
          acceptedAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 2000,
          createdAtMs:
            NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 2000,
          primaryDispatchId: "dispatch-accepted-input-second",
          status: "accepted",
        }),
      ],
    });

    expect(workItems.map((record) => record.primaryDispatchId)).toEqual([
      "dispatch-accepted-input-first",
      "dispatch-accepted-at-now",
      "dispatch-accepted-input-second",
    ]);
  });

  it("normalizes a legacy accepted head from its latest authoritative transition", () => {
    const promotedAtMs = NOW_MS - 1000;
    const record = buildHeadLifecycleRecord({
      createdAtMs:
        NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS - 1000,
      updatedAtMs: promotedAtMs,
    });

    expect(
      normalizeLegacyRuntimeCoordinatorHeadAcceptanceTiming(record)
    ).toMatchObject({
      acceptedAtMs: promotedAtMs,
      primaryDispatchId: record.primaryDispatchId,
      status: "accepted",
    });
  });

  it("plans due failure-publication retry records in record order", () => {
    const workItems =
      planRuntimeCoordinatorHeadFailurePublicationRetryAlarmWork({
        nowMs: NOW_MS,
        records: [
          buildHeadLifecycleRecord({
            primaryDispatchId: "dispatch-publication-future",
            publicationRetry: {
              attemptCount: 1,
              firstFailureAtMs: NOW_MS - 1000,
              lastFailureAtMs: NOW_MS - 1000,
              lastReasonCode: "space.unavailable",
              nextRetryAtMs: NOW_MS + 1000,
              status: "retry_scheduled",
            },
            status: "publication_intent_ready",
          }),
          buildHeadLifecycleRecord({
            primaryDispatchId: "dispatch-publication-input-first",
            publicationRetry: {
              attemptCount: 1,
              firstFailureAtMs: NOW_MS - 2000,
              lastFailureAtMs: NOW_MS - 1000,
              lastReasonCode: "space.unavailable",
              nextRetryAtMs: NOW_MS - 1000,
              status: "retry_scheduled",
            },
            status: "publication_intent_ready",
          }),
          buildHeadLifecycleRecord({
            primaryDispatchId: "dispatch-publication-at-now",
            publicationRetry: {
              attemptCount: 1,
              firstFailureAtMs: NOW_MS - 2000,
              lastFailureAtMs: NOW_MS - 1000,
              lastReasonCode: "space.unavailable",
              nextRetryAtMs: NOW_MS,
              status: "retry_scheduled",
            },
            status: "publication_intent_ready",
          }),
          buildHeadLifecycleRecord({
            primaryDispatchId: "dispatch-accepted-with-retry",
            publicationRetry: {
              attemptCount: 1,
              firstFailureAtMs: NOW_MS - 2000,
              lastFailureAtMs: NOW_MS - 1000,
              lastReasonCode: "space.unavailable",
              nextRetryAtMs: NOW_MS - 1000,
              status: "retry_scheduled",
            },
            status: "accepted",
          }),
          buildHeadLifecycleRecord({
            primaryDispatchId: "dispatch-publication-input-second",
            publicationRetry: {
              attemptCount: 2,
              firstFailureAtMs: NOW_MS - 5000,
              lastFailureAtMs: NOW_MS - 1000,
              lastReasonCode: "space.unavailable",
              nextRetryAtMs: NOW_MS - 5000,
              status: "retry_scheduled",
            },
            status: "publication_intent_ready",
          }),
        ],
      });

    expect(workItems.map((record) => record.primaryDispatchId)).toEqual([
      "dispatch-publication-input-first",
      "dispatch-publication-at-now",
      "dispatch-publication-input-second",
    ]);
  });

  it("returns empty work lists when no head lifecycle work is due", () => {
    const records = [
      buildHeadLifecycleRecord({
        primaryDispatchId: "dispatch-waiting-future",
        status: "waiting",
        waitingBoundary: buildWaitingBoundary({
          deadlineAtMs: NOW_MS + 1000,
        }),
      }),
      buildHeadLifecycleRecord({
        createdAtMs:
          NOW_MS - RUNTIME_COORDINATOR_HEAD_ACCEPTED_HANDOFF_WAIT_MS + 1000,
        primaryDispatchId: "dispatch-accepted-future",
        status: "accepted",
      }),
      buildHeadLifecycleRecord({
        primaryDispatchId: "dispatch-publication-future",
        publicationRetry: {
          attemptCount: 1,
          firstFailureAtMs: NOW_MS - 1000,
          lastFailureAtMs: NOW_MS - 1000,
          lastReasonCode: "space.unavailable",
          nextRetryAtMs: NOW_MS + 1000,
          status: "retry_scheduled",
        },
        status: "publication_intent_ready",
      }),
    ];

    expect(
      planRuntimeCoordinatorHeadWaitingAlarmWork({ nowMs: NOW_MS, records })
    ).toEqual([]);
    expect(
      planRuntimeCoordinatorHeadAcceptedHandoffAlarmWork({
        nowMs: NOW_MS,
        records,
      })
    ).toEqual([]);
    expect(
      planRuntimeCoordinatorHeadFailurePublicationRetryAlarmWork({
        nowMs: NOW_MS,
        records,
      })
    ).toEqual([]);
  });
});
