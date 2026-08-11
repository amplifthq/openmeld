import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runDaemon,
  runDaemonCancel,
  runDaemonInstall,
  runDaemonInterrupt,
  runDaemonReinstall,
  runDaemonRun,
  runDaemonStatus,
  runDaemonStop,
  runDaemonUninstall,
} from "../src/commands/service";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const {
  inspectDaemonServiceInventoryMock,
  listDaemonOwnedProcessesMock,
  prepareDaemonServiceBundleMock,
  runDaemonServiceLifecycleMock,
} = vi.hoisted(() => ({
  inspectDaemonServiceInventoryMock: vi.fn(),
  listDaemonOwnedProcessesMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  runDaemonServiceLifecycleMock: vi.fn(),
}));

let previousArgv: string[] | null = null;

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-inventory")
  >("../src/local-service/lifecycle/daemon-service-inventory");
  return {
    ...actual,
    inspectDaemonServiceInventory: (...args: unknown[]) => {
      const implementation =
        inspectDaemonServiceInventoryMock.getMockImplementation();
      if (implementation) {
        return inspectDaemonServiceInventoryMock(...args);
      }
      return actual.inspectDaemonServiceInventory(
        ...(args as Parameters<typeof actual.inspectDaemonServiceInventory>)
      );
    },
  };
});

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-process-inventory")
    >("../src/local-service/lifecycle/daemon-service-process-inventory");
    return {
      ...actual,
      listDaemonOwnedProcesses: (...args: unknown[]) =>
        listDaemonOwnedProcessesMock(...args),
    };
  }
);

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-bundle")
  >("../src/local-service/lifecycle/daemon-service-bundle");
  return {
    ...actual,
    prepareDaemonServiceBundle: (...args: unknown[]) =>
      prepareDaemonServiceBundleMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-lifecycle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-lifecycle")
  >("../src/local-service/lifecycle/daemon-service-lifecycle");
  return {
    ...actual,
    runDaemonServiceLifecycle: (...args: unknown[]) =>
      runDaemonServiceLifecycleMock(...args),
  };
});

