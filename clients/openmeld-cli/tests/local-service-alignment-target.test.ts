import { describe, expect, it } from "vitest";
import {
  buildDaemonServiceTargetSpec,
  resolveDaemonServiceAlignmentDecision,
} from "../src/local-service/lifecycle/daemon-service-alignment-target";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";

describe("local service alignment target", () => {
  it("uses the binary bundle format for binary distribution targets", () => {
    expect(
      buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
        distribution: "binary",
      })
    ).toEqual({
      daemonVersion: "0.2.0",
      bundleFormat: "binary_v1",
    });
  });

  it("treats a clean binary service as already aligned in binary distribution", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "binary-bundle",
          daemonVersion: "0.2.0",
          entryScriptRelativePath: "openmeld",
          bundleFormat: "binary_v1",
          sourceEntryScriptPath: "/Users/dev/.openmeld/versions/0.2.0/openmeld",
          sourcePackageRootPath: "/Users/dev/.openmeld/versions/0.2.0",
          sourceDistRootPath: "/Users/dev/.openmeld/versions/0.2.0",
          sourceKind: "package_install",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
        distribution: "binary",
      }),
    });

    expect(decision.status).toBe("already_aligned");
    expect(decision.reasonCodes).toEqual([]);
  });

  it("treats a clean stopped self-contained service as already aligned", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory(),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("already_aligned");
    expect(decision.reasonCodes).toEqual([]);
  });

  it("requires full alignment when same-version service still uses a legacy bundle layout", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "legacy-bundle",
          daemonVersion: "0.2.0",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "legacy_linked_v1",
          sourceEntryScriptPath: "/tmp/legacy/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/legacy",
          sourceDistRootPath: "/tmp/legacy/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
        anomalies: [
          {
            code: "bundle_strategy_legacy",
            message:
              "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual(["bundle_strategy_legacy"]);
  });

  it("requires action for same-version service manager path drift instead of reporting already aligned", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "service_manager_path_drift",
            message:
              "The OS service manager is still pointing at an old CLI path instead of the OpenMeld-managed stable launcher.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_auto_heal");
    expect(decision.reasonCodes).toEqual(["service_manager_path_drift"]);
  });

  it("requires full alignment when same-version service bundle content has drifted", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_content_drift",
            message:
              "OpenMeld Service is using older local service files than this lane expects, so OpenMeld needs to update the service.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual(["bundle_content_drift"]);
  });

  it("uses target daemonVersion instead of trusting stale inventory anomalies", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        expectedVersion: "0.1.9",
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.9",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual(["version_outdated"]);
  });

  it("blocks alignment when foreground and background ownership conflict is active", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "foreground_background_conflict",
            message:
              "A foreground OpenMeld service session is already running, so OpenMeld will not start background mode.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.reasonCodes).toEqual(["foreground_background_conflict"]);
  });

  it("returns not_installed when the service does not exist yet", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        installStatus: {
          installed: false,
          state: null,
        },
        anomalies: [
          {
            code: "not_installed",
            message: "OpenMeld Service is not installed on this device.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("not_installed");
    expect(decision.reasonCodes).toEqual(["not_installed"]);
  });

  it("routes a legacy shared service into full alignment for lane migration", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        installStatus: {
          installed: false,
          state: null,
        },
        legacySharedService: {
          present: true,
          pathInput: {
            env: {
              OPENMELD_ENV_PRESET: "prod",
            },
          },
          installStatus: {
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: "0.1.9",
              installSource: "daemon.command.install",
              installedAt: "2026-03-07T00:00:00.000Z",
              updatedAt: "2026-03-07T00:00:00.000Z",
            },
          },
          runtimeStatus: {
            status: "running",
            mode: "background",
            pid: 4242,
            startedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
          serviceManager: null,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath:
              "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
            commandSummary:
              "/Users/felix/.openmeld/runtime/daemon/service-manager/openmeld-service service run --mode foreground",
          },
          ownedProcesses: [],
        },
        anomalies: [
          {
            code: "legacy_shared_service_present",
            message:
              "A legacy shared OpenMeld Service from the pre-lane release is still installed and must be migrated to this lane.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual(["legacy_shared_service_present"]);
  });

  it("keeps blocked priority above full alignment and auto-heal reasons", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "runtime_stale",
            message: "Runtime state is stale (heartbeat_stale).",
          },
          {
            code: "bundle_strategy_legacy",
            message:
              "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
          },
          {
            code: "lifecycle_locked",
            message: "Another OpenMeld Service task is already running.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.reasonCodes).toEqual(["lifecycle_locked"]);
  });

  it("requires full alignment when raw bundle format drifts even if anomalies are missing", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "legacy-bundle",
          daemonVersion: "0.2.0",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "legacy_linked_v1",
          sourceEntryScriptPath: "/tmp/legacy/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/legacy",
          sourceDistRootPath: "/tmp/legacy/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual(["bundle_strategy_legacy"]);
  });

  it("does not duplicate full-alignment reason codes", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "legacy-bundle",
          daemonVersion: "0.2.0",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "legacy_linked_v1",
          sourceEntryScriptPath: "/tmp/legacy/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/legacy",
          sourceDistRootPath: "/tmp/legacy/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
        anomalies: [
          {
            code: "bundle_strategy_legacy",
            message:
              "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.reasonCodes).toEqual(["bundle_strategy_legacy"]);
  });

  it("routes provenance drift and duplicate owned processes to full alignment", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_provenance_drift",
            message:
              "The active OpenMeld Service bundle still depends on a local CLI source path that is no longer available.",
          },
          {
            code: "duplicate_owned_processes",
            message: "Found 2 OpenMeld-owned service processes on this device.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual([
      "bundle_provenance_drift",
      "duplicate_owned_processes",
    ]);
  });

  it("routes lane drift and runtime bundle mismatch to full alignment", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_lane_drift",
            message:
              "The active OpenMeld Service bundle came from repo-local workspace source, but this lane only allows published or packaged OpenMeld bundles. Use `openmeld-dev` for repo-local service validation.",
          },
          {
            code: "runtime_bundle_mismatch",
            message:
              "OpenMeld Service runtime state still points at a bundle entry file that no longer exists.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual([
      "bundle_lane_drift",
      "runtime_bundle_mismatch",
    ]);
  });

  it("routes manager-running-without-runtime to auto-heal", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "manager_running_without_runtime",
            message:
              "The OS service manager reports OpenMeld Service as running, but runtime state is not healthy.",
          },
        ],
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_auto_heal");
    expect(decision.reasonCodes).toEqual(["manager_running_without_runtime"]);
  });

  it("does not duplicate downgrade_blocked in blocked results", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        anomalies: [
          {
            code: "downgrade_blocked",
            message: "Installed v0.3.0 is newer than current CLI v0.2.0.",
          },
          {
            code: "lifecycle_locked",
            message: "Another OpenMeld Service task is already running.",
          },
        ],
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.3.0",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("blocked");
    expect(decision.reasonCodes).toEqual([
      "downgrade_blocked",
      "lifecycle_locked",
    ]);
  });

  it("requires full alignment when the active bundle version drifts from the installed service version", () => {
    const decision = resolveDaemonServiceAlignmentDecision({
      inventory: createInventory({
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "drifted-bundle",
          daemonVersion: "1.0.0",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "self_contained_v1",
          sourceEntryScriptPath: "/tmp/current/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/current",
          sourceDistRootPath: "/tmp/current/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
      }),
      target: buildDaemonServiceTargetSpec({
        daemonVersion: "0.2.0",
      }),
    });

    expect(decision.status).toBe("needs_full_alignment");
    expect(decision.reasonCodes).toEqual(["bundle_version_drift"]);
  });
});

