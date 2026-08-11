import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import {
  getConfiguredDeviceRuntimeState,
  type RuntimeAgentControllerState,
  setConfiguredDeviceRuntimeState,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { syncDeviceRuntimeStateProjection as syncDeviceRuntimeStateProjectionImpl } from "../src/local-service/reporting/device-runtime-state-sync";
import { withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const {
  listAgentTargetStatesMock,
  repairBuiltinControllerInstallMock,
  resolveAgentProfilePrimaryAgentControllerReportMock,
} = vi.hoisted(() => ({
  listAgentTargetStatesMock: vi.fn(),
  repairBuiltinControllerInstallMock: vi.fn(),
  resolveAgentProfilePrimaryAgentControllerReportMock: vi.fn(),
}));

const { getAuthSessionStateMock, listOpenMeldProfilesMock } = vi.hoisted(
  () => ({
    getAuthSessionStateMock: vi.fn(),
    listOpenMeldProfilesMock: vi.fn(),
  })
);

const PROFILE_NAME_SUFFIX_PATTERN = /-profile$/;
const BUILTIN_CAPABILITY_PREFIX_PATTERN = /^builtin:/;
const LEGACY_EXPECTED_ROUTES_READ = {
  read: async () => ({ status: "legacy_endpoint_unavailable" as const }),
};

function syncDeviceRuntimeStateProjection(
  input?: Parameters<typeof syncDeviceRuntimeStateProjectionImpl>[0]
) {
  return syncDeviceRuntimeStateProjectionImpl({
    ...input,
    expectedRoutesRead:
      input?.expectedRoutesRead ?? LEGACY_EXPECTED_ROUTES_READ,
  });
}

vi.mock("../src/agents/local-controller-install", async () => {
  const actual = await vi.importActual<
    typeof import("../src/agents/local-controller-install")
  >("../src/agents/local-controller-install");
  return {
    ...actual,
    repairBuiltinControllerInstall: repairBuiltinControllerInstallMock,
  };
});

vi.mock("../src/agents/registry", async () => {
  const actual = await vi.importActual<typeof import("../src/agents/registry")>(
    "../src/agents/registry"
  );
  return {
    ...actual,
    listAgentTargetStates: listAgentTargetStatesMock,
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: getAuthSessionStateMock,
  };
});

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    listOpenMeldProfiles: listOpenMeldProfilesMock,
  };
});

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport:
    resolveAgentProfilePrimaryAgentControllerReportMock,
}));

