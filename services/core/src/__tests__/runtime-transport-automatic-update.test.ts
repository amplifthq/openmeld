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
    {
      name: "the release is unavailable",
      result: {
        operation: "request_update",
        result: { status: "unavailable" },
      } satisfies OpenMeldToolsControlResult,
    },
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

  it.each([
    "started",
    "already_running",
  ] as const)("coalesces later heartbeats after the update is %s", async (status) => {
    const harness = createHarness([
      {
        operation: "request_update",
        result: {
          operation: {
            operationId: "operation-1",
            phase: "updating",
            requestSource: "automatic",
            requestedAt: "2026-09-01T12:55:00.000Z",
            targetVersion: "0.3.153",
            updatedAt: "2026-09-01T12:55:00.000Z",
            urgency: "required",
          },
          status,
        },
      },
    ]);

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

function createHarness(results: Array<Error | OpenMeldToolsControlResult>) {
  const socket = {} as WebSocket;
  const waitUntilTasks: Promise<unknown>[] = [];
  const sendCurrentDeviceOperationAndWait = vi.fn(
    (): Promise<OpenMeldToolsControlResult> => {
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
    value: new Map<string, string>(),
  });
  Object.defineProperty(hub, "ctx", {
    value: {
      waitUntil: (task: Promise<unknown>) => waitUntilTasks.push(task),
    },
  });
  Object.defineProperty(hub, "sendCurrentDeviceOperationAndWait", {
    value: sendCurrentDeviceOperationAndWait,
  });

  const session: RuntimeTransportSessionState = {
    acceptingDispatches: true,
    capabilities: {
      localComponents: createLocalComponentsStatus(),
      openMeldToolsControl: {
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

  return {
    queueAndSettle: async (trigger: "heartbeat" | "register") => {
      const firstNewTaskIndex = waitUntilTasks.length;
      (
        hub as unknown as {
          queueReleaseTriggeredOpenMeldToolsUpdate: (input: {
            releaseManifest: LocalComponentsReleaseManifest;
            session: RuntimeTransportSessionState;
            socket: WebSocket;
            trigger: "heartbeat" | "register";
          }) => void;
        }
      ).queueReleaseTriggeredOpenMeldToolsUpdate({
        releaseManifest: createReleaseManifest(),
        session,
        socket,
        trigger,
      });
      await Promise.all(waitUntilTasks.slice(firstNewTaskIndex));
    },
    sendCurrentDeviceOperationAndWait,
  };
}

function currentResult(currentVersion: string): OpenMeldToolsControlResult {
  return {
    operation: "request_update",
    result: { currentVersion, status: "current" },
  };
}

function createReleaseManifest(): LocalComponentsReleaseManifest {
  return {
    components: {
      cli: {
        commandContractVersion: "cli-contract-v1",
        packageVersion: "0.3.153",
        reason: "Fixture.",
        updatePolicy: "available",
      },
      service: {
        bundleHash: "a".repeat(64),
        bundleVersion: "0.3.153",
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
