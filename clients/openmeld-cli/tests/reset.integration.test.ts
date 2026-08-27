import {
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReset } from "../src/commands/reset";
import { upsertSpaceConfig } from "../src/space/local-state";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { seedVersionState } from "./helpers/version";

const { runSkillsCheckMock, runDaemonTeardownStrictMock } = vi.hoisted(() => ({
  runSkillsCheckMock: vi.fn(),
  runDaemonTeardownStrictMock: vi.fn(),
}));

vi.mock("../src/commands/skills", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/skills")>(
    "../src/commands/skills"
  );
  return {
    ...actual,
    runSkillsCheck: runSkillsCheckMock,
  };
});

vi.mock("../src/commands/service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/commands/service")
  >("../src/commands/service");
  return {
    ...actual,
    runDaemonTeardownStrict: runDaemonTeardownStrictMock,
  };
});

describe("openmeld reset", () => {
  beforeEach(() => {
    runSkillsCheckMock.mockResolvedValue(undefined);
    runDaemonTeardownStrictMock.mockResolvedValue({
      removed: false,
      stopSignal: null,
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    runSkillsCheckMock.mockReset();
    runDaemonTeardownStrictMock.mockReset();
  });

  it("removes local OpenMeld state and reinitializes baseline files", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      await upsertSpaceConfig({
        openMeldProfileId: "mira--aaaaaaaa",
        baseUrl: "https://gateway.internal.example",
        space:
          "1111111111111111111111111111111111111111111111111111111111111111",
        name: "reset-space",
        profileName: "Mira",
      });
      await mkdir(join(home, ".openmeld", "runtime", "logs"), {
        recursive: true,
      });
      await writeFile(
        join(home, ".openmeld", "runtime", "logs", "custom.log"),
        "before reset",
        "utf8"
      );

      await runReset({
        view: "agent",
        yes: true,
      });

      await expect(
        readFile(
          join(home, ".openmeld", "profiles", "mira--aaaaaaaa", "profile.json")
        )
      ).rejects.toThrow();
      await expect(
        readFile(join(home, ".openmeld", "system", "layout.json"), "utf8")
      ).resolves.toContain('"schema": "openmeld-fs-v1"');
      await expect(
        readFile(
          join(home, ".openmeld", "skills", "openmeld-cli", "SKILL.md"),
          "utf8"
        )
      ).resolves.toContain("name:");
      await expect(
        readFile(join(home, ".openmeld", "version.json"), "utf8")
      ).resolves.toContain('"last_version"');
      await expect(
        readFile(
          join(home, ".openmeld", "system", "storage-version.json"),
          "utf8"
        )
      ).resolves.toContain('"storageVersion": 1');
      await expect(readdir(join(home, ".openmeld-backups"))).rejects.toThrow();

      expect(runSkillsCheckMock).toHaveBeenCalledTimes(1);
      expect(runSkillsCheckMock).toHaveBeenCalledWith({
        view: "agent",
        quiet: true,
        suppressAgentOverview: true,
      });
      expect(runDaemonTeardownStrictMock).toHaveBeenCalledTimes(1);
      expect(runDaemonTeardownStrictMock).toHaveBeenCalledWith({
        reason: "reset",
      });
    });
  });

  it("emits current-lane reset evidence in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);

      const { stdout } = await withCapturedStdio(async () => {
        await runReset({
          view: "agent",
          yes: true,
        });
      });

      expect(stdout).toContain('"code":"reset.completed"');
      expect(stdout).toContain('"lane"');
      expect(stdout).toContain('"command":"openmeld"');
      expect(stdout).toContain(`"openMeldHome":"${home}/.openmeld"`);
      expect(stdout).toContain('"resetCommand":"openmeld reset --yes"');
    });
  });

  it("fails fast when strict service teardown fails before destructive cleanup", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      await mkdir(join(home, ".openmeld", "runtime", "logs"), {
        recursive: true,
      });
      await writeFile(
        join(home, ".openmeld", "runtime", "logs", "custom.log"),
        "before reset",
        "utf8"
      );
      runDaemonTeardownStrictMock.mockRejectedValueOnce(
        new Error("strict teardown failed")
      );

      await expect(
        runReset({
          view: "agent",
          yes: true,
        })
      ).rejects.toThrow("strict teardown failed");
      await expect(
        readFile(
          join(home, ".openmeld", "runtime", "logs", "custom.log"),
          "utf8"
        )
      ).resolves.toBe("before reset");
      expect(runSkillsCheckMock).not.toHaveBeenCalled();
    });
  });

  it("requires --yes in non-interactive mode", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      try {
        await runReset({
          view: "agent",
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld reset in agent view requires explicit confirmation flag."
      );
      expect(message).toContain("[FOR HUMAN OPERATORS]");
      expect(message).toContain("[FOR AGENTS]");
      expect(message).toContain("openmeld reset --yes");
    });
  });

  it("rejects unsafe OPENMELD_HOME path for destructive reset", async () => {
    await withTempHome(async () => {
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      try {
        for (const candidate of ["/tmp", "/tmp/cats", "/tmp/stats"]) {
          process.env.OPENMELD_HOME = candidate;
          await expect(
            runReset({
              view: "agent",
              yes: true,
            })
          ).rejects.toThrow("unsafe OpenMeld root path for reset");
        }
      } finally {
        if (previousOpenMeldHome === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        } else {
          process.env.OPENMELD_HOME = previousOpenMeldHome;
        }
      }
    });
  });

  it("allows unsafe OPENMELD_HOME path when OPENMELD_RESET_ALLOW_UNSAFE_HOME=1", async () => {
    await withTempHome(async (home) => {
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      const previousAllowUnsafeHome =
        process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME;
      const sandboxHome = join(home, "sandbox-reset-home");
      try {
        process.env.OPENMELD_HOME = sandboxHome;
        process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME = "1";

        await runReset({
          view: "agent",
          yes: true,
        });

        await expect(
          readFile(join(sandboxHome, "system", "layout.json"), "utf8")
        ).resolves.toContain('"schema": "openmeld-fs-v1"');
      } finally {
        if (previousAllowUnsafeHome === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_RESET_ALLOW_UNSAFE_HOME"
          );
        } else {
          process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME =
            previousAllowUnsafeHome;
        }
        if (previousOpenMeldHome === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        } else {
          process.env.OPENMELD_HOME = previousOpenMeldHome;
        }
      }
    });
  });

  it("still rejects non-temp OPENMELD_HOME when OPENMELD_RESET_ALLOW_UNSAFE_HOME=1", async () => {
    await withTempHome(async (home) => {
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      const previousAllowUnsafeHome =
        process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME;
      const previousTmpdir = process.env.TMPDIR;
      const allowedTempRoot = join(home, "allowed-temp");
      try {
        await mkdir(allowedTempRoot, { recursive: true });
        process.env.TMPDIR = allowedTempRoot;
        process.env.OPENMELD_HOME = join(home, "unsafe-reset-home");
        process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME = "1";

        await expect(
          runReset({
            view: "agent",
            yes: true,
          })
        ).rejects.toThrow("only allows temp directories");
      } finally {
        if (previousAllowUnsafeHome === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_RESET_ALLOW_UNSAFE_HOME"
          );
        } else {
          process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME =
            previousAllowUnsafeHome;
        }
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

  it("rejects tmpdir symlink paths that resolve outside temp root", async () => {
    await withTempHome(async (home) => {
      if (process.platform === "win32") {
        return;
      }

      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      const previousAllowUnsafeHome =
        process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME;
      const previousTmpdir = process.env.TMPDIR;
      const allowedTempRoot = join(home, "allowed-temp");
      const linkPath = join(allowedTempRoot, "openmeld-reset-link");

      try {
        await mkdir(allowedTempRoot, { recursive: true });
        process.env.TMPDIR = allowedTempRoot;
        await symlink(home, linkPath);
        process.env.OPENMELD_HOME = join(linkPath, "sandbox-reset-home");
        process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME = "1";

        await expect(
          runReset({
            view: "agent",
            yes: true,
          })
        ).rejects.toThrow("only allows temp directories");
      } finally {
        await rm(linkPath, { force: true }).catch(() => undefined);
        if (previousAllowUnsafeHome === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_RESET_ALLOW_UNSAFE_HOME"
          );
        } else {
          process.env.OPENMELD_RESET_ALLOW_UNSAFE_HOME =
            previousAllowUnsafeHome;
        }
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

  it("does not create default backup snapshots during reset", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      await upsertSpaceConfig({
        openMeldProfileId: "nova--aaaaaaaa",
        baseUrl: "https://gateway.internal.example",
        space:
          "2222222222222222222222222222222222222222222222222222222222222222",
        name: "retention-space",
        profileName: "Nova",
      });

      await runReset({
        view: "agent",
        yes: true,
      });

      await expect(readdir(join(home, ".openmeld-backups"))).rejects.toThrow();
    });
  });

  it("removes legacy local profile cache without creating backup snapshots", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const profile = "cccccccc-0000-0000-0000-000000000000";
      await upsertSpaceConfig({
        openMeldProfileId: profile,
        baseUrl: "https://gateway.internal.example",
        space:
          "1111111111111111111111111111111111111111111111111111111111111111",
        name: "profile-room",
        profileName: "Default Mira",
      });

      await runReset({
        view: "agent",
        yes: true,
      });

      await expect(
        readFile(
          join(
            home,
            ".openmeld",
            "accounts",
            "unauthenticated",
            "local",
            "profiles",
            profile,
            "space-cache",
            "1111111111111111111111111111111111111111111111111111111111111111.json"
          ),
          "utf8"
        )
      ).rejects.toThrow();
      await expect(readdir(join(home, ".openmeld-backups"))).rejects.toThrow();
    });
  });
});
