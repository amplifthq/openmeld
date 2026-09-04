import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  LocalComponentsReleaseManifest,
  LocalComponentsStatus,
  OpenMeldToolsControlResult,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeTransportSessionState } from "../runtime-transport/application/runtime-transport-state";
import { RuntimeTransportHub } from "../runtime-transport/transport/do/runtime-transport-hub";

describe("Runtime Transport release-triggered OpenMeld Tools update", () => {
  it.each([
    { name: "the registered session is missing", sessionPresent: false },
    {
      name: "the registered session uses another socket",
      sessionPresent: true,
    },
  ])("records when $name", async ({ sessionPresent }) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const harness = createHarness([]);

    try {
      await harness.queueAndSettle("register", {
        sessionPresent,
        socketMatches: false,
      });

      expect(harness.sendCurrentDeviceOperationAndWait).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        "[core.openmeld_tools.automatic_update_skipped]",
        expect.objectContaining({
          reasonCode: "automatic_update.session_socket_mismatch",
          sessionPresent,
          sessionSocketMatches: false,
          trigger: "register",
        })
      );
    } finally {
      log.mockRestore();
    }
  });

  it("records why a production Service register cannot request the release", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const harness = createHarness([], {
      openMeldToolsControl: { requestUpdate: true },
    });

    try {
      await harness.queueAndSettle("register");

      expect(harness.sendCurrentDeviceOperationAndWait).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        "[core.openmeld_tools.automatic_update_skipped]",
        expect.objectContaining({
          event: "core.openmeld_tools.automatic_update_skipped",
          reasonCode: "automatic_update.capability_not_supported",
          releaseServiceVersion: "0.3.153",
          requestAutomaticUpdateSupported: false,
          requestUpdateSupported: true,
          serviceVersion: "0.3.152",
          trigger: "register",
        })
      );
    } finally {
      log.mockRestore();
    }
  });

  it("does not record a routine heartbeat skip", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const harness = createHarness([], {
      openMeldToolsControl: { requestUpdate: true },
    });

    try {
      await harness.queueAndSettle("heartbeat");

      expect(harness.sendCurrentDeviceOperationAndWait).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("records the request before waiting for the Service response", async () => {
    const callOrder: string[] = [];
    const log = vi.spyOn(console, "info").mockImplementation((message) => {
      if (message === "[core.openmeld_tools.automatic_update_queued]") {
        callOrder.push("queued");
      }
    });
    const harness = createHarness([currentResult("0.3.153")], {
      onSend: () => callOrder.push("send"),
    });

    try {
      await harness.queueAndSettle("register");

      expect(log).toHaveBeenCalledWith(
        "[core.openmeld_tools.automatic_update_queued]",
        expect.objectContaining({
          event: "core.openmeld_tools.automatic_update_queued",
          targetVersion: "0.3.153",
          trigger: "register",
        })
      );
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledOnce();
      expect(callOrder.slice(0, 2)).toEqual(["queued", "send"]);
    } finally {
      log.mockRestore();
    }
  });

  it("records when the same target is already coalesced", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const harness = createHarness([currentResult("0.3.153")]);

    try {
      await harness.queueAndSettle("register");
      await harness.queueAndSettle("register");

      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith(
        "[core.openmeld_tools.automatic_update_skipped]",
        expect.objectContaining({
          reasonCode: "automatic_update.target_already_coalesced",
          targetVersion: "0.3.153",
          trigger: "register",
        })
      );
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    {
      name: "automatic updates became disabled",
      result: {
        operation: "request_update",
        result: { status: "disabled" },
      } satisfies OpenMeldToolsControlResult,
    },
    {
      name: "the control response is invalid",
      result: new Error("invalid control response"),
    },
    {
      name: "the Service still reports a lower current version",
      result: {
        operation: "request_update",
        result: { currentVersion: "0.3.152", status: "current" },
      } satisfies OpenMeldToolsControlResult,
    },
  ])("retries on the next heartbeat when $name", async ({ result }) => {
    const harness = createHarness([result, currentResult("0.3.153")]);

    await harness.queueAndSettle("register");
    await harness.queueAndSettle("heartbeat");

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(2);
  });

  it("backs off unavailable results with a bounded retry delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    const unavailable = {
      operation: "request_update",
      result: { status: "unavailable" },
    } satisfies OpenMeldToolsControlResult;
    const harness = createHarness([
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      currentResult("0.3.153"),
    ]);

    try {
      await harness.queueAndSettle("register");
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(
        2
      );

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(
        2
      );

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(
        3
      );

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(
        4
      );

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(
        5
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps unavailable backoff after the Durable Object is rebuilt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    const storageValues = new Map<string, unknown>();
    const firstHub = createHarness(
      [
        {
          operation: "request_update",
          result: { status: "unavailable" },
        },
      ],
      { storageValues }
    );

    try {
      await firstHub.queueAndSettle("register");
      expect(storageValues.size).toBe(1);

      const rebuiltHub = createHarness([currentResult("0.3.153")], {
        storageValues,
      });
      await rebuiltHub.restoreUnavailableRetries();
      await rebuiltHub.queueAndSettle("heartbeat");
      expect(
        rebuiltHub.sendCurrentDeviceOperationAndWait
      ).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await rebuiltHub.queueAndSettle("heartbeat");
      expect(
        rebuiltHub.sendCurrentDeviceOperationAndWait
      ).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries immediately when the Service registers a new session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    const harness = createHarness([
      {
        operation: "request_update",
        result: { status: "unavailable" },
      },
      currentResult("0.3.153"),
    ]);

    try {
      await harness.queueAndSettle("register");
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledOnce();

      harness.setDaemonSessionId("daemon-session-2");
      await harness.queueAndSettle("register");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(
        2
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a handled release when the Service session changes", async () => {
    const harness = createHarness([
      currentResult("0.3.153"),
      currentResult("0.3.153"),
    ]);

    await harness.queueAndSettle("register");
    harness.setDaemonSessionId("daemon-session-2");
    await harness.queueAndSettle("register");

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(2);
  });

  it("does not let an old session result clear the new session marker", async () => {
    const oldSessionResult =
      Promise.withResolvers<OpenMeldToolsControlResult>();
    const harness = createHarness([
      oldSessionResult.promise,
      currentResult("0.3.153"),
    ]);

    const settleOldSession = harness.queue("register");
    harness.setDaemonSessionId("daemon-session-2");
    await harness.queueAndSettle("register");

    oldSessionResult.resolve({
      operation: "request_update",
      result: { status: "unavailable" },
    });
    await settleOldSession;
    await harness.queueAndSettle("register");

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(2);
  });

  it("retries immediately when a newer release becomes available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    const harness = createHarness([
      {
        operation: "request_update",
        result: { status: "unavailable" },
      },
      currentResult("0.3.154"),
    ]);

    try {
      await harness.queueAndSettle("register");
      await harness.queueAndSettle("heartbeat");
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledOnce();

      await harness.queueAndSettle("heartbeat", { releaseVersion: "0.3.154" });
      expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(
        2
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "started operation targets an older release",
      status: "started",
      targetVersion: "0.3.152",
    },
    {
      name: "already-running operation targets an older release",
      status: "already_running",
      targetVersion: "0.3.152",
    },
    {
      name: "started operation target is invalid",
      status: "started",
      targetVersion: "invalid",
    },
    {
      name: "already-running operation target is invalid",
      status: "already_running",
      targetVersion: "invalid",
    },
  ] as const)("retries when the $name", async ({ status, targetVersion }) => {
    const harness = createHarness([
      operationResult(status, targetVersion),
      currentResult("0.3.153"),
    ]);

    await harness.queueAndSettle("register");
    await harness.queueAndSettle("heartbeat");

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: "started", targetVersion: "0.3.153" },
    { status: "started", targetVersion: "0.3.154" },
    { status: "already_running", targetVersion: "0.3.153" },
    { status: "already_running", targetVersion: "0.3.154" },
  ] as const)("coalesces later heartbeats after $status reaches $targetVersion", async ({
    status,
    targetVersion,
  }) => {
    const harness = createHarness([operationResult(status, targetVersion)]);

    await harness.queueAndSettle("register");
    await harness.queueAndSettle("heartbeat");

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(1);
  });

  it.each([
    "0.3.153",
    "0.3.154",
  ])("coalesces later heartbeats after the Service reaches %s", async (currentVersion) => {
    const harness = createHarness([currentResult(currentVersion)]);

    await harness.queueAndSettle("register");
    await harness.queueAndSettle("heartbeat");

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(1);
  });
});

