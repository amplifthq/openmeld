import { beforeEach, describe, expect, it, vi } from "vitest";

const { readPolicy, writePolicy } = vi.hoisted(() => ({
  readPolicy: vi.fn(),
  writePolicy: vi.fn(),
}));

vi.mock(
  "../src/local-service/maintenance/openmeld-tools-maintenance-policy",
  () => ({
    readOpenMeldToolsMaintenancePolicy: readPolicy,
    writeOpenMeldToolsMaintenancePolicy: writePolicy,
  })
);

import { handleOpenMeldToolsControlRequest } from "../src/local-service/maintenance/openmeld-tools-control-handler";

describe("OpenMeld Tools control handler", () => {
  beforeEach(() => {
    readPolicy.mockReset();
    writePolicy.mockReset();
  });

  it("uses the background coordinator for Web update requests", async () => {
    const requestUpdate = vi.fn(async () => ({
      currentVersion: "0.3.104",
      status: "current" as const,
    }));

    await expect(
      handleOpenMeldToolsControlRequest({
        coordinator: {
          requestUpdate,
          resumePendingUpdate: vi.fn(),
          waitForIdle: vi.fn(),
        },
        request: { operation: "request_update", requestSource: "web" },
      })
    ).resolves.toEqual({
      operation: "request_update",
      result: { currentVersion: "0.3.104", status: "current" },
    });
    expect(requestUpdate).toHaveBeenCalledWith({ requestSource: "web" });
  });

  it("writes the automatic update setting only when it changes", async () => {
    readPolicy.mockResolvedValue({ automaticUpdatesEnabled: true });
    writePolicy.mockResolvedValue(undefined);

    await expect(
      handleOpenMeldToolsControlRequest({
        coordinator: {
          requestUpdate: vi.fn(),
          resumePendingUpdate: vi.fn(),
          waitForIdle: vi.fn(),
        },
        request: {
          automaticUpdatesEnabled: false,
          operation: "set_automatic_updates",
          requestSource: "center_agent",
        },
      })
    ).resolves.toEqual({
      operation: "set_automatic_updates",
      result: { automaticUpdatesEnabled: false, status: "updated" },
    });
    expect(writePolicy).toHaveBeenCalledWith({
      automaticUpdatesEnabled: false,
    });
  });
});
