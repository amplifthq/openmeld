import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import {
  runUpgrade,
  UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG,
} from "../src/commands/upgrade";
import {
  readVersionState,
  resetVersionCheckCacheForTests,
} from "../src/config/version-state";
import { MANUAL_OPENMELD_UPGRADE_COMMAND } from "../src/runtime/manual-upgrade";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { seedVersionState } from "./helpers/version";

const {
  canUseInteractivePromptsMock,
  confirmMock,
  inspectDaemonServiceInventoryMock,
  isCancelMock,
  resolveDaemonServiceAlignmentDecisionMock,
  runDaemonServiceFullAlignmentMock,
} = vi.hoisted(() => ({
  canUseInteractivePromptsMock: vi.fn(),
  confirmMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  isCancelMock: vi.fn((value: unknown) => value === "__cancel__"),
  resolveDaemonServiceAlignmentDecisionMock: vi.fn(),
  runDaemonServiceFullAlignmentMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process"
    );
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: (value: unknown) => isCancelMock(value),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: (context: unknown) =>
    canUseInteractivePromptsMock(context),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-inventory")
  >("../src/local-service/lifecycle/daemon-service-inventory");
  return {
    ...actual,
    inspectDaemonServiceInventory: (...args: unknown[]) =>
      inspectDaemonServiceInventoryMock(...args),
  };
});

vi.mock(
  "../src/local-service/lifecycle/daemon-service-alignment-target",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-alignment-target")
    >("../src/local-service/lifecycle/daemon-service-alignment-target");
    return {
      ...actual,
      resolveDaemonServiceAlignmentDecision: (...args: unknown[]) =>
        resolveDaemonServiceAlignmentDecisionMock(...args),
    };
  }
);

vi.mock(
  "../src/local-service/lifecycle/daemon-service-alignment-executor",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-alignment-executor")
    >("../src/local-service/lifecycle/daemon-service-alignment-executor");
    return {
      ...actual,
      runDaemonServiceFullAlignment: (...args: unknown[]) =>
        runDaemonServiceFullAlignmentMock(...args),
    };
  }
);

