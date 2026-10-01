import type {
  LocalComponentsReleaseManifest,
  LocalComponentsStatus,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveLocalComponentUpdateProjection } from "../local-components/update-projection";

describe("local component update projection", () => {
  it.each([
    "restored",
    "needs_help",
  ] as const)("projects only the first allowlisted Service CLI update failure reason for %s", (phase) => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-09-14T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        cliPackageVersion: "0.7.27",
        cliReasonCodes: [
          "OpenMeld update process exited with status 1 at /private/path",
          "cli.update.download_stalled",
          "cli.update.failed",
          "cli.update.download_stalled",
        ],
        includeUpdateOperation: true,
        updateOperationPhase: phase,
      }),
      releaseManifest: createReleaseManifest({}),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection.cli.reasonCodes).toEqual([
      "cli.package_update_available",
      "cli.update.download_stalled",
    ]);
  });

  it("keeps a healthy Service Wake-ready after a historical update failure", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-09-14T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        cliReasonCodes: ["cli.update.download_stalled"],
        includeUpdateOperation: true,
        updateOperationPhase: "needs_help",
      }),
      releaseManifest: createReleaseManifest({}),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      setupAction: "none",
      service: {
        status: "current",
        wakeBlocked: false,
      },
      updateOperation: {
        phase: "needs_help",
      },
    });
    expect(projection.cli.reasonCodes).toEqual(["cli.update.download_stalled"]);
  });

  it("drops Service CLI update failure reasons without an update operation", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-09-14T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        cliPackageVersion: "0.7.27",
        cliReasonCodes: ["cli.update.download_stalled"],
      }),
      releaseManifest: createReleaseManifest({}),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection.cli.reasonCodes).toEqual([
      "cli.package_update_available",
    ]);
  });

  it.each([
    "waiting_for_work",
    "updating",
    "updated",
  ] as const)("drops Service CLI update failure reasons while the operation is %s", (phase) => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-09-14T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        cliReasonCodes: ["cli.update.download_stalled"],
        includeUpdateOperation: true,
        updateOperationPhase: phase,
      }),
      releaseManifest: createReleaseManifest({}),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection.cli.reasonCodes).toEqual([]);
  });

  it("does not describe unknown installed versions as up to date and preserves the command lane", () => {
    const result = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-09-07T00:00:00.000Z",
      runtimeLane: "canary",
      releaseManifest: createReleaseManifest({}),
      serviceConnected: false,
      serviceVersion: null,
    });
    expect(result.setupActionLabel).toBe("Update status unavailable");
    expect(result.humanSetupCommand).toBe(
      "openmeld-canary upgrade && openmeld-canary setup"
    );
    expect(result.agentSetupCommand).not.toContain("npm");
  });
  it("accepts compatible independently maintained Skill content without asking for another CLI upgrade", () => {
    const status = createLocalComponentsStatus({
      skillsBundleHash: "c".repeat(64),
    });
    status.skills.expectedBundleHash = "c".repeat(64);
    status.skills.contentRelease = {
      revision: 1,
      minimumCliVersion: "0.3.159",
    };
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-09-05T00:00:00.000Z",
      localComponentsStatus: status,
      releaseManifest: createReleaseManifest({
        skillsUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });
    expect(projection.skills).toMatchObject({
      status: "current",
      expectedBundleHash: "c".repeat(64),
      reasonCodes: [],
    });
  });

  it("still rejects missing files, incompatible CLI commands, and mismatched Skill contracts", () => {
    for (const fault of ["missing", "cli", "contract"] as const) {
      const status = createLocalComponentsStatus({
        skillsBundleHash: "c".repeat(64),
      });
      status.skills.expectedBundleHash = "c".repeat(64);
      status.skills.contentRelease = {
        revision: 1,
        minimumCliVersion: fault === "cli" ? "99.0.0" : "0.3.159",
      };
      if (fault === "missing") {
        status.skills.status = "update_required";
      }
      if (fault === "contract") {
        status.skills.skillContractVersion = "unsupported";
      }
      const projection = resolveLocalComponentUpdateProjection({
        generatedAt: "2026-09-05T00:00:00.000Z",
        localComponentsStatus: status,
        releaseManifest: createReleaseManifest({
          skillsUpdatePolicy: "required",
        }),
        serviceConnected: true,
        serviceVersion: "0.7.28",
      });
      expect(projection.skills.status).toBe("update_required");
    }
  });
  it("keeps advisory Service updates from blocking Wake work", () => {
    const projection = resolveLocalComponentUpdateProjection({
      localComponentsStatus: createNpmStatusForServiceVersion("0.7.27"),
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.27",
    });

    expect(projection).toMatchObject({
      agentSetupCommand:
        "openmeld upgrade --view agent && openmeld setup --view agent",
      humanSetupCommand: "openmeld upgrade && openmeld setup",
      setupAction: "none",
      service: {
        installedVersion: "0.7.27",
        latestVersion: "0.7.28",
        reasonCodes: ["service.version_outdated"],
        requiredVersion: null,
        status: "update_available",
        updatePolicy: "available",
        wakeBlocked: false,
      },
    });
  });

  it("preserves the Service-owned update operation while the required floor blocks new Wakes", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        includeUpdateOperation: true,
        updateTargetVersion: "0.3.198",
        updateUrgency: "required",
      }),
      releaseManifest: createReleaseManifest({
        serviceBundleVersion: "0.3.198",
        serviceUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.3.197",
    });

    expect(projection.updateOperation).toEqual({
      operationId: "update-1",
      phase: "waiting_for_work",
      requestSource: "automatic",
      requestedAt: "2026-06-04T00:00:00.000Z",
      targetVersion: "0.3.198",
      updatedAt: "2026-06-04T00:01:00.000Z",
      urgency: "required",
    });
    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: "0.3.197",
        requiredVersion: "0.3.198",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("does not show an old completed update when a newer update is available", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        includeCompletedUpdateOperation: true,
        serviceBundleHash: "c".repeat(64),
      }),
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.27",
    });

    expect(projection.service.status).toBe("update_available");
    expect(projection.updateOperation).toBeUndefined();
  });

  it("passes the computer's automatic update setting through unchanged", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        automaticUpdatesEnabled: false,
      }),
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection.maintenance).toEqual({
      automaticUpdatesEnabled: false,
      status: "ready",
    });
  });

  it.each([
    {
      installedVersion: "0.3.215",
      latestVersion: "0.3.217",
      requiredVersion: "0.3.217",
      setupAction: "update_service",
      status: "update_required",
      updatePolicy: "required",
      wakeBlocked: true,
    },
    {
      installedVersion: "0.3.217",
      latestVersion: "0.3.217",
      requiredVersion: null,
      setupAction: "none",
      status: "current",
      updatePolicy: "available",
      wakeBlocked: false,
    },
    {
      installedVersion: "0.3.215",
      latestVersion: "0.3.217",
      requiredVersion: "0.3.217",
      setupAction: "update_service",
      status: "update_required",
      updatePolicy: "required",
      wakeBlocked: true,
    },
    {
      installedVersion: "0.3.216",
      latestVersion: "0.3.217",
      requiredVersion: "0.3.217",
      setupAction: "update_service",
      status: "update_required",
      updatePolicy: "required",
      wakeBlocked: true,
    },
    {
      installedVersion: "0.3.217",
      latestVersion: "0.3.217",
      requiredVersion: null,
      setupAction: "none",
      status: "current",
      updatePolicy: "available",
      wakeBlocked: false,
    },
    {
      installedVersion: "0.3.216",
      latestVersion: "0.3.218",
      requiredVersion: "0.3.218",
      setupAction: "update_service",
      status: "update_required",
      updatePolicy: "required",
      wakeBlocked: true,
    },
    {
      installedVersion: "0.3.217",
      latestVersion: "0.3.218",
      requiredVersion: "0.3.218",
      setupAction: "update_service",
      status: "update_required",
      updatePolicy: "required",
      wakeBlocked: true,
    },
    {
      installedVersion: "0.3.218",
      latestVersion: "0.3.219",
      requiredVersion: null,
      setupAction: "none",
      status: "update_available",
      updatePolicy: "available",
      wakeBlocked: false,
    },
    {
      installedVersion: "0.3.218",
      latestVersion: "0.3.223",
      requiredVersion: null,
      setupAction: "none",
      status: "update_available",
      updatePolicy: "available",
      wakeBlocked: false,
    },
    {
      installedVersion: "0.3.223",
      latestVersion: "0.3.224",
      requiredVersion: "0.3.224",
      setupAction: "update_service",
      status: "update_required",
      updatePolicy: "required",
      wakeBlocked: true,
    },
    {
      installedVersion: "0.3.224",
      latestVersion: "0.3.224",
      requiredVersion: null,
      setupAction: "none",
      status: "current",
      updatePolicy: "available",
      wakeBlocked: false,
    },
    {
      installedVersion: "0.3.225",
      latestVersion: "0.3.226",
      requiredVersion: "0.3.226",
      setupAction: "update_service",
      status: "update_required",
      updatePolicy: "required",
      wakeBlocked: true,
    },
  ] as const)("projects the monotonic Service floor for $installedVersion against available $latestVersion", ({
    installedVersion,
    latestVersion,
    requiredVersion,
    setupAction,
    status,
    updatePolicy,
    wakeBlocked,
  }) => {
    const projection = resolveLocalComponentUpdateProjection({
      localComponentsStatus: createNpmStatusForServiceVersion(installedVersion),
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceBundleVersion: latestVersion,
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: installedVersion,
    });

    expect(projection).toMatchObject({
      setupAction,
      service: {
        installedVersion,
        latestVersion,
        requiredVersion,
        status,
        updatePolicy,
        wakeBlocked,
      },
    });
  });

  it.each([
    { installedVersion: null, reasonCode: "service.version_not_reported" },
    { installedVersion: "unknown", reasonCode: "service.version_invalid" },
  ] as const)("keeps the published Service floor fail-closed for unprovable version $installedVersion", ({
    installedVersion,
    reasonCode,
  }) => {
    const projection = resolveLocalComponentUpdateProjection({
      localComponentsStatus: createNpmStatusForServiceVersion(installedVersion),
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceBundleVersion: "0.3.217",
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: installedVersion,
    });

    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion,
        latestVersion: "0.3.217",
        reasonCodes: [reasonCode],
        requiredVersion: "0.3.217",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("fails closed when a connected Service cannot prove the minimum version", () => {
    const projection = resolveLocalComponentUpdateProjection({
      localComponentsStatus: createNpmStatusForServiceVersion(null),
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: null,
    });

    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: null,
        reasonCodes: ["service.version_not_reported"],
        requiredVersion: "0.7.28",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("fails closed when a connected Service reports a non-SemVer version", () => {
    const projection = resolveLocalComponentUpdateProjection({
      localComponentsStatus: createNpmStatusForServiceVersion("unknown"),
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "unknown",
    });

    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: "unknown",
        requiredVersion: "0.7.28",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("keeps a prerelease Service below the stable minimum version", () => {
    const projection = resolveLocalComponentUpdateProjection({
      localComponentsStatus:
        createNpmStatusForServiceVersion("0.3.126-alpha.1"),
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.3.126-alpha.1",
    });

    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: "0.3.126-alpha.1",
        requiredVersion: "0.7.28",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("blocks Wake work only when the release policy is required", () => {
    const projection = resolveLocalComponentUpdateProjection({
      localComponentsStatus: createNpmStatusForServiceVersion("0.7.27"),
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.27",
    });

    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: "0.7.27",
        latestVersion: "0.7.28",
        reasonCodes: ["service.version_outdated"],
        requiredVersion: "0.7.28",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("projects advisory CLI package drift without blocking Wake work", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        cliPackageVersion: "0.7.27",
      }),
      releaseManifest: createReleaseManifest({
        cliUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      cli: {
        installedPackageVersion: "0.7.27",
        latestPackageVersion: "0.7.28",
        reasonCodes: ["cli.package_update_available"],
        status: "update_available",
        updatePolicy: "available",
        wakeBlocked: false,
      },
      setupAction: "none",
    });
  });

  it("projects same-version Service bundle drift as an advisory update", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        serviceBundleHash: "c".repeat(64),
      }),
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      setupAction: "none",
      service: {
        installedVersion: "0.7.28",
        latestVersion: "0.7.28",
        reasonCodes: ["service.bundle_mismatch"],
        requiredVersion: null,
        status: "update_available",
        updatePolicy: "available",
        wakeBlocked: false,
      },
    });
  });

  it("keeps same-version missing Service bundle hash diagnostic-only even when required", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        serviceBundleHash: null,
      }),
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      setupAction: "none",
      service: {
        installedVersion: "0.7.28",
        latestVersion: "0.7.28",
        reasonCodes: ["service.bundle_hash_not_reported"],
        requiredVersion: "0.7.28",
        status: "current",
        updatePolicy: "required",
        wakeBlocked: false,
      },
    });
  });

  it("projects same-version Service bundle drift as required when the release policy requires it", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        serviceBundleHash: "c".repeat(64),
      }),
      releaseManifest: createReleaseManifest({
        serviceUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: "0.7.28",
        latestVersion: "0.7.28",
        reasonCodes: ["service.bundle_mismatch"],
        requiredVersion: "0.7.28",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("projects required CLI package drift as a setup update without a Core Wake gate", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        cliPackageVersion: "0.7.27",
      }),
      releaseManifest: createReleaseManifest({
        cliUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      cli: {
        installedPackageVersion: "0.7.27",
        latestPackageVersion: "0.7.28",
        reasonCodes: ["cli.package_update_available"],
        requiredCommandContractVersion: "cli-contract-v1",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: false,
      },
      setupAction: "update_cli",
    });
  });

  it("projects aligned OpenMeld skills as current with no bundle mismatch", () => {
    // Regression guard for the permanent "Update available" badge family: when
    // the installed skills bundle matches the released bundle and the reported
    // status is ok, the projection must be current regardless of the release
    // update policy.
    for (const skillsUpdatePolicy of ["available", "required"] as const) {
      const projection = resolveLocalComponentUpdateProjection({
        generatedAt: "2026-06-04T00:00:00.000Z",
        localComponentsStatus: createLocalComponentsStatus({}),
        releaseManifest: createReleaseManifest({
          skillsUpdatePolicy,
        }),
        serviceConnected: true,
        serviceVersion: "0.7.28",
      });

      expect(projection).toMatchObject({
        setupAction: "none",
        skills: {
          expectedBundleHash: "b".repeat(64),
          installedBundleHash: "b".repeat(64),
          reasonCodes: [],
          status: "current",
          updatePolicy: skillsUpdatePolicy,
          wakeBlocked: false,
        },
      });
    }
  });

  it("projects advisory OpenMeld skills drift from installed bundle facts", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        skillsBundleHash: "c".repeat(64),
      }),
      releaseManifest: createReleaseManifest({
        skillsUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      setupAction: "none",
      skills: {
        expectedBundleHash: "b".repeat(64),
        expectedTargetCount: 1,
        installedBundleHash: "c".repeat(64),
        reasonCodes: ["skills.bundle_mismatch"],
        status: "update_available",
        targetCount: 1,
        updatePolicy: "available",
        wakeBlocked: false,
      },
    });
  });

  it("projects required OpenMeld skills drift as a setup update", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      localComponentsStatus: createLocalComponentsStatus({
        skillsBundleHash: "c".repeat(64),
      }),
      releaseManifest: createReleaseManifest({
        skillsUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      setupAction: "update_skills",
      skills: {
        reasonCodes: ["skills.bundle_mismatch"],
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: false,
      },
    });
  });

  it("fails closed when required CLI or skills facts are missing", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        cliUpdatePolicy: "required",
        skillsUpdatePolicy: "required",
      }),
      serviceConnected: true,
      serviceVersion: "0.7.28",
    });

    expect(projection).toMatchObject({
      cli: {
        installedPackageVersion: null,
        reasonCodes: [
          "cli.status_unavailable",
          "cli.release_target_unavailable",
        ],
        status: "update_required",
        updatePolicy: "required",
      },
      setupAction: "update_cli",
      skills: {
        reasonCodes: ["skills.status_unavailable"],
        status: "update_required",
        targetCount: null,
        updatePolicy: "required",
      },
    });
  });
});

