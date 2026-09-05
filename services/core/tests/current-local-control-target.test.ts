import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  LocalRuntimeExecutionTarget,
  LocalRuntimesResponse,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  requireCurrentLocalRuntimeExecutionTarget,
  requireCurrentLocalRuntimeServiceTarget,
} from "../src/rpc/current-local-control-target";

const DEVICE_ID = "device-bound";
const OFFLINE_ERROR = {
  code: "service_offline",
  reason: "This computer isn't reachable for OpenMeld right now.",
  status: 503,
};
const EXECUTION_TARGET: LocalRuntimeExecutionTarget = {
  capabilities: [],
  deviceId: DEVICE_ID,
  isCurrent: true,
  lastObservedAtMs: 1_720_000_000_000,
  localAgentCatalog: {
    detectedNotSupportedYet: 0,
    detectedSupported: 0,
    entries: [],
    needsChoice: 0,
    needsRepair: 0,
    notDetected: 0,
    totalBuiltins: 0,
  },
  localAgentControl: {
    refreshCatalog: true,
    setEnabled: true,
    setProfileWorkspace: true,
  },
  localProjectControl: {
    connectCandidate: true,
    connectDeclaredPath: true,
    discoverProjects: true,
    moveConnection: true,
    removeConnection: true,
    removeMissingConnections: true,
    setDefaultConnection: true,
  },
  reasonCodes: [],
  runtimeLane: "prod",
  status: "ready",
  userFacingCommand: "openmeld",
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority",
    value: "runtime-bound",
  },
};
const INVENTORY = {
  currentConnectedComputerId: "computer-bound",
  currentDeviceId: DEVICE_ID,
  currentRuntimeLane: "prod",
  legacyDeviceEvidence: [],
  localRuntimes: [
    {
      connectedComputerId: "computer-bound",
      connectionStatus: "connected",
      deviceDisplayName: "Felix's MacBook Pro",
      deviceDisplayNameSource: "observed",
      deviceId: DEVICE_ID,
      deviceType: "laptop",
      executionTargets: [EXECUTION_TARGET],
      firstSeenAtMs: 1_710_000_000_000,
      isCurrent: true,
      lastObservedAtMs: 1_720_000_000_000,
      legacyDeviceIds: [DEVICE_ID],
      osVersion: "26.0",
      platformFamily: "macOS",
    },
  ],
} satisfies LocalRuntimesResponse;
const RECONNECTED_SERVICE_ONLY_INVENTORY = {
  currentConnectedComputerId: "computer-bound",
  currentDeviceId: DEVICE_ID,
  currentRuntimeLane: "prod",
  legacyDeviceEvidence: [],
  localRuntimes: [
    {
      connectedComputerId: "computer-bound",
      connectionStatus: "connected",
      deviceDisplayName: "Felix's MacBook Pro",
      deviceDisplayNameSource: "observed",
      deviceId: DEVICE_ID,
      deviceType: "laptop",
      executionTargets: [],
      firstSeenAtMs: 1_710_000_000_000,
      isCurrent: true,
      lastObservedAtMs: 1_720_000_000_000,
      legacyDeviceIds: [DEVICE_ID, "device-reconnected"],
      osVersion: "26.0",
      platformFamily: "macOS",
    },
  ],
} satisfies LocalRuntimesResponse;

const COMPATIBLE_EXECUTION = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;

function liveOwnerService(
  deviceId: string
): RuntimeTransportLookupOwnerServiceResponse {
  return {
    online: true,
    sessions: [
      {
        capabilities: {},
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        deviceId,
        executionCompatibility: COMPATIBLE_EXECUTION,
        lane: "prod",
        lastHeartbeatMs: 1_720_000_000_000,
      },
    ],
  };
}

describe("requireCurrentLocalRuntimeExecutionTarget", () => {
  it("rejects a persisted Binding target when the Service is offline", () => {
    expect(() =>
      requireCurrentLocalRuntimeExecutionTarget({
        bindingTarget: {
          availability: "resolved",
          deviceId: DEVICE_ID,
          runtimeLane: "prod",
        },
        inventory: INVENTORY,
        offlineError: OFFLINE_ERROR,
        ownerService: {
          online: false,
          reasonCode: "daemon.session.not_found",
        },
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({
          code: "service_offline",
          status: 503,
        }),
      })
    );
  });

  it("rejects a live Service session for a different computer", () => {
    expect(() =>
      requireCurrentLocalRuntimeExecutionTarget({
        bindingTarget: {
          availability: "resolved",
          deviceId: DEVICE_ID,
          runtimeLane: "prod",
        },
        inventory: INVENTORY,
        offlineError: OFFLINE_ERROR,
        ownerService: liveOwnerService("device-other"),
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({
          code: "service_offline",
          status: 503,
        }),
      })
    );
  });

  it("accepts the Binding target when the live Service session matches", () => {
    expect(
      requireCurrentLocalRuntimeExecutionTarget({
        bindingTarget: {
          availability: "resolved",
          deviceId: DEVICE_ID,
          runtimeLane: "prod",
        },
        inventory: INVENTORY,
        offlineError: OFFLINE_ERROR,
        ownerService: liveOwnerService(DEVICE_ID),
      })
    ).toEqual(EXECUTION_TARGET);
  });
});

describe("requireCurrentLocalRuntimeServiceTarget", () => {
  it("accepts the exact live Service target", () => {
    expect(
      requireCurrentLocalRuntimeServiceTarget({
        bindingTarget: {
          availability: "resolved",
          deviceId: DEVICE_ID,
          runtimeLane: "prod",
        },
        inventory: INVENTORY,
        offlineError: OFFLINE_ERROR,
        ownerService: liveOwnerService(DEVICE_ID),
      })
    ).toEqual({ deviceId: DEVICE_ID, runtimeLane: "prod" });
  });

  it("follows a reconnected Computer's live Service without requiring an Agent execution target", () => {
    const input = {
      bindingTarget: {
        availability: "resolved" as const,
        deviceId: DEVICE_ID,
        runtimeLane: "prod" as const,
      },
      inventory: RECONNECTED_SERVICE_ONLY_INVENTORY,
      offlineError: OFFLINE_ERROR,
      ownerService: liveOwnerService("device-reconnected"),
    };

    expect(requireCurrentLocalRuntimeServiceTarget(input)).toEqual({
      deviceId: "device-reconnected",
      runtimeLane: "prod",
    });
    expect(() => requireCurrentLocalRuntimeExecutionTarget(input)).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({
          code: "service_offline",
          status: 503,
        }),
      })
    );
  });

  it("rejects a live Service on a different device or lane", () => {
    expect(() =>
      requireCurrentLocalRuntimeServiceTarget({
        bindingTarget: {
          availability: "resolved",
          deviceId: DEVICE_ID,
          runtimeLane: "dev-local",
        },
        inventory: INVENTORY,
        offlineError: OFFLINE_ERROR,
        ownerService: liveOwnerService(DEVICE_ID),
      })
    ).toThrowError(
      expect.objectContaining({
        cause: expect.objectContaining({
          code: "service_offline",
          status: 503,
        }),
      })
    );
  });
});
