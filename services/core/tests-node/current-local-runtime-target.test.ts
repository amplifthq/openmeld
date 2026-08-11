import type {
  LocalRuntimeComputer,
  LocalRuntimeExecutionTarget,
  LocalRuntimesResponse,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { requireCurrentLocalRuntimeExecutionTarget } from "../src/rpc/current-local-control-target";
import { resolveCurrentLocalRuntimeTarget } from "../src/start/application/current-local-runtime-target";

describe("current local runtime target", () => {
  it("prefers the Binding target over a newer live ServiceRuntime session", () => {
    expect(
      resolveCurrentLocalRuntimeTarget({
        bindingTarget: {
          availability: "resolved",
          deviceId: "device-binding",
          runtimeLane: "prod",
        },
        inventory: inventory(["device-binding", "device-live"]),
        ownerService: onlineService([
          session("device-live", "prod", 200),
          session("device-binding", "prod", 100),
        ]),
      })
    ).toEqual({
      availability: "resolved",
      deviceId: "device-binding",
      runtimeLane: "prod",
    });
  });

  it("fails closed instead of choosing the freshest of multiple unbound ServiceRuntime targets", () => {
    expect(() =>
      requireCurrentLocalRuntimeExecutionTarget({
        bindingTarget: { availability: "missing" },
        inventory: inventory(["device-older", "device-fresh"]),
        offlineError: offlineError(),
        ownerService: onlineService([
          session("device-older", "prod", 100),
          session("device-fresh", "dev-local", 200),
        ]),
      })
    ).toThrow(
      expect.objectContaining({
        code: "service_offline",
        status: 503,
      })
    );
  });

  it("allows one unambiguous live ServiceRuntime target before a Binding exists", () => {
    expect(
      requireCurrentLocalRuntimeExecutionTarget({
        bindingTarget: { availability: "missing" },
        inventory: inventory(["device-only"]),
        offlineError: offlineError(),
        ownerService: onlineService([session("device-only", "prod", 200)]),
      })
    ).toMatchObject({
      deviceId: "device-only",
      runtimeLane: "prod",
    });
  });

  it("does not expose an ambiguous heartbeat as a read-only current-device projection", () => {
    expect(
      resolveCurrentLocalRuntimeTarget({
        bindingTarget: { availability: "missing" },
        inventory: inventory(["device-older", "device-fresh"]),
        ownerService: onlineService([
          session("device-older", "prod", 100),
          session("device-fresh", "dev-local", 200),
        ]),
      })
    ).toEqual({ availability: "missing" });
  });

  it("throws the caller's structured offline error when neither source names a target", () => {
    expect(() =>
      requireCurrentLocalRuntimeExecutionTarget({
        bindingTarget: { availability: "missing" },
        inventory: inventory(["device-known"]),
        offlineError: offlineError(),
        ownerService: {
          online: false,
          sessions: [],
        } as unknown as RuntimeTransportLookupOwnerServiceResponse,
      })
    ).toThrow(
      expect.objectContaining({
        cause: {
          code: "service_offline",
          message: "This computer isn't reachable for OpenMeld right now.",
          status: 503,
        },
        code: "service_offline",
        status: 503,
      })
    );
  });
});

function inventory(deviceIds: readonly string[]): LocalRuntimesResponse {
  return {
    currentDeviceId: null,
    currentRuntimeLane: null,
    localRuntimes: deviceIds.map(
      (deviceId): LocalRuntimeComputer =>
        ({
          deviceId,
          executionTargets: [executionTarget(deviceId)],
        }) as LocalRuntimeComputer
    ),
  } as LocalRuntimesResponse;
}

function executionTarget(deviceId: string): LocalRuntimeExecutionTarget {
  return {
    deviceId,
    runtimeLane: deviceId === "device-fresh" ? "dev-local" : "prod",
  } as LocalRuntimeExecutionTarget;
}

function onlineService(
  sessions: readonly ReturnType<typeof session>[]
): RuntimeTransportLookupOwnerServiceResponse {
  return {
    online: true,
    sessions,
  } as unknown as RuntimeTransportLookupOwnerServiceResponse;
}

function session(
  deviceId: string,
  lane: "dev-local" | "prod",
  lastHeartbeatMs: number
) {
  return { deviceId, lane, lastHeartbeatMs };
}

function offlineError() {
  return {
    code: "service_offline",
    reason: "This computer isn't reachable for OpenMeld right now.",
    status: 503,
  };
}