function createReleaseManifest(input: {
  cliUpdatePolicy?: "ok" | "available" | "required";
  serviceBundleVersion?: string;
  serviceUpdatePolicy?: "ok" | "available" | "required";
  skillsUpdatePolicy?: "ok" | "available" | "required";
}): LocalComponentsReleaseManifest {
  return {
    schemaVersion: 1,
    updatedAt: "2026-06-04T00:00:00.000Z",
    components: {
      cli: {
        commandContractVersion: "cli-contract-v1",
        packageVersion: "0.7.28",
        reason: "Fixture.",
        updatePolicy: input.cliUpdatePolicy ?? "available",
      },
      service: {
        bundleHash: "a".repeat(64),
        bundleVersion: input.serviceBundleVersion ?? "0.7.28",
        reason: "Fixture.",
        runtimeContractEpoch: "daemon-epoch-v1",
        serviceContractVersion: "daemon-epoch-v1",
        updatePolicy: input.serviceUpdatePolicy ?? "available",
      },
      skills: {
        bundleHash: "b".repeat(64),
        reason: "Fixture.",
        skillContractVersion: "skills-contract-v1",
        skillIds: ["openmeld-cli"],
        updatePolicy: input.skillsUpdatePolicy ?? "available",
      },
    },
  };
}

