import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { daemonRuntimeLeasePath } from "../src/config/daemon-runtime-lease";
import { upsertDaemonServiceContract } from "../src/config/daemon-service-contract";
import type {
  DaemonServiceRuntimeStatus,
  DaemonStatus,
} from "../src/config/daemon-state";
import {
  DAEMON_SERVICE_LIFECYCLE_LOCK_KEY,
  DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE,
  daemonServiceRuntimeStatePath,
} from "../src/config/daemon-state";
import { locksDir } from "../src/config/paths";
import { DAEMON_RUNTIME_CONTRACT_EPOCH } from "../src/local-service/core/constants";
import {
  daemonServiceActiveBundlePath,
  daemonServiceExecutableWrapperPath,
  daemonServiceLauncherPath,
  resolveDaemonBundleRootPath,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { inspectDaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";
import type {
  DaemonServiceManager,
  DaemonServiceManagerRuntimeStatus,
} from "../src/local-service/lifecycle/daemon-service-manager";
import { ensureDaemonRuntimePaths } from "../src/local-service/state/daemon-device-id";
import { withTempHome } from "./helpers/fs";

const INSTALLED_STATUS: DaemonStatus = {
  installed: true,
  state: {
    v: 1,
    schema: "openmeld-daemon-install-v1",
    daemonVersion: "0.2.2",
    installSource: "daemon.command.install",
    installedAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  },
};

const NOT_RUNNING_RUNTIME_STATUS: DaemonServiceRuntimeStatus = {
  status: "not_running",
  mode: null,
  pid: null,
  startedAt: null,
  updatedAt: null,
  managedBySystemService: false,
  serviceController: "unknown",
  autoStart: false,
};

const EXTERNAL_MANAGER_STATUS: DaemonServiceManagerRuntimeStatus = {
  installed: true,
  running: false,
  enabled: true,
  definitionPath:
    "/tmp/external/com.openmeld.openmeld-background-service.plist",
  commandSummary:
    "node /tmp/external/.openmeld/runtime/daemon/launcher.mjs service run --mode foreground",
};

describe("local service inventory process evidence", () => {
  it("does not diagnose a missing live command as bundle corruption after the process exits", async () => {
    await withTempHome(async () => {
      const exited = spawnSync(process.execPath, ["-e", ""]);
      expect(exited.status).toBe(0);
      await writeRunningRuntimeLease(exited.pid);
      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        listOwnedProcesses: async () => [],
        resolveServiceManager: async () => null,
      });
      expect(inventory.runtimeStatus.reason).toBe("process_not_alive");
      expect(inventory.anomalies.map((item) => item.code)).toContain(
        "runtime_stale"
      );
      expect(inventory.anomalies.map((item) => item.code)).not.toContain(
        "runtime_bundle_mismatch"
      );
    });
  });
  it("fails closed when the owned-process scan cannot run", async () => {
    await withTempHome(async () => {
      await expect(
        inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          listOwnedProcesses: () =>
            Promise.reject(new Error("process inventory unavailable")),
          readDaemonStatus: async () => INSTALLED_STATUS,
          resolveServiceManager: async () =>
            createServiceManager(EXTERNAL_MANAGER_STATUS),
        })
      ).rejects.toThrow("process inventory unavailable");
    });
  });
});

function createServiceManager(
  status: DaemonServiceManagerRuntimeStatus
): DaemonServiceManager {
  return {
    controller: "launchd",
    install: async () => undefined,
    uninstall: async () => undefined,
    enableAutostart: async () => undefined,
    disableAutostart: async () => undefined,
    start: async () => undefined,
    stop: async () => undefined,
    deactivate: async () => undefined,
    waitUntilAbsent: async () => undefined,
    waitUntilStopped: async () => undefined,
    waitUntilRunning: async () => undefined,
    status: async () => status,
  };
}

