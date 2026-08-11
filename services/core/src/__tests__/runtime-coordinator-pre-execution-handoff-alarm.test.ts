import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_MODEL_VERSION,
  type RuntimeCoordinatorPreExecutionHandoffRecord,
} from "../runtime-transport/application/runtime-coordinator-authority";
import { processRuntimeCoordinatorPreExecutionHandoffAlarm } from "../runtime-transport/application/runtime-coordinator-pre-execution-handoff-alarm";

const NOW_MS = 1_700_000_000_000;

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

describe("RuntimeCoordinator pre-execution handoff alarm processor", () => {
  it("processes due work through explicit ports in planner order", async () => {
    const calls: string[] = [];
    const records = [
      buildPreExecutionHandoffRecord({
        deadlineAtMs: NOW_MS + 1000,
        dispatchId: "dispatch-future",
        publicationStatus: "waiting_for_recovery",
      }),
      buildPreExecutionHandoffRecord({
        dispatchId: "dispatch-recovered",
        publicationStatus: "recovered",
      }),
      buildPreExecutionHandoffRecord({
        deadlineAtMs: NOW_MS - 1000,
        dispatchId: "dispatch-due",
        publicationStatus: "waiting_for_recovery",
      }),
      buildPreExecutionHandoffRecord({
        deadlineAtMs: NOW_MS - 1000,
        dispatchId: "dispatch-published",
        publicationStatus: "published",
      }),
      buildPreExecutionHandoffRecord({
        deadlineAtMs: NOW_MS - 1000,
        dispatchId: "dispatch-failed",
        publicationStatus: "publication_failed",
      }),
    ];
    const readRecords = vi.fn(() => Promise.resolve(records));
    const reserveWorkUnit = vi.fn(() => true);
    const deleteRecord = vi.fn((dispatchId: string) => {
      calls.push(`delete:${dispatchId}`);
      return Promise.resolve();
    });
    const markLegacyEvidenceOnly = vi.fn((input) => {
      calls.push(`legacy:${input.record.dispatchId}:${input.nowMs}`);
      return Promise.resolve(input.record);
    });

    await processRuntimeCoordinatorPreExecutionHandoffAlarm({
      nowMs: NOW_MS,
      ports: {
        deleteRecord,
        markLegacyEvidenceOnly,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(readRecords).toHaveBeenCalledTimes(1);
    expect(reserveWorkUnit).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([
      "delete:dispatch-recovered",
      `legacy:dispatch-due:${NOW_MS}`,
      `legacy:dispatch-failed:${NOW_MS}`,
    ]);
  });

  it("stops before the current work item when the budget port rejects work", async () => {
    const calls: string[] = [];
    const readRecords = vi.fn(() =>
      Promise.resolve([
        buildPreExecutionHandoffRecord({
          dispatchId: "dispatch-recovered",
          publicationStatus: "recovered",
        }),
        buildPreExecutionHandoffRecord({
          deadlineAtMs: NOW_MS - 1000,
          dispatchId: "dispatch-due",
          publicationStatus: "waiting_for_recovery",
        }),
      ])
    );
    const reserveWorkUnit = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const deleteRecord = vi.fn((dispatchId: string) => {
      calls.push(`delete:${dispatchId}`);
      return Promise.resolve();
    });
    const markLegacyEvidenceOnly = vi.fn((input) => {
      calls.push(`legacy:${input.record.dispatchId}`);
      return Promise.resolve(input.record);
    });

    await processRuntimeCoordinatorPreExecutionHandoffAlarm({
      nowMs: NOW_MS,
      ports: {
        deleteRecord,
        markLegacyEvidenceOnly,
        readRecords,
        reserveWorkUnit,
      },
    });

    expect(reserveWorkUnit).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["delete:dispatch-recovered"]);
    expect(markLegacyEvidenceOnly).not.toHaveBeenCalled();
  });

  it("uses injected time and ports instead of ambient runtime APIs", async () => {
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("processor must use injected nowMs");
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("processor must not fetch"));
    try {
      const record = buildPreExecutionHandoffRecord({
        deadlineAtMs: NOW_MS - 1000,
        dispatchId: "dispatch-due",
      });
      const markLegacyEvidenceOnly = vi.fn((input) =>
        Promise.resolve(input.record)
      );

      await processRuntimeCoordinatorPreExecutionHandoffAlarm({
        nowMs: NOW_MS,
        ports: {
          deleteRecord: vi.fn(() => Promise.resolve()),
          markLegacyEvidenceOnly,
          readRecords: vi.fn(() => Promise.resolve([record])),
          reserveWorkUnit: vi.fn(() => true),
        },
      });

      expect(markLegacyEvidenceOnly).toHaveBeenCalledWith({
        nowMs: NOW_MS,
        record,
      });
      expect(dateNow).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});