function createHarness(
  results: Array<
    Error | OpenMeldToolsControlResult | Promise<OpenMeldToolsControlResult>
  >,
  input: {
    onSend?: () => void;
    openMeldToolsControl?: RuntimeTransportSessionState["capabilities"]["openMeldToolsControl"];
    storageValues?: Map<string, unknown>;
  } = {}
) {
  const socket = {} as WebSocket;
  const waitUntilTasks: Promise<unknown>[] = [];
  const storageValues = input.storageValues ?? new Map<string, unknown>();
  const sendCurrentDeviceOperationAndWait = vi.fn(
    (): Promise<OpenMeldToolsControlResult> => {
      input.onSend?.();
      const result = results.shift() ?? currentResult("0.3.153");
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    }
  );
  const hub = Object.create(
    RuntimeTransportHub.prototype
  ) as RuntimeTransportHub;
  Object.defineProperty(hub, "automaticToolsUpdateTargetByComputer", {
    value: new Map<string, unknown>(),
  });
  Object.defineProperty(hub, "automaticToolsUpdateUnavailableRetryByComputer", {
    value: new Map(),
  });
  Object.defineProperty(hub, "ctx", {
    value: {
      storage: {
        delete: (key: string) => {
          storageValues.delete(key);
          return Promise.resolve();
        },
        list: (options: { prefix?: string } = {}) =>
          Promise.resolve(
            new Map(
              [...storageValues].filter(([key]) =>
                options.prefix ? key.startsWith(options.prefix) : true
              )
            )
          ),
        put: (key: string, value: unknown) => {
          storageValues.set(key, value);
          return Promise.resolve();
        },
      },
      waitUntil: (task: Promise<unknown>) => waitUntilTasks.push(task),
    },
  });
  Object.defineProperty(hub, "sendCurrentDeviceOperationAndWait", {
    value: sendCurrentDeviceOperationAndWait,
  });

  let session: RuntimeTransportSessionState = {
    acceptingDispatches: true,
    capabilities: {
      localComponents: createLocalComponentsStatus(),
      openMeldToolsControl: input.openMeldToolsControl ?? {
        requestAutomaticUpdate: true,
        requestUpdate: true,
      },
    },
    connectedAtMs: 1_700_000_000_000,
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deliveryDisconnectedAtMs: null,
    deviceId: "device-1",
    executionCompatibility: {
      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      reasonCode: "daemon.runtime_contract.compatible",
      status: "compatible",
    },
    lane: "prod",
    lastHeartbeatMs: 1_700_000_000_000,
    localWakeRouteReport: null,
    ownerUserId: "owner-1",
    profileIds: new Set(),
    rejectedProfileRegistrationsByProfileId: new Map(),
    serviceVersion: "0.3.152",
    socket,
  };

  const queue = (
    trigger: "heartbeat" | "register",
    options: {
      releaseVersion?: string;
      sessionPresent?: boolean;
      socketMatches?: boolean;
    } = {}
  ): Promise<unknown[]> => {
    const firstNewTaskIndex = waitUntilTasks.length;
    (
      hub as unknown as {
        queueReleaseTriggeredOpenMeldToolsUpdate: (input: {
          connection: Pick<
            RuntimeTransportSessionState,
            "daemonSessionId" | "deviceId" | "lane" | "ownerUserId"
          >;
          releaseManifest: LocalComponentsReleaseManifest;
          session: RuntimeTransportSessionState | null;
          socket: WebSocket;
          trigger: "heartbeat" | "register";
        }) => void;
      }
    ).queueReleaseTriggeredOpenMeldToolsUpdate({
      connection: {
        daemonSessionId: session.daemonSessionId,
        deviceId: session.deviceId,
        lane: session.lane,
        ownerUserId: session.ownerUserId,
      },
      releaseManifest: createReleaseManifest(options.releaseVersion),
      session: options.sessionPresent === false ? null : session,
      socket: options.socketMatches === false ? ({} as WebSocket) : socket,
      trigger,
    });
    return Promise.all(waitUntilTasks.slice(firstNewTaskIndex));
  };

  return {
    queue,
    queueAndSettle: async (
      trigger: "heartbeat" | "register",
      options: {
        releaseVersion?: string;
        sessionPresent?: boolean;
        socketMatches?: boolean;
      } = {}
    ) => {
      await queue(trigger, options);
    },
    restoreUnavailableRetries: async () => {
      await (
        hub as unknown as {
          restoreAutomaticToolsUpdateUnavailableRetries: () => Promise<void>;
        }
      ).restoreAutomaticToolsUpdateUnavailableRetries();
    },
    sendCurrentDeviceOperationAndWait,
    setDaemonSessionId: (daemonSessionId: string) => {
      session = { ...session, daemonSessionId };
    },
  };
}

