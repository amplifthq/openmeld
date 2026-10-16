import { describe, expect, it, vi } from "vitest";
import {
  isRunningServiceRepairHealthy,
  isServiceRepairReadinessCurrent,
} from "../src/local-service/lifecycle/service-repair-readiness";

const probes = vi.hoisted(() => ({
  health: vi.fn(),
  readiness: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../src/system/current-local-runtime-reply-readiness", () => ({
  readCurrentLocalRuntimeReplyReadiness: probes.readiness,
}));
vi.mock("../src/local-service/control-plane/client", () => ({
  sendLocalDaemonControlPlaneRequest: probes.health,
  requestLocalDaemonServiceUpdateReadiness: probes.update,
}));

describe("Service repair readiness", () => {
  it.each([
    "health",
    "readiness",
    "update",
  ] as const)("keeps repair available when the %s probe fails", async (probe) => {
    for (const fn of Object.values(probes)) {
      fn.mockReset().mockResolvedValue(undefined);
    }
    probes[probe].mockRejectedValue(new Error("probe unavailable"));
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await expect(
        isRunningServiceRepairHealthy({
          deviceId: "device-1",
          runtimeLane: "dev-local",
          gatewayUrl: "https://gateway.openmeld.invalid",
        })
      ).resolves.toBe(false);
      expect(warning).toHaveBeenCalledWith(
        "[openmeld.service.repair_probe_failed]",
        { error: "probe unavailable" }
      );
    } finally {
      warning.mockRestore();
    }
  });
  it.each([
    "ready",
    "busy",
    "draining",
    "unresponsive",
    "replaying",
    "wrong_device",
    "wrong_lane",
    "disconnected",
  ])("requires live matching admission for %s", (state) => {
    const input: Parameters<typeof isServiceRepairReadinessCurrent>[0] = {
      deviceId: "device-1",
      runtimeLane: "dev-local",
      readiness: {
        currentTarget: {
          availability: "resolved",
          deviceId: "device-1",
          runtimeLane: "dev-local",
        },
        service: {
          connected: state !== "disconnected",
          matchingCurrentRuntime: true,
          sessionDeviceId: state === "wrong_device" ? "device-2" : "device-1",
          sessionLane: state === "wrong_lane" ? "prod" : "dev-local",
          reasonCodes: [],
          executionCompatibility: {
            status: "compatible",
            reasonCode: "daemon.runtime_contract.compatible",
            expectedEpoch: "test-epoch",
            observedEpoch: "test-epoch",
          },
          executionHost: {
            hostInstanceId: "11111111-1111-4111-8111-111111111111",
            observedAtMs: 1000,
            responsive: state !== "unresponsive",
            admission: state === "draining" ? "draining" : "open",
            activeCount: state === "busy" ? 1 : 0,
            pendingCount: 0,
            unacknowledgedResultCount: 0,
            startupReplayPending: state === "replaying",
          },
        },
      },
    };
    expect(isServiceRepairReadinessCurrent(input)).toBe(
      state === "ready" || state === "busy"
    );
  });
});
