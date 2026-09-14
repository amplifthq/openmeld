import { beforeEach, describe, expect, it, vi } from "vitest";
import { createComputerConnection } from "../src/main/computer-connection";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  install: vi.fn(),
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.exec }),
    spawn: vi.fn(),
  };
});
vi.mock("../src/main/cli/managed-binary", () => ({
  installManagedBinary: mocks.install,
}));

describe("Desktop computer connection admission", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    "same_account",
    "cancel_switch",
    "changed_account",
    "unexpected_field",
    "unreadable_connection",
    "missing_tools",
  ] as const)("keeps connection intent and account boundaries: %s", async (scenario) => {
    const cloudRequest = vi.fn();
    const confirmSwitch = vi.fn(async () => false);
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        protocol: "computer-connection-v1",
        previousSessionIdentity: "reviewed-session",
        account: {
          id: scenario === "cancel_switch" ? "account-old" : "account-a",
          email: "old@example.com",
        },
        existingConnection: { deviceId: "device-a", runtimeLane: "dev-local" },
      }),
      stderr: "",
    });
    if (scenario === "unreadable_connection") {
      mocks.exec.mockRejectedValueOnce(
        new Error("Connection identity unavailable")
      );
    }
    if (scenario === "missing_tools") {
      mocks.exec.mockRejectedValueOnce(
        Object.assign(new Error("missing"), { code: "ENOENT" })
      );
    }
    const connect = createComputerConnection({
      auth: {
        session: async () => ({
          user: {
            id: scenario === "changed_account" ? "account-b" : "account-a",
            email: "a@example.com",
            name: "A",
          },
        }),
        cloudRequest,
      },
      commandDeps: {
        openMeldBin: "/test-owned/bin/openmeld",
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
          OPENMELD_HOME: "/test-owned",
          OPENMELD_AUTH_URL: "http://lane.localhost:8788",
          OPENMELD_GATEWAY_URL: "http://lane.localhost:8080",
        },
      },
      webOrigin: "http://lane.localhost:3000",
      webBuild: "build",
      installed: false,
      ensureCompatible: async () => undefined,
      confirmSwitch,
    });
    const result = connect({
      expectedAccount: "account-a",
      ...(scenario === "unexpected_field" ? { command: "arbitrary" } : {}),
    });
    if (scenario === "same_account" || scenario === "missing_tools") {
      await expect(result).resolves.toEqual({
        status: "reused",
        connection: { deviceId: "device-a", runtimeLane: "dev-local" },
      });
      expect(confirmSwitch).not.toHaveBeenCalled();
    } else if (scenario === "cancel_switch") {
      await expect(result).resolves.toEqual({ status: "cancelled" });
      expect(confirmSwitch).toHaveBeenCalledWith(
        "old@example.com",
        "a@example.com"
      );
    } else if (scenario === "unreadable_connection") {
      await expect(result).rejects.toThrow("Connection identity unavailable");
    } else {
      await expect(result).rejects.toThrow();
      expect(mocks.exec).not.toHaveBeenCalled();
    }
    expect(cloudRequest).not.toHaveBeenCalled();
    if (scenario === "missing_tools") {
      expect(mocks.install).toHaveBeenCalledOnce();
    } else {
      expect(mocks.install).not.toHaveBeenCalled();
    }
  });
});