function currentResult(currentVersion: string): OpenMeldToolsControlResult {
  return {
    operation: "request_update",
    result: { currentVersion, status: "current" },
  };
}

function operationResult(
  status: "already_running" | "started",
  targetVersion: string
): OpenMeldToolsControlResult {
  return {
    operation: "request_update",
    result: {
      operation: {
        operationId: "operation-1",
        phase: "updating",
        requestSource: "automatic",
        requestedAt: "2026-09-01T12:55:00.000Z",
        targetVersion,
        updatedAt: "2026-09-01T12:55:00.000Z",
        urgency: "required",
      },
      status,
    },
  };
}

function createReleaseManifest(
  version = "0.3.153"
): LocalComponentsReleaseManifest {
  return {
    components: {
      cli: {
        commandContractVersion: "cli-contract-v1",
        packageVersion: version,
        reason: "Fixture.",
        updatePolicy: "available",
      },
      service: {
        bundleHash: "a".repeat(64),
        bundleVersion: version,
        reason: "Fixture.",
        runtimeContractEpoch: "runtime-contract-v1",
        serviceContractVersion: "service-contract-v1",
        updatePolicy: "required",
      },
      skills: {
        bundleHash: "b".repeat(64),
        reason: "Fixture.",
        skillContractVersion: "skills-contract-v1",
        skillIds: ["openmeld-cli"],
        updatePolicy: "available",
      },
    },
    schemaVersion: 1,
    updatedAt: "2026-09-01T12:55:00.000Z",
  };
}

