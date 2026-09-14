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

  it("requires Service 0.3.198 before admitting new Wake work", () => {
    const releaseManifest = createReleaseManifest({
      serviceBundleVersion: "0.3.198",
      serviceUpdatePolicy: "available",
    });
    const unsupported = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest,
      serviceConnected: true,
      serviceVersion: "0.3.197",
    });
    const supported = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest,
      serviceConnected: true,
      serviceVersion: "0.3.198",
    });

    expect(unsupported).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: "0.3.197",
        latestVersion: "0.3.198",
        reasonCodes: ["service.version_outdated"],
        requiredVersion: "0.3.198",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
    expect(supported).toMatchObject({
      setupAction: "none",
      service: {
        installedVersion: "0.3.198",
        latestVersion: "0.3.198",
        reasonCodes: ["service.bundle_hash_not_reported"],
        requiredVersion: null,
        status: "current",
        updatePolicy: "available",
        wakeBlocked: false,
      },
    });
  });

  it("fails closed when a connected Service cannot prove the minimum version", () => {
    const projection = resolveLocalComponentUpdateProjection({
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

  it("does not activate the Core floor before its matching Service release is installable", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceBundleVersion: "0.3.197",
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.3.197",
    });

    expect(projection).toMatchObject({
      setupAction: "none",
      service: {
        installedVersion: "0.3.197",
        latestVersion: "0.3.197",
        reasonCodes: ["service.bundle_hash_not_reported"],
        requiredVersion: null,
        status: "current",
        updatePolicy: "available",
        wakeBlocked: false,
      },
    });
  });

  it("activates the Core floor when the matching Service release is installable", () => {
    const projection = resolveLocalComponentUpdateProjection({
      generatedAt: "2026-06-04T00:00:00.000Z",
      releaseManifest: createReleaseManifest({
        serviceBundleVersion: "0.3.198",
        serviceUpdatePolicy: "available",
      }),
      serviceConnected: true,
      serviceVersion: "0.3.197",
    });

    expect(projection).toMatchObject({
      setupAction: "update_service",
      service: {
        installedVersion: "0.3.197",
        latestVersion: "0.3.198",
        reasonCodes: ["service.version_outdated"],
        requiredVersion: "0.3.198",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
    });
  });

  it("blocks Wake work only when the release policy is required", () => {
    const projection = resolveLocalComponentUpdateProjection({
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
        reasonCodes: ["cli.status_unavailable"],
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
