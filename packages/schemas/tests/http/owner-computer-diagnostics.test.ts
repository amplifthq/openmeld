import { describe, expect, it } from "vitest";
import {
  ownerComputerDiagnosticsSchema,
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
    expect(
      ownerComputerDiagnosticsSchema.safeParse(validDiagnostics).success
    ).toBe(true);
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