function createLocalComponentsStatus(): LocalComponentsStatus {
  return {
    cli: {
      commandContractVersion: "cli-contract-v1",
      latestPackageVersion: "0.3.152",
      packageVersion: "0.3.152",
      reasonCodes: [],
      requiredCommandContractVersion: null,
      status: "ok",
    },
    entrypoint: "setup",
    generatedAt: "2026-09-01T12:54:00.000Z",
    maintenance: {
      automaticUpdatesEnabled: true,
      status: "ready",
    },
    schemaVersion: 1,
    service: {
      expectedBundleHash: "c".repeat(64),
      expectedBundleVersion: "0.3.152",
      installedBundleHash: "c".repeat(64),
      installedBundleVersion: "0.3.152",
      reasonCodes: [],
      runtimeContractEpoch: "runtime-contract-v1",
      serviceContractVersion: "service-contract-v1",
      status: "ok",
    },
    setupAction: "none",
    setupActionDescription: "OpenMeld Tools are ready.",
    setupActionLabel: "Everything is up to date",
    skills: {
      expectedBundleHash: "b".repeat(64),
      installedBundleHash: "b".repeat(64),
      reasonCodes: [],
      skillContractVersion: "skills-contract-v1",
      status: "ok",
      targetCount: 1,
    },
    summaryDescription: "OpenMeld Tools are ready.",
    summaryLabel: "Everything is up to date",
  };
}
