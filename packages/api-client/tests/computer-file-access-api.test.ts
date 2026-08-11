import { describe, expect, it, vi } from "vitest";
import {
  createComputerFileAccessApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

const FULL_FOLDER_PATH_PATTERN = /full folder path/i;

describe("api-client Computer file access API", () => {
  it("uses owner-current read and update routes without organization scope", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            deviceId: "device-1",
            policy: {
              mode: "local_agent_settings",
              revision: 1,
              updatedAtMs: 0,
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    );
    const api = createComputerFileAccessApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.readPolicy({ expectedDeviceId: "device-1" });
    await api.updatePolicy({
      expectedDeviceId: "device-1",
      expectedRevision: 1,
      idempotencyKey: "save-1",
      policy: { mode: "local_agent_settings" },
    });

    expect(
      transport.mock.calls.map(([call]) => ({
        body: call.init?.body,
        method: call.init?.method,
        operation: call.operation,
        url: call.url,
      }))
    ).toEqual([
      {
        body: undefined,
        method: "GET",
        operation: "computer-file-access.read",
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/file-access?expectedDeviceId=device-1",
      },
      {
        body: JSON.stringify({
          expectedDeviceId: "device-1",
          expectedRevision: 1,
          idempotencyKey: "save-1",
          policy: { mode: "local_agent_settings" },
        }),
        method: "PUT",
        operation: "computer-file-access.update",
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/file-access",
      },
    ]);
  });

  it("rejects a relative path before transport", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>();
    const api = createComputerFileAccessApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.updatePolicy({
        expectedDeviceId: "device-1",
        expectedRevision: 1,
        idempotencyKey: "save-1",
        policy: {
          folders: ["relative/path"],
          mode: "only_selected_folders",
        },
      })
    ).rejects.toThrow(FULL_FOLDER_PATH_PATTERN);
    expect(transport).not.toHaveBeenCalled();
  });
});