describe("openmeld upgrade", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    resetVersionCheckCacheForTests();
    canUseInteractivePromptsMock.mockReset().mockReturnValue(false);
    confirmMock.mockReset().mockResolvedValue(true);
    inspectDaemonServiceInventoryMock.mockReset().mockResolvedValue({});
    isCancelMock.mockReset().mockImplementation((value: unknown) => {
      return value === "__cancel__";
    });
    resolveDaemonServiceAlignmentDecisionMock.mockReset().mockReturnValue({
      status: "already_aligned",
      reasonCodes: [],
    });
    runDaemonServiceFullAlignmentMock.mockReset().mockResolvedValue({
      status: "aligned",
      targetVersion: "9.9.9",
      inventoryBefore: {},
      inventoryAfter: {},
      reasonCodes: [],
      completedSteps: [],
      restoredBackground: false,
      backupDataPath: null,
      errorMessage: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires reset when version metadata is missing", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runUpgrade({
            view: "agent",
            check: true,
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      expect(stdout).toContain('"code":"upgrade.agent_overview"');
      expect(stdout).toContain('"code":"upgrade.metadata.missing"');
      expect(stdout).toContain(MANUAL_OPENMELD_UPGRADE_COMMAND);
    });
  });

  it("emits structured check result in agent view", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runUpgrade({
          view: "agent",
          check: true,
        });
      });

      expect(stdout).toContain('"code":"upgrade.agent_overview"');
      expect(stdout).toContain('"code":"upgrade.check"');
      expect(stdout).toContain('"status":"outdated"');
      expect(stdout).toContain('"latestVersion":"9.9.9"');
    });
  });

  it("clears a malformed cached floor when upgrade refreshes version metadata", async () => {
    await withTempHome(async (home) => {
      const openMeldDir = join(home, ".openmeld");
      await mkdir(openMeldDir, { recursive: true });
      const checkedAt = new Date().toISOString();
      await writeFile(
        join(openMeldDir, "version.json"),
        `${JSON.stringify(
          {
            v: 1,
            last_version: packageJson.version,
            latest_version: "9.9.9",
            last_checked_at: checkedAt,
            dismissed_version: null,
            required_floor: "9.0.0+bad meta",
            updated_at: checkedAt,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: packageJson.version }), {
          status: 200,
        })
      );

      await runUpgrade({
        view: "agent",
        check: true,
      });

      const state = await readVersionState();
      expect(state).toMatchObject({
        last_version: packageJson.version,
        latest_version: packageJson.version,
      });
      expect(state?.required_floor).toBeUndefined();
    });
  });

  it("requires --yes in non-interactive mode when upgrade is available", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );

      let thrown: unknown = null;
      try {
        await runUpgrade({
          view: "agent",
        });
      } catch (error) {
        thrown = error;
      }
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld upgrade in agent view requires --yes before installing updates."
      );
      expect(message).toContain("[FOR HUMAN OPERATORS]");
      expect(message).toContain("[FOR AGENTS]");
      expect(message).toContain("openmeld upgrade --yes");
    });
  });

  it("blocks upgrade when version check fails because downgrade direction cannot be verified", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockRejectedValueOnce(new Error("network down"));

      let thrown: unknown = null;
      try {
        await runUpgrade({
          view: "agent",
        });
      } catch (error) {
        thrown = error;
      }
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "Upgrade stopped because downgrade protection requires confirming that npm latest is newer than the current CLI."
      );
      expect(message).toContain(MANUAL_OPENMELD_UPGRADE_COMMAND);
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  it("blocks install when version check fails because downgrade direction is unknown", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const beforeState = await readVersionState();
      expect(beforeState).not.toBeNull();

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockRejectedValueOnce(new Error("network down"));
      let thrown: unknown = null;
      try {
        await runUpgrade({
          view: "agent",
          yes: true,
        });
      } catch (error) {
        thrown = error;
      }

      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "Upgrade stopped because downgrade protection requires confirming that npm latest is newer than the current CLI."
      );
      expect(message).toContain(MANUAL_OPENMELD_UPGRADE_COMMAND);

      const afterState = await readVersionState();
      expect(afterState).toEqual(beforeState);
      expect(spawn).not.toHaveBeenCalled();
      expect(runDaemonServiceFullAlignmentMock).not.toHaveBeenCalled();
    });
  });

  it("blocks downgrade when npm latest is older than the current CLI", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "0.0.1" }), {
          status: 200,
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runUpgrade({
          view: "agent",
        });
      });

      expect(stdout).toContain('"code":"upgrade.downgrade_blocked"');
      expect(stdout).toContain('"status":"downgrade_blocked"');
      expect(spawn).not.toHaveBeenCalled();
      expect(runDaemonServiceFullAlignmentMock).not.toHaveBeenCalled();
    });
  });

  it("installs latest and hands off service alignment to the latest binary", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );
      const globalInstall = await createFakeGlobalCliInstall(home);
      const originalArgvEntry = process.argv[1];
      process.argv[1] = globalInstall.cliScriptPath;
      mockSpawnSequence([
        { code: 0 },
        {
          code: 0,
          stdout:
            '{"type":"data","code":"upgrade.reconcile.completed","payload":{"ok":true}}\n',
        },
      ]);

      try {
        const { stdout } = await withCapturedStdio(async () => {
          await runUpgrade({
            view: "agent",
            yes: true,
          });
        });

        expect(vi.mocked(spawn).mock.calls).toHaveLength(2);
        const [firstSpawnCommand, firstSpawnArgs] =
          vi.mocked(spawn).mock.calls[0] ?? [];
        const expectedNpmInstallSpawn = resolveExpectedNpmInstallSpawnSpec();
        if (firstSpawnCommand === expectedNpmInstallSpawn.fallbackCommand) {
          expect(firstSpawnArgs?.[0]).toBe(
            expectedNpmInstallSpawn.fallbackArgsPrefix[0]
          );
        } else {
          expect(firstSpawnCommand).toBe(
            expectedNpmInstallSpawn.wrapperCommand
          );
        }
        expect(vi.mocked(spawn).mock.calls[0]?.[1]?.slice(-5)).toEqual([
          "install",
          "-g",
          "--prefix",
          globalInstall.globalPrefix,
          "openmeld@latest",
        ]);
        expect(vi.mocked(spawn).mock.calls[1]?.[0]).toBe(process.execPath);
        expect(vi.mocked(spawn).mock.calls[1]?.[1]).toEqual([
          globalInstall.cliScriptPath,
          "--view",
          "agent",
          "upgrade",
          UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG,
        ]);
        expect(stdout).toContain('"code":"upgrade.reconcile.completed"');
        expect(stdout).toContain('"code":"upgrade.completed"');
      } finally {
        process.argv[1] = originalArgvEntry ?? process.execPath;
      }
    });
  });

  it("runs upgrade in human interactive mode with a single confirmation prompt", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      canUseInteractivePromptsMock.mockReturnValue(true);
      confirmMock.mockResolvedValueOnce(true);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );
      const globalInstall = await createFakeGlobalCliInstall(home);
      const originalArgvEntry = process.argv[1];
      process.argv[1] = globalInstall.cliScriptPath;
      mockSpawnSequence([{ code: 0 }, { code: 0 }]);

      try {
        const { stdout } = await withCapturedStdio(async () => {
          await runUpgrade({
            view: "human",
          });
        });

        expect(confirmMock).toHaveBeenCalledTimes(1);
        expect(stdout).toContain("OpenMeld CLI upgrade completed.");
      } finally {
        process.argv[1] = originalArgvEntry ?? process.execPath;
      }
    });
  });

  it("uses inherited stdio for the latest-binary handoff in human TTY mode", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );
      const globalInstall = await createFakeGlobalCliInstall(home);
      const originalArgvEntry = process.argv[1];
      process.argv[1] = globalInstall.cliScriptPath;
      mockSpawnSequence([{ code: 0 }, { code: 0 }]);

      const stdoutDescriptor = Object.getOwnPropertyDescriptor(
        process.stdout,
        "isTTY"
      );
      const stderrDescriptor = Object.getOwnPropertyDescriptor(
        process.stderr,
        "isTTY"
      );
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: true,
      });

      try {
        await runUpgrade({
          view: "human",
          yes: true,
        });
        expect(vi.mocked(spawn).mock.calls[1]?.[2]).toEqual(
          expect.objectContaining({
            stdio: ["ignore", "inherit", "inherit"],
          })
        );
      } finally {
        if (stdoutDescriptor) {
          Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
        }
        if (stderrDescriptor) {
          Object.defineProperty(process.stderr, "isTTY", stderrDescriptor);
        }
        process.argv[1] = originalArgvEntry ?? process.execPath;
      }
    });
  });

  it("fails upgrade when the latest-binary alignment handoff exits non-zero", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );
      const globalInstall = await createFakeGlobalCliInstall(home);
      const originalArgvEntry = process.argv[1];
      process.argv[1] = globalInstall.cliScriptPath;
      mockSpawnSequence([
        { code: 0 },
        {
          code: 1,
          stdout:
            '{"type":"data","code":"upgrade.reconcile.failed","payload":{"ok":false}}\n',
        },
      ]);

      try {
        const { stdout } = await withCapturedStdio(async () => {
          await expect(
            runUpgrade({
              view: "agent",
              yes: true,
            })
          ).rejects.toThrow(
            "Latest OpenMeld CLI handoff reported a service alignment failure."
          );
        });

        expect(stdout).toContain('"code":"upgrade.reconcile.failed"');
        expect(stdout).not.toContain('"code":"upgrade.completed"');
      } finally {
        process.argv[1] = originalArgvEntry ?? process.execPath;
      }
    });
  });

  it("shows the manual install fallback when npm install fails", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );
      const globalInstall = await createFakeGlobalCliInstall(home);
      const originalArgvEntry = process.argv[1];
      process.argv[1] = globalInstall.cliScriptPath;
      mockSpawnSequence([
        {
          code: 1,
          stderr: "npm ERR! registry timeout",
        },
      ]);

      try {
        await expect(
          runUpgrade({
            view: "human",
            yes: true,
          })
        ).rejects.toThrow(
          `npm install -g --prefix ${globalInstall.globalPrefix} openmeld@latest`
        );
        expect(home.length).toBeGreaterThan(0);
      } finally {
        process.argv[1] = originalArgvEntry ?? process.execPath;
      }
    });
  });

  it("emits a fallback error when the human TTY handoff exits non-zero without output", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
        })
      );
      const globalInstall = await createFakeGlobalCliInstall(home);
      const originalArgvEntry = process.argv[1];
      process.argv[1] = globalInstall.cliScriptPath;
      mockSpawnSequence([{ code: 0 }, { code: 1 }]);

      const stdoutDescriptor = Object.getOwnPropertyDescriptor(
        process.stdout,
        "isTTY"
      );
      const stderrDescriptor = Object.getOwnPropertyDescriptor(
        process.stderr,
        "isTTY"
      );
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: true,
      });

      try {
        await expect(
          runUpgrade({
            view: "human",
            yes: true,
          })
        ).rejects.toThrow(
          "Service reconcile failed: latest CLI handoff exited with status 1. Please run `openmeld service repair` manually."
        );
      } finally {
        if (stdoutDescriptor) {
          Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
        }
        if (stderrDescriptor) {
          Object.defineProperty(process.stderr, "isTTY", stderrDescriptor);
        }
        process.argv[1] = originalArgvEntry ?? process.execPath;
      }
    });
  });

  it("emits already_current from the hidden internal alignment mode without reinstalling", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      resolveDaemonServiceAlignmentDecisionMock.mockReturnValueOnce({
        status: "already_aligned",
        reasonCodes: [],
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runUpgrade({
          view: "agent",
          internalAlignService: true,
        });
      });

      expect(stdout).toContain('"code":"upgrade.reconcile.already_current"');
      expect(runDaemonServiceFullAlignmentMock).not.toHaveBeenCalled();
    });
  });

  it("runs full alignment in the hidden internal alignment mode for dirty services", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      resolveDaemonServiceAlignmentDecisionMock.mockReturnValueOnce({
        status: "needs_full_alignment",
        reasonCodes: ["bundle_strategy_legacy"],
      });
      runDaemonServiceFullAlignmentMock.mockResolvedValueOnce({
        status: "aligned",
        targetVersion: packageJson.version,
        inventoryBefore: {},
        inventoryAfter: {},
        reasonCodes: [],
        completedSteps: [],
        restoredBackground: false,
        backupDataPath: null,
        errorMessage: null,
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runUpgrade({
          view: "agent",
          internalAlignService: true,
        });
      });

      expect(runDaemonServiceFullAlignmentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: packageJson.version,
          intent: "upgrade_reconcile",
        })
      );
      expect(stdout).toContain('"code":"upgrade.reconcile.completed"');
    });
  });

  it("fails the hidden internal alignment mode when service alignment is blocked", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      resolveDaemonServiceAlignmentDecisionMock.mockReturnValueOnce({
        status: "needs_full_alignment",
        reasonCodes: ["bundle_strategy_legacy"],
      });
      runDaemonServiceFullAlignmentMock.mockResolvedValueOnce({
        status: "blocked",
        targetVersion: packageJson.version,
        inventoryBefore: {},
        inventoryAfter: {},
        reasonCodes: ["duplicate_ownership_uncertain"],
        completedSteps: [],
        restoredBackground: false,
        backupDataPath: null,
        errorMessage: null,
      });

      const { stdout } = await withCapturedStdio(async () => {
        await expect(
          runUpgrade({
            view: "agent",
            internalAlignService: true,
          })
        ).rejects.toThrow("Service alignment is blocked");
      });

      expect(stdout).toContain('"code":"upgrade.reconcile.failed"');
    });
  });

  it("preserves backupDataPath in hidden internal alignment failure output", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      resolveDaemonServiceAlignmentDecisionMock.mockReturnValueOnce({
        status: "needs_full_alignment",
        reasonCodes: ["bundle_strategy_legacy"],
      });
      runDaemonServiceFullAlignmentMock.mockResolvedValueOnce({
        status: "failed",
        targetVersion: packageJson.version,
        inventoryBefore: {},
        inventoryAfter: null,
        reasonCodes: [],
        completedSteps: [],
        restoredBackground: false,
        backupDataPath: "/tmp/openmeld-runtime-backup",
        errorMessage: "runtime restore failed",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await expect(
          runUpgrade({
            view: "agent",
            internalAlignService: true,
          })
        ).rejects.toThrow("runtime restore failed");
      });

      expect(stdout).toContain('"code":"upgrade.reconcile.failed"');
      expect(stdout).toContain(
        '"backupDataPath":"/tmp/openmeld-runtime-backup"'
      );
    });
  });
});

async function createFakeGlobalCliInstall(home: string): Promise<{
  globalPrefix: string;
  cliScriptPath: string;
}> {
  const globalPrefix = join(home, "global-prefix");
  const cliDir = join(globalPrefix, "lib", "node_modules", "openmeld", "dist");
  await mkdir(cliDir, {
    recursive: true,
  });
  const cliScriptPath = join(cliDir, "openmeld.js");
  await writeFile(cliScriptPath, "export {};\n", "utf8");
  const resolvedGlobalPrefix = await realpath(globalPrefix);
  const resolvedCliScriptPath = await realpath(cliScriptPath);
  return {
    globalPrefix: resolvedGlobalPrefix,
    cliScriptPath: resolvedCliScriptPath,
  };
}

function resolveExpectedNpmInstallSpawnSpec(): {
  wrapperCommand: string;
  fallbackCommand: string;
  fallbackArgsPrefix: [string];
} {
  const nodeExecutableDir = dirname(process.execPath);
  return {
    wrapperCommand: join(
      nodeExecutableDir,
      process.platform === "win32" ? "npm.cmd" : "npm"
    ),
    fallbackCommand: process.execPath,
    fallbackArgsPrefix: [
      process.platform === "win32"
        ? join(nodeExecutableDir, "node_modules", "npm", "bin", "npm-cli.js")
        : join(
            nodeExecutableDir,
            "..",
            "lib",
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js"
          ),
    ],
  };
}

function mockSpawnSequence(
  steps: {
    code: number;
    stdout?: string;
    stderr?: string;
  }[]
): void {
  const remainingSteps = [...steps];
  vi.mocked(spawn).mockImplementation(() => {
    const step = remainingSteps.shift();
    if (!step) {
      throw new Error("Unexpected extra spawn invocation.");
    }
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (step.stdout) {
        child.stdout.emit("data", Buffer.from(step.stdout));
      }
      if (step.stderr) {
        child.stderr.emit("data", Buffer.from(step.stderr));
      }
      child.emit("close", step.code);
    });
    return child as never;
  });
}
