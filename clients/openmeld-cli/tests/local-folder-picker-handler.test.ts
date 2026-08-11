import { describe, expect, it, vi } from "vitest";
import { handleLocalFolderPickerFrame } from "../src/local-service/folder-picker/local-folder-picker-handler";

const FRAME = {
  code: "daemon.local_folder_picker.select_folders" as const,
  payload: {
    request: {
      allowMultiple: true,
      expectedDeviceId: "device-current",
      purpose: "computer_file_access" as const,
    },
    requestId: "picker-1",
  },
  v: 1 as const,
};

describe("Local Folder Picker handler", () => {
  it("returns selected folders without storing or reading their contents", async () => {
    const selectFolders = vi.fn().mockResolvedValue({
      deviceId: "device-current",
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    });

    await expect(
      handleLocalFolderPickerFrame({
        deviceId: "device-current",
        frame: FRAME,
        selectFolders,
      })
    ).resolves.toEqual({
      code: "daemon.local_folder_picker.select_folders_result",
      payload: {
        requestId: "picker-1",
        result: {
          deviceId: "device-current",
          paths: ["/Users/felix/Design Work"],
          status: "selected",
        },
      },
      v: 1,
    });
    expect(selectFolders).toHaveBeenCalledWith(FRAME.payload.request);
  });

  it("keeps closing the native picker as a normal no-change result", async () => {
    await expect(
      handleLocalFolderPickerFrame({
        deviceId: "device-current",
        frame: FRAME,
        selectFolders: vi.fn().mockResolvedValue({
          deviceId: "device-current",
          status: "cancelled",
        }),
      })
    ).resolves.toMatchObject({
      payload: {
        result: { deviceId: "device-current", status: "cancelled" },
      },
    });
  });

  it("rejects a stale Computer before opening a native dialog", async () => {
    const selectFolders = vi.fn();

    await expect(
      handleLocalFolderPickerFrame({
        deviceId: "device-other",
        frame: FRAME,
        selectFolders,
      })
    ).resolves.toMatchObject({
      payload: {
        result: {
          code: "local.folder_picker.device_mismatch",
          status: "unavailable",
        },
      },
    });
    expect(selectFolders).not.toHaveBeenCalled();
  });

  it("redacts unexpected native errors to a path-free stable result", async () => {
    const selectedPath = "/Users/felix/Secret Work";

    const result = await handleLocalFolderPickerFrame({
      deviceId: "device-current",
      frame: FRAME,
      selectFolders: vi
        .fn()
        .mockRejectedValue(new Error(`helper failed near ${selectedPath}`)),
    });

    expect(result).toMatchObject({
      payload: {
        result: {
          code: "local.folder_picker.internal_error",
          message: "OpenMeld couldn’t open the folder picker. Try again.",
          status: "unavailable",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(selectedPath);
  });
});
