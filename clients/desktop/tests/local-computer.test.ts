import { afterEach, expect, it, vi } from "vitest";
import { serviceStatus } from "../src/main/cli/commands";
import { readComputerConnection } from "../src/main/computer-connection";
import {
  createLocalComputerReader,
  createLocalServiceAuthenticationReader,
} from "../src/main/local-computer";

vi.mock("../src/main/cli/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/cli/commands")>()),
  serviceStatus: vi.fn(),
}));

vi.mock("../src/main/computer-connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/computer-connection")>()),
  readComputerConnection: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
const deps = {
  env: {
    OPENMELD_HOME: "/test/disposable",
    OPENMELD_AUTH_URL: "http://test.localhost:3001",
    OPENMELD_GATEWAY_URL: "http://test.localhost:3002",
  },
  openMeldBin: "/test/openmeld",
};
const user = { id: "owner-a", email: "a@example.com", name: "A" };

it.each([
  "auth rejected",
  "network failure",
  "stopped",
  "different account",
  "account changed",
])("requires local authentication evidence for the current account: %s", async (scenario) => {
  const session = vi.fn().mockResolvedValue({ user });
  if (scenario === "account changed") {
    session
      .mockResolvedValueOnce({ user })
      .mockResolvedValue({ user: { ...user, id: "owner-b" } });
  }
  vi.mocked(readComputerConnection).mockResolvedValue({
    protocol: "computer-connection-v1",
    previousSessionIdentity: "private",
    account: {
      id: scenario === "different account" ? "owner-b" : user.id,
      email: user.email,
    },
    existingConnection: null,
  });
  vi.mocked(serviceStatus).mockResolvedValue({
    ok: true,
    type: "daemon.status",
    exitCode: 0,
    data: {
      result: {
        installed: true,
        runtime: { status: scenario === "stopped" ? "not_running" : "running" },
      },
      attention:
        scenario === "network failure"
          ? null
          : { code: "authentication_required" },
    },
  });
  await expect(
    createLocalServiceAuthenticationReader({ session }, deps)(user.id)
  ).resolves.toBe(scenario === "auth rejected");
  if (scenario === "different account") {
    expect(serviceStatus).not.toHaveBeenCalled();
  }
});

it.each([
  "aligned",
  "account mismatch",
  "account changed",
  "disconnected",
  "signed out",
  "read failed",
])("reads native identity without mutating the Service: %s", async (scenario) => {
  vi.mocked(readComputerConnection).mockResolvedValue({
    protocol: "computer-connection-v1",
    previousSessionIdentity: "not-for-renderer",
    account:
      scenario === "signed out"
        ? null
        : {
            id: scenario === "account mismatch" ? "owner-b" : user.id,
            email: user.email,
          },
    existingConnection:
      scenario === "disconnected"
        ? null
        : { deviceId: "mac-a", runtimeLane: "dev-local" },
  });
  const session = vi.fn().mockResolvedValue({ user });
  if (scenario === "read failed") {
    vi.mocked(readComputerConnection).mockRejectedValue(
      new Error("CLI unavailable")
    );
    await expect(
      createLocalComputerReader({ session }, deps)()
    ).resolves.toEqual({
      status: "unavailable",
      message:
        "Couldn’t check this Mac’s connection. Check its OpenMeld Service and try again.",
    });
    return;
  }
  if (scenario === "account changed") {
    session
      .mockResolvedValueOnce({ user })
      .mockResolvedValue({ user: { ...user, id: "owner-b" } });
    await expect(
      createLocalComputerReader({ session }, deps)()
    ).resolves.toEqual({
      status: "unavailable",
      message:
        "Couldn’t check this Mac’s connection. Check its OpenMeld Service and try again.",
    });
    return;
  }
  const result = await createLocalComputerReader({ session }, deps)();
  expect(result.status).toBe(
    scenario === "aligned" ? "available" : "unavailable"
  );
  expect(result).not.toHaveProperty("previousSessionIdentity");
  expect(readComputerConnection).toHaveBeenCalledWith("/test/openmeld", deps, {
    includeStopped: true,
  });
  if (scenario === "signed out") {
    expect(result).toMatchObject({
      status: "unavailable",
      message: "Use local agents in OpenMeld, even after you quit Desktop.",
    });
  }
});

it("does not read the user's default lane from an unconfigured test build", async () => {
  const result = await createLocalComputerReader({ session: vi.fn() }, {})();
  expect(result.status).toBe("unavailable");
  expect(readComputerConnection).not.toHaveBeenCalled();
});
