import { type ExecFileException, spawn } from "node:child_process";
import {
  type computerConnectionReviewSchema,
  prepareSessionWithTokenResponseSchema,
} from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComputerConnection,
  createComputerDisconnection,
  readComputerConnection,
} from "../src/main/computer-connection";

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
vi.mock("../src/main/cli/computer-tools", () => ({
  installComputerTools: mocks.install,
}));

describe("Desktop computer connection admission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.install.mockResolvedValue("/test-owned/installed/npm/openmeld.js");
  });
  it.each([
    "unsupported command",
    "authentication failure",
  ])("retries a stopped-identity probe only for compatibility: %s", async (reason) => {
    const error = Object.assign(new Error(reason), {
      code: 1,
      stderr:
        reason === "unsupported command"
          ? "error: unknown command 'connection-review'"
          : "Authentication expired",
    });
    mocks.exec.mockRejectedValueOnce(error).mockResolvedValueOnce({
      stdout: JSON.stringify({
        protocol: "computer-connection-v1",
        previousSessionIdentity: "review-session",
        account: null,
        existingConnection: null,
      }),
    });
    const result = readComputerConnection(
      "/test/openmeld",
      {},
      { includeStopped: true }
    );
    if (reason === "unsupported command") {
      await expect(result).resolves.toMatchObject({ existingConnection: null });
      expect(mocks.exec).toHaveBeenCalledTimes(2);
    } else {
      await expect(result).rejects.toBe(error);
      expect(mocks.exec).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    "cancelled",
    "account changed",
  ])("does not start Disconnect when confirmation is %s", async (scenario) => {
    const session = vi.fn().mockResolvedValue({
      user: { id: "account-a", email: "a@example.com", name: "A" },
    });
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        protocol: "computer-connection-v1",
        previousSessionIdentity: "reviewed-session",
        account: { id: "account-a", email: "a@example.com" },
        existingConnection: { deviceId: "device-a", runtimeLane: "dev-local" },
      }),
    });
    const disconnect = createComputerDisconnection({
      auth: { session },
      commandDeps: {
        openMeldBin: "/test-owned/openmeld",
        env: {
          OPENMELD_HOME: "/test-owned",
          OPENMELD_AUTH_URL: "http://lane.localhost:8788",
          OPENMELD_GATEWAY_URL: "http://lane.localhost:8080",
        },
      },
      confirmDisconnect: () => {
        session.mockResolvedValue({
          user: { id: "account-b", email: "b@example.com", name: "B" },
        });
        return Promise.resolve(scenario !== "cancelled");
      },
    });
    if (scenario === "cancelled") {
      await expect(
        disconnect({ expectedAccount: "account-a" })
      ).resolves.toEqual({
        status: "cancelled",
      });
    } else {
      await expect(
        disconnect({ expectedAccount: "account-a" })
      ).resolves.toMatchObject({ status: "connection_changed" });
    }
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each([
    "account",
    "device",
    "lane",
  ])("does not open confirmation or dispatch Disconnect for a changed %s", async (changed) => {
    const confirmDisconnect = vi.fn();
    const onPhase = vi.fn();
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        protocol: "computer-connection-v1",
        previousSessionIdentity: "reviewed-session",
        account: {
          id: changed === "account" ? "account-b" : "account-a",
          email: null,
        },
        existingConnection: {
          deviceId: changed === "device" ? "device-b" : "device-a",
          runtimeLane: changed === "lane" ? "prod" : "dev-local",
        },
      }),
    });
    const disconnect = createComputerDisconnection({
      auth: {
        session: vi.fn().mockResolvedValue({ user: { id: "account-a" } }),
      },
      commandDeps: {
        openMeldBin: "/test-owned/openmeld",
        env: {
          OPENMELD_HOME: "/test-owned",
          OPENMELD_AUTH_URL: "http://lane.localhost:8788",
          OPENMELD_GATEWAY_URL: "http://lane.localhost:8080",
        },
      },
      confirmDisconnect,
      onPhase,
    });
    await expect(
      disconnect({
        expectedAccount: "account-a",
        expectedConnection: { deviceId: "device-a", runtimeLane: "dev-local" },
      })
    ).resolves.toMatchObject({ status: "connection_changed" });
    expect(onPhase.mock.calls).toEqual([["checking"]]);
    expect(confirmDisconnect).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each([
    "same_account",
    "cancel_switch",
    "changed_account",
    "unexpected_field",
    "unreadable_connection",
    "missing_tools",
    "first_connect_missing_tools",
    "first_connect_legacy_tools",
    "targeted_update_missing_tools",
    "targeted_update_legacy_tools",
    "fresh_session",
    "source_action",
    "reconnect_target",
    "space_target",
    "service_update",
  ] as const)("keeps connection intent and account boundaries: %s", async (scenario) => {
    const cloudRequest = vi.fn();
    const firstConnect = scenario.startsWith("first_connect_");
    const targetedUpdate = scenario.startsWith("targeted_update_");
    const createsPrepare = [
      "fresh_session",
      "source_action",
      "reconnect_target",
      "space_target",
      "service_update",
      "first_connect_missing_tools",
      "first_connect_legacy_tools",
    ].includes(scenario);
    if (createsPrepare) {
      cloudRequest.mockRejectedValue(new Error("Prepare requested"));
    }
    const confirmSwitch = vi.fn(async () => false);
    const onProgress = vi.fn();
    mocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        protocol: "computer-connection-v1",
        previousSessionIdentity: firstConnect ? "missing" : "reviewed-session",
        account: firstConnect
          ? null
          : {
              id: scenario === "cancel_switch" ? "account-old" : "account-a",
              email: "old@example.com",
            },
        existingConnection: firstConnect
          ? null
          : { deviceId: "device-a", runtimeLane: "dev-local" },
      } satisfies ReturnType<typeof computerConnectionReviewSchema.parse>),
      stderr: "",
    });
    if (scenario === "unreadable_connection") {
      mocks.exec.mockRejectedValueOnce(
        new Error("Connection identity unavailable")
      );
    }
    if (scenario.endsWith("missing_tools")) {
      mocks.exec.mockRejectedValueOnce(
        Object.assign(new Error("missing"), { code: "ENOENT" })
      );
    }
    if (scenario.endsWith("legacy_tools")) {
      const failure = Object.assign(new Error("Command failed"), {
        code: 1,
        stdout: "",
        stderr: "error: unknown command 'connection-review'",
      }) satisfies ExecFileException & { stdout: string; stderr: string };
      mocks.exec.mockRejectedValueOnce(failure);
      if (scenario === "targeted_update_legacy_tools") {
        mocks.exec.mockRejectedValueOnce(failure);
      }
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
      onProgress,
    });
    const result = connect({
      expectedAccount: "account-a",
      ...(scenario === "unexpected_field" ? { command: "arbitrary" } : {}),
      ...(scenario === "fresh_session" ? { resetThisComputer: true } : {}),
      ...(scenario === "reconnect_target" || targetedUpdate
        ? { connectedComputerId: "computer-b" }
        : {}),
      ...(scenario === "space_target" ? { targetSpaceId: "space-a" } : {}),
      ...(scenario === "service_update" || targetedUpdate
        ? { serviceAction: "update_service" }
        : {}),
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
    } else if (targetedUpdate) {
      await expect(result).rejects.toThrow(
        "OpenMeld cannot verify this computer. Open Desktop on the selected computer and connect it before updating."
      );
      expect(mocks.grant).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    } else if (createsPrepare) {
      await expect(result).rejects.toThrow("Prepare requested");
    } else if (scenario === "unreadable_connection") {
      await expect(result).rejects.toThrow("Connection identity unavailable");
    } else {
      await expect(result).rejects.toThrow();
      expect(mocks.exec).not.toHaveBeenCalled();
    }
    if (createsPrepare) {
      expect(cloudRequest).toHaveBeenCalledOnce();
      if (scenario === "reconnect_target") {
        const body = cloudRequest.mock.calls[0]?.[1].body;
        expect(JSON.parse(new TextDecoder().decode(body))).toMatchObject({
          connectedComputerId: "computer-b",
        });
      }
    } else {
      expect(cloudRequest).not.toHaveBeenCalled();
    }
    if (scenario === "missing_tools" || firstConnect) {
      expect(mocks.install).toHaveBeenCalledOnce();
      expect(mocks.exec.mock.calls.at(-1)?.[0]).toBe(
        "/test-owned/installed/npm/openmeld.js"
      );
    } else {
      expect(mocks.install).not.toHaveBeenCalled();
    }
    if (scenario !== "unexpected_field") {
      expect(onProgress.mock.calls[0]?.[0]).toMatchObject({
        phase: "checking",
        state: "active",
        sequence: 0,
      });
    }
  });
});

