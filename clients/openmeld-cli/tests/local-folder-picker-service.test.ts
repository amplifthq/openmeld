import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLocalFolderPickerService } from "../src/local-service/folder-picker/local-folder-picker-service";

const REQUEST = {
  allowMultiple: true,
  expectedDeviceId: "device-current",
  purpose: "computer_file_access" as const,
};

describe("Local Folder Picker service", () => {
  it("attaches the current Computer identity to selected paths", async () => {
    const selectedPath = await mkdtemp(join(tmpdir(), "openmeld-picker-"));
    const runHelper = vi.fn().mockResolvedValue({
      paths: [selectedPath],
      status: "selected",
    });
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper,
    });

    try {
      expect(service.available).toBe(true);
      await expect(service.selectFolders(REQUEST)).resolves.toEqual({
        deviceId: "device-current",
        paths: [selectedPath],
        status: "selected",
      });
      expect(runHelper).toHaveBeenCalledWith(
        expect.objectContaining({
          allowMultiple: true,
          purpose: "computer_file_access",
        })
      );
    } finally {
      await rm(selectedPath, { recursive: true });
    }
  });

  it("keeps cancellation quiet and path-free", async () => {
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn().mockResolvedValue({ status: "cancelled" }),
    });

    await expect(service.selectFolders(REQUEST)).resolves.toEqual({
      deviceId: "device-current",
      status: "cancelled",
    });
  });

  it("allows only one native picker at a time", async () => {
    let finishFirst: ((value: { status: "cancelled" }) => void) | undefined;
    const first = new Promise<{ status: "cancelled" }>((resolve) => {
      finishFirst = resolve;
    });
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn().mockReturnValue(first),
    });

    const pending = service.selectFolders(REQUEST);
    await expect(service.selectFolders(REQUEST)).resolves.toEqual({
      code: "local.folder_picker.picker_busy",
      message:
        "A folder picker is already open on this computer. Finish or close it, then try again.",
      status: "unavailable",
    });
    finishFirst?.({ status: "cancelled" });
    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
  });

  it("waits for the active helper to close during Service shutdown", async () => {
    let helperClosed = false;
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn(
        async ({ signal }: { signal: AbortSignal }) =>
          await new Promise<{ status: "cancelled" }>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                helperClosed = true;
                resolve({ status: "cancelled" });
              },
              { once: true }
            );
          })
      ),
    });

    const selection = service.selectFolders(REQUEST);
    await service.close();

    expect(helperClosed).toBe(true);
    await expect(selection).resolves.toMatchObject({ status: "cancelled" });
  });

  it("fails closed when the helper returns an invalid path", async () => {
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn().mockResolvedValue({
        paths: ["relative/path"],
        status: "selected",
      }),
    });

    await expect(service.selectFolders(REQUEST)).resolves.toEqual({
      code: "local.folder_picker.invalid_response",
      message: "OpenMeld received an invalid response from the folder picker.",
      status: "unavailable",
    });
  });

  it("fails closed when the helper returns a file instead of a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-picker-"));
    const selectedPath = join(root, "not-a-folder.txt");
    await writeFile(selectedPath, "not a folder", "utf8");
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn().mockResolvedValue({
        paths: [selectedPath],
        status: "selected",
      }),
    });

    try {
      await expect(service.selectFolders(REQUEST)).resolves.toEqual({
        code: "local.folder_picker.invalid_response",
        message:
          "OpenMeld received an invalid response from the folder picker.",
        status: "unavailable",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when a selected directory disappears before validation", async () => {
    const selectedPath = await mkdtemp(join(tmpdir(), "openmeld-picker-"));
    await rm(selectedPath, { recursive: true });
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn().mockResolvedValue({
        paths: [selectedPath],
        status: "selected",
      }),
    });

    await expect(service.selectFolders(REQUEST)).resolves.toEqual({
      code: "local.folder_picker.invalid_response",
      message: "OpenMeld received an invalid response from the folder picker.",
      status: "unavailable",
    });
  });

  it("maps helper failures to fixed path-free messages at the Service boundary", async () => {
    const selectedPath = "/Users/felix/Secret Work";
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn().mockResolvedValue({
        code: "local.folder_picker.internal_error",
        status: "unavailable",
      }),
    });

    const result = await service.selectFolders(REQUEST);
    expect(result).toEqual({
      code: "local.folder_picker.internal_error",
      message: "OpenMeld couldn’t open the folder picker. Try again.",
      status: "unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(selectedPath);
  });

  it("rejects helper payloads that try to attach a path-bearing message", async () => {
    const selectedPath = "/Users/felix/Secret Work";
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: vi.fn().mockResolvedValue({
        code: "local.folder_picker.internal_error",
        message: `native failure near ${selectedPath}`,
        status: "unavailable",
      }),
    });

    const result = await service.selectFolders(REQUEST);
    expect(result).toEqual({
      code: "local.folder_picker.invalid_response",
      message: "OpenMeld received an invalid response from the folder picker.",
      status: "unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(selectedPath);
  });

  it("does not advertise a picker when no native helper is available", () => {
    const service = createLocalFolderPickerService({
      deviceId: "device-current",
      runHelper: null,
    });

    expect(service.available).toBe(false);
  });
});
