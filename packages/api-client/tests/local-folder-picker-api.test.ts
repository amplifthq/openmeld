import type { LocalFolderPickerResult } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalFolderPickerApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

const INVALID_PICKER_REQUEST_PATTERN = /folder picker request is invalid/i;

describe("api-client Local Folder Picker API", () => {
  it("routes explicit folder selection to the chosen computer environment", async () => {
    const result: LocalFolderPickerResult = {
      deviceId: "device-1",
      status: "cancelled",
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(Response.json(result))
    );
    const api = createLocalFolderPickerApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    await expect(
      api.selectPeopleComputerFolders({
        deviceId: "device-1",
        runtimeLane: "canary",
        allowMultiple: false,
        purpose: "computer_file_access",
      })
    ).resolves.toEqual(result);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/people-computers/device-1/lanes/canary/folders/select",
        init: expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            allowMultiple: false,
            purpose: "computer_file_access",
          }),
        }),
      })
    );
  });
  it("opens the picker on the exact current Computer", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            deviceId: "device-1",
            paths: ["/Users/felix/Design Work"],
            status: "selected",
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    );
    const api = createLocalFolderPickerApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.selectFolders({
        allowMultiple: true,
        expectedDeviceId: "device-1",
        purpose: "computer_file_access",
        timeoutMs: 600_000,
      })
    ).resolves.toEqual({
      deviceId: "device-1",
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    });

    expect(transport).toHaveBeenCalledOnce();
    const [call] = transport.mock.calls[0] ?? [];
    expect(call).toMatchObject({
      init: {
        body: JSON.stringify({
          allowMultiple: true,
          expectedDeviceId: "device-1",
          purpose: "computer_file_access",
        }),
        method: "POST",
      },
      operation: "local-folder-picker.select-folders",
      timeoutMs: 600_000,
      url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/folder-picker",
    });
  });

  it("treats closing the native picker as a successful no-change result", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ deviceId: "device-1", status: "cancelled" }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    );
    const api = createLocalFolderPickerApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.selectFolders({
        allowMultiple: false,
        expectedDeviceId: "device-1",
        purpose: "agent_profile_working_folder",
      })
    ).resolves.toEqual({ deviceId: "device-1", status: "cancelled" });
  });

  it("rejects an invalid request before transport", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>();
    const api = createLocalFolderPickerApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.selectFolders({
        allowMultiple: false,
        expectedDeviceId: "",
        purpose: "project_connection",
      })
    ).rejects.toThrow(INVALID_PICKER_REQUEST_PATTERN);
    expect(transport).not.toHaveBeenCalled();
  });
});