describe("Prepare diagnostic continuity", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    "grant",
    "account",
    "snapshot",
    "target_space",
    "human_profile",
    "computer_device",
    "computer_lane",
    "target_match",
    "service_update",
    "update_wrong_target",
    "update_account_changed",
  ] as const)("keeps the established diagnostic ID when %s fails", async (failure) => {
    const date = "2026-09-14T00:00:00.000Z";
    const prepare = prepareSessionWithTokenResponseSchema.parse({
      opaqueToken: "prepare-token",
      opaqueTokenExpiresAt: date,
      snapshot: {
        prepareSessionId: "prepare-a",
        ownerUserId: "account-a",
        humanProfileId:
          failure === "target_match"
            ? "11111111-1111-4111-8111-111111111111"
            : null,
        deviceId:
          failure === "target_match" ||
          failure === "computer_lane" ||
          failure === "service_update"
            ? "device-a"
            : null,
        runtimeLane:
          failure === "target_match" || failure === "service_update"
            ? "dev-local"
            : null,
        targetSpaceId: failure === "target_match" ? "space-a" : null,
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
        account:
          failure === "target_match" ||
          failure.startsWith("computer_") ||
          failure.startsWith("update_") ||
          failure === "service_update"
            ? { id: "account-a", email: "a@example.com" }
            : null,
        existingConnection:
          failure === "target_match" ||
          failure.startsWith("computer_") ||
          failure.startsWith("update_") ||
          failure === "service_update"
            ? { deviceId: "device-a", runtimeLane: "dev-local" }
            : null,
      }),
    });
    const session = vi.fn().mockResolvedValue({
      user: { id: "account-a", email: "a@example.com", name: "A" },
    });
    mocks.grant.mockImplementation(() => {
      if (failure === "grant" || failure === "service_update") {
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
    if (failure === "update_account_changed") {
      mocks.install.mockImplementationOnce(() => {
        mocks.exec.mockResolvedValue({
          stdout: JSON.stringify({
            protocol: "computer-connection-v1",
            previousSessionIdentity: "changed-session",
            account: { id: "account-b", email: "b@example.com" },
            existingConnection: {
              deviceId: "device-a",
              runtimeLane: "dev-local",
            },
          }),
        });
        return Promise.resolve("/test-owned/installed/npm/openmeld.js");
      });
    }
    const connect = createComputerConnection({
      auth: { session, cloudRequest },
      commandDeps: {
        openMeldBin: "/test-owned/openmeld",
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
          OPENMELD_AUTH_CLIENT_ID: "openmeld-cli-dev",
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
    const result = await connect({
      expectedAccount: "account-a",
      ...(failure === "target_space" || failure === "target_match"
        ? { targetSpaceId: "space-a" }
        : {}),
      ...(failure === "human_profile" || failure === "target_match"
        ? { humanProfileId: "11111111-1111-4111-8111-111111111111" }
        : {}),
      ...(failure.startsWith("computer_") ||
      failure === "target_match" ||
      failure === "service_update"
        ? { connectedComputerId: "computer-a" }
        : {}),
      ...(failure === "update_wrong_target"
        ? { connectedComputerId: "computer-b" }
        : {}),
      ...(failure.startsWith("update_") || failure === "service_update"
        ? { serviceAction: "update_service" }
        : {}),
    });
    if (
      [
        "target_space",
        "human_profile",
        "computer_device",
        "computer_lane",
        "update_wrong_target",
        "update_account_changed",
      ].includes(failure)
    ) {
      expect(mocks.grant).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      if (failure === "update_wrong_target") {
        expect(mocks.install).not.toHaveBeenCalled();
      }
    } else {
      expect(mocks.grant).toHaveBeenCalledWith(expect.any(Function), {
        clientId: "openmeld-cli-dev",
      });
    }
    if (failure === "service_update" || failure === "update_account_changed") {
      expect(mocks.install).toHaveBeenCalledOnce();
    }
    expect(result).toMatchObject({
      status: "failed",
      diagnosticId: "diagnostic-a",
      message: {
        grant: "Grant failed",
        account: "Account unavailable",
        snapshot: "Test executable unavailable",
        target_match: "Test executable unavailable",
        target_space:
          "The connection request does not match this profile, Space, or computer.",
        human_profile:
          "The connection request does not match this profile, Space, or computer.",
        computer_device:
          "The connection request does not match this profile, Space, or computer.",
        computer_lane:
          "The connection request does not match this profile, Space, or computer.",
        service_update: "Grant failed",
        update_wrong_target:
          "The connection request does not match this profile, Space, or computer.",
        update_account_changed:
          "Local sign-in changed. Check the account and try again.",
      }[failure],
    });
  });
});
