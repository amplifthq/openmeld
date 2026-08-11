import { daemonStatusServerRequirementSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import type { CliUpdateAssessment } from "../src/command-entry-checks/cli-update-assessment";
import type { ServerRequiredVersionAssessment } from "../src/command-entry-checks/server-required-version-assessment";
import { buildServerRequirementJsonPayload } from "../src/commands/service-status-view";

const channel: CliUpdateAssessment = {
  checked: true,
  currentVersion: "0.2.20",
  floorBreached: false,
  latestVersion: "0.2.20",
  requiredFloor: null,
  updateAvailable: false,
};

const availableServer: ServerRequiredVersionAssessment = {
  available: true,
  cli: {
    commandContractVersion:
      "openmeld-cli-command-contract-2026-05-local-components-v1",
    installedPackageVersion: "0.2.20",
    latestPackageVersion: "0.2.21",
    reasonCodes: ["cli.package_update_available"],
    requiredCommandContractVersion:
      "openmeld-cli-command-contract-2026-05-local-components-v1",
    status: "update_available",
    updatePolicy: "available",
    wakeBlocked: false,
  },
  generatedAt: "2026-07-11T00:00:00.000Z",
  service: {
    installedVersion: "0.2.20",
    latestVersion: "0.2.21",
    reasonCodes: ["service.update_available"],
    requiredVersion: null,
    status: "update_available",
    updatePolicy: "available",
    wakeBlocked: false,
  },
};

describe("daemon status serverRequirement JSON contract", () => {
  it("parses the real available payload built by service status", () => {
    const payload = buildServerRequirementJsonPayload({
      channel,
      installedServiceVersion: "0.2.20",
      server: availableServer,
    });

    expect(daemonStatusServerRequirementSchema.safeParse(payload).success).toBe(
      true
    );
  });

  it("parses the real unavailable payload built by service status", () => {
    const payload = buildServerRequirementJsonPayload({
      channel,
      installedServiceVersion: "0.2.20",
      server: { available: false, detail: null, reason: "signed_out" },
    });

    expect(daemonStatusServerRequirementSchema.safeParse(payload).success).toBe(
      true
    );
  });
});
