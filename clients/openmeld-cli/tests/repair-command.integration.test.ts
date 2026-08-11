import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRepairLocalState } from "../src/commands/repair";
import { withCapturedStdio } from "./helpers/fs";

const {
  repairOrphanedLegacyLocksMock,
  runDaemonStartupPreflightMock,
  runLocalStateAlignmentMock,
} = vi.hoisted(() => ({
  repairOrphanedLegacyLocksMock: vi.fn(),
  runDaemonStartupPreflightMock: vi.fn(),
  runLocalStateAlignmentMock: vi.fn(),
}));

let resolvedView: "human" | "agent" = "human";

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: vi.fn(async () => ({
    viewMode: "auto",
    resolvedView,
    interactive: resolvedView === "human",
  })),
}));

vi.mock("../src/system/local-state-alignment", () => ({
  runLocalStateAlignment: (...args: unknown[]) =>
    runLocalStateAlignmentMock(...args),
}));

vi.mock("../src/local-service/lifecycle/daemon-startup-preflight", () => ({
  runDaemonStartupPreflight: (...args: unknown[]) =>
    runDaemonStartupPreflightMock(...args),
}));

vi.mock("../src/config/lock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config/lock")>()),
  repairOrphanedLegacyLocks: (...args: unknown[]) =>
    repairOrphanedLegacyLocksMock(...args),
}));

describe("repair local state summary", () => {
  beforeEach(() => {
    resolvedView = "human";
    repairOrphanedLegacyLocksMock
      .mockReset()
      .mockResolvedValue({ removedOrphanedLegacyLocks: 0 });
    runLocalStateAlignmentMock.mockReset();
    runDaemonStartupPreflightMock.mockReset();
  });

  it.each([
    {
      name: "includes service repaired status after partial corrupt-file backup",
      report: createLocalStateAlignmentReport({
        storageVersionUpdated: true,
        requiresRepair: true,
        backedUpCorruptFiles: 2,
      }),
      daemonService: {
        status: "auto_healed",
        reasonCodes: [],
        errorMessage: null,
        cooldownUntil: null,
        backupDataPath: null,
      },
      expectedClauses: [
        "OpenMeld backed up some corrupt Space cache files",
        "OpenMeld Service for this lane was repaired.",
      ],
    },
    {
      name: "includes blocked service status when local cache still needs attention",
      report: createLocalStateAlignmentReport({
        requiresRepair: true,
      }),
      daemonService: {
        status: "blocked",
        reasonCodes: ["runtime_not_running"],
        errorMessage: null,
        cooldownUntil: null,
        backupDataPath: null,
      },
      expectedClauses: [
        "Local OpenMeld data still needs attention because some corrupt Space cache files could not be fully backed up.",
        "OpenMeld Service in this lane still needs attention.",
      ],
    },
    {
      name: "includes failed service status when local cache still needs attention",
      report: createLocalStateAlignmentReport({
        cleanupRemovedTemporaryFiles: 1,
        requiresRepair: true,
      }),
      daemonService: {
        status: "failed",
        reasonCodes: [],
        errorMessage: "daemon reinstall failed",
        cooldownUntil: null,
        backupDataPath: "/tmp/openmeld-backup",
      },
      expectedClauses: [
        "Automatic local OpenMeld data upgrade and cleanup completed, but some corrupt Space cache files still need attention.",
        "OpenMeld Service repair in this lane failed.",
      ],
    },
    {
      name: "includes aligned service status when local state is already up to date",
      report: createLocalStateAlignmentReport(),
      daemonService: {
        status: "aligned",
        reasonCodes: [],
        errorMessage: null,
        cooldownUntil: null,
        backupDataPath: null,
      },
      expectedClauses: [
        "Local OpenMeld data is up to date.",
        "OpenMeld Service for this lane was repaired.",
      ],
    },
    {
      name: "includes not-installed service status when local cleanup changed state",
      report: createLocalStateAlignmentReport({
        cleanupRemovedTemporaryFiles: 1,
      }),
      daemonService: {
        status: "not_installed",
        reasonCodes: [],
        errorMessage: null,
        cooldownUntil: null,
        backupDataPath: null,
      },
      expectedClauses: [
        "Automatic local OpenMeld data upgrade and cleanup completed.",
        "OpenMeld Service is not installed for this lane.",
      ],
    },
  ])("$name", async ({ report, daemonService, expectedClauses }) => {
    runLocalStateAlignmentMock.mockResolvedValue(report);
    runDaemonStartupPreflightMock.mockResolvedValue(daemonService);

    const { stdout } = await withCapturedStdio(async () => {
      await runRepairLocalState({ view: "human" });
    });

    for (const expectedClause of expectedClauses) {
      expect(stdout).toContain(expectedClause);
    }
    expect(stdout).toContain("This only affects the openmeld lane at");
  });

  it("prints the human repair summary as separate lines", async () => {
    runLocalStateAlignmentMock.mockResolvedValue(
      createLocalStateAlignmentReport()
    );
    runDaemonStartupPreflightMock.mockResolvedValue({
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });

    const { stdout } = await withCapturedStdio(async () => {
      await runRepairLocalState({ view: "human" });
    });

    expect(stdout).toContain("This only affects the openmeld lane at");
    expect(stdout).toContain(
      ".\nLocal OpenMeld data is up to date.\nOpenMeld Service for this lane is already aligned."
    );
  });

  it("reports every orphaned legacy lock removed across local command owners", async () => {
    repairOrphanedLegacyLocksMock.mockResolvedValue({
      removedOrphanedLegacyLocks: 2,
    });
    runLocalStateAlignmentMock.mockResolvedValue(
      createLocalStateAlignmentReport()
    );
    runDaemonStartupPreflightMock.mockResolvedValue({
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });

    const { stdout } = await withCapturedStdio(async () => {
      const result = await runRepairLocalState({ view: "human" });
      expect(result.localLocks.removedOrphanedLegacyLocks).toBe(2);
    });

    expect(repairOrphanedLegacyLocksMock).toHaveBeenCalledWith();
    expect(stdout).toContain(
      "OpenMeld removed 2 locks left by an older version."
    );
  });

  it("can repair local data without reporting OpenMeld Service repair state", async () => {
    runLocalStateAlignmentMock.mockResolvedValue(
      createLocalStateAlignmentReport()
    );

    const { stdout } = await withCapturedStdio(async () => {
      await runRepairLocalState({
        includeDaemonService: false,
        view: "human",
      });
    });

    expect(runDaemonStartupPreflightMock).not.toHaveBeenCalled();
    expect(stdout).toContain("This only affects the openmeld lane at");
    expect(stdout).toContain("Local OpenMeld data is up to date.");
    expect(stdout).not.toContain("OpenMeld Service");
  });

  it("keeps lane scope evidence in agent output", async () => {
    resolvedView = "agent";
    runLocalStateAlignmentMock.mockResolvedValue(
      createLocalStateAlignmentReport()
    );
    runDaemonStartupPreflightMock.mockResolvedValue({
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });

    const { stdout } = await withCapturedStdio(async () => {
      await runRepairLocalState({ view: "agent" });
    });

    expect(stdout).toContain('"code":"repair.local_state.completed"');
    expect(stdout).toContain('"lane"');
    expect(stdout).toContain('"command":"openmeld"');
    expect(stdout).toContain('"repairCommand":"openmeld repair local-state"');
  });
});

