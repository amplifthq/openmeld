import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daemonRuntimeLeasePath,
  writeDaemonRuntimeLease,
} from "../src/config/daemon-runtime-lease";
import {
  clearDaemonServiceRuntimeState,
  DAEMON_HEARTBEAT_STALE_MS,
  DAEMON_SERVICE_LIFECYCLE_LOCK_KEY,
  DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE,
  DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
  daemonRuntimeRootPath,
  daemonServiceRuntimeStatePath,
  daemonStatePath,
  daemonTokenPath,
  ensureDaemonControlPlaneToken,
  getDaemonRuntimeStatus,
  getDaemonStatus,
  installDaemon,
  readDaemonControlPlaneToken,
  readDaemonServiceLifecycleLockMeta,
  readDaemonServiceLifecycleLockMetaWithCleanup,
  resolveDaemonControlPlaneEndpoint,
  setDaemonServiceRuntimeState,
  uninstallDaemon,
} from "../src/config/daemon-state";
import { locksDir } from "../src/config/paths";
import {
  ensureDaemonInstalledForCliStartup,
  ensureDaemonVersionForCliStartup,
} from "../src/local-service/lifecycle/daemon-bootstrap";
import { withTempHome } from "./helpers/fs";

const ORIGINAL_PLATFORM = process.platform;

function setProcessPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  });
}

