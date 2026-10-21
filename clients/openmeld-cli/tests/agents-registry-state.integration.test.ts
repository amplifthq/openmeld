import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  detectInstalledRuntimeAgentsMock,
  listBuiltinControllerInstalledCandidatesMock,
  notifyDaemonRouteCatalogChangedMock,
  refreshBuiltinControllerPersistedLaunchContractMock,
} = vi.hoisted(() => ({
  detectInstalledRuntimeAgentsMock: vi.fn(),
  listBuiltinControllerInstalledCandidatesMock: vi.fn(),
  notifyDaemonRouteCatalogChangedMock: vi.fn(),
  refreshBuiltinControllerPersistedLaunchContractMock: vi.fn(),
}));

vi.mock("../src/skills/agents", async () => {
  const actual = await vi.importActual<typeof import("../src/skills/agents")>(
    "../src/skills/agents"
  );
  return {
    ...actual,
    detectInstalledRuntimeAgents: detectInstalledRuntimeAgentsMock,
  };
});

vi.mock("../src/agents/local-controller-install", async () => {
  const actual = await vi.importActual<
    typeof import("../src/agents/local-controller-install")
  >("../src/agents/local-controller-install");
  return {
    ...actual,
    listBuiltinControllerInstalledCandidates: (input: unknown) =>
      listBuiltinControllerInstalledCandidatesMock(input),
    refreshBuiltinControllerPersistedLaunchContract: (input: unknown) =>
      refreshBuiltinControllerPersistedLaunchContractMock(input),
  };
});

vi.mock("../src/local-service/state/route-catalog-sync-notifier", () => ({
  notifyDaemonRouteCatalogChanged: notifyDaemonRouteCatalogChangedMock,
}));

import {
  type AgentTargetState,
  listAgentRegistrations,
  listAgentTargetStates,
  manageAgentRegistrationInstallation,
  reconcileNewRunnableBuiltinAgentRegistrations,
  reconcileNewRunnableBuiltinAgentsForSetup,
  registerUnselectedBuiltinAgentsTurnedOff,
  resolveAgentContextBinding,
  resolveAgentTargetState,
} from "../src/agents/registry";
import {
  getConfiguredDeviceRuntimeState,
  setConfiguredDeviceRuntimeState,
  setConfiguredSkillsConfig,
} from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

