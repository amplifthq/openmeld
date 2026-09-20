import type {
  RuntimeAgentControllerLaunchCandidate,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveBuiltinAgentControllerDefinitionMock } = vi.hoisted(() => ({
  resolveBuiltinAgentControllerDefinitionMock: vi.fn(),
}));

vi.mock("../src/agents/builtin-agent-controller-definitions", () => ({
  resolveBuiltinAgentControllerDefinition:
    resolveBuiltinAgentControllerDefinitionMock,
}));

import {
  repairBuiltinControllerInstall,
  resolveBuiltinControllerInstallResolution,
} from "../src/agents/local-controller-install";

type TestInstallResolver = {
  refreshPersistedLaunchContract?: (input: {
    launchContract: RuntimeAgentControllerLaunchContract;
  }) => Promise<RuntimeAgentControllerLaunchContract>;
  resolveInstalledLaunchCandidates: (input?: {
    preferredLaunchContract?: RuntimeAgentControllerLaunchContract | null;
    timeoutMs?: number | null;
  }) => Promise<
    | {
        candidates: RuntimeAgentControllerLaunchCandidate[];
        ok: true;
      }
    | {
        errorMessage: string;
        reason: "not_installed" | "not_launchable";
        ok: false;
      }
  >;
  verifyLaunchContract: (input: {
    launchContract: RuntimeAgentControllerLaunchContract;
  }) => Promise<
    | {
        launchCommand: {
          argsPrefix: string[];
          bin: string;
        };
        ok: true;
      }
    | {
        errorMessage: string;
        failureKind: "completed_negative" | "incomplete_check";
        ok: false;
      }
  >;
};

