import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import { runCliUpdateCheck } from "../src/command-entry-checks/check-cli-update";
import type { CommandEntryContext } from "../src/command-entry-checks/types";
import {
  readVersionState,
  resetVersionCheckCacheForTests,
  writeVersionState,
} from "../src/config/version-state";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
} from "../src/runtime/dispatch-runtime-env";
import type { Presenter } from "../src/runtime/presenter";
import { withTempHome } from "./helpers/fs";

const { confirmMock, rerunCurrentCommandWithEnvMock, runUpgradeMock } =
  vi.hoisted(() => ({
    confirmMock: vi.fn(),
    rerunCurrentCommandWithEnvMock: vi.fn(),
    runUpgradeMock: vi.fn(),
  }));

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: vi.fn(() => false),
}));

vi.mock("../src/commands/upgrade", () => ({
  runUpgrade: (...args: unknown[]) => runUpgradeMock(...args),
}));

vi.mock("../src/command-entry-checks/rerun-current-command", () => ({
  rerunCurrentCommandWithEnv: (...args: unknown[]) =>
    rerunCurrentCommandWithEnvMock(...args),
}));

vi.mock("../src/command-entry-checks/show-human-check-card", () => ({
  showHumanCheckCard: vi.fn(),
}));

function createPresenter(): Presenter {
  return {
    view: "human",
    event: vi.fn(),
    line: vi.fn(),
    data: vi.fn(),
  };
}

function createContext(
  overrides: Partial<CommandEntryContext> = {}
): CommandEntryContext {
  return {
    entryName: "start",
    argv: ["node", "openmeld", "start"],
    runtime: {
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    },
    presenter: createPresenter(),
    allowPrompt: true,
    environmentTarget: {
      authBaseUrl: "https://auth.openmeld.invalid",
      gatewayUrl: "https://gateway.openmeld.invalid",
      preset: "prod",
      userFacingCommand: "openmeld",
    },
    gatewayUrl: null,
    profileArg: null,
    jsonOutput: false,
    ...overrides,
  };
}