describe("local service inventory", () => {
  it("preserves an orphaned legacy lifecycle lock as a blocking anomaly", async () => {
    await withTempHome(async () => {
      const stalePid = 5757;
      const lockDir = locksDir(DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE);
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        join(lockDir, `${DAEMON_SERVICE_LIFECYCLE_LOCK_KEY}.lock`),
        `${JSON.stringify({
          pid: stalePid,
          intent: "run_foreground",
          command: "openmeld service run",
        })}\n`,
        "utf8"
      );

      const killSpy = vi.spyOn(process, "kill").mockImplementation(((
        pid: number | NodeJS.Signals,
        signal?: number | NodeJS.Signals
      ) => {
        if (pid === stalePid && signal === 0) {
          const err = new Error("no such process") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }
        return true;
      }) as typeof process.kill);

      try {
        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => INSTALLED_STATUS,
          listOwnedProcesses: async () => [],
        });

        expect(inventory.runtimeStatus).toEqual(NOT_RUNNING_RUNTIME_STATUS);
        expect(inventory.lifecycleLock).toEqual(
          expect.objectContaining({
            pid: stalePid,
            intent: "run_foreground",
            command: "openmeld service run",
          })
        );
        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "lifecycle_locked"
          )
        ).toBe(true);
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  it("preserves a live lifecycle lock as a blocking anomaly", async () => {
    await withTempHome(async () => {
      const competingPid = process.ppid;
      if (!Number.isInteger(competingPid) || competingPid <= 0) {
        throw new Error("expected a live parent pid for lifecycle lock test");
      }

      const lockDir = locksDir(DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE);
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        join(lockDir, `${DAEMON_SERVICE_LIFECYCLE_LOCK_KEY}.lock`),
        `${JSON.stringify({
          pid: competingPid,
          intent: "run_foreground",
          command: "openmeld service run",
        })}\n`,
        "utf8"
      );

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        listOwnedProcesses: async () => [],
      });

      expect(inventory.lifecycleLock).toEqual(
        expect.objectContaining({
          pid: competingPid,
          intent: "run_foreground",
          command: "openmeld service run",
        })
      );
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "lifecycle_locked"
        )
      ).toBe(true);
    });
  });

  it("ignores external service-manager drift when OPENMELD_HOME is explicitly overridden", async () => {
    await withTempHome(async () => {
      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager(EXTERNAL_MANAGER_STATUS),
        listOwnedProcesses: async () => [],
      });

      expect(inventory.serviceManagerStatus).toBeNull();
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "service_manager_path_drift"
        )
      ).toBe(false);
    });
  });

  it("still detects multiple active owners from an external manager when OPENMELD_HOME is explicitly overridden", async () => {
    await withTempHome(async () => {
      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager({
            ...EXTERNAL_MANAGER_STATUS,
            running: true,
          }),
        listOwnedProcesses: async () => [
          {
            pid: 222,
            parentPid: 1,
            command:
              "node /tmp/current-cli/dist/openmeld.js service run --mode foreground",
            mode: "foreground",
            ownership: "cli_direct",
          },
        ],
      });

      expect(inventory.serviceManagerStatus).toBeNull();
      expect(
        inventory.anomalies.find(
          (anomaly) => anomaly.code === "multiple_active_owners"
        )
      ).toEqual({
        code: "multiple_active_owners",
        message:
          "Multiple OpenMeld Service owners are active on this device: Direct CLI + System service.",
      });
    });
  });

  it("still reports service-manager drift when OPENMELD_HOME is not explicitly overridden", async () => {
    await withTempHome(async () => {
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      Reflect.deleteProperty(process.env, "OPENMELD_HOME");

      try {
        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => INSTALLED_STATUS,
          resolveServiceManager: async () =>
            createServiceManager(EXTERNAL_MANAGER_STATUS),
          listOwnedProcesses: async () => [],
        });

        expect(inventory.serviceManagerStatus?.installed).toBe(true);
        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "service_manager_path_drift"
          )
        ).toBe(true);
      } finally {
        if (previousOpenMeldHome === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        } else {
          process.env.OPENMELD_HOME = previousOpenMeldHome;
        }
      }
    });
  });

  it("reports multiple active owners when system service and direct CLI are both active", async () => {
    await withTempHome(async () => {
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      Reflect.deleteProperty(process.env, "OPENMELD_HOME");

      try {
        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => INSTALLED_STATUS,
          resolveServiceManager: async () =>
            createServiceManager({
              ...EXTERNAL_MANAGER_STATUS,
              running: true,
            }),
          listOwnedProcesses: async () => [
            {
              pid: 222,
              parentPid: 1,
              command:
                "node /tmp/current-cli/dist/openmeld.js service run --mode foreground",
              mode: "foreground",
              ownership: "cli_direct",
            },
          ],
        });

        expect(
          inventory.anomalies.find(
            (anomaly) => anomaly.code === "multiple_active_owners"
          )
        ).toEqual({
          code: "multiple_active_owners",
          message:
            "Multiple OpenMeld Service owners are active on this device: Direct CLI + System service.",
        });
      } finally {
        if (previousOpenMeldHome === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        } else {
          process.env.OPENMELD_HOME = previousOpenMeldHome;
        }
      }
    });
  });

  it("treats commandSummary as diagnostic-only when the launchd definition already matches the current wrapper", async () => {
    await withTempHome(async () => {
      const definitionPath =
        "/tmp/current/com.openmeld.openmeld-background-service.plist";
      await mkdir(dirname(definitionPath), { recursive: true });
      await writeFile(
        definitionPath,
        `<plist><string>${daemonServiceExecutableWrapperPath()}</string></plist>\n`,
        "utf8"
      );

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager({
            ...EXTERNAL_MANAGER_STATUS,
            definitionPath,
            commandSummary:
              "node /tmp/old-cli/openmeld.js service run --mode foreground",
          }),
        listOwnedProcesses: async () => [],
      });

      expect(inventory.serviceManagerStatus?.installed).toBe(true);
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "service_manager_path_drift"
        )
      ).toBe(false);
    });
  });

  it("reports service-manager drift when a launchd definition still points directly at the old launcher", async () => {
    await withTempHome(async () => {
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      Reflect.deleteProperty(process.env, "OPENMELD_HOME");
      const definitionPath =
        "/tmp/current/com.openmeld.openmeld-background-service.plist";
      await mkdir(dirname(definitionPath), { recursive: true });
      await writeFile(
        definitionPath,
        `<plist><string>${process.execPath}</string><string>${daemonServiceLauncherPath()}</string></plist>\n`,
        "utf8"
      );

      try {
        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => INSTALLED_STATUS,
          resolveServiceManager: async () =>
            createServiceManager({
              ...EXTERNAL_MANAGER_STATUS,
              definitionPath,
              commandSummary: `${process.execPath} ${daemonServiceLauncherPath()} service run --mode foreground`,
            }),
          listOwnedProcesses: async () => [],
        });

        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "service_manager_path_drift"
          )
        ).toBe(true);
      } finally {
        if (previousOpenMeldHome === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        } else {
          process.env.OPENMELD_HOME = previousOpenMeldHome;
        }
      }
    });
  });

  it("reports bundle lane drift for workspace bundles in the published lanes but not in openmeld-dev", async () => {
    await withTempHome(async () => {
      const installStatus = INSTALLED_STATUS;
      const entryPath = `${resolveDaemonBundleRootPath("workspace-bundle")}/dist/openmeld.js`;
      await mkdir(dirname(entryPath), { recursive: true });
      await mkdir(dirname(daemonServiceActiveBundlePath()), {
        recursive: true,
      });
      await writeFile(entryPath, 'console.log("ok");\n', "utf8");
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleId: "workspace-bundle",
            daemonVersion: "0.2.2",
            entryScriptRelativePath: "dist/openmeld.js",
            bundleFormat: "self_contained_v1",
            sourceEntryScriptPath: "/tmp/workspace-cli/dist/openmeld.js",
            sourcePackageRootPath: "/tmp/openmeld/clients/openmeld-cli",
            sourceDistRootPath: "/tmp/openmeld/clients/openmeld-cli/dist",
            sourceKind: "workspace",
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const previousPreset = process.env.OPENMELD_ENV_PRESET;
      process.env.OPENMELD_ENV_PRESET = "prod";
      try {
        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => installStatus,
          listOwnedProcesses: async () => [],
        });

        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "bundle_lane_drift"
          )
        ).toBe(true);
      } finally {
        if (previousPreset === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
        } else {
          process.env.OPENMELD_ENV_PRESET = previousPreset;
        }
      }

      process.env.OPENMELD_ENV_PRESET = "dev-local";
      try {
        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => installStatus,
          listOwnedProcesses: async () => [],
        });

        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "bundle_lane_drift"
          )
        ).toBe(false);
      } finally {
        if (previousPreset === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
        } else {
          process.env.OPENMELD_ENV_PRESET = previousPreset;
        }
      }
    });
  });

  it("reports bundle content drift when the current CLI dist differs from the active bundle fingerprint", async () => {
    await withTempHome(async () => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), "openmeld-cli-dist-"));
      const fixtureDistRoot = join(fixtureRoot, "dist");
      const cliScriptPath = join(fixtureDistRoot, "openmeld.js");
      const entryPath = `${resolveDaemonBundleRootPath("content-drift-bundle")}/dist/openmeld.js`;

      try {
        await mkdir(fixtureDistRoot, { recursive: true });
        await mkdir(dirname(entryPath), { recursive: true });
        await mkdir(dirname(daemonServiceActiveBundlePath()), {
          recursive: true,
        });
        await writeFile(cliScriptPath, 'console.log("current");\n', "utf8");
        await writeFile(entryPath, 'console.log("bundle");\n', "utf8");
        await writeFile(
          daemonServiceActiveBundlePath(),
          `${JSON.stringify(
            {
              v: 2,
              schema: "openmeld-daemon-active-bundle-v2",
              bundleId: "content-drift-bundle",
              daemonVersion: "0.2.2",
              entryScriptRelativePath: "dist/openmeld.js",
              bundleFormat: "self_contained_v1",
              sourceEntryScriptPath: "/tmp/package-install/dist/openmeld.js",
              sourcePackageRootPath: "/tmp/node_modules/openmeld",
              sourceDistRootPath: "/tmp/node_modules/openmeld/dist",
              sourceDistFingerprint: "old-fingerprint",
              sourceKind: "package_install",
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => INSTALLED_STATUS,
          listOwnedProcesses: async () => [],
          cliScriptPath,
        });

        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "bundle_content_drift"
          )
        ).toBe(true);
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  });

  it("treats active bundles without a content fingerprint as one-time bundle content drift", async () => {
    await withTempHome(async () => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), "openmeld-cli-dist-"));
      const fixtureDistRoot = join(fixtureRoot, "dist");
      const cliScriptPath = join(fixtureDistRoot, "openmeld.js");
      const entryPath = `${resolveDaemonBundleRootPath("legacy-fingerprint-bundle")}/dist/openmeld.js`;

      try {
        await mkdir(fixtureDistRoot, { recursive: true });
        await mkdir(dirname(entryPath), { recursive: true });
        await mkdir(dirname(daemonServiceActiveBundlePath()), {
          recursive: true,
        });
        await writeFile(cliScriptPath, 'console.log("current");\n', "utf8");
        await writeFile(entryPath, 'console.log("bundle");\n', "utf8");
        await writeFile(
          daemonServiceActiveBundlePath(),
          `${JSON.stringify(
            {
              v: 2,
              schema: "openmeld-daemon-active-bundle-v2",
              bundleId: "legacy-fingerprint-bundle",
              daemonVersion: "0.2.2",
              entryScriptRelativePath: "dist/openmeld.js",
              bundleFormat: "self_contained_v1",
              sourceEntryScriptPath: "/tmp/package-install/dist/openmeld.js",
              sourcePackageRootPath: "/tmp/node_modules/openmeld",
              sourceDistRootPath: "/tmp/node_modules/openmeld/dist",
              sourceKind: "package_install",
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => INSTALLED_STATUS,
          listOwnedProcesses: async () => [],
          cliScriptPath,
        });

        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "bundle_content_drift"
          )
        ).toBe(true);
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  });

  it("reports bundle ID drift separately from local service version drift", async () => {
    await withTempHome(async () => {
      const entryPath = `${resolveDaemonBundleRootPath("active-bundle")}/dist/openmeld.js`;
      await mkdir(dirname(entryPath), { recursive: true });
      await mkdir(dirname(daemonServiceActiveBundlePath()), {
        recursive: true,
      });
      await writeFile(entryPath, 'console.log("ok");\n', "utf8");
      await upsertDaemonServiceContract({
        daemonVersion: "0.2.2",
        bundleId: "contract-bundle",
        desiredState: "stopped",
        serviceController: "launchd",
        autoStart: false,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_123",
        heartbeatMs: 25_000,
      });
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleId: "active-bundle",
            daemonVersion: "0.2.2",
            entryScriptRelativePath: "dist/openmeld.js",
            bundleFormat: "self_contained_v1",
            sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
            sourcePackageRootPath: "/tmp/current-cli",
            sourceDistRootPath: "/tmp/current-cli/dist",
            sourceKind: "package_install",
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        listOwnedProcesses: async () => [],
      });

      expect(inventory.anomalies).toContainEqual(
        expect.objectContaining({
          code: "bundle_id_drift",
          message: expect.stringContaining("active-bundle"),
        })
      );
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "bundle_version_drift"
        )
      ).toBe(false);
    });
  });

  it("reports runtime bundle mismatch when a live owned process points at a deleted bundle entry", async () => {
    await withTempHome(async () => {
      const bundleEntryPath = `${resolveDaemonBundleRootPath("service-bundle")}/dist/openmeld.js`;
      const deletedRuntimeEntryPath =
        "/tmp/old-openmeld/runtime/daemon/bundles/drifted-bundle/dist/openmeld.js";
      await mkdir(dirname(bundleEntryPath), { recursive: true });
      await mkdir(dirname(daemonServiceActiveBundlePath()), {
        recursive: true,
      });
      await writeFile(bundleEntryPath, 'console.log("ok");\n', "utf8");
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleId: "service-bundle",
            daemonVersion: "0.2.2",
            entryScriptRelativePath: "dist/openmeld.js",
            bundleFormat: "self_contained_v1",
            sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
            sourcePackageRootPath: "/tmp/current-cli",
            sourceDistRootPath: "/tmp/current-cli/dist",
            sourceKind: "package_install",
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        listOwnedProcesses: async () => [
          {
            pid: 444,
            parentPid: 1,
            command: `node ${deletedRuntimeEntryPath} service run --mode background`,
            mode: "background",
            ownership: "stable_launcher",
          },
        ],
      });

      expect(inventory.runtimeCommandEntryPath).toBe(deletedRuntimeEntryPath);
      expect(inventory.runtimeCommandPathExists).toBe(false);
      expect(inventory.runtimeStatus).toEqual(
        expect.objectContaining({
          status: "stale",
          pid: 444,
          reason: "runtime_lease_missing",
        })
      );
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "runtime_bundle_mismatch"
        )
      ).toBe(true);
    });
  });

  it("does not resurrect runtime from the legacy runtime snapshot when lease and live process are both missing", async () => {
    await withTempHome(async () => {
      await mkdir(dirname(daemonServiceRuntimeStatePath()), {
        recursive: true,
      });
      await writeFile(
        daemonServiceRuntimeStatePath(),
        `${JSON.stringify(
          {
            v: 1,
            schema: "openmeld-daemon-service-state-v1",
            status: "running",
            pid: 444,
            mode: "background",
            command:
              "node /tmp/old-openmeld/runtime/daemon/bundles/drifted-bundle/dist/openmeld.js service run --mode foreground",
            gatewayUrl: "https://gateway.openmeld.invalid",
            profile: null,
            stopRequestedAt: null,
            heartbeatAt: "2026-03-10T00:00:00.000Z",
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        listOwnedProcesses: async () => [],
      });

      expect(inventory.runtimeStatus).toEqual(NOT_RUNNING_RUNTIME_STATUS);
      expect(inventory.runtimeCommandEntryPath).toBeNull();
      expect(inventory.runtimeCommandPathExists).toBeNull();
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "runtime_bundle_mismatch"
        )
      ).toBe(false);
    });
  });

  it("prefers the live runtime process command over legacy runtime snapshot when checking bundle drift", async () => {
    await withTempHome(async () => {
      const bundleEntryPath = `${resolveDaemonBundleRootPath("service-bundle")}/dist/openmeld.js`;
      await mkdir(dirname(bundleEntryPath), { recursive: true });
      await mkdir(dirname(daemonServiceActiveBundlePath()), {
        recursive: true,
      });
      await mkdir(dirname(daemonServiceRuntimeStatePath()), {
        recursive: true,
      });
      await writeFile(bundleEntryPath, 'console.log("ok");\n', "utf8");
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleId: "service-bundle",
            daemonVersion: "0.2.2",
            entryScriptRelativePath: "dist/openmeld.js",
            bundleFormat: "self_contained_v1",
            sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
            sourcePackageRootPath: "/tmp/current-cli",
            sourceDistRootPath: "/tmp/current-cli/dist",
            sourceKind: "package_install",
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(
        daemonServiceRuntimeStatePath(),
        `${JSON.stringify(
          {
            v: 1,
            schema: "openmeld-daemon-service-state-v1",
            status: "running",
            pid: 222,
            mode: "background",
            command:
              "node /tmp/old-openmeld/runtime/daemon/bundles/drifted-bundle/dist/openmeld.js service run --mode foreground",
            gatewayUrl: "https://gateway.openmeld.invalid",
            profile: "agt_existing",
            stopRequestedAt: null,
            heartbeatAt: "2026-03-10T00:00:00.000Z",
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        listOwnedProcesses: async () => [
          {
            pid: 222,
            parentPid: 1,
            command: `node ${bundleEntryPath} service run --mode foreground`,
            mode: "background",
            ownership: "cli_direct",
          },
        ],
      });

      expect(inventory.runtimeCommandEntryPath).toBe(bundleEntryPath);
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "runtime_bundle_mismatch"
        )
      ).toBe(false);
    });
  });

  it("does not flag runtime bundle mismatch when the live runtime uses the active bundle source entry", async () => {
    await withTempHome(async () => {
      const sourceRoot = await mkdtemp(
        join(tmpdir(), "openmeld-daemon-source-")
      );
      const sourceEntryPath = join(sourceRoot, "dist", "openmeld-dev.js");
      const bundleEntryPath = `${resolveDaemonBundleRootPath("service-bundle")}/dist/openmeld-dev.js`;

      try {
        await mkdir(dirname(sourceEntryPath), { recursive: true });
        await mkdir(dirname(bundleEntryPath), { recursive: true });
        await mkdir(dirname(daemonServiceActiveBundlePath()), {
          recursive: true,
        });
        await writeFile(sourceEntryPath, 'console.log("source");\n', "utf8");
        await writeFile(bundleEntryPath, 'console.log("bundle");\n', "utf8");
        await writeFile(
          daemonServiceActiveBundlePath(),
          `${JSON.stringify(
            {
              v: 2,
              schema: "openmeld-daemon-active-bundle-v2",
              bundleId: "service-bundle",
              daemonVersion: "0.2.2",
              entryScriptRelativePath: "dist/openmeld-dev.js",
              bundleFormat: "self_contained_v1",
              sourceEntryScriptPath: sourceEntryPath,
              sourcePackageRootPath: dirname(dirname(sourceEntryPath)),
              sourceDistRootPath: dirname(sourceEntryPath),
              sourceKind: "workspace",
              createdAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        const inventory = await inspectDaemonServiceInventory({
          expectedVersion: "0.2.2",
          readDaemonStatus: async () => INSTALLED_STATUS,
          listOwnedProcesses: async () => [
            {
              pid: 222,
              parentPid: 1,
              command: `node ${sourceEntryPath} service run --mode foreground`,
              mode: "foreground",
              ownership: "cli_direct",
            },
          ],
        });

        expect(inventory.runtimeCommandEntryPath).toBe(sourceEntryPath);
        expect(inventory.runtimeCommandPathExists).toBe(true);
        expect(
          inventory.anomalies.some(
            (anomaly) => anomaly.code === "runtime_bundle_mismatch"
          )
        ).toBe(false);
      } finally {
        await rm(sourceRoot, { recursive: true, force: true });
      }
    });
  });

  it("prefers runtime lease over legacy runtime status when determining the active service state", async () => {
    await withTempHome(async () => {
      const runtimeLeaseFilePath = daemonRuntimeLeasePath();
      await mkdir(dirname(runtimeLeaseFilePath), { recursive: true });
      await writeFile(
        runtimeLeaseFilePath,
        `${JSON.stringify(
          {
            schema: "openmeld-daemon-runtime-lease-v1",
            v: 1,
            generation: 2,
            bundleId: "service-bundle",
            pid: process.pid,
            mode: "background",
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: new Date().toISOString(),
            heartbeatAt: new Date().toISOString(),
            serviceController: "launchd",
            managedBySystemService: true,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager({
            installed: true,
            running: true,
            enabled: true,
            definitionPath: null,
            commandSummary: null,
          }),
        listOwnedProcesses: async () => [],
      });

      expect(inventory.runtimeLease).toEqual(
        expect.objectContaining({
          pid: process.pid,
          mode: "background",
          serviceController: "launchd",
        })
      );
      expect(inventory.runtimeStatus).toEqual(
        expect.objectContaining({
          status: "running",
          mode: "background",
          pid: process.pid,
          managedBySystemService: true,
          serviceController: "launchd",
        })
      );
    });
  });

  it("treats a freshly written runtime lease as healthy before the first heartbeat lands", async () => {
    await withTempHome(async () => {
      const runtimeLeaseFilePath = daemonRuntimeLeasePath();
      await mkdir(dirname(runtimeLeaseFilePath), { recursive: true });
      const justNow = new Date().toISOString();
      await writeFile(
        runtimeLeaseFilePath,
        `${JSON.stringify(
          {
            schema: "openmeld-daemon-runtime-lease-v1",
            v: 1,
            generation: 3,
            bundleId: "service-bundle",
            pid: process.pid,
            mode: "background",
            startedAt: justNow,
            updatedAt: justNow,
            heartbeatAt: null,
            serviceController: "launchd",
            managedBySystemService: true,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager({
            installed: true,
            running: true,
            enabled: true,
            definitionPath: null,
            commandSummary: null,
          }),
        listOwnedProcesses: async () => [],
      });

      expect(inventory.runtimeStatus).toEqual(
        expect.objectContaining({
          status: "running",
          pid: process.pid,
          mode: "background",
        })
      );
      expect(
        inventory.anomalies.some((anomaly) => anomaly.code === "runtime_stale")
      ).toBe(false);
    });
  });

  it("reports missing runtime contract evidence as a repair anomaly only for a running local service", async () => {
    await withTempHome(async () => {
      await writeRunningRuntimeLease();

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager({
            installed: true,
            running: true,
            enabled: true,
            definitionPath: null,
            commandSummary: null,
          }),
        listOwnedProcesses: async () => [],
      });

      expect(inventory.runtimeContractCompatibility).toEqual({
        status: "missing",
        expectedEpoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
        observedEpoch: null,
        updatedAt: null,
        reasonCode: "daemon.runtime_contract.missing",
      });
      expect(inventory.anomalies).toContainEqual(
        expect.objectContaining({
          code: "runtime_contract_missing",
        })
      );
    });
  });

  it("reports mismatched runtime contract evidence as a repair anomaly for a running local service", async () => {
    await withTempHome(async () => {
      await writeRunningRuntimeLease();
      await writeRuntimeContractMeta({
        contractEpoch: "daemon-runtime-epoch-old",
        updatedAt: "2026-03-03T00:00:00.000Z",
      });

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager({
            installed: true,
            running: true,
            enabled: true,
            definitionPath: null,
            commandSummary: null,
          }),
        listOwnedProcesses: async () => [],
      });

      expect(inventory.runtimeContractCompatibility).toMatchObject({
        status: "mismatch",
        expectedEpoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
        observedEpoch: "daemon-runtime-epoch-old",
        updatedAt: "2026-03-03T00:00:00.000Z",
      });
      expect(inventory.anomalies).toContainEqual(
        expect.objectContaining({
          code: "runtime_contract_mismatch",
        })
      );
    });
  });

  it("does not turn absent runtime contract evidence into refresh guidance when the service is stopped", async () => {
    await withTempHome(async () => {
      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: "0.2.2",
        readDaemonStatus: async () => INSTALLED_STATUS,
        resolveServiceManager: async () =>
          createServiceManager({
            installed: true,
            running: false,
            enabled: true,
            definitionPath: null,
            commandSummary: null,
          }),
        listOwnedProcesses: async () => [],
      });

      expect(inventory.runtimeStatus.status).toBe("not_running");
      expect(inventory.runtimeContractCompatibility).toEqual({
        status: "not_observed",
        expectedEpoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
        observedEpoch: null,
        updatedAt: null,
        reasonCode: "daemon.runtime_contract.not_observed",
      });
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "runtime_contract_missing"
        )
      ).toBe(false);
    });
  });
});

async function writeRunningRuntimeLease(pid = process.pid): Promise<void> {
  const runtimeLeaseFilePath = daemonRuntimeLeasePath();
  await mkdir(dirname(runtimeLeaseFilePath), { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    runtimeLeaseFilePath,
    `${JSON.stringify(
      {
        schema: "openmeld-daemon-runtime-lease-v1",
        v: 1,
        generation: 10,
        bundleId: "service-bundle",
        pid,
        mode: "background",
        startedAt: now,
        updatedAt: now,
        heartbeatAt: now,
        serviceController: "launchd",
        managedBySystemService: true,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeRuntimeContractMeta(input: {
  contractEpoch: string;
  updatedAt: string;
}): Promise<void> {
  const runtimePaths = await ensureDaemonRuntimePaths();
  await writeFile(
    runtimePaths.contractMetaPath,
    `${JSON.stringify(
      {
        schema: "daemon.runtime.contract.meta",
        v: 1,
        contractEpoch: input.contractEpoch,
        updatedAt: input.updatedAt,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