function createLocalComponentsStatus(input: {
  automaticUpdatesEnabled?: boolean;
  cliPackageVersion?: string;
  cliReasonCodes?: string[];
  includeCompletedUpdateOperation?: boolean;
  includeUpdateOperation?: boolean;
  serviceBundleHash?: string | null;
  skillsBundleHash?: string | null;
  updateTargetVersion?: string;
  updateOperationPhase?: NonNullable<
    LocalComponentsStatus["updateOperation"]
  >["phase"];
  updateUrgency?: "available" | "required";
}): LocalComponentsStatus {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-04T00:00:00.000Z",
    entrypoint: "setup",
    installationSource: {
      distribution: "npm",
      channel: "stable",
      platform: "darwin-arm64",
    },
    summaryLabel: "Everything is up to date",
    summaryDescription:
      "OpenMeld local components are aligned for this computer.",
    setupAction: "none",
    setupActionLabel: "Everything is up to date",
    setupActionDescription:
      "OpenMeld local components are aligned for this computer.",
    ...(input.automaticUpdatesEnabled === undefined
      ? {}
      : {
          maintenance: {
            automaticUpdatesEnabled: input.automaticUpdatesEnabled,
            status: "ready" as const,
          },
        }),
    ...(input.includeUpdateOperation
      ? {
          updateOperation: {
            operationId: "update-1",
            phase: input.updateOperationPhase ?? "waiting_for_work",
            requestSource: "automatic" as const,
            requestedAt: "2026-06-04T00:00:00.000Z",
            targetVersion: input.updateTargetVersion ?? "0.7.28",
            updatedAt: "2026-06-04T00:01:00.000Z",
            urgency: input.updateUrgency ?? ("available" as const),
          },
        }
      : {}),
    ...(input.includeCompletedUpdateOperation
      ? {
          updateOperation: {
            operationId: "update-complete-1",
            phase: "updated" as const,
            requestSource: "web" as const,
            requestedAt: "2026-06-03T23:58:00.000Z",
            targetVersion: "0.7.27",
            updatedAt: "2026-06-04T00:00:00.000Z",
            urgency: "available" as const,
          },
        }
      : {}),
    cli: {
      commandContractVersion: "cli-contract-v1",
      latestPackageVersion: "0.7.28",
      packageVersion: input.cliPackageVersion ?? "0.7.28",
      reasonCodes: input.cliReasonCodes ?? [],
      requiredCommandContractVersion: null,
      status: "ok",
    },
    service: {
      expectedBundleHash: "a".repeat(64),
      expectedBundleVersion: "0.7.28",
      installedBundleHash:
        input.serviceBundleHash === undefined
          ? "a".repeat(64)
          : input.serviceBundleHash,
      installedBundleVersion: "0.7.28",
      reasonCodes: [],
      runtimeContractEpoch: "daemon-epoch-v1",
      serviceContractVersion: "daemon-epoch-v1",
      status: "ok",
    },
    skills: {
      expectedBundleHash: "b".repeat(64),
      installedBundleHash:
        input.skillsBundleHash === undefined
          ? "b".repeat(64)
          : input.skillsBundleHash,
      reasonCodes: [],
      skillContractVersion: "skills-contract-v1",
      status: "ok",
      targetCount: 1,
    },
  };
}

