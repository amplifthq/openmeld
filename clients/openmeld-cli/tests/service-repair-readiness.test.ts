import { describe, expect, it } from "vitest";
import { isServiceRepairReadinessCurrent } from "../src/local-service/lifecycle/service-repair-readiness";

describe("Service repair readiness", () => {
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
