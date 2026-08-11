import { describe, expect, it, vi } from "vitest";
import type { RuntimeCoordinatorWakeStoppedNoticePublicationRecord } from "../runtime-transport/application/runtime-coordinator-authority";
import { RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION } from "../runtime-transport/application/runtime-coordinator-authority";
import { RuntimeTransportHub } from "../runtime-transport/transport/do/runtime-transport-hub";

const INDEX_KEY = "runtime-coordinator:stopped-task-projection:index";

describe("RuntimeCoordinator stopped task projection retry", () => {
  it("keeps a durable pending intent until the alarm projection succeeds", async () => {
    const storage = createStorageHarness();
    const hub = Object.create(RuntimeTransportHub.prototype) as {
      processRuntimeCoordinatorStoppedTaskProjectionAlarm: (
        nowMs: number
      ) => Promise<void>;
      projectRuntimeCoordinatorStoppedTaskOutcome: (input: {
        record: RuntimeCoordinatorWakeStoppedNoticePublicationRecord;
        sourceClientMessageId: string | null;
      }) => Promise<void>;
      writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord: (
        record: RuntimeCoordinatorWakeStoppedNoticePublicationRecord
      ) => Promise<void>;
    };
    Object.defineProperty(hub, "ctx", {
      value: { storage },
    });
    const record = buildPendingRecord();
    await hub.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord(record);

    expect(storage.values.get(INDEX_KEY)).toEqual({
      publicationIds: [record.publicationId],
    });
    expect(storage.alarmAtMs).toEqual(expect.any(Number));

    hub.projectRuntimeCoordinatorStoppedTaskOutcome = vi.fn(() =>
      Promise.reject(new Error("D1 unavailable"))
    );
    await expect(
      hub.processRuntimeCoordinatorStoppedTaskProjectionAlarm(2000)
    ).rejects.toThrow("D1 unavailable");
    expect(storage.values.get(INDEX_KEY)).toEqual({
      publicationIds: [record.publicationId],
    });

    hub.projectRuntimeCoordinatorStoppedTaskOutcome = vi.fn(async (input) => {
      await hub.writeRuntimeCoordinatorWakeStoppedNoticePublicationRecord({
        ...input.record,
        taskOutcomeProjectedAtMs: 2100,
      });
    });
    await expect(
      hub.processRuntimeCoordinatorStoppedTaskProjectionAlarm(2100)
    ).resolves.toBeUndefined();
    expect(storage.values.get(INDEX_KEY)).toEqual({ publicationIds: [] });
  });
});

function buildPendingRecord(): RuntimeCoordinatorWakeStoppedNoticePublicationRecord {
  return {
    createdAtMs: 1000,
    dispatchId: "dispatch-stopped",
    modelVersion:
      RUNTIME_COORDINATOR_WAKE_STOPPED_NOTICE_PUBLICATION_MODEL_VERSION,
    publicationId: "stopped-publication-1",
    publishedSignalId: "signal-stopped",
    reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
    runtimeCoordinatorExecutionId: "execution-stopped",
    spaceId: "space-1",
    status: "published",
    taskOutcomeProjectedAtMs: null,
    taskOutcomeSourceClientMessageId: "client-stopped",
    targetProfileId: "agt_00000000-0000-4000-8000-000000000001",
    targetWakeLifecycleId: "lifecycle-stopped",
    updatedAtMs: 1100,
  };
}

function createStorageHarness() {
  const values = new Map<string, unknown>();
  let alarmAtMs: number | null = null;
  const storage = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    transaction: async <T>(
      callback: (transaction: {
        get: <Value>(key: string) => Promise<Value | undefined>;
        put: {
          (entries: Record<string, unknown>): Promise<void>;
          (key: string, value: unknown): Promise<void>;
        };
        setAlarm: (scheduledTime: number) => Promise<void>;
      }) => Promise<T>
    ) =>
      await callback({
        get: <Value>(key: string) =>
          Promise.resolve(values.get(key) as Value | undefined),
        put: (
          keyOrEntries: string | Record<string, unknown>,
          value?: unknown
        ) => {
          if (typeof keyOrEntries === "string") {
            values.set(keyOrEntries, value);
            return Promise.resolve();
          }
          for (const [key, entry] of Object.entries(keyOrEntries)) {
            values.set(key, entry);
          }
          return Promise.resolve();
        },
        setAlarm: (scheduledTime: number) => {
          alarmAtMs = scheduledTime;
          return Promise.resolve();
        },
      }),
    values,
    get alarmAtMs() {
      return alarmAtMs;
    },
  };
  return storage;
}