function npmLatestResponse(input: {
  version: string;
  minRequiredCliVersion?: string;
}): Response {
  const body: Record<string, unknown> = { version: input.version };
  if (input.minRequiredCliVersion) {
    body.openmeld = { minRequiredCliVersion: input.minRequiredCliVersion };
  }
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("command entry cli update", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(npmLatestResponse({ version: "9.9.9" }))
    );
    confirmMock.mockReset().mockResolvedValue(true);
    rerunCurrentCommandWithEnvMock.mockReset().mockResolvedValue(0);
    runUpgradeMock.mockReset().mockResolvedValue(undefined);
    resetVersionCheckCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("skips the gate inside a dispatch-owned runtime even when required", async () => {
    await withTempHome(async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      vi.stubEnv(
        OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
        DISPATCH_OWNED_RUNTIME_MODE
      );

      const result = await runCliUpdateCheck({
        context: createContext({
          runtime: {
            viewMode: "agent",
            resolvedView: "agent",
            interactive: false,
          },
          allowPrompt: false,
        }),
        requirement: { mode: "required", stage: "before-entry" },
      });

      expect(result).toEqual({ status: "continue" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("seeds version metadata before interactive upgrade runs", async () => {
    await withTempHome(async () => {
      expect(await readVersionState()).toBeNull();

      const result = await runCliUpdateCheck({
        context: createContext(),
        requirement: {
          mode: "optional",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({
        status: "blocked",
        exitCode: 0,
      });
      expect(runUpgradeMock).toHaveBeenCalledWith({
        yes: true,
        view: "human",
      });
      expect(await readVersionState()).toMatchObject({
        v: 1,
        last_version: packageJson.version,
        latest_version: "9.9.9",
      });
    });
  });

  it("fails non-zero when the user declines a required product-command CLI update", async () => {
    await withTempHome(async () => {
      confirmMock.mockResolvedValue(false);

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.send",
          argv: ["node", "openmeld", "space", "send"],
        }),
        requirement: {
          mode: "required",
          stage: "before-entry",
        },
      });

      // Declining a required update must surface as a non-zero failure, not a
      // silent exit-0 "cancelled".
      expect(result).toEqual({
        status: "blocked",
        exitCode: 1,
      });
      expect(runUpgradeMock).not.toHaveBeenCalled();
      expect(rerunCurrentCommandWithEnvMock).not.toHaveBeenCalled();
    });
  });

  it("reruns a required product command after the CLI update succeeds", async () => {
    await withTempHome(async () => {
      const argv = ["node", "openmeld", "space", "send", "--view", "human"];

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.send",
          argv,
        }),
        requirement: {
          mode: "required",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({
        status: "blocked",
        exitCode: 0,
      });
      expect(runUpgradeMock).toHaveBeenCalledWith({
        yes: true,
        view: "human",
      });
      expect(rerunCurrentCommandWithEnvMock).toHaveBeenCalledWith({
        argv,
        env: {
          OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE: "1",
        },
      });
    });
  });

  it("continues a required product command when npm latest cannot be checked", async () => {
    await withTempHome(async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      resetVersionCheckCacheForTests();

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.send",
          argv: ["node", "openmeld", "space", "send"],
        }),
        requirement: {
          mode: "required",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({
        status: "continue",
      });
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("reuses a fresh local version check for optional command checks", async () => {
    await withTempHome(async () => {
      const checkedAt = new Date().toISOString();
      await writeVersionState({
        v: 1,
        last_version: packageJson.version,
        latest_version: packageJson.version,
        last_checked_at: checkedAt,
        dismissed_version: null,
        updated_at: checkedAt,
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      resetVersionCheckCacheForTests();

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.create",
          argv: ["node", "openmeld", "space", "create"],
        }),
        requirement: {
          mode: "optional",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({
        status: "continue",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("does not run npm latest checks for dev lane setup", async () => {
    await withTempHome(async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      resetVersionCheckCacheForTests();

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "setup",
          argv: ["node", "openmeld-dev", "setup"],
          environmentTarget: {
            authBaseUrl: "http://localhost:8788",
            gatewayUrl: "http://localhost:8080",
            preset: "dev-local",
            userFacingCommand: "openmeld-dev",
          },
        }),
        requirement: {
          mode: "required",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({
        status: "continue",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("blocks a non-interactive required product command when the CLI is outdated", async () => {
    await withTempHome(async () => {
      const presenter = createPresenter();

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.send",
          argv: ["node", "openmeld", "space", "send", "--view", "agent"],
          runtime: {
            viewMode: "agent",
            resolvedView: "agent",
            interactive: false,
          },
          presenter,
          allowPrompt: false,
        }),
        requirement: {
          mode: "required",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({
        status: "blocked",
        exitCode: 1,
        jsonError: {
          code: "upgrade.required",
          message: expect.stringContaining("required OpenMeld CLI update"),
        },
      });
      expect(presenter.data).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "command.entry.cli_update.status",
          payload: expect.objectContaining({
            status: "blocked",
            code: "upgrade.required",
          }),
        })
      );
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("blocks an agent --json command below the required floor with a structured envelope", async () => {
    await withTempHome(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          npmLatestResponse({
            version: "9.9.9",
            minRequiredCliVersion: "9.0.0",
          })
        )
      );
      resetVersionCheckCacheForTests();
      const presenter = createPresenter();

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.send",
          argv: ["node", "openmeld", "space", "send", "--json"],
          runtime: {
            viewMode: "agent",
            resolvedView: "agent",
            interactive: false,
          },
          presenter,
          allowPrompt: false,
          jsonOutput: true,
        }),
        requirement: {
          mode: "optional",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({
        status: "blocked",
        exitCode: 1,
        jsonError: {
          code: "upgrade.required",
          message: expect.stringContaining("required OpenMeld CLI update"),
        },
      });
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("fails non-zero on a human floor breach when the update is declined", async () => {
    await withTempHome(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          npmLatestResponse({
            version: "9.9.9",
            minRequiredCliVersion: "9.0.0",
          })
        )
      );
      resetVersionCheckCacheForTests();
      confirmMock.mockResolvedValue(false);

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.send",
          argv: ["node", "openmeld", "space", "send"],
        }),
        requirement: {
          mode: "optional",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({ status: "blocked", exitCode: 1 });
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("lets an optional update through silently under --json", async () => {
    await withTempHome(async () => {
      const presenter = createPresenter();

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "space.send",
          argv: ["node", "openmeld", "space", "send", "--json"],
          runtime: {
            viewMode: "agent",
            resolvedView: "agent",
            interactive: false,
          },
          presenter,
          allowPrompt: false,
          jsonOutput: true,
        }),
        requirement: {
          mode: "optional",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({ status: "continue" });
      expect(presenter.data).not.toHaveBeenCalled();
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("does not block doctor even below the required floor", async () => {
    await withTempHome(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          npmLatestResponse({
            version: "9.9.9",
            minRequiredCliVersion: "9.0.0",
          })
        )
      );
      resetVersionCheckCacheForTests();
      const presenter = createPresenter();

      const result = await runCliUpdateCheck({
        context: createContext({
          entryName: "doctor",
          argv: ["node", "openmeld", "doctor", "--json"],
          runtime: {
            viewMode: "agent",
            resolvedView: "agent",
            interactive: false,
          },
          presenter,
          allowPrompt: false,
          jsonOutput: true,
        }),
        requirement: {
          mode: "optional",
          stage: "before-entry",
        },
      });

      expect(result).toEqual({ status: "continue" });
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });

  it("never blocks or probes the service lifecycle/liveness surface", async () => {
    await withTempHome(async () => {
      // A floor breach would otherwise block; these entries must skip the check
      // entirely — no block and no network probe (the daemon would crash-loop,
      // the GUI liveness probe would lose status).
      const fetchMock = vi.fn().mockResolvedValue(
        npmLatestResponse({
          version: "9.9.9",
          minRequiredCliVersion: "9.0.0",
        })
      );
      vi.stubGlobal("fetch", fetchMock);
      resetVersionCheckCacheForTests();

      for (const entryName of [
        "service.run",
        "service.status",
        "service.snapshot",
      ] as const) {
        const result = await runCliUpdateCheck({
          context: createContext({
            entryName,
            argv: ["node", "openmeld", "service", "run"],
          }),
          requirement: {
            mode: "optional",
            stage: "before-entry",
          },
        });
        expect(result).toEqual({ status: "continue" });
      }

      expect(fetchMock).not.toHaveBeenCalled();
      expect(runUpgradeMock).not.toHaveBeenCalled();
    });
  });
});