describe("openmeld service agent overview", () => {
  beforeEach(() => {
    previousArgv = process.argv;
    process.argv = ["node", "openmeld", "--details"];
    inspectDaemonServiceInventoryMock.mockReset();
    listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
    prepareDaemonServiceBundleMock.mockReset().mockResolvedValue({
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
    });
    runDaemonServiceLifecycleMock.mockReset();
  });

  afterEach(() => {
    if (previousArgv) {
      process.argv = previousArgv;
      previousArgv = null;
    }
  });

  it("emits overview before menu payload in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemon({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.menu.agent_overview");
      expect(envelopes[1]?.code).toBe("daemon.menu.result");
    });
  });

  it("emits overview before install result in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonInstall({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.install.agent_overview");
      expect(envelopes[1]?.code).toBe("daemon.install.result");
    });
  });

  it("formats service overview commands and notes with the resolved CLI entry", async () => {
    const previousCliEntry = process.env.OPENMELD_USER_FACING_CLI_COMMAND;
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";

    try {
      await withTempHome(async () => {
        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonInstall({ view: "agent" });
        });

        const payload = parseAgentEnvelopes(stdout)[0]?.payload;
        expect(payload?.commands).toContain(
          "openmeld-canary service install --view agent"
        );
        expect(payload?.commands).toContain(
          "openmeld-canary service start --view agent"
        );
        expect(payload?.notes).toContain(
          "Install does not automatically start the service; use `openmeld-canary service start --view agent` next."
        );
      });
    } finally {
      if (previousCliEntry === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_USER_FACING_CLI_COMMAND");
      } else {
        process.env.OPENMELD_USER_FACING_CLI_COMMAND = previousCliEntry;
      }
    }
  });

  it("omits overview from the default status success path in agent view", async () => {
    await withTempHome(async () => {
      process.argv = [
        "node",
        "openmeld",
        "service",
        "status",
        "--view",
        "agent",
      ];
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.status.local_result");
      expect(envelopes[1]?.code).toBe("daemon.status.result");
      expect(
        envelopes.some((item) => item.code === "daemon.status.agent_overview")
      ).toBe(false);
    });
  });

  it("uses one coherent local service observation for both agent status results", async () => {
    await withTempHome(async () => {
      await withCapturedStdio(async () => {
        await runDaemonInstall({ view: "agent" });
      });
      let inspectionCount = 0;
      inspectDaemonServiceInventoryMock.mockImplementation(() => {
        inspectionCount += 1;
        return Promise.resolve(
          createStatusInventory({
            anomaly:
              inspectionCount === 1
                ? {
                    code: "bundle_content_drift",
                    message:
                      "The installed service bundle differs from the CLI.",
                  }
                : undefined,
          })
        );
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      const localResult = envelopes.find(
        (item) => item.code === "daemon.status.local_result"
      )?.payload as
        | { inventory?: { anomalies?: Array<{ code?: string }> } }
        | undefined;
      const fullResult = envelopes.find(
        (item) => item.code === "daemon.status.result"
      )?.payload as
        | { inventory?: { anomalies?: Array<{ code?: string }> } }
        | undefined;

      expect(localResult?.inventory?.anomalies).toEqual([
        expect.objectContaining({ code: "bundle_content_drift" }),
      ]);
      expect(fullResult?.inventory?.anomalies).toEqual(
        localResult?.inventory?.anomalies
      );
    });
  });

  it("includes runtime contract compatibility evidence in agent status payload", async () => {
    await withTempHome(async () => {
      await withCapturedStdio(async () => {
        await runDaemonInstall({ view: "agent" });
      });
      inspectDaemonServiceInventoryMock.mockResolvedValue(
        createStatusInventory({
          anomaly: {
            code: "runtime_contract_mismatch",
            message:
              "OpenMeld Service runtime contract epoch does not match the current CLI.",
          },
          runtimeContractCompatibility: {
            status: "mismatch",
            expectedEpoch: "daemon-runtime-epoch-current",
            observedEpoch: "daemon-runtime-epoch-old",
            updatedAt: "2026-03-09T00:00:00.000Z",
            reasonCode: "daemon.runtime_contract.mismatch",
          },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({ view: "agent" });
      });

      const statusPayload = parseAgentEnvelopes(stdout).find(
        (item) => item.code === "daemon.status.result"
      )?.payload as
        | {
            inventory?: {
              runtimeContractCompatibility?: unknown;
            };
          }
        | undefined;

      expect(statusPayload?.inventory?.runtimeContractCompatibility).toEqual({
        status: "mismatch",
        expectedEpoch: "daemon-runtime-epoch-current",
        observedEpoch: "daemon-runtime-epoch-old",
        updatedAt: "2026-03-09T00:00:00.000Z",
        reasonCode: "daemon.runtime_contract.mismatch",
      });
    });
  });

  it("emits overview before run not-installed failure in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runDaemonRun({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.run.agent_overview");
      expect(envelopes[0]?.payload?.stages).toContain(
        "Validate local service installation and OpenMeld auth readiness."
      );
      expect(envelopes[0]?.payload?.notes).toContain(
        "A selected OpenMeld profile is not required; use `--profile` only as an optional override."
      );
      expect(envelopes[1]?.code).toBe("daemon.run.not_installed");
      expect(thrown).toBeInstanceOf(Error);
    });
  });

  it("emits overview before stop not-running result in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStop({ view: "agent" });
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.stop.agent_overview");
      expect(envelopes[1]?.code).toBe("daemon.stop.not_running");
    });
  });

  it("emits overview before interrupt not-running result in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runDaemonInterrupt({
            dispatch: "dispatch-1",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.interrupt.agent_overview");
      expect(envelopes[0]?.payload?.requiredArguments).toContain(
        "exactly one of --dispatch <id> or --task <id>"
      );
      expect(envelopes[1]?.code).toBe("daemon.interrupt.not_running");
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe("daemon.control.not_running");
    });
  });

  it("emits overview before cancel not-running result in agent view", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runDaemonCancel({
            task: "task-1",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.cancel.agent_overview");
      expect(envelopes[0]?.payload?.commands).toContain(
        "openmeld service cancel --dispatch <id> --view agent"
      );
      expect(envelopes[1]?.code).toBe("daemon.cancel.not_running");
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe("daemon.control.not_running");
    });
  });

  it("emits overview before reinstall result in agent view", async () => {
    await withTempHome(async () => {
      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: "SIGTERM",
        systemServiceController: null,
        systemServiceUninstalled: false,
      });
      const runInstallMock = vi.fn().mockResolvedValue(undefined);
      const runRunMock = vi.fn().mockResolvedValue({
        ok: true,
        reason: "started",
      });
      const readDaemonStatusMock = vi.fn().mockResolvedValue({
        installed: true,
        state: {
          daemonVersion: "0.2.5",
          installedAt: "2026-03-05T00:00:00.000Z",
          source: "daemon.command.install",
        },
      });
      const runningInventory = {
        expectedVersion: "0.2.5",
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.2.5",
            installSource: "daemon.command.install",
            installedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
        },
        runtimeStatus: {
          status: "running",
          mode: "background",
          pid: 123,
          startedAt: "2026-03-05T00:00:00.000Z",
          updatedAt: "2026-03-05T00:00:00.000Z",
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        },
        legacySharedService: null,
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "service-bundle",
          daemonVersion: "0.2.5",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "self_contained_v1",
          sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/current-cli",
          sourceDistRootPath: "/tmp/current-cli/dist",
          sourceKind: "package_install",
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-10T00:00:00.000Z",
        },
        activeBundleSourceAvailable: null,
        activeBundleEntryPath:
          "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js",
        runtimeCommandEntryPath:
          "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js",
        runtimeCommandPathExists: true,
        serviceManager: null,
        serviceManagerStatus: {
          installed: true,
          running: true,
          enabled: true,
          commandSummary:
            "node /tmp/.openmeld/runtime/daemon/service-manager/daemon-service-launcher.mjs service run --mode foreground",
          definitionPath:
            "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
        },
        ownedProcesses: [],
        lifecycleLock: null,
        anomalies: [],
      };
      inspectDaemonServiceInventoryMock.mockResolvedValue(runningInventory);
      runDaemonServiceLifecycleMock.mockResolvedValue({
        status: "aligned",
        targetVersion: "0.2.5",
        inventoryBefore: runningInventory,
        inventoryAfter: runningInventory,
        reasonCodes: [],
        completedPhases: [
          "inspect",
          "backup",
          "stop_or_drain",
          "wait_stopped",
          "unregister",
          "wait_absent",
          "install_bundle",
          "write_contract",
          "register_service",
          "restore_runtime_data",
          "verify_final_inventory",
        ],
        desiredState: "stopped",
        shouldStartAfterLifecycle: false,
        backupDataPath: null,
        errorMessage: null,
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonReinstall(
          {
            view: "agent",
          },
          {
            teardown: teardownMock,
            runInstall: runInstallMock,
            runRun: runRunMock,
            readDaemonStatus: readDaemonStatusMock,
            withReconcileLock: async <T>(callback: () => Promise<T>) =>
              await callback(),
          }
        );
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.reinstall.agent_overview");
      expect(
        envelopes.some((item) => item.code === "daemon.reinstall.result")
      ).toBe(true);
    });
  });

  it("emits overview before uninstall result in agent view", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({ view: "agent" });
      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: null,
        systemServiceController: null,
        systemServiceUninstalled: false,
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonUninstall(
          {
            view: "agent",
          },
          {
            teardown: teardownMock,
          }
        );
      });

      const envelopes = parseAgentEnvelopes(stdout);
      expect(envelopes[0]?.code).toBe("daemon.uninstall.agent_overview");
      expect(envelopes[1]?.code).toBe("daemon.uninstall.result");
    });
  });
});

