import { describe, expect, it } from "vitest";
import {
  formatLocalComponentsSummaryLabel,
  formatLocalSetupActionDescription,
  formatLocalSetupActionLabel,
  localComponentsReleaseManifestSchema,
  localComponentsStatusSchema,
  localComponentUpdateProjectionSchema,
} from "../src/schemas";

describe("local components schema", () => {
  it("accepts the normalized setup action projection", () => {
    const parsed = localComponentsStatusSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-05-30T00:00:00.000Z",
      entrypoint: "setup",
      summaryLabel: "Update OpenMeld Service",
      summaryDescription:
        "Update OpenMeld Service through setup on this computer.",
      setupAction: "update_service",
      setupActionLabel: "Update OpenMeld Service",
      setupActionDescription:
        "Update OpenMeld Service through setup on this computer.",
      cli: {
        commandContractVersion:
          "openmeld-cli-command-contract-2026-05-local-components-v1",
        latestPackageVersion: null,
        packageVersion: "0.6.9",
        reasonCodes: [],
        requiredCommandContractVersion: null,
        status: "ok",
      },
      service: {
        expectedBundleHash: null,
        expectedBundleVersion: "0.6.9",
        installedBundleHash: null,
        installedBundleVersion: "0.6.8",
        reasonCodes: ["service.version_outdated"],
        runtimeContractEpoch:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        serviceContractVersion:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        status: "update_required",
      },
      skills: {
        expectedBundleHash: "hash-next",
        installedBundleHash: "hash-prev",
        reasonCodes: ["skills.update_required"],
        skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
        status: "update_required",
        targetCount: 2,
      },
    });

    expect(parsed.setupAction).toBe("update_service");
  });

  it("owns the user-facing labels for setup actions", () => {
    expect(formatLocalSetupActionLabel("connect_service")).toBe(
      "Connect OpenMeld Service"
    );
    expect(formatLocalSetupActionLabel("reconnect_service")).toBe(
      "Reconnect OpenMeld Service"
    );
    expect(formatLocalSetupActionLabel("connect_local_agent")).toBe(
      "Connect local agent"
    );
    expect(formatLocalSetupActionDescription("update_skills")).toContain(
      "Update OpenMeld skills"
    );
  });

  it("keeps optional CLI updates separate from setup actions", () => {
    expect(
      formatLocalComponentsSummaryLabel({
        cliStatus: "update_available",
        setupAction: "none",
      })
    ).toBe("OpenMeld CLI update available");

    expect(
      formatLocalComponentsSummaryLabel({
        cliStatus: "update_available",
        setupAction: "update_service",
      })
    ).toBe("Update OpenMeld Service");
  });

  it("accepts the release-side update policy manifest", () => {
    const parsed = localComponentsReleaseManifestSchema.parse({
      schemaVersion: 1,
      updatedAt: "2026-06-03T00:00:00.000Z",
      components: {
        cli: {
          packageVersion: "0.7.24",
          commandContractVersion:
            "openmeld-cli-command-contract-2026-05-local-components-v1",
          updatePolicy: "available",
          reason: "CLI package freshness is advisory.",
        },
        service: {
          bundleHash: null,
          bundleVersion: "0.7.24",
          runtimeContractEpoch:
            "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
          serviceContractVersion:
            "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
          updatePolicy: "required",
          reason: "OpenMeld Service must be current before new Wake work.",
        },
        skills: {
          bundleHash: null,
          skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
          skillIds: ["openmeld-cli"],
          updatePolicy: "required",
          reason: "Agents need current OpenMeld instructions.",
        },
      },
    });

    expect(parsed.components.service.updatePolicy).toBe("required");
  });

  it("accepts the Core-owned local component update projection", () => {
    const parsed = localComponentUpdateProjectionSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-06-03T00:00:00.000Z",
      setupAction: "update_service",
      setupActionLabel: "Update OpenMeld Service",
      setupActionDescription:
        "Update OpenMeld Service through setup on this computer.",
      humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
      agentSetupCommand:
        "npm install -g openmeld@latest && openmeld setup --view agent",
      cli: {
        commandContractVersion:
          "openmeld-cli-command-contract-2026-05-local-components-v1",
        installedPackageVersion: "0.7.23",
        latestPackageVersion: "0.7.24",
        reasonCodes: ["cli.package_update_available"],
        requiredCommandContractVersion: null,
        status: "update_available",
        updatePolicy: "available",
        wakeBlocked: false,
      },
      service: {
        installedVersion: "0.7.23",
        latestVersion: "0.7.24",
        reasonCodes: ["service.version_outdated"],
        requiredVersion: "0.7.24",
        status: "update_required",
        updatePolicy: "required",
        wakeBlocked: true,
      },
      skills: {
        expectedBundleHash: "hash-next",
        expectedTargetCount: 1,
        installedBundleHash: "hash-prev",
        reasonCodes: ["skills.bundle_mismatch"],
        skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
        status: "update_available",
        targetCount: 1,
        updatePolicy: "available",
        wakeBlocked: false,
      },
    });

    expect(parsed.service.wakeBlocked).toBe(true);
  });
});
