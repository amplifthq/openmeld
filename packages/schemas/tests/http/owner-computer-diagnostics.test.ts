import { describe, expect, it } from "vitest";
import {
  ownerComputerDiagnosticsSchema,
  projectOwnerComputerLocalRuntimes,
  summarizeComputerFileAccessPolicy,
} from "../../src/index";

describe("Owner Computer diagnostics contract", () => {
  it("summarizes File Access without exposing local folder paths", () => {
    const summary = summarizeComputerFileAccessPolicy({
      deviceId: "computer-1",
      policy: {
        folders: ["/Users/felix/Code", "/Users/felix/Documents"],
        mode: "only_selected_folders",
        revision: 3,
        updatedAtMs: 1_786_320_000_000,
      },
    });

    expect(summary).toEqual({
      deviceId: "computer-1",
      folderCount: 2,
      mode: "only_selected_folders",
      revision: 3,
      status: "available",
      updatedAtMs: 1_786_320_000_000,
    });
    expect(JSON.stringify(summary)).not.toContain("/Users/felix");
  });

  it("rejects local folder paths at the shared diagnostics boundary", () => {
    const validDiagnostics = {
      currentComputerFileAccess: {
        deviceId: "computer-1",
        folderCount: 1,
        mode: "only_selected_folders" as const,
        revision: 1,
        status: "available" as const,
        updatedAtMs: 1,
      },
      currentLocalRuntimeReplyReadiness: createReplyReadiness(),
      localRuntimes: createLocalRuntimes(),
    };
    const parsedDiagnostics =
      ownerComputerDiagnosticsSchema.parse(validDiagnostics);
    expect(
      parsedDiagnostics.currentLocalRuntimeReplyReadiness.runtime
        .signInOnlyBlockers
    ).toBe(false);
    expect(
      ownerComputerDiagnosticsSchema.safeParse({
        ...validDiagnostics,
        currentComputerFileAccess: {
          ...validDiagnostics.currentComputerFileAccess,
          folders: ["/Users/felix/Code"],
        },
      }).success
    ).toBe(false);
  });

  it("projects Local Agent status without exposing accounts, paths, commands, or private skills", () => {
    const projected = projectOwnerComputerLocalRuntimes(
      createSensitiveLocalRuntimes()
    );

    expect(
      projected.localRuntimes[0]?.executionTargets[0]?.capabilities[0]
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
      details: {
        launch: { installChoiceCount: 1, status: "ready" },
        models: [{ displayName: "GPT-5.5" }],
        status: "ready",
        usageLimits: [
          {
            key: "codex:primary",
            label: "5-hour usage",
            observedAt: "2026-08-19T00:00:00.000Z",
            resetsAt: "2026-08-19T05:00:00.000Z",
            status: "available",
            usedPercent: 62,
          },
        ],
        version: "1.2.3",
        versionAdvisory: {
          currentVersion: "1.2.3",
          latestVersion: "1.2.4",
          status: "behind_latest",
        },
      },
      displayName: "Codex",
      enabled: true,
      status: "ready",
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("felix@example.com");
    expect(serialized).not.toContain("/Users/felix/bin/codex");
    expect(serialized).not.toContain("--private-flag");
    expect(serialized).not.toContain("npm install -g private-package");
    expect(serialized).not.toContain("Private diagnostic message");
    expect(serialized).not.toContain("private-company-skill");
  });
});

function createLocalRuntimes() {
  return {
    currentDeviceId: "computer-1",
    currentRuntimeLane: "prod",
    localRuntimes: [],
  };
}

function createReplyReadiness() {
  return {
    canReplyFromThisComputer: false,
    currentTarget: { availability: "missing" },
    generatedAt: "2026-08-19T00:00:00.000Z",
    localComponents: {
      agentSetupCommand: "openmeld setup --view agent",
      cli: {
        commandContractVersion: null,
        installedPackageVersion: null,
        latestPackageVersion: null,
        reasonCodes: [],
        requiredCommandContractVersion: null,
        status: "unknown",
        updatePolicy: "required",
        wakeBlocked: false,
      },
      generatedAt: "2026-08-19T00:00:00.000Z",
      humanSetupCommand: "openmeld setup",
      schemaVersion: 1,
      service: {
        installedVersion: null,
        latestVersion: null,
        reasonCodes: [],
        requiredVersion: null,
        status: "unknown",
        updatePolicy: "required",
        wakeBlocked: false,
      },
      setupAction: "connect_service",
      setupActionDescription: "Connect OpenMeld Service on this computer.",
      setupActionLabel: "Connect OpenMeld Service",
      skills: {
        expectedBundleHash: null,
        expectedTargetCount: 0,
        installedBundleHash: null,
        reasonCodes: [],
        skillContractVersion: null,
        status: "unknown",
        targetCount: null,
        updatePolicy: "required",
        wakeBlocked: false,
      },
    },
    message: "No current Computer was found.",
    nextAction: "run_setup",
    primaryBlocker: "current_runtime_missing",
    runtime: {
      deviceDisplayName: null,
      deviceId: null,
      executionTargetStatus: null,
      lastObservedAtMs: null,
      openMeldServiceRuntimeId: null,
      reasonCodes: [],
      runtimeLane: null,
    },
    service: {
      connected: false,
      executionCompatibility: null,
      matchingCurrentRuntime: false,
      reasonCodes: [],
      sessionDeviceId: null,
      sessionLane: null,
    },
    status: "blocked",
  };
}

function createSensitiveLocalRuntimes() {
  return {
    currentDeviceId: "computer-1",
    currentRuntimeLane: "prod" as const,
    localRuntimes: [
      {
        deviceDisplayName: "Felix's MacBook Pro",
        deviceDisplayNameSource: "user" as const,
        deviceId: "computer-1",
        deviceType: "laptop" as const,
        executionTargets: [
          {
            capabilities: [
              {
                agentControllerInterface: {
                  agentControllerRef: "builtin:codex",
                  auth: {
                    email: "felix@example.com",
                    label: "Private account",
                    status: "authenticated" as const,
                  },
                  capabilities: {
                    approvals: true,
                    cancel: true,
                    interrupt: true,
                    modelSelection: true,
                    nativeEventStream: true,
                    permissionModes: true,
                    structuredUserInput: true,
                  },
                  checkedAt: "2026-08-19T00:00:00.000Z",
                  controllerId: "codex",
                  displayName: "Codex",
                  launch: {
                    argsPrefix: ["--private-flag"],
                    commandPath: "/Users/felix/bin/codex",
                    installChoiceCount: 1,
                    status: "ready" as const,
                  },
                  message: "Private diagnostic message",
                  models: [{ displayName: "GPT-5.5", id: "gpt-5.5" }],
                  nativeInterface: "codex-app-server" as const,
                  schemaVersion: 1 as const,
                  skills: [{ id: "private-company-skill" }],
                  status: "ready" as const,
                  usageLimits: [
                    {
                      key: "codex:primary",
                      label: "5-hour usage",
                      observedAt: "2026-08-19T00:00:00.000Z",
                      resetsAt: "2026-08-19T05:00:00.000Z",
                      status: "available" as const,
                      usedPercent: 62,
                    },
                  ],
                  version: "1.2.3",
                  versionAdvisory: {
                    checkedAt: "2026-08-19T00:00:00.000Z",
                    currentVersion: "1.2.3",
                    latestVersion: "1.2.4",
                    message: "Private update detail",
                    status: "behind_latest" as const,
                    updateCommand: "npm install -g private-package",
                  },
                },
                agentControllerRef: "builtin:codex",
                enabled: true,
                reasonCodes: [],
                status: "ready" as const,
              },
            ],
            deviceId: "computer-1",
            isCurrent: true,
            lastObservedAtMs: 1,
            localAgentCatalog: {
              detectedNotSupportedYet: 0,
              detectedSupported: 1,
              entries: [
                {
                  agentId: "codex",
                  detected: true,
                  displayName: "Codex",
                  enabled: true,
                  launchStatus: "ready" as const,
                  lifecycleStatus: "active" as const,
                  selectable: true,
                  selectableReason: null,
                  targetKind: "builtin" as const,
                },
              ],
              needsChoice: 0,
              needsRepair: 0,
              notDetected: 0,
              totalBuiltins: 1,
            },
            localAgentControl: {
              refreshCatalog: true,
              setEnabled: true,
            },
            openMeldServiceRuntimeId: null,
            reasonCodes: [],
            runtimeLane: "prod" as const,
            status: "ready" as const,
            userFacingCommand: "openmeld" as const,
          },
        ],
        firstSeenAtMs: 1,
        isCurrent: true,
        lastObservedAtMs: 1,
        osVersion: "15.6",
        platformFamily: "macOS" as const,
      },
    ],
  };
}
