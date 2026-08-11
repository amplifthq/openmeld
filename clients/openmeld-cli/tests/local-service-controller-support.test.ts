import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfiguredDeviceRuntimeStateMock } = vi.hoisted(() => ({
  getConfiguredDeviceRuntimeStateMock: vi.fn(),
}));

vi.mock("../src/config/runtime-config", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/runtime-config")
  >("../src/config/runtime-config");
  return {
    ...actual,
    getConfiguredDeviceRuntimeState: getConfiguredDeviceRuntimeStateMock,
  };
});

import { readLocalEnabledControllers } from "../src/local-service/routing/resolve-controller-support";

describe("readLocalEnabledControllers", () => {
  beforeEach(() => {
    getConfiguredDeviceRuntimeStateMock.mockReset();
  });

  it("throws when runtime state cannot be read", async () => {
    getConfiguredDeviceRuntimeStateMock.mockRejectedValue(
      new Error("runtime config unavailable")
    );

    await expect(readLocalEnabledControllers()).rejects.toThrow(
      "runtime config unavailable"
    );
  });

  it("returns normalized controller map when runtime state is available", async () => {
    getConfiguredDeviceRuntimeStateMock.mockResolvedValue({
      controllers: [
        {
          agentId: " codex ",
          enabled: true,
          transportMode: "local-cli",
        },
      ],
    });

    const controllers = await readLocalEnabledControllers();

    expect(controllers.size).toBe(1);
    expect(controllers.get("codex")).toMatchObject({
      agentId: " codex ",
      enabled: true,
      transportMode: "local-cli",
    });
  });
});
