import { afterEach, expect, it, vi } from "vitest";
import { readComputerConnection } from "../src/main/computer-connection";
import { createLocalComputerReader } from "../src/main/local-computer";

vi.mock("../src/main/computer-connection", () => ({
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
  "aligned",
  "account mismatch",
  "account changed",
  "disconnected",
])("reads native identity without mutating the Service: %s", async (scenario) => {
  vi.mocked(readComputerConnection).mockResolvedValue({
    protocol: "computer-connection-v1",
    previousSessionIdentity: "not-for-renderer",
    account: {
      id: scenario === "account mismatch" ? "owner-b" : user.id,
      email: user.email,
    },
    existingConnection:
      scenario === "disconnected"
        ? null
        : { deviceId: "mac-a", runtimeLane: "dev-local" },
  });
  const session = vi.fn().mockResolvedValue({ user });
  if (scenario === "account changed") {
    session
      .mockResolvedValueOnce({ user })
      .mockResolvedValue({ user: { ...user, id: "owner-b" } });
  }
  const result = await createLocalComputerReader({ session }, deps)();
  expect(result.status).toBe(
    scenario === "aligned" ? "available" : "unavailable"
  );
  expect(result).not.toHaveProperty("previousSessionIdentity");
  expect(readComputerConnection).toHaveBeenCalledWith("/test/openmeld", deps);
});

it("does not read the user's default lane from an unconfigured test build", async () => {
  const result = await createLocalComputerReader({ session: vi.fn() }, {})();
  expect(result.status).toBe("unavailable");
  expect(readComputerConnection).not.toHaveBeenCalled();
});