function createStatusInventory(input: {
  anomaly?: DaemonServiceInventory["anomalies"][number];
  runtimeContractCompatibility?: DaemonServiceInventory["runtimeContractCompatibility"];
}): DaemonServiceInventory {
  return {
    expectedVersion: "0.2.2",
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.2",
        installSource: "daemon.command.install",
        installedAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
    },
    runtimeStatus: {
      status: "running",
      mode: "background",
      pid: 123,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    legacySharedService: null,
    activeBundle: null,
    activeBundleSourceAvailable: null,
    activeBundleEntryPath: null,
    runtimeCommandEntryPath: null,
    runtimeCommandPathExists: null,
    ...(input.runtimeContractCompatibility
      ? { runtimeContractCompatibility: input.runtimeContractCompatibility }
      : {}),
    serviceManager: null,
    serviceManagerStatus: null,
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: input.anomaly ? [input.anomaly] : [],
  };
}

function parseAgentEnvelopes(stdout: string): Array<{
  code?: string;
  payload?: {
    commands?: string[];
    notes?: string[];
    requiredArguments?: string[];
    stages?: string[];
  };
}> {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const envelopes: Array<{
    code?: string;
    payload?: {
      commands?: string[];
      notes?: string[];
      requiredArguments?: string[];
      stages?: string[];
    };
  }> = [];
  for (const line of lines) {
    try {
      envelopes.push(
        JSON.parse(line) as {
          code?: string;
          payload?: {
            commands?: string[];
            notes?: string[];
            requiredArguments?: string[];
            stages?: string[];
          };
        }
      );
    } catch {
      // Ignore mixed human notes if they ever appear in captures.
    }
  }
  return envelopes;
}
