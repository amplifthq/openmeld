import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";
import type { DeviceReplyReadinessStatus } from "../src/system/reply-readiness";
import {
  formatServiceParticipationReadinessLabel,
  resolveServiceParticipationReadiness,
} from "../src/system/service-participation-readiness";

function createDeviceReplyReadiness(
  overrides: Partial<DeviceReplyReadinessStatus> = {}
): DeviceReplyReadinessStatus {
  return {
    reasonCodes: [],
    reasonText:
      "This device is ready for Space replies from local agent profiles",
    replyReadiness: "ready",
    updatedAt: "2026-03-22T00:00:00.000Z",
    wakeableRouteCount: 1,
    ...overrides,
  };
}

function createRuntimeStatus(
  status: DaemonServiceRuntimeStatus["status"]
): DaemonServiceRuntimeStatus {
  return {
    status,
    mode: status === "running" ? "background" : null,
    pid: status === "running" ? 4321 : null,
    startedAt: status === "running" ? "2026-03-22T00:00:00.000Z" : null,
    updatedAt: "2026-03-22T00:00:00.000Z",
    managedBySystemService: false,
    serviceController: "unknown",
    autoStart: false,
    ...(status === "stale"
      ? {
          reason: "heartbeat_stale",
        }
      : {}),
  };
}

function createRunningDriftInventory(): DaemonServiceInventory {
  const runtimeStatus = createRuntimeStatus("running");
  return {
    expectedVersion: "0.6.1",
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.6.1",
        installSource: "daemon.command.install",
        installedAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
    },
    runtimeStatus,
    legacySharedService: null,
    activeBundle: null,
    activeBundleSourceAvailable: null,
    activeBundleEntryPath:
      "/Users/test/.openmeld/runtime/daemon/bundles/current/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/Users/test/.openmeld/runtime/daemon/bundles/current/dist/openmeld.js",
    runtimeCommandPathExists: true,
    runtimeContractCompatibility: {
      expectedEpoch: "daemon-runtime-epoch-test",
      observedEpoch: "daemon-runtime-epoch-test",
      reasonCode: "daemon.runtime_contract.compatible",
      status: "compatible",
      updatedAt: "2026-05-27T00:00:00.000Z",
    },
    serviceContract: {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: "0.6.1",
      bundleId: "daemon-bundle-test",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "https://gateway.openmeld.invalid",
      profileId: "profile_test",
      deviceId: "device_test",
      heartbeatMs: 30_000,
      generation: 1,
      updatedAt: "2026-05-27T00:00:00.000Z",
    },
    runtimeLease: null,
    serviceManager: null,
    serviceManagerStatus: null,
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [
      {
        code: "bundle_content_drift",
        message: "bundle content drift",
      },
    ],
  };
}