function createInventory(
  overrides: Partial<DaemonServiceInventory> = {}
): DaemonServiceInventory {
  return {
    expectedVersion: "0.2.0",
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.0",
        installSource: "daemon.command.install",
        installedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      },
    },
    runtimeStatus: {
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    },
    legacySharedService: null,
    activeBundle: {
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleId: "self-contained-bundle",
      daemonVersion: "0.2.0",
      entryScriptRelativePath: "dist/openmeld.js",
      bundleFormat: "self_contained_v1",
      sourceEntryScriptPath: "/tmp/current/dist/openmeld.js",
      sourcePackageRootPath: "/tmp/current",
      sourceDistRootPath: "/tmp/current/dist",
      sourceKind: "workspace",
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
    },
    activeBundleSourceAvailable: null,
    activeBundleEntryPath:
      "/tmp/.openmeld/runtime/daemon/bundles/self-contained-bundle/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/tmp/.openmeld/runtime/daemon/bundles/self-contained-bundle/dist/openmeld.js",
    runtimeCommandPathExists: true,
    serviceManager: null,
    serviceManagerStatus: {
      installed: true,
      running: false,
      enabled: true,
      definitionPath:
        "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
      commandSummary:
        "com.openmeld.openmeld-background-service /Users/felix/.openmeld/runtime/daemon/service-manager/OpenMeld Service service run --mode foreground",
    },
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [],
    ...overrides,
  };
}