describe("local service state", () => {
  afterEach(() => {
    setProcessPlatform(ORIGINAL_PLATFORM);
  });

  it("installs local service runtime layout and state file", async () => {
    await withTempHome(async () => {
      const result = await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });
      expect(result.status).toBe("installed");
      expect(result.state.daemonVersion).toBe("1.0.0");
      expect(await pathExists(daemonStatePath())).toBe(true);
      expect(await pathExists(daemonRuntimeRootPath())).toBe(true);
      expect(await pathExists(daemonTokenPath())).toBe(true);
      const tokenStats = await stat(daemonTokenPath());
      expect(tokenStats.mode.toString(8).slice(-3)).toBe("600");

      const status = await getDaemonStatus();
      expect(status.installed).toBe(true);
      expect(status.state?.daemonVersion).toBe("1.0.0");
    });
  });

  it("re-installs local service with newer version while preserving installedAt", async () => {
    await withTempHome(async () => {
      const firstInstall = await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });

      const reinstalled = await installDaemon({
        daemonVersion: "2.0.0",
        source: "cli.auto_check",
      });
      expect(reinstalled.status).toBe("installed");
      expect(reinstalled.state.daemonVersion).toBe("2.0.0");
      expect(reinstalled.state.installedAt).toBe(
        firstInstall.state.installedAt
      );

      const noChange = await installDaemon({
        daemonVersion: "2.0.0",
        source: "cli.auto_check",
      });
      expect(noChange.status).toBe("already_installed");
      expect(noChange.state.daemonVersion).toBe("2.0.0");
    });
  });

  it("uninstalls local service artifacts", async () => {
    await withTempHome(async () => {
      const emptyUninstall = await uninstallDaemon();
      expect(emptyUninstall.removed).toBe(false);

      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });
      const removed = await uninstallDaemon();
      expect(removed.removed).toBe(true);
      expect(await pathExists(daemonStatePath())).toBe(false);
      expect(await pathExists(daemonTokenPath())).toBe(false);
      expect(await pathExists(daemonRuntimeRootPath())).toBe(false);

      const status = await getDaemonStatus();
      expect(status.installed).toBe(false);
      expect(status.state).toBeNull();
    });
  });

  it("reads stale lifecycle lock metadata without deleting the lock file", async () => {
    await withTempHome(async () => {
      const lockDir = locksDir(DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE);
      const lockPath = join(
        lockDir,
        `${DAEMON_SERVICE_LIFECYCLE_LOCK_KEY}.lock`
      );
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        lockPath,
        `${JSON.stringify({
          pid: 4949,
          intent: "run_foreground",
          command: "openmeld service run",
        })}\n`,
        "utf8"
      );

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
        const err = new Error("no such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }) as typeof process.kill);

      try {
        await expect(readDaemonServiceLifecycleLockMeta()).resolves.toEqual(
          expect.objectContaining({
            pid: 4949,
            intent: "run_foreground",
            command: "openmeld service run",
          })
        );
        await expect(access(lockPath)).resolves.toBeUndefined();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("preserves an orphaned legacy lifecycle lock until explicit local-state repair", async () => {
    await withTempHome(async () => {
      const lockDir = locksDir(DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE);
      const lockPath = join(
        lockDir,
        `${DAEMON_SERVICE_LIFECYCLE_LOCK_KEY}.lock`
      );
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        lockPath,
        `${JSON.stringify({
          pid: 5050,
          intent: "run_foreground",
          command: "openmeld service run",
        })}\n`,
        "utf8"
      );

      const killSpy = vi.spyOn(process, "kill").mockImplementation((() => {
        const err = new Error("no such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }) as typeof process.kill);

      try {
        await expect(
          readDaemonServiceLifecycleLockMetaWithCleanup()
        ).resolves.toEqual(
          expect.objectContaining({
            pid: 5050,
            intent: "run_foreground",
            command: "openmeld service run",
          })
        );
        await expect(access(lockPath)).resolves.toBeUndefined();
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("uses a short tmpdir socket path for Unix local service control endpoints", async () => {
    await withTempHome(() => {
      setProcessPlatform("darwin");

      const runtimeRoot = daemonRuntimeRootPath();
      const suffix = createHash("sha256")
        .update(runtimeRoot)
        .digest("hex")
        .slice(0, 24);

      expect(resolveDaemonControlPlaneEndpoint()).toBe(
        join(tmpdir(), `openmeld-daemon-control-${suffix}.sock`)
      );

      return Promise.resolve();
    });
  });

  it("keeps the hashed Windows named pipe format for local service control endpoints", async () => {
    await withTempHome(() => {
      setProcessPlatform("win32");

      const runtimeRoot = daemonRuntimeRootPath();
      const suffix = createHash("sha256")
        .update(runtimeRoot)
        .digest("hex")
        .slice(0, 24);

      expect(resolveDaemonControlPlaneEndpoint()).toBe(
        `\\\\.\\pipe\\openmeld-daemon-control-${suffix}`
      );

      return Promise.resolve();
    });
  });

  it("auto-installs local service during cli startup bootstrap when missing", async () => {
    await withTempHome(async () => {
      const first = await ensureDaemonInstalledForCliStartup({
        daemonVersion: "9.9.9",
      });
      expect(first.status).toBe("installed");
      expect(first.mode).toBe("always");
      expect(first.autoInstalled).toBe(true);
      expect(first.state?.daemonVersion).toBe("9.9.9");

      const second = await ensureDaemonInstalledForCliStartup({
        daemonVersion: "9.9.9",
      });
      expect(second.status).toBe("already_installed");
      expect(second.mode).toBe("always");
      expect(second.autoInstalled).toBe(false);
      expect(second.state?.daemonVersion).toBe("9.9.9");
    });
  });

  it("supports ask mode with explicit confirmation callback", async () => {
    await withTempHome(async () => {
      const skipped = await ensureDaemonInstalledForCliStartup({
        daemonVersion: "9.9.9",
        mode: "ask",
        canPrompt: true,
        confirmInstall: async () => false,
      });
      expect(skipped.status).toBe("skipped");
      expect(skipped.mode).toBe("ask");
      expect(skipped.autoInstalled).toBe(false);
      expect(skipped.state).toBeNull();

      const installed = await ensureDaemonInstalledForCliStartup({
        daemonVersion: "9.9.9",
        mode: "ask",
        canPrompt: true,
        confirmInstall: async () => true,
      });
      expect(installed.status).toBe("installed");
      expect(installed.mode).toBe("ask");
      expect(installed.autoInstalled).toBe(true);
      expect(installed.state?.daemonVersion).toBe("9.9.9");
    });
  });

  it("supports never mode to keep local service missing", async () => {
    await withTempHome(async () => {
      const skipped = await ensureDaemonInstalledForCliStartup({
        daemonVersion: "9.9.9",
        mode: "never",
      });
      expect(skipped.status).toBe("skipped");
      expect(skipped.mode).toBe("never");
      expect(skipped.autoInstalled).toBe(false);
      expect(skipped.state).toBeNull();
      expect(await pathExists(daemonStatePath())).toBe(false);
      expect(await pathExists(daemonRuntimeRootPath())).toBe(false);
      expect(await pathExists(daemonTokenPath())).toBe(false);
    });
  });

  it("updates outdated local service version during cli startup in always mode", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });
      const before = await getDaemonStatus();
      if (!before.installed) {
        throw new Error("expected daemon to be installed before version sync");
      }

      const updated = await ensureDaemonVersionForCliStartup({
        daemonVersion: "2.0.0",
        installedState: before.state,
        mode: "always",
      });

      expect(updated.status).toBe("updated");
      expect(updated.outdatedBeforeCheck).toBe(true);
      expect(updated.previousVersion).toBe("1.0.0");
      expect(updated.autoUpdated).toBe(true);
      expect(updated.state?.daemonVersion).toBe("2.0.0");
    });
  });

  it("supports ask mode for outdated local service version with explicit confirmation callback", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });
      const before = await getDaemonStatus();
      if (!before.installed) {
        throw new Error("expected daemon to be installed before version sync");
      }

      const skipped = await ensureDaemonVersionForCliStartup({
        daemonVersion: "2.0.0",
        installedState: before.state,
        mode: "ask",
        canPrompt: true,
        confirmUpdate: async () => false,
      });
      expect(skipped.status).toBe("skipped");
      expect(skipped.outdatedBeforeCheck).toBe(true);
      expect(skipped.previousVersion).toBe("1.0.0");
      expect(skipped.autoUpdated).toBe(false);
      expect(skipped.state?.daemonVersion).toBe("1.0.0");

      const updated = await ensureDaemonVersionForCliStartup({
        daemonVersion: "2.0.0",
        installedState: before.state,
        mode: "ask",
        canPrompt: true,
        confirmUpdate: async ({
          installedVersion,
          expectedVersion,
        }: {
          installedVersion: string;
          expectedVersion: string;
        }) => installedVersion === "1.0.0" && expectedVersion === "2.0.0",
      });
      expect(updated.status).toBe("updated");
      expect(updated.autoUpdated).toBe(true);
      expect(updated.state?.daemonVersion).toBe("2.0.0");
    });
  });

  it("blocks startup version sync when installed local service is newer than this CLI", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "2.0.0",
        source: "daemon.command.install",
      });
      const before = await getDaemonStatus();
      if (!before.installed) {
        throw new Error("expected daemon to be installed before version sync");
      }
      const confirmUpdate = vi.fn(async () => true);

      const blocked = await ensureDaemonVersionForCliStartup({
        daemonVersion: "1.0.0",
        installedState: before.state,
        mode: "ask",
        canPrompt: true,
        confirmUpdate,
      });

      expect(blocked.status).toBe("downgrade_blocked");
      expect(blocked.outdatedBeforeCheck).toBe(false);
      expect(blocked.previousVersion).toBe("2.0.0");
      expect(blocked.autoUpdated).toBe(false);
      expect(blocked.state?.daemonVersion).toBe("2.0.0");
      expect(confirmUpdate).not.toHaveBeenCalled();

      const after = await getDaemonStatus();
      expect(after.state?.daemonVersion).toBe("2.0.0");
    });
  });

  it("keeps already current local service version untouched in version sync", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "2.0.0",
        source: "daemon.command.install",
      });
      const before = await getDaemonStatus();
      if (!before.installed) {
        throw new Error("expected daemon to be installed before version sync");
      }

      const unchanged = await ensureDaemonVersionForCliStartup({
        daemonVersion: "2.0.0",
        installedState: before.state,
        mode: "always",
      });
      expect(unchanged.status).toBe("already_current");
      expect(unchanged.outdatedBeforeCheck).toBe(false);
      expect(unchanged.autoUpdated).toBe(false);
      expect(unchanged.state?.daemonVersion).toBe("2.0.0");
    });
  });

  it("rotates local service token when existing token is older than 24h", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });
      const tokenPath = daemonTokenPath();
      const firstToken = await readDaemonTokenFixture(tokenPath);

      const expiredToken = {
        ...firstToken,
        updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      };
      await writeFile(tokenPath, `${JSON.stringify(expiredToken, null, 2)}\n`);

      await ensureDaemonInstalledForCliStartup({
        daemonVersion: "1.0.0",
      });
      const rotatedToken = await readDaemonTokenFixture(tokenPath);

      expect(rotatedToken.token).not.toBe(firstToken.token);
      expect(Date.parse(rotatedToken.updatedAt)).toBeGreaterThan(
        Date.parse(expiredToken.updatedAt)
      );
      expect(rotatedToken.issuedAt).toBe(rotatedToken.updatedAt);
    });
  });

  it("uses the same explicit local service home for control-plane token writes and reads", async () => {
    await withTempHome(async (homeDir) => {
      const customPathInput = {
        env: {
          ...process.env,
          OPENMELD_HOME: "",
        },
        homeDir: join(homeDir, "custom-daemon-home"),
      };

      const token = await ensureDaemonControlPlaneToken(customPathInput);

      expect(await readDaemonControlPlaneToken(customPathInput)).toBe(token);
      expect(await pathExists(daemonTokenPath(customPathInput))).toBe(true);
      expect(await pathExists(daemonTokenPath())).toBe(false);
    });
  });

  it("marks runtime as stale when heartbeat is outdated even if pid is alive", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });

      const staleAt = new Date(
        Date.now() - DAEMON_HEARTBEAT_STALE_MS - 10_000
      ).toISOString();
      await setDaemonServiceRuntimeState({
        v: 1,
        schema: DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
        status: "running",
        pid: process.pid,
        mode: "background",
        command: "openmeld service run --mode foreground",
        gatewayUrl: null,
        openMeldProfileId: null,
        stopRequestedAt: null,
        heartbeatAt: staleAt,
        startedAt: staleAt,
        updatedAt: staleAt,
        managedBySystemService: false,
        serviceController: "legacy-detached",
        autoStart: false,
      });

      const runtime = await getDaemonRuntimeStatus();
      expect(runtime.status).toBe("stale");
      expect(runtime.reason).toBe("heartbeat_stale");
    });
  });

  it("clears both legacy runtime state and runtime lease state", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });

      await setDaemonServiceRuntimeState({
        v: 1,
        schema: DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
        status: "running",
        pid: process.pid,
        mode: "background",
        command: "openmeld service run --mode background",
        gatewayUrl: null,
        openMeldProfileId: null,
        stopRequestedAt: null,
        heartbeatAt: null,
        startedAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:00.000Z",
        managedBySystemService: false,
        serviceController: "legacy-detached",
        autoStart: false,
      });
      await writeDaemonRuntimeLease({
        schema: "openmeld-daemon-runtime-lease-v1",
        v: 1,
        generation: 1,
        bundleId: "service-bundle-1",
        pid: process.pid,
        mode: "background",
        startedAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:01.000Z",
        heartbeatAt: "2026-03-14T00:00:01.000Z",
        serviceController: "legacy-detached",
        managedBySystemService: false,
      });

      expect(await pathExists(daemonServiceRuntimeStatePath())).toBe(true);
      expect(await pathExists(daemonRuntimeLeasePath())).toBe(true);

      await clearDaemonServiceRuntimeState();

      expect(await pathExists(daemonServiceRuntimeStatePath())).toBe(false);
      expect(await pathExists(daemonRuntimeLeasePath())).toBe(false);
    });
  });

  it("writes service runtime state into the explicitly scoped OpenMeld home", async () => {
    await withTempHome(async (homeDir) => {
      const customPathInput = {
        env: {
          ...process.env,
          OPENMELD_HOME: "",
        },
        homeDir: join(homeDir, "custom-daemon-home"),
      };

      await setDaemonServiceRuntimeState(
        {
          v: 1,
          schema: DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
          status: "running",
          pid: process.pid,
          mode: "background",
          command: "openmeld service run --mode background",
          gatewayUrl: null,
          openMeldProfileId: null,
          stopRequestedAt: null,
          heartbeatAt: null,
          startedAt: "2026-03-14T00:00:00.000Z",
          updatedAt: "2026-03-14T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "legacy-detached",
          autoStart: false,
        },
        customPathInput
      );

      expect(
        await pathExists(daemonServiceRuntimeStatePath(customPathInput))
      ).toBe(true);
      expect(await pathExists(daemonServiceRuntimeStatePath())).toBe(false);
    });
  });
});

async function readDaemonTokenFixture(path: string): Promise<{
  token: string;
  issuedAt: string;
  updatedAt: string;
}> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as {
    token?: string;
    issuedAt?: string;
    updatedAt?: string;
  };
  return {
    token: String(parsed.token ?? ""),
    issuedAt: String(parsed.issuedAt ?? ""),
    updatedAt: String(parsed.updatedAt ?? ""),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
