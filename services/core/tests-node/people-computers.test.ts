import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  peopleComputersResponseSchema,
} from "@openmeld/schemas";
import type {
  LocalRuntimeComputer,
  LocalRuntimesResponse,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  projectPeopleComputerConnection,
  projectPeopleComputers,
  resolvePeopleComputerTarget,
} from "../src/people-computers/projection";

const compatible = {
  status: "compatible",
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
} as const;

function computer(deviceId: string): LocalRuntimeComputer {
  return {
    deviceId,
    deviceDisplayName: "Same computer name",
    deviceDisplayNameSource: "observed",
    platformFamily: "macOS",
    osVersion: null,
    deviceType: "laptop",
    firstSeenAtMs: 1,
    lastObservedAtMs: 100,
    isCurrent: deviceId === "old-device",
    executionTargets: [],
  };
}

function inventory(): LocalRuntimesResponse {
  return {
    currentDeviceId: "old-device",
    currentRuntimeLane: "prod",
    localRuntimes: [computer("old-device"), computer("new-device")],
  };
}

function live(
  deviceId: string,
  time = 100
): Extract<
  RuntimeTransportLookupOwnerServiceResponse,
  { online: true }
>["sessions"][number] {
  return {
    daemonSessionId: `session-${deviceId}-${time}`,
    deviceId,
    lane: "prod",
    serviceVersion: "0.3.163",
    connectionGeneration: 1,
    lastHeartbeatMs: time,
    capabilities: {},
    executionCompatibility: compatible,
  };
}

describe("PeopleComputers authority", () => {
  it("uses the exact owned target, not the owner's older Binding or another live computer", () => {
    expect(
      resolvePeopleComputerTarget({
        inventory: inventory(),
        target: { deviceId: "new-device", runtimeLane: "prod" },
      })
    ).toEqual({
      availability: "resolved",
      deviceId: "new-device",
      runtimeLane: "prod",
    });
    expect(
      resolvePeopleComputerTarget({
        inventory: inventory(),
        target: { deviceId: "someone-elses-device", runtimeLane: "prod" },
      })
    ).toEqual({ availability: "missing" });
  });

  it("does not merge same-name devices or infer a browser's current computer", () => {
    const response = peopleComputersResponseSchema.parse(
      projectPeopleComputers({
        generatedAt: "2026-09-07T00:00:00.000Z",
        inventory: inventory(),
        ownerService: { online: true, sessions: [live("new-device")] },
      })
    );
    expect(response.computers).toHaveLength(2);
    expect(response.computers[0]?.connection.status).toBe("disconnected");
    expect(response.computers[1]?.connection.status).toBe("connected");
    expect(response.computers[1]?.identityStatus).toBe("unconfirmed");
    expect(JSON.stringify(response)).not.toContain("isCurrent");
    expect(JSON.stringify(response)).not.toContain("daemonSessionId");
  });

  it("keeps enrollment separate from connection and accepts a connected computer with no local agents", () => {
    const source = inventory();
    source.localRuntimes[0] = {
      ...computer("old-device"),
      connectedComputerId: "stable-computer",
      connectionStatus: "connected",
    };
    const response = projectPeopleComputers({
      generatedAt: "2026-09-07T00:00:00.000Z",
      inventory: source,
      ownerService: { online: true, sessions: [live("new-device")] },
    });
    expect(response.computers[0]).toMatchObject({
      identityStatus: "enrolled",
      connection: { status: "disconnected" },
    });
    expect(response.computers[1]).toMatchObject({
      executionTargets: [],
      connection: { status: "connected" },
    });
  });

  it("does not translate lookup failure or transport restart into disconnection", () => {
    expect(
      projectPeopleComputerConnection({
        deviceIds: ["new-device"],
        ownerService: null,
      }).status
    ).toBe("unknown");
    expect(
      projectPeopleComputerConnection({
        deviceIds: ["new-device"],
        ownerService: {
          online: false,
          reasonCode: "core.transport_restarting",
        },
      }).status
    ).toBe("unknown");
    expect(
      projectPeopleComputerConnection({
        deviceIds: ["new-device"],
        ownerService: { online: false, reasonCode: "daemon.session.not_found" },
      }).status
    ).toBe("disconnected");
  });

  it("retains only the transport-authoritative current session for a device/lane", () => {
    const result = projectPeopleComputerConnection({
      deviceIds: ["new-device"],
      ownerService: {
        online: true,
        sessions: [
          live("new-device", 200),
          live("new-device", 100),
          live("old-device"),
        ],
      },
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.lastHeartbeatMs).toBe(200);
  });
});
