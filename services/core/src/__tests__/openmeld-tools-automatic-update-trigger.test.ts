import type {
  LocalComponentsReleaseManifest,
  LocalComponentsStatus,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveReleaseTriggeredOpenMeldToolsUpdate } from "../local-components/automatic-update-trigger";

describe("release-triggered OpenMeld Tools updates", () => {
  it("requests one automatic update when a capable Service reports an actionable release", () => {
    expect(
      resolveReleaseTriggeredOpenMeldToolsUpdate({
        capabilities: {
          localComponents: createLocalComponentsStatus(),
          openMeldToolsControl: { requestUpdate: true },
        },
        generatedAt: "2026-09-01T13:00:00.000Z",
        lane: "prod",
        releaseManifest: createReleaseManifest(),
        serviceVersion: "0.3.139",
      })
    ).toEqual({
      request: {
        operation: "request_update",
        requestSource: "automatic",
      },
      targetVersion: "0.3.140",
    });
  });

  it("does not send the new automatic request shape to an older Service", () => {
    expect(
      resolveReleaseTriggeredOpenMeldToolsUpdate({
        capabilities: {
          localComponents: createLocalComponentsStatus(),
          openMeldToolsControl: { requestUpdate: true },
        },
        generatedAt: "2026-09-01T13:00:00.000Z",
        lane: "prod",
        releaseManifest: createReleaseManifest(),
        serviceVersion: "0.3.138",
      })
    ).toBeNull();
  });

  it("keeps the release signal quiet when automatic updates are off", () => {
    expect(
      resolveReleaseTriggeredOpenMeldToolsUpdate({
        capabilities: {
          localComponents: createLocalComponentsStatus({
            automaticUpdatesEnabled: false,
          }),
          openMeldToolsControl: { requestUpdate: true },
        },
        generatedAt: "2026-09-01T13:00:00.000Z",
        lane: "prod",
        releaseManifest: createReleaseManifest(),
        serviceVersion: "0.3.139",
      })
    ).toBeNull();
  });

  it("joins the operation already reported by the Service", () => {
    expect(
      resolveReleaseTriggeredOpenMeldToolsUpdate({
        capabilities: {
          localComponents: createLocalComponentsStatus({
            includeUpdateOperation: true,
          }),
          openMeldToolsControl: { requestUpdate: true },
        },
        generatedAt: "2026-09-01T13:00:00.000Z",
        lane: "prod",
        releaseManifest: createReleaseManifest(),
        serviceVersion: "0.3.139",
      })
    ).toBeNull();
  });

  it.each([
    "dev-local",
    "canary",
  ] as const)("does not send the published release signal to the %s lane", (lane) => {
    expect(
      resolveReleaseTriggeredOpenMeldToolsUpdate({
        capabilities: {
          localComponents: createLocalComponentsStatus(),
          openMeldToolsControl: { requestUpdate: true },
        },
        generatedAt: "2026-09-01T13:00:00.000Z",
        lane,
        releaseManifest: createReleaseManifest(),
        serviceVersion: "0.3.139",
      })
    ).toBeNull();
  });
});

function createReleaseManifest(): LocalComponentsReleaseManifest {
  return {
    schemaVersion: 1,
    updatedAt: "2026-09-01T12:55:00.000Z",
    components: {
      cli: {
        commandContractVersion: "cli-contract-v1",
        packageVersion: "0.3.140",
        reason: "Fixture.",
        updatePolicy: "available",
      },
      service: {
        bundleHash: "a".repeat(64),
        bundleVersion: "0.3.140",
        reason: "Fixture.",
        runtimeContractEpoch: "runtime-contract-v1",
        serviceContractVersion: "service-contract-v1",
        updatePolicy: "required",
      },
      skills: {
        bundleHash: "b".repeat(64),
        reason: "Fixture.",
        skillContractVersion: "skills-contract-v1",
        skillIds: ["openmeld-cli"],
        updatePolicy: "available",
      },
    },
  };
}

function createLocalComponentsStatus(
  input: {
    automaticUpdatesEnabled?: boolean;
    includeUpdateOperation?: boolean;
  } = {}
): LocalComponentsStatus {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-01T12:54:00.000Z",
    entrypoint: "setup",
    summaryLabel: "Everything is up to date",
    summaryDescription: "OpenMeld Tools are ready.",
    setupAction: "none",
    setupActionLabel: "Everything is up to date",
    setupActionDescription: "OpenMeld Tools are ready.",
    maintenance: {
      automaticUpdatesEnabled: input.automaticUpdatesEnabled ?? true,
      status: "ready",
    },
    ...(input.includeUpdateOperation
      ? {
          updateOperation: {
            operationId: "update-operation-1",
            phase: "updating" as const,
            requestSource: "automatic" as const,
            requestedAt: "2026-09-01T12:56:00.000Z",
            targetVersion: "0.3.140",
            updatedAt: "2026-09-01T12:56:01.000Z",
            urgency: "required" as const,
          },
        }
      : {}),
    cli: {
      commandContractVersion: "cli-contract-v1",
      latestPackageVersion: "0.3.139",
      packageVersion: "0.3.139",
      reasonCodes: [],
      requiredCommandContractVersion: null,
      status: "ok",
    },
    service: {
      expectedBundleHash: "c".repeat(64),
      expectedBundleVersion: "0.3.139",
      installedBundleHash: "c".repeat(64),
      installedBundleVersion: "0.3.139",
      reasonCodes: [],
      runtimeContractEpoch: "runtime-contract-v1",
      serviceContractVersion: "service-contract-v1",
      status: "ok",
    },
    skills: {
      expectedBundleHash: "d".repeat(64),
      installedBundleHash: "d".repeat(64),
      reasonCodes: [],
      skillContractVersion: "skills-contract-v1",
      status: "ok",
      targetCount: 1,
    },
  };
}
