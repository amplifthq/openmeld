import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const {
  cancelMock,
  clearLaneAuthSessionMock,
  confirmMock,
  getLaneAuthSessionMetadataMock,
  isCancelMock,
  removeLaneOpenMeldHomeMock,
  runLaneDaemonTeardownMock,
  runLaneSkillsCleanupMock,
  selectMock,
  textMock,
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  clearLaneAuthSessionMock: vi.fn(),
  confirmMock: vi.fn(),
  getLaneAuthSessionMetadataMock: vi.fn(),
  isCancelMock: vi.fn((value: unknown) => value === "__cancel__"),
  removeLaneOpenMeldHomeMock: vi.fn(),
  runLaneDaemonTeardownMock: vi.fn(),
  runLaneSkillsCleanupMock: vi.fn(),
  selectMock: vi.fn(),
  textMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: cancelMock,
  confirm: confirmMock,
  isCancel: (value: unknown) => isCancelMock(value),
  select: selectMock,
  text: textMock,
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

vi.mock("../src/uninstall/adapters", () => ({
  clearLaneAuthSession: clearLaneAuthSessionMock,
  getLaneAuthSessionMetadata: getLaneAuthSessionMetadataMock,
  removeLaneOpenMeldHome: removeLaneOpenMeldHomeMock,
  runLaneDaemonTeardown: runLaneDaemonTeardownMock,
  runLaneSkillsCleanup: runLaneSkillsCleanupMock,
}));

import { runUninstall } from "../src/commands/uninstall";

describe("uninstall command", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    clearLaneAuthSessionMock.mockReset().mockResolvedValue(undefined);
    confirmMock.mockReset().mockResolvedValue(true);
    getLaneAuthSessionMetadataMock.mockReset().mockResolvedValue(null);
    isCancelMock.mockReset().mockImplementation((value: unknown) => {
      return value === "__cancel__";
    });
    removeLaneOpenMeldHomeMock
      .mockReset()
      .mockImplementation(async ({ lane }) => ({
        removed: true,
        homePath: `/tmp/${lane}`,
      }));
    runLaneDaemonTeardownMock.mockReset().mockResolvedValue({
      removed: true,
    });
    runLaneSkillsCleanupMock.mockReset().mockResolvedValue(undefined);
    selectMock.mockReset();
    textMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
    Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("emits uninstall overview and completed payload in agent view", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    await withTempHome(async () => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runUninstall({
          view: "agent",
          yes: true,
          keepSkills: true,
          keepAuthTokens: true,
        });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      const completedPayload = envelopes[1]?.payload as
        | {
            finalCliRemoval?: {
              command?: string;
            };
          }
        | undefined;
      expect(envelopes[0]?.code).toBe("uninstall.agent_overview");
      expect(envelopes[1]?.code).toBe("uninstall.completed");
      expect(completedPayload?.finalCliRemoval?.command).toBe(
        "pnpm openmeld:dev:remove"
      );
      expect(removeLaneOpenMeldHomeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lane: "dev-local",
          openMeldHome: process.env.OPENMELD_HOME,
        })
      );
      expect(selectMock).not.toHaveBeenCalled();
      expect(confirmMock).not.toHaveBeenCalled();
    });
  });

  it("prompts for skills, auth tokens, and confirmation in human view", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";
    selectMock.mockResolvedValueOnce("keep").mockResolvedValueOnce("keep");

    await withTempHome(async () => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runUninstall({
          view: "human",
        });
      });

      expect(selectMock).toHaveBeenCalledTimes(2);
      expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
        message: "OpenMeld-installed skills?",
      });
      expect(selectMock.mock.calls[1]?.[0]).toMatchObject({
        message: "Your OpenMeld sign-in?",
      });
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(stdout).toContain("⚠️ Before You Remove OpenMeld");
      expect(stdout).toContain(
        "This step: Keep or remove the skills OpenMeld installed for OpenMeld Dev."
      );
      expect(stdout).toContain("If removed: OpenMeld deletes them.");
      expect(stdout).toContain("Recommend: Keep them");
      expect(stdout).toContain(
        "This step: Keep or remove your OpenMeld sign-in on this Mac."
      );
      expect(stdout).toContain("If removed: OpenMeld signs you out here.");
      expect(stdout).toContain("Recommend: Keep it");
      expect(stdout).toContain("⚠️ Remove OpenMeld Dev?");
      expect(stdout).toContain("👋 OpenMeld Dev Removed");
      expect(stdout).toContain("Status:");
      expect(stdout).toContain("Done");
      const completedCardStart = stdout.indexOf("👋 OpenMeld Dev Removed");
      const completedCard = stdout.slice(completedCardStart);
      expect(completedCard).not.toContain("What stays:");
      expect(completedCard).not.toContain("The OpenMeld command you used");
      expect(completedCard).toContain(
        "Next step: Run pnpm openmeld:dev:remove to finish removing OpenMeld."
      );
    });
  });

  it("uses device-scoped skills copy and typed confirmation for all-lanes", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";
    selectMock.mockResolvedValueOnce("keep").mockResolvedValueOnce("keep");
    textMock.mockResolvedValueOnce("UNINSTALL ALL");

    await withTempHome(async () => {
      await withCapturedStdio(async () => {
        await runUninstall({
          view: "human",
          allLanes: true,
        });
      });

      expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
        message: "OpenMeld-installed skills on this Mac?",
      });
      expect(textMock).toHaveBeenCalledTimes(1);
      expect(textMock.mock.calls[0]?.[0]).toMatchObject({
        message: 'Type "UNINSTALL ALL" to continue.',
      });
      expect(runLaneDaemonTeardownMock).toHaveBeenCalledTimes(3);
      expect(removeLaneOpenMeldHomeMock).toHaveBeenCalledTimes(3);
    });
  });

  it("prints the shared auth warning before completion when another lane shares the token identity", async () => {
    process.env.OPENMELD_ENV_PRESET = "canary";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";
    selectMock.mockResolvedValueOnce("keep").mockResolvedValueOnce("remove");
    getLaneAuthSessionMetadataMock.mockImplementation(({ lane }) => {
      if (lane === "prod" || lane === "canary") {
        return {
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-03-09T00:00:00.000Z",
        };
      }
      return null;
    });

    await withTempHome(async () => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runUninstall({
          view: "human",
        });
      });

      expect(stdout).toContain(
        "This sign-in is also used by another OpenMeld lane on this device."
      );
    });
  });

  it("requires explicit keep/remove flags in non-interactive agent mode", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    await withTempHome(async () => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await expect(
          runUninstall({
            view: "agent",
            yes: true,
          })
        ).rejects.toThrow(
          "openmeld uninstall requires --keep-skills or --remove-skills in non-interactive mode"
        );
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("uninstall.agent_overview");
    });
  });

  it("requires --force together with --all-lanes in non-interactive mode", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    await withTempHome(async () => {
      await expect(
        runUninstall({
          view: "agent",
          allLanes: true,
          yes: true,
          keepSkills: true,
          keepAuthTokens: true,
        })
      ).rejects.toThrow(
        "openmeld uninstall --all-lanes requires --yes --force in non-interactive mode"
      );
    });
  });

  it("uses internal safe validation mode for a temp OPENMELD_HOME without touching service, skills, or auth tokens", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    await withTempHome(async () => {
      const { plainStdout: stdout } = await withCapturedStdio(async () => {
        await runUninstall({
          view: "agent",
          yes: true,
          internalSafeValidation: true,
        });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[1]?.payload?.internalSafeValidation).toBe(true);
      expect(envelopes[1]?.payload?.skillsAction).toBe("keep");
      expect(envelopes[1]?.payload?.authTokenAction).toBe("keep");
      expect(runLaneDaemonTeardownMock).not.toHaveBeenCalled();
      expect(runLaneSkillsCleanupMock).not.toHaveBeenCalled();
      expect(clearLaneAuthSessionMock).not.toHaveBeenCalled();
      expect(removeLaneOpenMeldHomeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          lane: "dev-local",
          openMeldHome: process.env.OPENMELD_HOME,
        })
      );
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  it("blocks internal safe validation when all-lanes is requested", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    await withTempHome(async () => {
      await expect(
        runUninstall({
          view: "agent",
          allLanes: true,
          yes: true,
          internalSafeValidation: true,
        })
      ).rejects.toThrow(
        "openmeld uninstall --internal-safe-validation only supports the local OpenMeld installation under test"
      );
    });
  });

  it("blocks internal safe validation when OPENMELD_HOME is not under the temp root", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    await withTempHome(async (home) => {
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      const previousTmpdir = process.env.TMPDIR;
      const allowedTempRoot = join(home, "allowed-temp");

      try {
        await mkdir(allowedTempRoot, { recursive: true });
        process.env.TMPDIR = allowedTempRoot;
        process.env.OPENMELD_HOME = join(home, "unsafe-uninstall-home");

        await expect(
          runUninstall({
            view: "agent",
            yes: true,
            internalSafeValidation: true,
          })
        ).rejects.toThrow(
          "openmeld uninstall --internal-safe-validation requires the local OpenMeld home under"
        );
      } finally {
        if (previousOpenMeldHome === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        } else {
          process.env.OPENMELD_HOME = previousOpenMeldHome;
        }
        if (previousTmpdir === undefined) {
          Reflect.deleteProperty(process.env, "TMPDIR");
        } else {
          process.env.TMPDIR = previousTmpdir;
        }
      }
    });
  });

  it("blocks internal safe validation when remove flags are requested", async () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    await withTempHome(async () => {
      await expect(
        runUninstall({
          view: "agent",
          yes: true,
          removeSkills: true,
          internalSafeValidation: true,
        })
      ).rejects.toThrow(
        "openmeld uninstall --internal-safe-validation always keeps OpenMeld-installed skills and OpenMeld auth tokens"
      );
    });
  });
});

function parseAgentEnvelopes(stdout: string): Array<{
  code?: string;
  payload?: Record<string, unknown>;
}> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          code?: string;
          payload?: Record<string, unknown>;
        }
    );
}
