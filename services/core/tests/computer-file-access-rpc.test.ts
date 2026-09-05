import type {
  LocalRuntimesResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createComputerFileAccessRpc } from "../src/computers/computer-file-access-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import { requireCurrentLocalRuntimeServiceTarget } from "../src/rpc/current-local-control-target";

const CONTEXT: OpenMeldRequestContext = {
  actorContext: {
    callerPrincipalId: "owner-1",
    ownerUserId: "owner-1",
    profileKind: "human",
    profileName: "Felix",
    requestId: "request-1",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
  },
};

const LOCAL_RUNTIME_INVENTORY = {
  currentConnectedComputerId: "computer-current",
  currentDeviceId: "device-current",
  currentRuntimeLane: "dev-local",
  legacyDeviceEvidence: [],
  localRuntimes: [
    {
      connectedComputerId: "computer-current",
      connectionStatus: "connected",
      deviceDisplayName: "Felix's MacBook Pro",
      deviceDisplayNameSource: "observed",
      deviceId: "device-current",
      deviceType: "laptop",
      executionTargets: [],
      firstSeenAtMs: 0,
      isCurrent: true,
      lastObservedAtMs: 100,
      legacyDeviceIds: ["device-current"],
      osVersion: "26.0",
      platformFamily: "macOS",
    },
  ],
} satisfies LocalRuntimesResponse;

function createHarness() {
  const readPolicy = vi.fn().mockResolvedValue({
    deviceId: "device-current",
    policy: { mode: "local_agent_settings", revision: 1, updatedAtMs: 0 },
  });
  const updatePolicy = vi.fn().mockResolvedValue({
    deviceId: "device-current",
    policy: {
      folders: ["/Users/felix/work"],
      mode: "only_selected_folders",
      revision: 2,
      updatedAtMs: 100,
    },
  });
  return {
    readPolicy,
    rpc: createComputerFileAccessRpc({
      readPolicy,
      requireOwnerUserId: () => "owner-1",
      resolveCurrentTarget: vi.fn().mockResolvedValue({
        deviceId: "device-current",
        runtimeLane: "dev-local",
      }),
      updatePolicy,
    }),
    updatePolicy,
  };
}

describe("Computer file access RPC", () => {
  it("reads policy only from the exact current Computer target", async () => {
    const { readPolicy, rpc } = createHarness();

    await expect(
      rpc.readPolicy({} as CoreBindings, {
        context: CONTEXT,
        expectedDeviceId: "device-current",
      })
    ).resolves.toMatchObject({ deviceId: "device-current" });

    expect(readPolicy).toHaveBeenCalledWith({
      deviceId: "device-current",
      env: {},
      ownerUserId: "owner-1",
      request: { expectedDeviceId: "device-current" },
      runtimeLane: "dev-local",
    });
  });

  it("rejects a stale Computer selection before calling Runtime Transport", async () => {
    const { readPolicy, rpc } = createHarness();

    await expect(
      rpc.readPolicy({} as CoreBindings, {
        context: CONTEXT,
        expectedDeviceId: "device-stale",
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "computer.file_access.device_mismatch",
        status: 409,
      }),
    });
    expect(readPolicy).not.toHaveBeenCalled();
  });

  it("forwards a canonical owner-scoped policy update", async () => {
    const { rpc, updatePolicy } = createHarness();

    await rpc.updatePolicy({} as CoreBindings, {
      context: CONTEXT,
      expectedDeviceId: "device-current",
      expectedRevision: 1,
      idempotencyKey: "save-1",
      policy: {
        folders: ["/Users/felix/work"],
        mode: "only_selected_folders",
      },
    });

    expect(updatePolicy).toHaveBeenCalledWith({
      deviceId: "device-current",
      env: {},
      ownerUserId: "owner-1",
      request: {
        expectedDeviceId: "device-current",
        expectedRevision: 1,
        idempotencyKey: "save-1",
        policy: {
          folders: ["/Users/felix/work"],
          mode: "only_selected_folders",
        },
      },
      runtimeLane: "dev-local",
    });
  });

  it("returns revision conflicts as an owner-refreshable HTTP conflict", async () => {
    const { rpc, updatePolicy } = createHarness();
    updatePolicy.mockResolvedValueOnce({
      code: "computer.file_access.revision_mismatch",
      message:
        "File access changed on this computer. Refresh Computers and try again.",
      status: "rejected",
    });

    await expect(
      rpc.updatePolicy({} as CoreBindings, {
        context: CONTEXT,
        expectedDeviceId: "device-current",
        expectedRevision: 1,
        idempotencyKey: "stale-save",
        policy: { mode: "local_agent_settings" },
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "computer.file_access.revision_mismatch",
        status: 409,
      }),
    });
  });

  it("reads and saves through an online Computer with no execution target", async () => {
    const readPolicy = vi.fn().mockResolvedValue({
      deviceId: "device-current",
      policy: { mode: "local_agent_settings", revision: 1, updatedAtMs: 0 },
    });
    const updatePolicy = vi.fn().mockResolvedValue({
      deviceId: "device-current",
      policy: { mode: "local_agent_settings", revision: 2, updatedAtMs: 100 },
    });
    const rpc = createComputerFileAccessRpc({
      readPolicy,
      requireOwnerUserId: () => "owner-1",
      resolveCurrentTarget: () =>
        Promise.resolve(
          requireCurrentLocalRuntimeServiceTarget({
            bindingTarget: {
              availability: "resolved",
              deviceId: "device-current",
              runtimeLane: "dev-local",
            },
            inventory: LOCAL_RUNTIME_INVENTORY,
            offlineError: {
              code: "computer.file_access.service_offline",
              reason: "This computer isn't reachable for OpenMeld right now.",
              status: 503,
            },
            ownerService: {
              online: true,
              sessions: [
                {
                  capabilities: {
                    computerFileAccess: {
                      readPolicy: true,
                      updatePolicy: true,
                    },
                  },
                  connectionGeneration: 1,
                  daemonSessionId: "daemon-session-current",
                  deviceId: "device-current",
                  executionCompatibility: {
                    expectedEpoch:
                      "runtime-transport-epoch-2026-07-default-project",
                    observedEpoch:
                      "runtime-transport-epoch-2026-07-default-project",
                    reasonCode: "daemon.runtime_contract.compatible",
                    status: "compatible",
                  },
                  lane: "dev-local",
                  lastHeartbeatMs: 100,
                },
              ],
            },
          })
        ),
      updatePolicy,
    });

    await rpc.readPolicy({} as CoreBindings, {
      context: CONTEXT,
      expectedDeviceId: "device-current",
    });
    await rpc.updatePolicy({} as CoreBindings, {
      context: CONTEXT,
      expectedDeviceId: "device-current",
      expectedRevision: 1,
      idempotencyKey: "save-without-target",
      policy: { mode: "local_agent_settings" },
    });

    expect(readPolicy).toHaveBeenCalledOnce();
    expect(updatePolicy).toHaveBeenCalledOnce();
  });
});
