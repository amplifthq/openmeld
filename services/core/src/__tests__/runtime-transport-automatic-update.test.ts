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
    "register",
    "heartbeat",
  ] as const)("queues the published release from a connected %s trigger", async (trigger) => {
    const harness = createHarness();

    harness.queue(trigger);
    await Promise.all(harness.waitUntilTasks);

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "daemon.openmeld_tools_control.request",
        payload: expect.objectContaining({
          request: {
            operation: "request_update",
            requestSource: "automatic",
          },
        }),
      })
    );
  });

  it("coalesces repeated connected triggers for the same computer and release target", async () => {
    const harness = createHarness();

    harness.queue("register");
    harness.queue("heartbeat");
    await Promise.all(harness.waitUntilTasks);

    expect(harness.sendCurrentDeviceOperationAndWait).toHaveBeenCalledTimes(1);
  });
});

function createHarness() {
  const socket = {} as WebSocket;
  const waitUntilTasks: Promise<unknown>[] = [];
  const sendCurrentDeviceOperationAndWait = vi.fn(
    async (): Promise<OpenMeldToolsControlResult> => ({
      operation: "request_update",
      result: {
        currentVersion: "0.3.153",
        status: "current",
      },
    })
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
    queue: (trigger: "heartbeat" | "register") =>
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
      }),
    sendCurrentDeviceOperationAndWait,
    waitUntilTasks,
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