describe("installation-source availability", () => {
  const global = createReleaseManifest({});
  global.components.cli.packageVersion = "0.3.232";
  global.components.service.bundleVersion = "0.3.232";
  const previewPolicy = {
    cli: { ...global.components.cli, packageVersion: "0.3.231" },
    service: { ...global.components.service, bundleVersion: "0.3.231" },
  };
  const catalog = {
    schemaVersion: 1 as const,
    entries: [
      {
        channel: "windows-preview" as const,
        platform: "windows-x64",
        policy: previewPolicy,
      },
      {
        channel: "stable" as const,
        platform: "darwin-arm64",
        policy: global.components,
      },
    ],
  };
  function project(
    input: {
      source?: LocalComponentsStatus["installationSource"];
      installed?: string;
      catalog?: typeof catalog | null;
      policy?: LocalComponentsReleaseManifest;
    } = {}
  ) {
    const status = createLocalComponentsStatus({
      cliPackageVersion: input.installed ?? "0.3.231",
    });
    status.installationSource = input.source;
    return resolveLocalComponentUpdateProjection({
      generatedAt: "2026-10-01T00:00:00.000Z",
      localComponentsStatus: status,
      releaseManifest: input.policy ?? global,
      availabilityCatalog:
        input.catalog === undefined ? catalog : input.catalog,
      serviceConnected: true,
      serviceVersion: input.installed ?? "0.3.231",
    });
  }
  const previewSource = {
    distribution: "binary" as const,
    channel: "windows-preview" as const,
    platform: "windows-x64",
  };

  it("does not offer stable232 to a preview231 installation", () => {
    expect(project({ source: previewSource })).toMatchObject({
      cli: { status: "current", latestPackageVersion: "0.3.231" },
      service: {
        status: "current",
        latestVersion: "0.3.231",
        wakeBlocked: false,
      },
    });
  });
  it.each([
    { installed: "0.3.231", available: true, status: "update_required" },
    { installed: "0.3.231", available: false, status: "update_required" },
    { installed: "invalid", available: false, status: "update_required" },
    { installed: "0.3.232", available: true, status: "unknown" },
    { installed: "0.3.233", available: false, status: "unknown" },
  ])("preserves required CLI232 policy for $installed with preview availability=$available", ({
    installed,
    available,
    status,
  }) => {
    const required = {
      ...global,
      components: {
        ...global.components,
        cli: { ...global.components.cli, updatePolicy: "required" as const },
      },
    };
    expect(
      project({
        source: previewSource,
        policy: required,
        installed,
        catalog: available ? catalog : null,
      })
    ).toMatchObject({
      cli: {
        status,
        latestPackageVersion: null,
        updatePolicy: "required",
        reasonCodes: expect.arrayContaining([
          "cli.release_target_unavailable",
          ...(status === "update_required"
            ? ["cli.package_update_available"]
            : []),
        ]),
        wakeBlocked: false,
      },
    });
  });
  it.each([
    undefined,
    { ...previewSource, channel: "stable" as const },
    { ...previewSource, platform: "windows-arm64" },
  ])("keeps unavailable or unreported selectors unknown: %j", (source) => {
    expect(project({ source })).toMatchObject({
      cli: { status: "unknown", latestPackageVersion: null },
      service: { status: "unknown", latestVersion: null, wakeBlocked: false },
    });
  });
  it("updates a preview230 computer only to its preview231 pair", () => {
    expect(
      project({ source: previewSource, installed: "0.3.230" })
    ).toMatchObject({
      cli: { status: "update_available", latestPackageVersion: "0.3.231" },
      service: {
        status: "update_available",
        latestVersion: "0.3.231",
        wakeBlocked: false,
      },
    });
  });
  it("keeps the226 safety floor while offering an installable231 recovery", () => {
    expect(
      project({ source: previewSource, installed: "0.3.224" })
    ).toMatchObject({
      service: {
        status: "update_required",
        requiredVersion: "0.3.231",
        latestVersion: "0.3.231",
        wakeBlocked: true,
      },
    });
  });
  it("blocks unsafe versions even when no recovery artifact is available", () => {
    expect(project({ installed: "0.3.224", catalog: null })).toMatchObject({
      service: {
        status: "update_required",
        requiredVersion: null,
        latestVersion: null,
        wakeBlocked: true,
      },
    });
  });
  it("does not weaken a required stable232 safety policy to preview231", () => {
    const required = createReleaseManifest({
      serviceUpdatePolicy: "required",
      serviceBundleVersion: "0.3.232",
    });
    const requiredPreview = {
      ...catalog,
      entries: [
        {
          channel: "windows-preview" as const,
          platform: previewSource.platform,
          policy: {
            ...previewPolicy,
            service: {
              ...previewPolicy.service,
              updatePolicy: "required" as const,
            },
          },
        },
      ],
    };
    expect(
      project({
        source: previewSource,
        policy: required,
        catalog: requiredPreview,
      })
    ).toMatchObject({
      service: {
        status: "update_required",
        latestVersion: null,
        requiredVersion: null,
        wakeBlocked: true,
      },
    });
    expect(project({ source: previewSource, policy: required })).toMatchObject({
      service: {
        status: "update_required",
        latestVersion: null,
        wakeBlocked: true,
      },
    });
  });
  it("preserves npm policy without borrowing binary platform availability", () => {
    expect(
      project({
        source: { ...previewSource, distribution: "npm", channel: "stable" },
      })
    ).toMatchObject({
      cli: { latestPackageVersion: "0.3.232", status: "update_available" },
      service: { latestVersion: "0.3.232", status: "update_available" },
    });
  });
  it("keeps healthy Service231 eligible without offering obsolete Service225", () => {
    const obsolete = {
      ...catalog,
      entries: [
        {
          channel: "windows-preview" as const,
          platform: previewSource.platform,
          policy: {
            ...previewPolicy,
            service: { ...previewPolicy.service, bundleVersion: "0.3.225" },
          },
        },
      ],
    };
    expect(project({ source: previewSource, catalog: obsolete })).toMatchObject(
      {
        service: {
          status: "unknown",
          latestVersion: null,
          requiredVersion: null,
          wakeBlocked: false,
        },
      }
    );
  });
  it("supports a separately retained preview Service", () => {
    const retained = {
      ...catalog,
      entries: [
        {
          channel: "windows-preview" as const,
          platform: previewSource.platform,
          policy: {
            ...previewPolicy,
            service: { ...previewPolicy.service, bundleVersion: "0.3.230" },
          },
        },
      ],
    };
    expect(
      project({
        source: previewSource,
        catalog: retained,
        installed: "0.3.230",
      })
    ).toMatchObject({
      cli: { latestPackageVersion: "0.3.231", status: "update_available" },
      service: { latestVersion: "0.3.230", status: "current" },
    });
  });
});

function createNpmStatusForServiceVersion(
  version: string | null
): LocalComponentsStatus {
  const status = createLocalComponentsStatus({});
  status.service.installedBundleVersion = version;
  return status;
}
