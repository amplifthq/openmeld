import { describe, expect, it } from "vitest";
import {
  findOpenMeldToolsUpdateFailureCode,
  formatLocalComponentsSummaryLabel,
  formatLocalSetupActionDescription,
  formatLocalSetupActionLabel,
  formatOpenMeldToolsUpdateFailureMessage,
  localComponentsReleaseManifestSchema,
  localComponentsStatusSchema,
  localComponentUpdateProjectionSchema,
  openMeldToolsControlRequestSchema,
  openMeldToolsControlResultSchema,
  openMeldToolsUpdateAttemptSchema,
  openMeldToolsUpdateOperationSchema,
  openMeldToolsUpdateProcessFailureFrameSchema,
} from "../src/schemas";

const baseUpdateOperation = {
  operationId: "update-1",
  phase: "needs_help",
  requestSource: "web",
  requestedAt: "2026-05-30T00:00:00.000Z",
  targetVersion: "0.6.9",
  updatedAt: "2026-05-30T00:01:00.000Z",
  urgency: "available",
} as const;

describe("local components schema", () => {
  it("finds only the first fully-prefixed update failure reason code", () => {
    expect(
      findOpenMeldToolsUpdateFailureCode([
        "raw download detail",
        "download_stalled",
        "cli.update.download_stalled.detail",
        "cli.update.download_stalled",
        "cli.update.failed",
      ])
    ).toBe("cli.update.download_stalled");
    expect(
      findOpenMeldToolsUpdateFailureCode([
        "download_stalled",
        "cli.update.unknown_failure",
        "OpenMeld update process exited with status 1",
      ])
    ).toBeNull();
  });

  it("keeps update operations on their existing strict wire shape", () => {
    expect(
      openMeldToolsUpdateOperationSchema.parse(baseUpdateOperation)
    ).toEqual(baseUpdateOperation);
    expect(
      openMeldToolsUpdateOperationSchema.safeParse({
        ...baseUpdateOperation,
        failureCode: "cli.update.download_failed",
      }).success
    ).toBe(false);
  });

  it("keeps the persisted attempt v1 rollback-compatible", () => {
    expect(
      openMeldToolsUpdateAttemptSchema.safeParse({
        attempts: 1,
        errorMessage:
          "openmeld.tools.update.failure=cli.update.download_failed\nlocal diagnostic",
        operation: baseUpdateOperation,
        v: 1,
      }).success
    ).toBe(true);
  });

  it("owns the bounded child-process failure frame and safe product copy", () => {
    const frame = {
      detail: "local diagnostic at /private/path",
      failureCode: "cli.update.download_stalled",
      schema: "openmeld-tools-update-process-failure-v1",
      v: 1,
    } as const;
    expect(openMeldToolsUpdateProcessFailureFrameSchema.parse(frame)).toEqual(
      frame
    );
    expect(
      openMeldToolsUpdateProcessFailureFrameSchema.safeParse({
        ...frame,
        detail: "x".repeat(2049),
      }).success
    ).toBe(false);
    expect(
      openMeldToolsUpdateProcessFailureFrameSchema.safeParse({
        ...frame,
        message: "untrusted public copy",
      }).success
    ).toBe(false);
    expect(formatOpenMeldToolsUpdateFailureMessage(frame.failureCode)).toBe(
      "The update download stopped making progress. Check this computer's connection and try again."
    );
    expect(
      formatOpenMeldToolsUpdateFailureMessage(
        "cli.update.service_alignment_failed"
      )
    ).toBe("OpenMeld Service could not finish updating.");
  });

  it("keeps Web and Center Agent maintenance requests on one contract", () => {
    expect(
      openMeldToolsControlRequestSchema.parse({
        operation: "request_update",
        requestSource: "web",
      })
    ).toEqual({ operation: "request_update", requestSource: "web" });
    expect(
      openMeldToolsControlRequestSchema.parse({
        automaticUpdatesEnabled: false,
        operation: "set_automatic_updates",
        requestSource: "center_agent",
      })
    ).toEqual({
      automaticUpdatesEnabled: false,
      operation: "set_automatic_updates",
      requestSource: "center_agent",
    });
    expect(
      openMeldToolsControlResultSchema.safeParse({
        operation: "set_automatic_updates",
        result: { automaticUpdatesEnabled: false, status: "updated" },
      }).success
    ).toBe(true);
  });

  it("accepts the normalized setup action projection", () => {
    const parsed = localComponentsStatusSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-05-30T00:00:00.000Z",
      entrypoint: "setup",
      summaryLabel: "Update OpenMeld on Computer",
      summaryDescription: "Update OpenMeld on this computer.",
      setupAction: "update_service",
      setupActionLabel: "Update OpenMeld on Computer",
      setupActionDescription: "Update OpenMeld on this computer.",
      maintenance: {
        automaticUpdatesEnabled: true,
        status: "ready",
      },
      updateOperation: {
        operationId: "update-1",
        phase: "waiting_for_work",
        requestSource: "cli",
        requestedAt: "2026-05-30T00:00:00.000Z",
        targetVersion: "0.6.9",
        updatedAt: "2026-05-30T00:01:00.000Z",
        urgency: "available",
      },
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
    expect(parsed.maintenance?.automaticUpdatesEnabled).toBe(true);
    expect(parsed.updateOperation?.phase).toBe("waiting_for_work");
  });

  it("owns the user-facing labels for setup actions", () => {
    expect(formatLocalSetupActionLabel("connect_service")).toBe(
      "Connect Computer"
    );
    expect(formatLocalSetupActionLabel("reconnect_service")).toBe(
      "Reconnect Computer"
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
    ).toBe("Update OpenMeld on Computer");
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
      setupActionLabel: "Update OpenMeld on Computer",
      setupActionDescription: "Update OpenMeld on this computer.",
      humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
      agentSetupCommand:
        "npm install -g openmeld@latest && openmeld setup --view agent",
      maintenance: {
        automaticUpdatesEnabled: false,
        status: "ready",
      },
      updateOperation: {
        operationId: "update-1",
        phase: "updating",
        requestSource: "web",
        requestedAt: "2026-06-03T00:00:00.000Z",
        targetVersion: "0.7.24",
        updatedAt: "2026-06-03T00:01:00.000Z",
        urgency: "required",
      },
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
    expect(parsed.maintenance?.automaticUpdatesEnabled).toBe(false);
    expect(parsed.updateOperation?.requestSource).toBe("web");
  });
});