describe("local controller install resolution", () => {
  beforeEach(() => {
    resolveBuiltinAgentControllerDefinitionMock.mockReset();
  });

  it("keeps a persisted launch contract when it still verifies", async () => {
    const persistedLaunchContract = createLaunchContract(
      "/opt/homebrew/bin/codex"
    );
    const resolveInstalledLaunchCandidates = vi.fn().mockResolvedValue({
      errorMessage: "Install inventory is temporarily unavailable.",
      reason: "not_launchable",
      ok: false,
    });
    setTestInstallResolver({
      resolveInstalledLaunchCandidates,
      verifyLaunchContract: vi.fn().mockResolvedValue({
        launchCommand: { argsPrefix: [], bin: "/opt/homebrew/bin/codex" },
        ok: true,
      }),
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "codex",
      detected: true,
      displayName: "Codex",
      persistedLaunchContract,
      runtimeSupported: true,
    });

    expect(resolution).toEqual({
      detail: null,
      installChoices: [],
      launchContract: persistedLaunchContract,
      status: "ready",
    });
    expect(resolveInstalledLaunchCandidates).toHaveBeenCalledWith({
      preferredLaunchContract: persistedLaunchContract,
    });
  });

  it("keeps a verified persisted install while exposing every verified install", async () => {
    const persistedLaunchContract = createLaunchContract(
      "/opt/homebrew/bin/codex"
    );
    const installChoices = [
      createInstallChoice("install_homebrew", "/opt/homebrew/bin/codex"),
      createInstallChoice("install_nvm", "/Users/test/.nvm/bin/codex"),
    ];
    const resolveInstalledLaunchCandidates = vi.fn().mockResolvedValue({
      candidates: installChoices,
      ok: true,
    });
    setTestInstallResolver({
      resolveInstalledLaunchCandidates,
      verifyLaunchContract: vi.fn().mockResolvedValue({
        launchCommand: { argsPrefix: [], bin: "/opt/homebrew/bin/codex" },
        ok: true,
      }),
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "codex",
      detected: true,
      displayName: "Codex",
      persistedLaunchContract,
      runtimeSupported: true,
    });

    expect(resolution).toEqual({
      detail: null,
      installChoices,
      launchContract: persistedLaunchContract,
      status: "ready",
    });
    expect(resolveInstalledLaunchCandidates).toHaveBeenCalledWith({
      preferredLaunchContract: persistedLaunchContract,
    });
  });

  it("verifies a persisted install even when ordinary detection misses it", async () => {
    const persistedLaunchContract = createLaunchContract(
      "/Users/test/saved/bin/codex"
    );
    const installChoices = [
      createInstallChoice("install_saved", "/Users/test/saved/bin/codex"),
    ];
    const resolveInstalledLaunchCandidates = vi.fn().mockResolvedValue({
      candidates: installChoices,
      ok: true,
    });
    setTestInstallResolver({
      resolveInstalledLaunchCandidates,
      verifyLaunchContract: vi.fn().mockResolvedValue({
        launchCommand: {
          argsPrefix: [],
          bin: "/Users/test/saved/bin/codex",
        },
        ok: true,
      }),
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "codex",
      detected: false,
      displayName: "Codex",
      persistedLaunchContract,
      runtimeSupported: true,
    });

    expect(resolution).toEqual({
      detail: null,
      installChoices,
      launchContract: persistedLaunchContract,
      status: "ready",
    });
    expect(resolveInstalledLaunchCandidates).toHaveBeenCalledWith({
      preferredLaunchContract: persistedLaunchContract,
    });
  });

  it("keeps a persisted launch contract when its current check is incomplete", async () => {
    const persistedLaunchContract = createLaunchContract(
      "/opt/homebrew/bin/claude"
    );
    const resolveInstalledLaunchCandidates = vi.fn().mockResolvedValue({
      errorMessage: "Install inventory timed out.",
      reason: "not_launchable",
      ok: false,
    });
    setTestInstallResolver({
      resolveInstalledLaunchCandidates,
      verifyLaunchContract: vi.fn().mockResolvedValue({
        errorMessage: "Claude Code launch check timed out.",
        failureKind: "incomplete_check",
        ok: false,
      }),
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "claude-code",
      detected: true,
      displayName: "Claude Code",
      persistedLaunchContract,
      runtimeSupported: true,
    });

    expect(resolution).toEqual({
      detail: null,
      installChoices: [],
      launchContract: persistedLaunchContract,
      status: "ready",
    });
    expect(resolveInstalledLaunchCandidates).toHaveBeenCalledWith({
      preferredLaunchContract: persistedLaunchContract,
    });
  });

  it("still requires repair after a completed negative launch check", async () => {
    const persistedLaunchContract = createLaunchContract(
      "/opt/homebrew/bin/claude"
    );
    setTestInstallResolver({
      resolveInstalledLaunchCandidates: vi.fn().mockResolvedValue({
        candidates: [],
        ok: true,
      }),
      verifyLaunchContract: vi.fn().mockResolvedValue({
        errorMessage: "Claude Code exited before reporting its version.",
        failureKind: "completed_negative",
        ok: false,
      }),
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "claude-code",
      detected: true,
      displayName: "Claude Code",
      persistedLaunchContract,
      runtimeSupported: true,
    });

    expect(resolution).toEqual({
      detail: "Claude Code exited before reporting its version.",
      installChoices: [],
      launchContract: persistedLaunchContract,
      status: "needs_repair",
    });
  });

  it("refreshes an adapter-managed persisted launch contract before verifying it", async () => {
    const persistedLaunchContract = createLaunchContract(
      "/tmp/cursor-agent/versions/old/cursor-agent"
    );
    const refreshedLaunchContract = createLaunchContract(
      "/Users/test/.local/bin/cursor-agent"
    );
    const verifyLaunchContract = vi.fn().mockResolvedValue({
      launchCommand: {
        argsPrefix: [],
        bin: "/Users/test/.local/bin/cursor-agent",
      },
      ok: true,
    });
    setTestInstallResolver({
      refreshPersistedLaunchContract: vi
        .fn()
        .mockResolvedValue(refreshedLaunchContract),
      verifyLaunchContract,
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "cursor",
      detected: true,
      displayName: "Cursor",
      persistedLaunchContract,
      runtimeSupported: true,
    });

    expect(verifyLaunchContract).toHaveBeenCalledWith({
      launchContract: refreshedLaunchContract,
    });
    expect(resolution).toEqual({
      detail: null,
      installChoices: [],
      launchContract: refreshedLaunchContract,
      status: "ready",
    });
  });

  it.each([
    { mode: "the only discovered install", preferredInstallId: undefined },
    {
      mode: "the preferred discovered install",
      preferredInstallId: "install_chatgpt",
    },
  ])("verifies $mode before first-use readiness", async ({
    preferredInstallId,
  }) => {
    const installChoices = preferredInstallId
      ? [
          createInstallChoice("install_homebrew", "/opt/homebrew/bin/codex"),
          createInstallChoice(
            "install_chatgpt",
            "/Applications/ChatGPT.app/Contents/Resources/codex"
          ),
        ]
      : [createInstallChoice("install_homebrew", "/opt/homebrew/bin/codex")];
    const selectedInstall = preferredInstallId
      ? installChoices[1]
      : installChoices[0];
    if (!selectedInstall) {
      throw new Error("Expected a selected install fixture.");
    }
    const verifyLaunchContract = vi.fn().mockResolvedValue({
      launchCommand: { argsPrefix: [], bin: selectedInstall.commandPath },
      ok: true,
    });
    setTestInstallResolver({
      resolveInstalledLaunchCandidates: vi.fn().mockResolvedValue({
        candidates: installChoices,
        ok: true,
        ...(preferredInstallId ? { preferredInstallId } : {}),
      }),
      verifyLaunchContract,
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "codex",
      detected: true,
      displayName: "Codex",
      runtimeSupported: true,
    });

    expect(resolution).toEqual({
      detail: null,
      installChoices: [],
      launchContract: selectedInstall.launchContract,
      status: "ready",
    });
    expect(verifyLaunchContract).toHaveBeenCalledWith({
      launchContract: selectedInstall.launchContract,
    });
  });

  it.each([
    {
      expectedDetail:
        "OpenMeld couldn't finish checking whether this Codex install can start. Try again.",
      failureKind: "incomplete_check" as const,
      mode: "the only discovered install",
      preferredInstallId: undefined,
    },
    {
      expectedDetail: "Codex exited before reporting its version.",
      failureKind: "completed_negative" as const,
      mode: "the preferred discovered install",
      preferredInstallId: "install_chatgpt",
    },
  ])("fails closed when verification rejects $mode", async ({
    expectedDetail,
    failureKind,
    preferredInstallId,
  }) => {
    const installChoices = preferredInstallId
      ? [
          createInstallChoice("install_homebrew", "/opt/homebrew/bin/codex"),
          createInstallChoice(
            "install_chatgpt",
            "/Applications/ChatGPT.app/Contents/Resources/codex"
          ),
        ]
      : [createInstallChoice("install_homebrew", "/opt/homebrew/bin/codex")];
    const selectedInstall = preferredInstallId
      ? installChoices[1]
      : installChoices[0];
    if (!selectedInstall) {
      throw new Error("Expected a selected install fixture.");
    }
    const errorMessage =
      failureKind === "incomplete_check"
        ? "Codex launch check timed out."
        : expectedDetail;
    setTestInstallResolver({
      resolveInstalledLaunchCandidates: vi.fn().mockResolvedValue({
        candidates: installChoices,
        ok: true,
        ...(preferredInstallId ? { preferredInstallId } : {}),
      }),
      verifyLaunchContract: vi.fn().mockResolvedValue({
        errorMessage,
        failureKind,
        ok: false,
      }),
    });

    const resolution = await resolveBuiltinControllerInstallResolution({
      agentId: "codex",
      detected: true,
      displayName: "Codex",
      runtimeSupported: true,
    });

    expect(resolution).toEqual({
      detail: expectedDetail,
      installChoices,
      launchContract: null,
      status: "needs_repair",
    });
  });

  it.each([
    { operation: "first-use resolution" as const },
    { operation: "repair" as const },
  ])("does not report success when $operation verification throws", async ({
    operation,
  }) => {
    const installChoice = createInstallChoice(
      "install_homebrew",
      "/opt/homebrew/bin/codex"
    );
    setTestInstallResolver({
      resolveInstalledLaunchCandidates: vi.fn().mockResolvedValue({
        candidates: [installChoice],
        ok: true,
      }),
      verifyLaunchContract: vi
        .fn()
        .mockRejectedValue(new Error("launch verifier unavailable")),
    });

    const operationPromise =
      operation === "repair"
        ? repairBuiltinControllerInstall({
            agentId: "codex",
            detected: true,
            displayName: "Codex",
            runtimeSupported: true,
          })
        : resolveBuiltinControllerInstallResolution({
            agentId: "codex",
            detected: true,
            displayName: "Codex",
            runtimeSupported: true,
          });

    await expect(operationPromise).rejects.toThrow(
      "launch verifier unavailable"
    );
  });

  it.each([
    { installId: "install_homebrew", mode: "an explicit install" },
    { installId: undefined, mode: "the only discovered install" },
  ])("verifies $mode before repair succeeds", async ({ installId }) => {
    const homebrewInstall = createInstallChoice(
      "install_homebrew",
      "/opt/homebrew/bin/codex"
    );
    const nvmInstall = createInstallChoice(
      "install_nvm",
      "/Users/test/.nvm/bin/codex"
    );
    const installChoices = installId
      ? [homebrewInstall, nvmInstall]
      : [homebrewInstall];
    const verifyLaunchContract = vi.fn().mockResolvedValue({
      launchCommand: { argsPrefix: [], bin: homebrewInstall.commandPath },
      ok: true,
    });
    setTestInstallResolver({
      resolveInstalledLaunchCandidates: vi.fn().mockResolvedValue({
        candidates: installChoices,
        ok: true,
      }),
      verifyLaunchContract,
    });

    const repairResult = await repairBuiltinControllerInstall({
      agentId: "codex",
      detected: true,
      displayName: "Codex",
      installId,
      runtimeSupported: true,
    });

    expect(repairResult).toEqual({
      launchContract: homebrewInstall.launchContract,
      ok: true,
      selectedInstall: homebrewInstall,
    });
    expect(verifyLaunchContract).toHaveBeenCalledWith({
      launchContract: homebrewInstall.launchContract,
    });
  });

  it.each([
    {
      expectedError:
        "OpenMeld couldn't finish checking whether this Codex install can start. Try again.",
      failureKind: "incomplete_check" as const,
      installId: "install_homebrew",
      mode: "an explicit install",
    },
    {
      expectedError: "Codex exited before reporting its version.",
      failureKind: "completed_negative" as const,
      installId: undefined,
      mode: "the only discovered install",
    },
  ])("keeps $mode unselected when repair verification fails", async ({
    expectedError,
    failureKind,
    installId,
  }) => {
    const homebrewInstall = createInstallChoice(
      "install_homebrew",
      "/opt/homebrew/bin/codex"
    );
    const nvmInstall = createInstallChoice(
      "install_nvm",
      "/Users/test/.nvm/bin/codex"
    );
    const installChoices = installId
      ? [homebrewInstall, nvmInstall]
      : [homebrewInstall];
    setTestInstallResolver({
      resolveInstalledLaunchCandidates: vi.fn().mockResolvedValue({
        candidates: installChoices,
        ok: true,
      }),
      verifyLaunchContract: vi.fn().mockResolvedValue({
        errorMessage:
          failureKind === "incomplete_check"
            ? "Codex launch check timed out."
            : expectedError,
        failureKind,
        ok: false,
      }),
    });

    const repairResult = await repairBuiltinControllerInstall({
      agentId: "codex",
      detected: true,
      displayName: "Codex",
      installId,
      runtimeSupported: true,
    });

    expect(repairResult).toEqual({
      errorCode: "controller.launch.needs_repair",
      errorMessage: expectedError,
      installChoices,
      ok: false,
    });
  });

  it("fails closed when multiple installs exist and no install id is selected", async () => {
    const installChoices = [
      createInstallChoice("install_homebrew", "/opt/homebrew/bin/codex"),
      createInstallChoice("install_nvm", "/Users/test/.nvm/bin/codex"),
    ];
    setTestInstallResolver({
      resolveInstalledLaunchCandidates: vi.fn().mockResolvedValue({
        candidates: installChoices,
        ok: true,
      }),
    });

    const repairResult = await repairBuiltinControllerInstall({
      agentId: "codex",
      detected: true,
      displayName: "Codex",
      runtimeSupported: true,
    });

    expect(repairResult).toEqual({
      errorCode: "controller.launch.choice_required",
      errorMessage:
        "OpenMeld found more than one Codex install on this computer. Choose which one OpenMeld should use here.",
      installChoices,
      ok: false,
    });
  });
});

function setTestInstallResolver(
  overrides: Partial<TestInstallResolver> = {}
): void {
  const resolver: TestInstallResolver = {
    ...(overrides.refreshPersistedLaunchContract
      ? {
          refreshPersistedLaunchContract:
            overrides.refreshPersistedLaunchContract,
        }
      : {}),
    resolveInstalledLaunchCandidates:
      overrides.resolveInstalledLaunchCandidates ??
      vi.fn().mockResolvedValue({ candidates: [], ok: true }),
    verifyLaunchContract:
      overrides.verifyLaunchContract ??
      vi.fn().mockResolvedValue({
        errorMessage: "not verified",
        failureKind: "completed_negative",
        ok: false,
      }),
  };
  resolveBuiltinAgentControllerDefinitionMock.mockReturnValue({
    installResolver: resolver,
  });
}

function createInstallChoice(
  installId: string,
  commandPath: string
): RuntimeAgentControllerLaunchCandidate {
  return {
    commandPath,
    detail: commandPath,
    installId,
    label: installId,
    launchContract: createLaunchContract(commandPath),
  };
}

function createLaunchContract(
  commandPath: string
): RuntimeAgentControllerLaunchContract {
  return {
    commandPath,
    kind: "executable",
  };
}