function createLocalStateAlignmentReport(input?: {
  storageVersionUpdated?: boolean;
  cleanupRemovedTemporaryFiles?: number;
  requiresRepair?: boolean;
  backedUpCorruptFiles?: number;
}): {
  storageVersion: number;
  storageVersionUpdated: boolean;
  runtimeConfig: {
    migratedLegacyConfig: boolean;
    removedLegacyConfig: boolean;
  };
  selectedOpenMeldProfile: {
    migratedSessionSelections: number;
    removedLegacyDirectory: boolean;
    removedLegacySelectionFile: boolean;
  };
  spaceCache: {
    migratedAccountSpaceFiles: number;
    removedLegacyAccountSpaceDirs: number;
    migratedLegacyProfileFiles: number;
    removedLegacyProfilesDir: boolean;
    migratedLegacyViews: number;
    requiresRepair: boolean;
    detectedCorruptFiles: number;
    detectedCorruptSpaceConfigFiles: number;
    detectedCorruptMaintenanceFiles: number;
    detectedCorruptDeletionNoticeFiles: number;
    backedUpCorruptFiles: number;
    backupRootPath: string | null;
    failedBackupPaths: string[];
  };
  cleanup: {
    removedTemporaryFiles: number;
  };
} {
  return {
    storageVersion: 1,
    storageVersionUpdated: input?.storageVersionUpdated ?? false,
    runtimeConfig: {
      migratedLegacyConfig: false,
      removedLegacyConfig: false,
    },
    selectedOpenMeldProfile: {
      migratedSessionSelections: 0,
      removedLegacyDirectory: false,
      removedLegacySelectionFile: false,
    },
    spaceCache: {
      migratedAccountSpaceFiles: 0,
      removedLegacyAccountSpaceDirs: 0,
      migratedLegacyProfileFiles: 0,
      removedLegacyProfilesDir: false,
      migratedLegacyViews: 0,
      requiresRepair: input?.requiresRepair ?? false,
      detectedCorruptFiles: input?.requiresRepair ? 2 : 0,
      detectedCorruptSpaceConfigFiles: input?.requiresRepair ? 1 : 0,
      detectedCorruptMaintenanceFiles: 0,
      detectedCorruptDeletionNoticeFiles: 0,
      backedUpCorruptFiles: input?.backedUpCorruptFiles ?? 0,
      backupRootPath:
        (input?.backedUpCorruptFiles ?? 0) > 0
          ? "/tmp/space-cache-backup"
          : null,
      failedBackupPaths: input?.requiresRepair ? ["/tmp/corrupt.json"] : [],
    },
    cleanup: {
      removedTemporaryFiles: input?.cleanupRemovedTemporaryFiles ?? 0,
    },
  };
}