describe("service participation readiness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ready when the device can participate", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      runtimeStatus: createRuntimeStatus("running"),
    });

    expect(summary.serviceReadiness).toBe("ready");
    expect(summary.serviceReadinessState).toBe("ready");
    expect(summary.summaryText).toBe("Running");
    expect(summary.runtimeHeadline).toBe("running");
    expect(summary.nextSteps).toEqual([]);
  });

  it("keeps compatible service drift wakeable while exposing update-available state", () => {
    const inventory = createRunningDriftInventory();
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      inventory,
      runtimeStatus: inventory.runtimeStatus,
    });

    expect(summary.serviceReadiness).toBe("ready");
    expect(summary.serviceReadinessState).toBe("update_available");
    expect(summary.summaryText).toBe("Update OpenMeld Service");
    expect(summary.nextSteps).toEqual(["openmeld setup"]);
    expect(formatServiceParticipationReadinessLabel(summary)).toContain(
      "ℹ️ Update OpenMeld Service"
    );
  });

  it("treats drift as a service repair for human-facing guidance", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.drifted"],
        reasonText:
          "OpenMeld Service artifact drift was detected on this device",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      runtimeStatus: createRuntimeStatus("running"),
    });

    expect(summary.serviceReadiness).toBe("needs_repair");
    expect(summary.summaryText).toBe("Needs repair");
    expect(summary.detailText).toBe(
      "OpenMeld Service needs repair. This computer may still be running an older local OpenMeld Service build, so local Wake work may not be received reliably until it is repaired."
    );
    expect(summary.runtimeHeadline).toBe("running");
    expect(summary.nextStepSummary).toBe(
      "OpenMeld Service needs repair. Run `openmeld setup`. If Wake or readiness still looks wrong after setup, run `openmeld service status`."
    );
    expect(summary.nextSteps).toEqual(["openmeld setup"]);
  });

  it("returns not running when device readiness reports service.not_running", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.not_running"],
        reasonText: "OpenMeld Service is not running on this device",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      runtimeStatus: createRuntimeStatus("not_running"),
    });

    expect(summary.serviceReadiness).toBe("not_running");
    expect(summary.summaryText).toBe("Not running");
    expect(summary.runtimeHeadline).toBe("not running");
    expect(summary.nextSteps).toEqual(["openmeld setup"]);
  });

  it("treats gateway chain failures as needs repair", () => {
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.gateway_chain_unhealthy"],
        reasonText:
          "OpenMeld gateway can't reach the local OpenMeld auth worker session.",
        replyReadiness: "blocked",
        wakeableRouteCount: 1,
      }),
      runtimeStatus: createRuntimeStatus("running"),
    });

    expect(summary.serviceReadiness).toBe("needs_repair");
    expect(summary.summaryText).toBe("Needs repair");
    expect(summary.nextSteps).toEqual([
      "pnpm dev:stop",
      "pnpm dev",
      "openmeld doctor --repair",
    ]);
  });

  it("treats dispatch storage gate failures as hosted cloud uncertainty", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["dispatch.storage_not_ready"],
        reasonText:
          "Core dispatch storage is not ready for wake execution yet.",
        replyReadiness: "blocked",
        wakeableRouteCount: 1,
      }),
      runtimeStatus: createRuntimeStatus("running"),
    });

    expect(summary.serviceReadiness).toBe("unknown");
    expect(summary.summaryText).toBe("OpenMeld cloud temporarily unavailable");
    expect(summary.nextSteps).toEqual([
      "Retry the OpenMeld command shortly.",
      "If this continues, contact OpenMeld support with the latest command output.",
    ]);
  });

  it("treats launch repair blockers as needs repair", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["controller.launch.needs_repair"],
        reasonText:
          "OpenMeld can't start one or more projected local agents on this device until launch repair completes.",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      runtimeStatus: createRuntimeStatus("running"),
    });

    expect(summary.serviceReadiness).toBe("needs_repair");
    expect(summary.summaryText).toBe("Needs repair");
    expect(summary.nextSteps).toEqual(["openmeld doctor --repair"]);
  });

  it("treats workspace.missing as needs repair", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["workspace.missing"],
        reasonText:
          "This profile is missing its local workspace on this device.",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      runtimeStatus: createRuntimeStatus("running"),
    });

    expect(summary.serviceReadiness).toBe("needs_repair");
    expect(summary.summaryText).toBe("Needs repair");
    expect(summary.nextSteps).toEqual(["openmeld doctor --repair"]);
  });

  it("treats workspace.invalid as needs repair", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["workspace.invalid"],
        reasonText:
          "This profile workspace on this device is invalid or unavailable.",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      runtimeStatus: createRuntimeStatus("running"),
    });

    expect(summary.serviceReadiness).toBe("needs_repair");
    expect(summary.summaryText).toBe("Needs repair");
    expect(summary.nextSteps).toEqual(["openmeld doctor --repair"]);
  });

  it("returns not installed when device readiness reports service.not_installed", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.not_installed"],
        reasonText: "OpenMeld Service is not installed on this device",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
    });

    expect(summary.serviceReadiness).toBe("not_installed");
    expect(summary.summaryText).toBe("Not installed");
    expect(summary.runtimeHeadline).toBe("unknown");
    expect(summary.nextSteps).toEqual(["openmeld setup"]);
  });

  it("falls back to unknown when readiness cannot be confirmed", () => {
    const summary = resolveServiceParticipationReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: [],
        reasonText:
          "OpenMeld couldn't confirm current reply readiness on this device",
        replyReadiness: "unknown",
        wakeableRouteCount: 0,
      }),
    });

    expect(summary.serviceReadiness).toBe("unknown");
    expect(summary.summaryText).toBe("Unknown");
    expect(summary.nextSteps).toEqual(["openmeld service status"]);
  });
});