describe("device runtime state projection sync", () => {
  const codexLaunchContract = {
    kind: "executable" as const,
    commandPath: process.execPath,
  };

  const codexInstallChoice = {
    installId: "install_codex",
    label: "Codex",
    detail: "Test install",
    commandPath: process.execPath,
    launchContract: codexLaunchContract,
  };

  function findCodexController(
    controllers: RuntimeAgentControllerState[] | undefined
  ): RuntimeAgentControllerState | null {
    return (
      controllers?.find(
        (controller) =>
          controller.agentId === "codex" ||
          controller.agentId === "builtin:codex"
      ) ?? null
    );
  }

  async function buildCodexTargetState() {
    const runtimeState = await getConfiguredDeviceRuntimeState();
    const registration = findCodexController(runtimeState?.controllers);
    const launchStatus =
      registration?.enabled === true && !registration.launchContract
        ? "needs_repair"
        : "ready";
    return {
      agentId: "codex",
      displayName: "Codex",
      targetKind: "builtin" as const,
      detected: true,
      runtimeSupported: true,
      transportModes: ["local-cli" as const],
      defaultTransportMode: "local-cli" as const,
      defaultStreamingMode: "final" as const,
      contextIdMappingSpec: {
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      },
      selectable: launchStatus === "ready",
      selectableReason: launchStatus === "ready" ? null : "needs_repair",
      installChoices: [],
      launchStatus,
      launchStatusDetail: null,
      launchContract: registration?.launchContract ?? codexLaunchContract,
      registered: Boolean(registration),
      enabled: registration?.enabled ?? false,
      registration,
    };
  }

  beforeEach(() => {
    listAgentTargetStatesMock
      .mockReset()
      .mockImplementation(async () => [await buildCodexTargetState()]);
    repairBuiltinControllerInstallMock.mockReset().mockResolvedValue({
      ok: true,
      launchContract: codexLaunchContract,
      selectedInstall: codexInstallChoice,
    });
    resolveAgentProfilePrimaryAgentControllerReportMock
      .mockReset()
      .mockImplementation(({ profile }: { profile: OpenMeldProfile }) => {
        const agentControllerRef = profile.profileName.replace(
          PROFILE_NAME_SUFFIX_PATTERN,
          ""
        );
        const capabilityId = agentControllerRef.replace(
          BUILTIN_CAPABILITY_PREFIX_PATTERN,
          ""
        );
        return Promise.resolve({
          bindingState: "enabled_primary",
          capabilityKind: "builtin",
          agentControllerRef: `builtin:${capabilityId}`,
          capabilityId,
          localAgentId: capabilityId,
          primaryBinding: null,
          reasonCodes: [],
          routable: true,
        });
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getAuthSessionStateMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
    listAgentTargetStatesMock.mockReset();
    repairBuiltinControllerInstallMock.mockReset();
    resolveAgentProfilePrimaryAgentControllerReportMock.mockReset();
    Reflect.deleteProperty(process.env, "OPENMELD_TRACE_DIAGNOSTICS");
  });

  it("reports degraded in check mode when projected controller is missing locally", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("codex"),
      ]);

      const result = await syncDeviceRuntimeStateProjection({
        mode: "check",
      });

      expect(result.status).toBe("degraded");
      expect(result.missingControllerIds).toEqual(["codex"]);
      expect(result.disabledControllerIds).toEqual([]);
      expect(result.repairedControllerIds).toEqual([]);
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers
      ).toBeFalsy();
    });
  });

  it("repairs missing projected controller in repair mode", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("codex"),
      ]);

      const result = await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });
      const runtimeState = await getConfiguredDeviceRuntimeState();
      const controller = runtimeState?.controllers?.find(
        (item) => item.agentId === "codex"
      );

      expect(result.status).toBe("ok");
      expect(result.repairedControllerIds).toEqual(["codex"]);
      expect(controller?.enabled).toBe(true);
      expect(controller?.transportMode).toBe("local-cli");
      expect(controller?.contextIdMappingSpec?.sourceField).toBe(
        "OPENMELD_CLI_CONTEXT_ID"
      );
    });
  });

  it("reuses the bare local controller id when a builtin profile stores a prefixed controller ref", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("builtin:codex"),
      ]);
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
        ],
      });

      const result = await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });
      const runtimeState = await getConfiguredDeviceRuntimeState();

      expect(result.status).toBe("ok");
      expect(result.repairedControllerIds).toEqual(["codex"]);
      expect(
        runtimeState?.controllers?.map((controller) => controller.agentId)
      ).toEqual(["codex"]);
    });
  });

  it("dedupes a stale prefixed builtin registration back into the canonical bare agent id", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("builtin:codex"),
      ]);
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "builtin:codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
        ],
      });

      const result = await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });
      const runtimeState = await getConfiguredDeviceRuntimeState();

      expect(result.status).toBe("ok");
      expect(result.repairedControllerIds).toEqual(["codex"]);
      expect(
        runtimeState?.controllers?.map((controller) => controller.agentId)
      ).toEqual(["codex"]);
    });
  });

  it("does not collapse a real custom target whose id matches a prefixed builtin ref", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("builtin:codex"),
      ]);
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "builtin:codex",
            name: "Custom Codex Alias",
            dir: "/tmp/custom-codex-alias",
          },
        ],
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "builtin:codex",
            displayName: "Custom Codex Alias",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "BUILTIN_OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
        ],
      });

      const result = await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });
      const runtimeState = await getConfiguredDeviceRuntimeState();

      expect(result.status).toBe("ok");
      expect(result.repairedControllerIds).toEqual(["codex"]);
      expect(
        runtimeState?.controllers?.map((controller) => controller.agentId)
      ).toEqual(["builtin:codex", "codex"]);
    });
  });

  it("keeps explicit local disabled controller state unchanged", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: false,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
        ],
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("codex"),
      ]);

      const result = await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });
      const runtimeState = await getConfiguredDeviceRuntimeState();
      const controller = runtimeState?.controllers?.find(
        (item) => item.agentId === "codex"
      );

      expect(result.status).toBe("degraded");
      expect(result.repairedControllerIds).toEqual([]);
      expect(controller?.enabled).toBe(false);
      expect(controller?.transportMode).toBe("local-cli");
    });
  });

  it("reports launch repair when a projected controller is present but missing its launch contract", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
        ],
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("codex"),
      ]);

      const result = await syncDeviceRuntimeStateProjection({
        mode: "check",
      });

      expect(result.status).toBe("degraded");
      expect(result.missingControllerIds).toEqual([]);
      expect(result.disabledControllerIds).toEqual([]);
      expect(result.repairRequiredControllerIds).toEqual(["codex"]);
      expect(result.repairedControllerIds).toEqual([]);
    });
  });

  it("repairs an existing projected controller when its launch contract is missing", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            transportMode: "local-cli",
            timeoutMs: 120_000,
            retry: 0,
            contextIdMappingSpec: {
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
              mappingVersion: 1,
            },
            registeredAt: "2026-02-28T00:00:00.000Z",
            updatedAt: "2026-02-28T00:00:00.000Z",
          },
        ],
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("codex"),
      ]);

      const result = await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });
      const runtimeState = await getConfiguredDeviceRuntimeState();
      const controller = runtimeState?.controllers?.find(
        (item) => item.agentId === "codex"
      );

      expect(result.status).toBe("ok");
      expect(result.repairRequiredControllerIds).toEqual([]);
      expect(result.repairedControllerIds).toEqual(["codex"]);
      expect(controller?.launchContract).toBeTruthy();
    });
  });

  it("skips sync when authentication is not valid", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        state: "missing",
        session: null,
      });

      const result = await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("authentication is not valid");
      expect(listOpenMeldProfilesMock).not.toHaveBeenCalled();
    });
  });

  it("preserves an expected-routes read failure instead of rebuilding from profiles", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      const error = new Error("expected routes are temporarily unavailable");

      await expect(
        syncDeviceRuntimeStateProjection({
          expectedRoutesRead: {
            read: () => Promise.reject(error),
          },
          mode: "check",
        })
      ).rejects.toBe(error);

      expect(listOpenMeldProfilesMock).not.toHaveBeenCalled();
    });
  });

  it("emits structured reconcile evidence for check and repair flows", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_TRACE_DIAGNOSTICS = "1";
      const consoleInfoSpy = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-02-28T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        createBoundAgentProfile("codex"),
      ]);

      await syncDeviceRuntimeStateProjection({
        mode: "check",
      });
      await syncDeviceRuntimeStateProjection({
        mode: "repair",
      });

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[openmeld.evidence.reconcile.drift.detected]",
        expect.objectContaining({
          action: "repair_projection",
          driftClass: "projection",
          owner: "device-runtime-state-sync",
        })
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[openmeld.evidence.reconcile.reconcile.skipped]",
        expect.objectContaining({
          action: "repair_projection",
          skipReason: "read_only_surface",
        })
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[openmeld.evidence.reconcile.reconcile.started]",
        expect.objectContaining({
          action: "repair_projection",
          mode: "repair",
          owner: "device-runtime-state-sync",
        })
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[openmeld.evidence.reconcile.reconcile.completed]",
        expect.objectContaining({
          action: "repair_projection",
          repairedControllerIds: ["codex"],
        })
      );
    });
  });
});

function createBoundAgentProfile(agentControllerRef: string): OpenMeldProfile {
  return createTestOpenMeldProfile({
    openMeldProfileId: `agt-${agentControllerRef}`,
    profileName: `${agentControllerRef}-profile`,
    profileKind: "agent",
    createdAt: "2026-02-28T00:00:00.000Z",
    updatedAt: "2026-02-28T00:00:00.000Z",
  });
}
