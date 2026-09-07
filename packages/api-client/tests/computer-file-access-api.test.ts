import type { ComputerFileAccessPolicyResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createComputerFileAccessApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

const FULL_FOLDER_PATH_PATTERN = /full folder path/i;

describe("api-client Computer file access API", () => {
  it("keeps explicit device and lane in read and write routes without current-target fallback", async () => {
    const response: ComputerFileAccessPolicyResponse = {
      deviceId: "device-1",
      policy: { mode: "local_agent_settings", revision: 1, updatedAtMs: 0 },
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(Response.json(response))
    );
    const api = createComputerFileAccessApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    await api.readPeopleComputerPolicy({
      deviceId: "device-1",
      runtimeLane: "canary",
    });
    await api.updatePeopleComputerPolicy({
      deviceId: "device-1",
      runtimeLane: "canary",
      expectedRevision: 1,
      idempotencyKey: "save-exact",
      policy: { mode: "local_agent_settings" },
    });
    expect(
      transport.mock.calls.map(([call]) => ({
        method: call.init?.method,
        url: call.url,
        body: call.init?.body,
      }))
    ).toEqual([
      {
        method: "GET",
        url: "https://gateway.openmeld.invalid/v1/people-computers/device-1/lanes/canary/file-access",
        body: undefined,
      },
      {
        method: "PUT",
        url: "https://gateway.openmeld.invalid/v1/people-computers/device-1/lanes/canary/file-access",
        body: JSON.stringify({
          expectedRevision: 1,
          idempotencyKey: "save-exact",
          policy: { mode: "local_agent_settings" },
        }),
      },
    ]);
  });
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
