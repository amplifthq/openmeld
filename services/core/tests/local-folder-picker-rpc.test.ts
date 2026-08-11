import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createLocalFolderPickerRpc } from "../src/computers/local-folder-picker-rpc";
import type { CoreBindings } from "../src/lib/bindings";

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

function createHarness() {
  const selectFolders = vi.fn().mockResolvedValue({
    deviceId: "device-current",
    paths: ["/Users/felix/Design Work"],
    status: "selected",
  });
  const resolveCurrentTarget = vi.fn().mockResolvedValue({
    deviceId: "device-current",
    runtimeLane: "dev-local",
  });
  return {
    resolveCurrentTarget,
    rpc: createLocalFolderPickerRpc({
      requireOwnerUserId: () => "owner-1",
      resolveCurrentTarget,
      selectFolders,
    }),
    selectFolders,
  };
}

describe("Local Folder Picker RPC", () => {
  it("selects folders only on the exact current Computer", async () => {
    const { rpc, selectFolders } = createHarness();

    await expect(
      rpc.selectFolders({} as CoreBindings, {
        allowMultiple: true,
        context: CONTEXT,
        expectedDeviceId: "device-current",
        purpose: "computer_file_access",
      })
    ).resolves.toEqual({
      deviceId: "device-current",
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    });

    expect(selectFolders).toHaveBeenCalledWith({
      deviceId: "device-current",
      env: {},
      ownerUserId: "owner-1",
      request: {
        allowMultiple: true,
        expectedDeviceId: "device-current",
        purpose: "computer_file_access",
      },
      runtimeLane: "dev-local",
    });
  });

  it("rejects a stale Computer selection before Runtime Transport", async () => {
    const { rpc, selectFolders } = createHarness();

    await expect(
      rpc.selectFolders({} as CoreBindings, {
        allowMultiple: false,
        context: CONTEXT,
        expectedDeviceId: "device-stale",
        purpose: "project_connection",
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "local.folder_picker.device_mismatch",
        status: 409,
      }),
    });
    expect(selectFolders).not.toHaveBeenCalled();
  });

  it("returns closing the native picker as a normal no-change result", async () => {
    const { rpc, selectFolders } = createHarness();
    selectFolders.mockResolvedValueOnce({
      deviceId: "device-current",
      status: "cancelled",
    });

    await expect(
      rpc.selectFolders({} as CoreBindings, {
        allowMultiple: false,
        context: CONTEXT,
        expectedDeviceId: "device-current",
        purpose: "agent_profile_working_folder",
      })
    ).resolves.toEqual({
      deviceId: "device-current",
      status: "cancelled",
    });
  });

  it("returns a Service capability race as an explicit unavailable result", async () => {
    const { rpc, selectFolders } = createHarness();
    selectFolders.mockResolvedValueOnce({
      code: "local.folder_picker.service_update_required",
      message: "Update OpenMeld Service to choose folders on this computer.",
      status: "unavailable",
    });

    await expect(
      rpc.selectFolders({} as CoreBindings, {
        allowMultiple: true,
        context: CONTEXT,
        expectedDeviceId: "device-current",
        purpose: "computer_file_access",
      })
    ).resolves.toMatchObject({
      code: "local.folder_picker.service_update_required",
      status: "unavailable",
    });
  });
});
