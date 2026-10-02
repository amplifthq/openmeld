import type { RuntimeAdapter } from "@openmeld/adapter-core";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
} from "@openmeld/local-service";
import { SERVICE_EXECUTION_HOST_PROTOCOL } from "@openmeld/schemas";
import {
  type ExecutionHostHandlers,
  serveExecutionHost,
} from "../../src/local-service/execution-host/channel";
import { createServiceExecutionInputReceiver } from "../../src/local-service/execution-host/execution-input";
import { parentExecutionHostChannel } from "../../src/local-service/execution-host/process-channel";

const hostInstanceId = process.argv[2];
if (!hostInstanceId) {
  throw new Error("Fixture requires its exact Host incarnation.");
}
const mode = process.argv[3];
let activeCount = 0;
let finishWork: (() => void) | null = null;
const completed = Promise.withResolvers<void>();
const snapshot = () => ({
  pid: process.pid,
  admission: "open" as const,
  activeCount,
  pendingCount: 0,
  localQuiescent: activeCount === 0,
  unacknowledgedResultCount: 0,
  startupReplayPending: false,
  adapterIds: [],
});
const unsupported = (): never => {
  throw new Error("Fixture method was not requested.");
};
const signal = () =>
  process.send?.({
    protocol: SERVICE_EXECUTION_HOST_PROTOCOL,
    hostInstanceId,
    type: "invalidate",
    scope: "execution",
  });
const registry = createInflightTaskControlRegistry();
registry.registerTask({
  adapterId: "codex",
  dispatchId: "dispatch-1",
  runtimeCoordinatorExecutionId: "execution-1",
  targetProfileId: "agent-1",
  taskId: "task-1",
});
let nativeInputs = 0;
const adapter: RuntimeAdapter = {
  adapterId: "codex",
  dispatch: unsupported,
  interrupt: unsupported,
  steer: ({ taskId }: { taskId: string }) => {
    nativeInputs += 1;
    return Promise.resolve({
      status: "applied" as const,
      taskId,
      threadId: "thread-1",
      turnId: `turn-${nativeInputs}`,
    });
  },
};
const executionInput = createServiceExecutionInputReceiver({
  ownerUserId: "owner-1",
  registry,
  adapters: createLocalAdapterContainer([
    { adapter, adapterId: "codex", transportModes: ["codex-app-server"] },
  ]),
});
const handlers: ExecutionHostHandlers = {
  initialize: () => snapshot(),
  health: () => snapshot(),
  loadCatalog: () => {
    signal();
    if (mode === "crash") {
      process.exit(19);
    }
    // Deliberately block the child event loop, not an async Promise. Only the
    // test's exact-child cleanup terminates this fixture.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    return { revision: 1, profileIds: [], routes: [], skippedProfiles: [] };
  },
  configureConnection: unsupported,
  detachConnection: unsupported,
  heartbeat: unsupported,
  handleFrame: unsupported,
  cancel: unsupported,
  interrupt: unsupported,
  executionInput,
  conversationStatus: unsupported,
  setEnabled: unsupported,
  reportControllers: async () => {
    activeCount += 1;
    signal();
    await new Promise<void>((resolve) => {
      finishWork = resolve;
    });
    activeCount -= 1;
    completed.resolve();
    return {
      status: "submitted",
      reasonCodes: [],
      reportCount: 1,
      submittedCount: 1,
      failedCount: 0,
      hasArmedReprobe: false,
    };
  },
  reportConversations: unsupported,
  persistCatalog: unsupported,
  syncActivity: () => {
    finishWork?.();
    return {};
  },
  beginDrain: () => snapshot(),
  drain: async () => {
    await completed.promise;
    return snapshot();
  },
  settleResults: unsupported,
  stop: () => snapshot(),
};
serveExecutionHost({
  channel: parentExecutionHostChannel(),
  hostInstanceId,
  handlers,
  onFailure: (error) => {
    console.error(error);
    process.exitCode = 1;
  },
  onDisconnect: () => {
    process.exit(0);
  },
});
