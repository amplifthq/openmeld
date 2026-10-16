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
// Captured from isolated-lane computer list on 2026-10-16. Identity is
// anonymized; unrelated controller details are omitted.
import stoppedComputerInventory from "./fixtures/stopped-computer-inventory.json";

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  help: vi.fn(() =>
    Promise.resolve({
      stdout: "Usage: openmeld computer wait-for-update [options]\n",
    })
  ),
  install: vi.fn(),
  grant: vi.fn(),
}));
vi.mock("@openmeld/api-client", () => ({
  createComputerAuthorizationGrant: mocks.grant,
}));
vi.mock("node:child_process", async (importOriginal) => {
  const { promisify } = await import("node:util");
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    execFile: Object.assign(vi.fn(), {
      [promisify.custom]: (bin: string, args: string[], options: unknown) =>
        args.includes("--help") ? mocks.help() : mocks.exec(bin, args, options),
    }),
    spawn: vi.fn((_bin, args, options) => {
      if (args[1] === "wait-for-update") {
        return actual.spawn(
          process.execPath,
          [
            "-e",
            'console.log(JSON.stringify({type:"line",code:"computer.update_ready",message:"Computer connection can continue."}))',
          ],
          options
        );
      }
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
    "unsupported json option",
    "unsupported stopped option",
    "authentication failure",
  ])("retries a stopped-identity probe only for compatibility: %s", async (reason) => {
    const error = Object.assign(new Error(reason), {
      code: 1,
      stderr: {
        "unsupported command": "error: unknown command 'connection-review'",
        "unsupported json option": "error: unknown option '--json'",
        "unsupported stopped option":
          "error: unknown option '--include-stopped'",
        "authentication failure": "Authentication expired",
      }[reason],
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
    if (reason !== "authentication failure") {
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
    "legacy_update_wait",
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
      "legacy_update_wait",
      "first_connect_missing_tools",
      "first_connect_legacy_tools",
    ].includes(scenario);
    if (createsPrepare) {
      cloudRequest.mockRejectedValue(new Error("Prepare requested"));
      if (scenario === "reconnect_target") {
        const inventory = structuredClone(stoppedComputerInventory);
        inventory.computers = inventory.computers.map((computer) => ({
          ...computer,
          connectedComputerId: "computer-b",
        }));
        cloudRequest.mockResolvedValueOnce(Response.json(inventory));
      }
    }
    const confirmSwitch = vi.fn(async () => false);
    if (scenario === "legacy_update_wait") {
      // Captured from published 0.3.264: unknown child + --help exits 0.
      mocks.help.mockResolvedValueOnce({
        stdout:
          "Usage: openmeld computer [options] [command]\n\nInspect and name computers in OpenMeld.\n",
      });
    }
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
        existingConnection:
          firstConnect || scenario === "targeted_update_legacy_tools"
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
        // Captured from the published 0.3.263 command parser: options are
        // rejected before the absent subcommand is diagnosed.
        stderr: "error: unknown option '--json'",
      }) satisfies ExecFileException & { stdout: string; stderr: string };
      mocks.exec.mockRejectedValueOnce(failure);
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
      ...(scenario === "fresh_session" || scenario === "legacy_update_wait"
        ? { resetThisComputer: true }
        : {}),
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
        scenario === "targeted_update_legacy_tools"
          ? "OpenMeld cannot read this Mac's Service identity. Start OpenMeld Service on this Mac, then try again."
          : "OpenMeld cannot verify this computer with the installed tools. Run OpenMeld setup on the selected computer, then try again."
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
      expect(cloudRequest).toHaveBeenCalledTimes(
        scenario === "reconnect_target" ? 2 : 1
      );
      if (scenario === "reconnect_target") {
        const body = cloudRequest.mock.calls[1]?.[1].body;
        expect(JSON.parse(new TextDecoder().decode(body))).toMatchObject({
          connectedComputerId: "computer-b",
          deviceId: "device-a",
          runtimeLane: "dev-local",
        });
      }
    } else {
      expect(cloudRequest).not.toHaveBeenCalled();
    }
    if (
      scenario === "missing_tools" ||
      firstConnect ||
      scenario === "service_update" ||
      scenario === "legacy_update_wait"
    ) {
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
    const cloudRequest = vi.fn().mockImplementation((path: string) => {
      if (path === "/v1/people-computers") {
        return Response.json(stoppedComputerInventory);
      }
      if (path === "/v1/prepare/sessions") {
        return Response.json(prepare);
      }
      throw new Error("Snapshot unavailable");
    });
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
    if (failure === "update_wrong_target") {
      await expect(
        connect({
          expectedAccount: "account-a",
          connectedComputerId: "computer-b",
          serviceAction: "update_service",
        })
      ).rejects.toThrow(
        "Open Desktop on the selected computer, then try again."
      );
      expect(mocks.install).not.toHaveBeenCalled();
      expect(mocks.grant).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      return;
    }
    const pendingResult = connect({
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
      ...(failure.startsWith("update_") || failure === "service_update"
        ? { serviceAction: "update_service" }
        : {}),
    });
    if (failure === "update_account_changed") {
      await expect(pendingResult).rejects.toThrow(
        "Local sign-in changed. Check the account and try again."
      );
      expect(cloudRequest).not.toHaveBeenCalled();
      expect(mocks.grant).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      return;
    }
    const result = await pendingResult;
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
      expect(
        vi
          .mocked(spawn)
          .mock.calls.every((call) => call[1]?.[1] === "wait-for-update")
      ).toBe(true);
    } else {
      expect(mocks.grant).toHaveBeenCalledWith(expect.any(Function), {
        clientId: "openmeld-cli-dev",
      });
    }
    if (failure === "service_update") {
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
