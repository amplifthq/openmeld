import { prepareSessionWithTokenResponseSchema } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createComputerConnection } from "../src/main/computer-connection";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  install: vi.fn(),
  grant: vi.fn(),
}));
vi.mock("@openmeld/api-client", () => ({
  createComputerAuthorizationGrant: mocks.grant,
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.exec }),
    spawn: vi.fn(() => {
      throw new Error("Test executable unavailable");
    }),
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
    "fresh_session",
    "source_action",
  ] as const)("keeps connection intent and account boundaries: %s", async (scenario) => {
    const cloudRequest = vi.fn();
    if (scenario === "fresh_session" || scenario === "source_action") {
      cloudRequest.mockRejectedValue(new Error("Prepare requested"));
    }
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
      ...(scenario === "fresh_session" ? { resetThisComputer: true } : {}),
      ...(scenario === "source_action"
        ? {
            sourceNavigationAction: {
              spaceId: "space-a",
              signalId: "signal-a",
            },
          }
        : {}),
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
    } else if (scenario === "fresh_session" || scenario === "source_action") {
      await expect(result).rejects.toThrow("Prepare requested");
    } else if (scenario === "unreadable_connection") {
      await expect(result).rejects.toThrow("Connection identity unavailable");
    } else {
      await expect(result).rejects.toThrow();
      expect(mocks.exec).not.toHaveBeenCalled();
    }
    if (scenario === "fresh_session" || scenario === "source_action") {
      expect(cloudRequest).toHaveBeenCalledOnce();
    } else {
      expect(cloudRequest).not.toHaveBeenCalled();
    }
    if (scenario === "missing_tools") {
      expect(mocks.install).toHaveBeenCalledOnce();
    } else {
      expect(mocks.install).not.toHaveBeenCalled();
    }
  });
});

describe("Prepare diagnostic continuity", () => {
  it.each([
    "grant",
    "account",
    "snapshot",
  ] as const)("keeps the established diagnostic ID when %s fails", async (failure) => {
    const date = "2026-09-14T00:00:00.000Z";
    const prepare = prepareSessionWithTokenResponseSchema.parse({
      opaqueToken: "prepare-token",
      opaqueTokenExpiresAt: date,
      snapshot: {
        prepareSessionId: "prepare-a",
        ownerUserId: "account-a",
        humanProfileId: null,
        deviceId: null,
        runtimeLane: null,
        targetSpaceId: null,
        sessionRevision: 0,
        lifecycleStatus: "active",
        phase: "waiting_for_terminal",
        steps: [],
        selectedLocalAgentIds: [],
        blockers: [],
        diagnosticCorrelationId: "diagnostic-a",
        createdAt: date,
        updatedAt: date,
        expiresAt: date,
        completedAt: null,
        terminalConnection: {
          status: "never_connected",
          connectionId: null,
          connectionEpoch: null,
          connectedAt: null,
          lastSeenAt: null,
          disconnectedAt: null,
          disconnectReason: null,
        },
      },
    });
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        protocol: "computer-connection-v1",
        previousSessionIdentity: "missing",
        account: null,
        existingConnection: null,
      }),
    });
    const session = vi.fn().mockResolvedValue({
      user: { id: "account-a", email: "a@example.com", name: "A" },
    });
    mocks.grant.mockImplementation(() => {
      if (failure === "grant") {
        throw new Error("Grant failed");
      }
      if (failure === "account") {
        session.mockRejectedValue(new Error("Account unavailable"));
      }
      return { deviceCode: "device-code", expiresIn: 60 };
    });
    const cloudRequest = vi
      .fn()
      .mockResolvedValueOnce(Response.json(prepare))
      .mockRejectedValue(new Error("Snapshot unavailable"));
    const connect = createComputerConnection({
      auth: { session, cloudRequest },
      commandDeps: {
        openMeldBin: "/test-owned/openmeld",
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
      confirmSwitch: async () => false,
    });
    const result = await connect({ expectedAccount: "account-a" });
    expect(result).toMatchObject({
      status: "failed",
      diagnosticId: "diagnostic-a",
      message: {
        grant: "Grant failed",
        account: "Account unavailable",
        snapshot: "Snapshot unavailable",
      }[failure],
    });
  });
});