describe("agents registry resolve target state", () => {
  it("delivers a target before another installation finishes and limits discovery to requested targets", async () => {
    await withTempHome(async () => {
      let release!: (value: string[]) => void;
      const slow = new Promise<string[]>((resolve) => {
        release = resolve;
      });
      detectInstalledRuntimeAgentsMock.mockImplementation(async (registry) =>
        Object.hasOwn(registry, "cursor") ? await slow : []
      );
      const onState = vi.fn(async (_state: AgentTargetState) => undefined);
      const listing = listAgentTargetStates({
        agentIds: ["codex", "cursor"],
        onState,
      });
      try {
        await vi.waitFor(() =>
          expect(onState).toHaveBeenCalledWith(
            expect.objectContaining({ agentId: "codex" })
          )
        );
        expect(onState).toHaveBeenCalledTimes(1);
      } finally {
        release([]);
        await listing;
      }
      expect(
        onState.mock.calls.map(([state]) => (state as AgentTargetState).agentId)
      ).toEqual(["codex", "cursor"]);
      expect(
        detectInstalledRuntimeAgentsMock.mock.calls.flatMap(([registry]) =>
          Object.keys(registry)
        )
      ).toEqual(["codex", "cursor"]);
    });
  });
  beforeEach(() => {
    detectInstalledRuntimeAgentsMock.mockResolvedValue(["codex"]);
    refreshBuiltinControllerPersistedLaunchContractMock.mockImplementation(
      async (input: { launchContract: unknown }) => input.launchContract
    );
    listBuiltinControllerInstalledCandidatesMock.mockReset();
    notifyDaemonRouteCatalogChangedMock.mockResolvedValue({
      notified: false,
      reason: "daemon_unavailable",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    detectInstalledRuntimeAgentsMock.mockReset();
    listBuiltinControllerInstalledCandidatesMock.mockReset();
    notifyDaemonRouteCatalogChangedMock.mockReset();
  });

  it("lists verified installations and persists the owner's selected installation", async () => {
    await withTempHome(async () => {
      const localInstall = {
        commandPath: "/Users/demo/.local/bin/claude",
        detail: "Claude Code installed for this account",
        installId: "install-local",
        label: "User installation",
        launchContract: {
          commandPath: "/Users/demo/.local/bin/claude",
          kind: "executable" as const,
        },
      };
      const homebrewInstall = {
        commandPath: "/opt/homebrew/bin/claude",
        detail: "Claude Code installed with Homebrew",
        installId: "install-homebrew",
        label: "Homebrew installation",
        launchContract: {
          commandPath: "/opt/homebrew/bin/claude",
          kind: "executable" as const,
        },
      };
      listBuiltinControllerInstalledCandidatesMock.mockResolvedValue({
        candidates: [localInstall, homebrewInstall],
        ok: true,
      });
      detectInstalledRuntimeAgentsMock.mockResolvedValue(["claude-code"]);
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: true,
            launchContract: localInstall.launchContract,
            registeredAt: "2026-08-18T00:00:00.000Z",
            updatedAt: "2026-08-18T00:00:00.000Z",
          },
        ],
      });
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]
          ?.launchContract
      ).toEqual(localInstall.launchContract);
      expect(
        (await resolveAgentTargetState("claude-code"))?.registration
          ?.launchContract
      ).toEqual(localInstall.launchContract);

      const listed = await manageAgentRegistrationInstallation({
        agentId: "claude-code",
        operation: "list",
      });
      expect(listBuiltinControllerInstalledCandidatesMock).toHaveBeenCalledWith(
        {
          agentId: "claude-code",
          detected: true,
          displayName: "Claude Code",
          persistedLaunchContract: localInstall.launchContract,
          runtimeSupported: true,
        }
      );
      expect(listed.installations).toEqual([
        expect.objectContaining({
          installationId: "install-local",
          selected: true,
        }),
        expect.objectContaining({
          installationId: "install-homebrew",
          selected: false,
        }),
      ]);

      const selected = await manageAgentRegistrationInstallation({
        agentId: "claude-code",
        installationId: "install-homebrew",
        operation: "select",
      });
      expect(selected).toMatchObject({
        agentId: "claude-code",
        changed: true,
        selectedInstallationId: "install-homebrew",
        status: "updated",
      });
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]
          ?.launchContract
      ).toEqual(homebrewInstall.launchContract);
    });
  });

  it("keeps a saved working installation available when ordinary detection misses it", async () => {
    await withTempHome(async (home) => {
      const commandDirectory = join(home, "saved", "bin");
      const commandPath = join(commandDirectory, "claude");
      await mkdir(commandDirectory, { recursive: true });
      await writeFile(commandPath, "#!/bin/sh\necho '1.0.0'\n", "utf8");
      await chmod(commandPath, 0o755);

      const launchContract = {
        commandPath,
        kind: "executable" as const,
      };
      const savedInstall = {
        commandPath,
        detail: "Saved Claude Code installation",
        installId: "install-saved",
        label: "Saved installation",
        launchContract,
      };
      listBuiltinControllerInstalledCandidatesMock.mockResolvedValue({
        candidates: [savedInstall],
        ok: true,
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: true,
            launchContract,
            registeredAt: "2026-08-18T00:00:00.000Z",
            updatedAt: "2026-08-18T00:00:00.000Z",
          },
        ],
      });

      const state = await resolveAgentTargetState("claude-code");
      expect(state).toMatchObject({
        agentId: "claude-code",
        detected: true,
        launchContract,
        launchStatus: "ready",
        selectable: true,
      });

      const listed = await manageAgentRegistrationInstallation({
        agentId: "claude-code",
        operation: "list",
      });
      expect(listBuiltinControllerInstalledCandidatesMock).toHaveBeenCalledWith(
        {
          agentId: "claude-code",
          detected: true,
          displayName: "Claude Code",
          persistedLaunchContract: launchContract,
          runtimeSupported: true,
        }
      );
      expect(listed.installations).toEqual([
        expect.objectContaining({
          installationId: "install-saved",
          selected: true,
        }),
      ]);
    });
  });

  it("persists an adapter-refreshed launch contract without changing controller state", async () => {
    await withTempHome(async () => {
      const oldLaunchContract = {
        kind: "node_script" as const,
        nodePath: "/usr/bin/env",
        scriptPath:
          "/Users/test/.local/share/cursor-agent/versions/old/cursor-agent",
      };
      const stableLaunchContract = {
        kind: "node_script" as const,
        nodePath: "/usr/bin/env",
        scriptPath: "/Users/test/.local/bin/cursor-agent",
      };
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            launchContract: oldLaunchContract,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });
      refreshBuiltinControllerPersistedLaunchContractMock.mockResolvedValue(
        stableLaunchContract
      );

      const registrations = await listAgentRegistrations();

      expect(registrations[0]).toMatchObject({
        agentId: "codex",
        enabled: true,
        launchContract: stableLaunchContract,
      });
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]
          ?.launchContract
      ).toEqual(stableLaunchContract);
    });
  });

  it("uses caller-provided states when available", async () => {
    const preloaded: AgentTargetState = {
      agentId: "codex",
      displayName: "Codex",
      targetKind: "builtin",
      detected: true,
      runtimeSupported: true,
      transportModes: [
        {
          mode: "local-cli",
          label: "Local CLI (Default)",
          description:
            "Run via local CLI on this computer, with session continuation when available.",
        },
      ],
      defaultTransportMode: "local-cli",
      contextIdMappingSpec: {
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      },
      lifecycleStatus: "active",
      selectable: true,
      selectableReason: null,
      installChoices: [],
      launchStatus: "ready",
      launchStatusDetail: null,
      launchContract: null,
      registered: false,
      enabled: false,
      registration: null,
    };

    const resolved = await resolveAgentTargetState("  codex  ", [preloaded]);
    expect(resolved).toEqual(preloaded);
  });

  it("prefers built-in state when custom id collides", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "codex",
            name: "Custom Codex",
            dir: "/tmp/custom-codex",
          },
        ],
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Custom Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const state = await resolveAgentTargetState("codex");
      expect(state?.targetKind).toBe("builtin");
      expect(state?.displayName).toBe("Codex");
      expect(state?.registered).toBe(true);
    });
  });

  it("exposes stable custom target ids as custom local agent ids", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        customTargets: [
          {
            id: "custom-target-001",
            name: "Executor Agent",
            dir: "/tmp/agent-executor",
          },
        ],
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "custom-target-001",
            displayName: "Executor Agent",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const states = await listAgentTargetStates();
      const customState = states.find(
        (state) => state.agentId === "custom-target-001"
      );

      expect(customState).toMatchObject({
        agentId: "custom-target-001",
        displayName: "Executor Agent",
        targetKind: "custom",
        registered: false,
        enabled: false,
        selectable: false,
        selectableReason: "custom_coming_soon",
      });
    });
  });

  it("returns null and prunes unknown registration when catalog entry is missing", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "legacy-custom-001",
            displayName: "Legacy Custom",
            enabled: false,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const state = await resolveAgentTargetState("legacy-custom-001");
      expect(state).toBeNull();
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers ?? []
      ).toEqual([]);
    });
  });

  it("returns null for blank ids", async () => {
    await expect(resolveAgentTargetState("  ")).resolves.toBeNull();
  });

  it("enables only newly detected runnable agents and preserves explicit Off decisions", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: false,
            registeredAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      });

      const result = await reconcileNewRunnableBuiltinAgentsForSetup({
        states: [
          buildBuiltinState({
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: false,
            registered: true,
          }),
          buildBuiltinState({
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registered: true,
          }),
          buildBuiltinState({
            agentId: "opencode",
            displayName: "OpenCode",
            enabled: false,
            registered: false,
          }),
        ],
      });

      expect(result).toEqual({
        registeredAgentIds: ["opencode"],
        preservedDisabledAgentIds: ["claude-code"],
        preservedEnabledAgentIds: ["codex"],
      });
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.map(
          ({ agentId, enabled }) => ({ agentId, enabled })
        )
      ).toEqual([
        { agentId: "claude-code", enabled: false },
        { agentId: "codex", enabled: true },
        { agentId: "opencode", enabled: true },
      ]);
    });
  });

  it("registers unselected detected agents turned off and reports the unselected ones still on", async () => {
    // Smoke: setup chose three of six detected agents, the others stayed
    // on, and each became an Agent.
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: true,
            registeredAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
          {
            agentId: "cursor",
            displayName: "Cursor",
            enabled: true,
            registeredAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      });

      const result = await registerUnselectedBuiltinAgentsTurnedOff({
        selectedAgentIds: ["claude-code"],
        states: [
          buildBuiltinState({
            agentId: "claude-code",
            displayName: "Claude Code",
            enabled: true,
            registered: true,
          }),
          buildBuiltinState({
            agentId: "cursor",
            displayName: "Cursor",
            enabled: true,
            registered: true,
          }),
          buildBuiltinState({
            agentId: "opencode",
            displayName: "OpenCode",
            enabled: false,
            registered: false,
          }),
        ],
      });

      expect(result).toEqual({
        registeredOffAgentIds: ["opencode"],
        unselectedOnAgentIds: ["cursor"],
      });
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.map(
          ({ agentId, enabled }) => ({ agentId, enabled })
        )
      ).toEqual([
        { agentId: "claude-code", enabled: true },
        { agentId: "cursor", enabled: true },
        { agentId: "opencode", enabled: false },
      ]);
      // The Service later sees OpenCode registered and keeps it off.
      expect(
        await reconcileNewRunnableBuiltinAgentsForSetup({
          states: [
            buildBuiltinState({
              agentId: "opencode",
              displayName: "OpenCode",
              enabled: false,
              registered: false,
            }),
          ],
        })
      ).toMatchObject({ preservedDisabledAgentIds: ["opencode"] });
    });
  });

  it("registers a newly installed agent during background catalog refresh without recursive notification", async () => {
    await withTempHome(async () => {
      const result = await reconcileNewRunnableBuiltinAgentRegistrations({
        notifyRouteCatalogChanged: false,
        states: [
          buildBuiltinState({
            agentId: "codex",
            displayName: "Codex",
            enabled: false,
            registered: false,
          }),
        ],
      });

      expect(result.registeredAgentIds).toEqual(["codex"]);
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.map(
          ({ agentId, enabled }) => ({ agentId, enabled })
        )
      ).toEqual([{ agentId: "codex", enabled: true }]);
      expect(notifyDaemonRouteCatalogChangedMock).not.toHaveBeenCalled();
    });
  });

  it("does not re-enable a controller disabled concurrently after discovery", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "opencode",
            displayName: "OpenCode",
            enabled: false,
            registeredAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      });

      const result = await reconcileNewRunnableBuiltinAgentsForSetup({
        states: [
          buildBuiltinState({
            agentId: "opencode",
            displayName: "OpenCode",
            enabled: false,
            registered: false,
          }),
        ],
      });

      expect(result).toEqual({
        registeredAgentIds: [],
        preservedDisabledAgentIds: ["opencode"],
        preservedEnabledAgentIds: [],
      });
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]?.enabled
      ).toBe(false);
    });
  });

  it("keeps enabled built-in targets that need repair selectable for setup convergence", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const state = await resolveAgentTargetState("codex");

      expect(state).toMatchObject({
        agentId: "codex",
        targetKind: "builtin",
        detected: true,
        enabled: true,
        registered: true,
        launchStatus: "needs_repair",
        selectable: true,
        selectableReason: null,
      });
    });
  });

  it("keeps suspended built-in targets technically selectable for existing users", async () => {
    detectInstalledRuntimeAgentsMock.mockResolvedValueOnce(["openclaw"]);

    await withTempHome(async () => {
      const state = await resolveAgentTargetState("openclaw");

      // Pin only the selectability contract: a suspended but detected built-in
      // stays technically selectable for existing users. launchStatus is left
      // unasserted on purpose — it is derived from the real host's installed
      // OpenClaw binaries (0 installs -> needs_repair, 1 -> ready, >1 ->
      // needs_choice), and withTempHome isolates HOME but not PATH, so pinning
      // it here would make the test non-hermetic.
      expect(state).toMatchObject({
        agentId: "openclaw",
        targetKind: "builtin",
        detected: true,
        lifecycleStatus: "suspended",
        selectable: true,
        selectableReason: null,
      });
    });
  });

  it("resolves agent context binding from registry mapping spec", async () => {
    await withTempHome(async () => {
      const binding = await resolveAgentContextBinding({
        agentId: "codex",
        env: {
          OPENMELD_CLI_CONTEXT_ID: "ctx-codex-1",
        },
      });

      expect(binding).toEqual({
        agentControllerConversationId: "ctx-codex-1",
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      });
    });
  });

  it("reads default streaming mode from registry for runtime-supported agent", async () => {
    await withTempHome(async () => {
      const state = await resolveAgentTargetState("codex");
      expect(state?.defaultStreamingMode).toBe("final");
    });
  });
});

function buildBuiltinState(input: {
  agentId: string;
  displayName: string;
  enabled: boolean;
  registered: boolean;
}): AgentTargetState {
  return {
    agentId: input.agentId,
    displayName: input.displayName,
    targetKind: "builtin",
    detected: true,
    runtimeSupported: true,
    transportModes: [
      {
        mode: "local-cli",
        label: "Local CLI (Default)",
        description: "Run this agent through its local CLI on this computer.",
      },
    ],
    defaultTransportMode: "local-cli",
    contextIdMappingSpec: {
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
      mappingVersion: 1,
    },
    lifecycleStatus: "active",
    selectable: true,
    selectableReason: null,
    installChoices: [],
    launchStatus: "ready",
    launchStatusDetail: null,
    launchContract: {
      commandPath: `/usr/local/bin/${input.agentId}`,
      kind: "executable",
    },
    registered: input.registered,
    enabled: input.enabled,
    registration: null,
  };
}
