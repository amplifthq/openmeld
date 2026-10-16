import { beforeEach, expect, it, vi } from "vitest";
import { readComputerConnectionReview } from "../src/commands/computer-connection-review";

const owners = vi.hoisted(() => ({
  session: vi.fn(),
  auth: vi.fn(),
  contract: vi.fn(),
  identity: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock("../src/config/auth-session", () => ({
  getAuthSessionMetadata: owners.session,
  getAuthSessionState: owners.auth,
  buildStoredAuthSessionIdentity: () => "review-session",
}));
vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: owners.contract,
}));
vi.mock("../src/local-service/lifecycle/service-account-authorization", () => ({
  resolveServiceAccountIdentity: owners.identity,
}));
vi.mock("../src/commands/service-control-capabilities", () => ({
  readServiceControlCapabilities: owners.capabilities,
}));

beforeEach(() => {
  vi.resetAllMocks();
  const session = { user: { id: "owner-a", email: "a@example.test" } };
  owners.session.mockResolvedValue(session);
  owners.auth.mockResolvedValue({ state: "valid", session });
  owners.contract.mockResolvedValue({ ownerUserId: "owner-a" });
  owners.identity.mockResolvedValue({ deviceId: "mac-a", lane: "dev-local" });
});

it.each([
  { includeStopped: false, start: true, stop: false, available: false },
  { includeStopped: true, start: true, stop: false, available: true },
  { includeStopped: false, start: false, stop: true, available: true },
  { includeStopped: true, start: false, stop: false, available: false },
])("preserves Connect reuse while admitting verified stopped recovery: %j", async ({
  includeStopped,
  start,
  stop,
  available,
}) => {
  owners.capabilities.mockResolvedValue({ deviceId: "mac-a", start, stop });
  const review = await readComputerConnectionReview({ includeStopped });
  expect(review.existingConnection).toEqual(
    available ? { deviceId: "mac-a", runtimeLane: "dev-local" } : null
  );
});

it.each([
  "account",
  "device",
  "expired authentication",
])("does not admit stopped recovery with mismatched %s", async (mismatch) => {
  owners.capabilities.mockResolvedValue({
    deviceId: mismatch === "device" ? "mac-b" : "mac-a",
    start: true,
    stop: false,
  });
  if (mismatch === "account") {
    owners.contract.mockResolvedValue({ ownerUserId: "owner-b" });
  }
  if (mismatch === "expired authentication") {
    owners.auth.mockResolvedValue({ state: "expired", session: null });
  }
  expect(
    (await readComputerConnectionReview({ includeStopped: true }))
      .existingConnection
  ).toBeNull();
});
