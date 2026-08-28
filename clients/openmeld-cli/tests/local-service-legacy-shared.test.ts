import { describe, expect, it } from "vitest";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";
import { OPENMELD_HOME_ENV_KEY } from "../src/config/paths";
import {
  requiresLegacySharedDaemonServiceMigration,
  resolveLegacySharedDaemonPathInput,
  shouldInspectLegacySharedDaemonService,
} from "../src/local-service/lifecycle/daemon-service-legacy-shared";

describe("local service legacy shared", () => {
  it("only inspects legacy production service state from the production lane", () => {
    expect(
      shouldInspectLegacySharedDaemonService({
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
        },
      })
    ).toBe(false);
    expect(
      shouldInspectLegacySharedDaemonService({
        env: {
          OPENMELD_ENV_PRESET: "canary",
        },
      })
    ).toBe(false);
    expect(
      shouldInspectLegacySharedDaemonService({
        env: {
          OPENMELD_ENV_PRESET: "prod",
        },
      })
    ).toBe(true);
  });

  it("skips legacy shared inspection when OPENMELD_HOME is explicitly overridden", () => {
    const env = {
      OPENMELD_ENV_PRESET: "dev-local",
      [OPENMELD_HOME_ENV_KEY]: "/tmp/custom-openmeld-home",
    };

    expect(
      shouldInspectLegacySharedDaemonService({
        env,
      })
    ).toBe(false);
    expect(
      resolveLegacySharedDaemonPathInput({
        env,
      })
    ).toBeNull();
  });

  it.each([
    "dev-local",
    "canary",
  ])("never resolves the production lane from %s", (envPreset) => {
    const input = {
      env: {
        OPENMELD_ENV_PRESET: envPreset,
        CUSTOM_FLAG: "1",
      },
    };

    expect(resolveLegacySharedDaemonPathInput(input)).toBeNull();
  });

  it("only requires migration when the shared service command drifts away from the prod service wrapper", () => {
    const pathInput = {
      env: {
        OPENMELD_ENV_PRESET: "prod",
      },
      homeDir: "/Users/felix",
    };

    const serviceManager = {
      controller: "launchd" as const,
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
      status: async () => ({
        installed: true,
        running: false,
        enabled: true,
      }),
    };

    expect(
      requiresLegacySharedDaemonServiceMigration({
        pathInput,
        runtimeStatus: createRuntimeStatus(),
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          running: false,
          enabled: true,
          definitionPath:
            "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
          commandSummary:
            "com.openmeld.openmeld-background-service /Users/felix/.openmeld/runtime/daemon/service-manager/openmeld-service service run --mode foreground",
        },
        ownedProcesses: [],
      })
    ).toBe(false);

    expect(
      requiresLegacySharedDaemonServiceMigration({
        pathInput,
        runtimeStatus: createRuntimeStatus(),
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          running: false,
          enabled: true,
          definitionPath:
            "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
          commandSummary:
            "com.openmeld.openmeld-background-service /tmp/openmeld-cli-test/.openmeld/runtime/daemon/service-manager/openmeld-service service run --mode foreground",
        },
        ownedProcesses: [],
      })
    ).toBe(true);
  });

  it("requires migration when legacy-detached runtime state remains without a registered prod service", () => {
    expect(
      requiresLegacySharedDaemonServiceMigration({
        pathInput: {
          env: {
            OPENMELD_ENV_PRESET: "prod",
          },
        },
        runtimeStatus: createRuntimeStatus({
          status: "stale",
          serviceController: "legacy-detached",
          reason: "process_not_alive",
        }),
        serviceManager: null,
        serviceManagerStatus: {
          installed: false,
          running: false,
          enabled: false,
        },
        ownedProcesses: [],
      })
    ).toBe(true);
  });

  it("requires migration when legacy-detached processes remain without a registered prod service", () => {
    expect(
      requiresLegacySharedDaemonServiceMigration({
        pathInput: {
          env: {
            OPENMELD_ENV_PRESET: "prod",
          },
        },
        runtimeStatus: createRuntimeStatus(),
        serviceManager: null,
        serviceManagerStatus: {
          installed: false,
          running: false,
          enabled: false,
        },
        ownedProcesses: [
          {
            pid: 42,
            parentPid: 1,
            command: "node legacy-detached-service.js",
            mode: null,
            ownership: "legacy_detached",
          },
        ],
      })
    ).toBe(true);
  });

  it("does not flag a healthy stopped prod lane without legacy residuals", () => {
    expect(
      requiresLegacySharedDaemonServiceMigration({
        pathInput: {
          env: {
            OPENMELD_ENV_PRESET: "prod",
          },
        },
        runtimeStatus: createRuntimeStatus(),
        serviceManager: null,
        serviceManagerStatus: {
          installed: false,
          running: false,
          enabled: false,
        },
        ownedProcesses: [],
      })
    ).toBe(false);
  });

  it("does not flag a current prod foreground session as legacy shared residual", () => {
    expect(
      requiresLegacySharedDaemonServiceMigration({
        pathInput: {
          env: {
            OPENMELD_ENV_PRESET: "prod",
          },
        },
        runtimeStatus: createRuntimeStatus({
          status: "running",
          mode: "foreground",
          pid: 73,
          startedAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z",
        }),
        serviceManager: null,
        serviceManagerStatus: {
          installed: false,
          running: false,
          enabled: false,
        },
        ownedProcesses: [
          {
            pid: 73,
            parentPid: 1,
            command:
              "node /usr/local/bin/openmeld service run --mode foreground",
            mode: "foreground",
            ownership: "cli_direct",
          },
        ],
      })
    ).toBe(false);
  });
});

function createRuntimeStatus(
  overrides: Partial<DaemonServiceRuntimeStatus> = {}
): DaemonServiceRuntimeStatus {
  return {
    status: "not_running",
    mode: null,
    pid: null,
    startedAt: null,
    updatedAt: null,
    managedBySystemService: false,
    serviceController: "unknown",
    autoStart: false,
    ...overrides,
  };
}
