import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalAgentActivitySyncLoop } from "../src/agent-activity/local-sync";

const mocks = vi.hoisted(() => ({
  drainAgentActivityHookInbox: vi.fn(),
  listProjectBindings: vi.fn(),
  readAgentActivityOutboxHealth: vi.fn(),
  readControllerTaskLifecycleOutboxHealth: vi.fn(),
  readDueAgentActivityOutbox: vi.fn(),
  readDueControllerTaskLifecycleOutbox: vi.fn(),
  removeAllAgentActivityContextCaches: vi.fn(),
  removeUnboundControllerTaskLifecycleEvents: vi.fn(),
  scanLocalAgentActivity: vi.fn(),
  startAgentActivityTranscriptWatchers: vi.fn(),
  stopAgentActivityTranscriptWatchers: vi.fn(),
  syncLocalAgentSessionInventory: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createAgentActivityApi: vi.fn(),
  createRuntimeReportingApi: vi.fn(),
}));

vi.mock("../src/agent-activity/controller-task-lifecycle-store", () => ({
  applyControllerTaskLifecycleSubmissionResults: vi.fn(),
  deferControllerTaskLifecycleOutbox: vi.fn(),
  readControllerTaskLifecycleOutboxHealth:
    mocks.readControllerTaskLifecycleOutboxHealth,
  readDueControllerTaskLifecycleOutbox:
    mocks.readDueControllerTaskLifecycleOutbox,
  removeUnboundControllerTaskLifecycleEvents:
    mocks.removeUnboundControllerTaskLifecycleEvents,
}));

vi.mock("../src/agent-activity/hook-inbox", () => ({
  drainAgentActivityHookInbox: mocks.drainAgentActivityHookInbox,
  removeProjectInbox: vi.fn(),
}));

vi.mock("../src/agent-activity/local-context-cache", () => ({
  removeAgentActivityContextCache: vi.fn(),
  removeAllAgentActivityContextCaches:
    mocks.removeAllAgentActivityContextCaches,
  writeAgentActivityContextCache: vi.fn(),
}));

vi.mock("../src/agent-activity/local-event-store", () => ({
  AgentActivitySubmissionResultsMismatchError: class extends Error {},
  applyAgentActivitySubmissionResults: vi.fn(),
  deferAgentActivityOutbox: vi.fn(),
  readAgentActivityOutboxHealth: mocks.readAgentActivityOutboxHealth,
  readDueAgentActivityOutbox: mocks.readDueAgentActivityOutbox,
  removeProjectOutbox: vi.fn(),
}));

vi.mock("../src/agent-activity/local-observer", () => ({
  scanLocalAgentActivity: mocks.scanLocalAgentActivity,
  startAgentActivityTranscriptWatchers:
    mocks.startAgentActivityTranscriptWatchers,
}));

vi.mock("../src/agent-activity/local-state-lock", () => ({
  withAgentActivityDeliveryLock: vi.fn(
    async (_input: unknown, operation: () => Promise<unknown>) =>
      await operation()
  ),
}));

vi.mock("../src/agent-activity/session-inventory-sync", () => ({
  syncLocalAgentSessionInventory: mocks.syncLocalAgentSessionInventory,
}));

vi.mock("../src/agent-activity/project-bindings", () => ({
  listProjectBindings: mocks.listProjectBindings,
  removeAgentActivityBindingsWhileDeliveryLocked: vi.fn(),
}));

describe("Agent Activity local sync loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.drainAgentActivityHookInbox.mockReset().mockResolvedValue({
      observedCount: 0,
    });
    mocks.listProjectBindings.mockReset().mockResolvedValue([]);
    mocks.readAgentActivityOutboxHealth.mockReset().mockResolvedValue({});
    mocks.readControllerTaskLifecycleOutboxHealth
      .mockReset()
      .mockResolvedValue({});
    mocks.readDueAgentActivityOutbox.mockReset().mockResolvedValue([]);
    mocks.readDueControllerTaskLifecycleOutbox
      .mockReset()
      .mockResolvedValue([]);
    mocks.removeAllAgentActivityContextCaches
      .mockReset()
      .mockResolvedValue(undefined);
    mocks.removeUnboundControllerTaskLifecycleEvents
      .mockReset()
      .mockResolvedValue(undefined);
    mocks.scanLocalAgentActivity.mockReset();
    mocks.syncLocalAgentSessionInventory.mockReset().mockResolvedValue({
      reason: null,
      sessionCount: 0,
      sourceCount: 0,
      status: "idle",
      submittedSourceCount: 0,
    });
    mocks.stopAgentActivityTranscriptWatchers
      .mockReset()
      .mockResolvedValue(undefined);
    mocks.startAgentActivityTranscriptWatchers
      .mockReset()
      .mockReturnValue(mocks.stopAgentActivityTranscriptWatchers);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately, prevents overlapping syncs, and drains before stopping watchers", async () => {
    let releaseScan:
      | ((result: {
          changedFileCount: number;
          driftCount: number;
          observedCount: number;
          queuedCount: number;
        }) => void)
      | undefined;
    mocks.scanLocalAgentActivity.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseScan = resolve;
        })
    );
    const onError = vi.fn();
    const onResult = vi.fn();

    const loop = startLocalAgentActivitySyncLoop({
      intervalMs: 1000,
      onError,
      onResult,
    });
    await flushPendingPromises();

    expect(mocks.scanLocalAgentActivity).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.scanLocalAgentActivity).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await flushPendingPromises();

    expect(stopped).toBe(false);
    expect(mocks.stopAgentActivityTranscriptWatchers).not.toHaveBeenCalled();

    releaseScan?.({
      changedFileCount: 0,
      driftCount: 0,
      observedCount: 0,
      queuedCount: 0,
    });
    await stopping;

    expect(onError).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "idle",
      })
    );
    expect(mocks.stopAgentActivityTranscriptWatchers).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.scanLocalAgentActivity).toHaveBeenCalledTimes(1);
  });

  it("runs a requested full sync immediately after the current sync finishes", async () => {
    let releaseFirstScan:
      | ((result: {
          changedFileCount: number;
          driftCount: number;
          observedCount: number;
          queuedCount: number;
        }) => void)
      | undefined;
    mocks.scanLocalAgentActivity
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstScan = resolve;
          })
      )
      .mockResolvedValueOnce(emptyObserverResult());

    const loop = startLocalAgentActivitySyncLoop({ intervalMs: 60_000 });
    await flushPendingPromises();
    expect(mocks.scanLocalAgentActivity).toHaveBeenCalledTimes(1);

    loop.requestSync({ reconcile: true, refreshContext: true });
    loop.requestSync({ reconcile: true, refreshContext: true });
    expect(mocks.scanLocalAgentActivity).toHaveBeenCalledTimes(1);

    releaseFirstScan?.(emptyObserverResult());
    await flushPendingPromises();

    expect(mocks.scanLocalAgentActivity).toHaveBeenCalledTimes(2);
    await loop.stop();
  });
});

function emptyObserverResult() {
  return {
    changedFileCount: 0,
    driftCount: 0,
    observedCount: 0,
    queuedCount: 0,
  };
}

async function flushPendingPromises(count = 20): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
