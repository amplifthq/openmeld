import type {
  LocalCliComponentUpdateProjection,
  LocalServiceComponentUpdateProjection,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CliUpdateAssessment } from "../src/command-entry-checks/cli-update-assessment";
import type { ServerRequiredVersionAssessment } from "../src/command-entry-checks/server-required-version-assessment";
import {
  reconcileCliVersionView,
  reconcileServiceVersionView,
} from "../src/command-entry-checks/version-reconciliation";

// Real incident numbers (W-REL-DOCTOR): Core's release manifest required
// 0.2.21 for both CLI and Service while the release channel
// (`https://openmeld.ai/cli/manifest.json`) was still stuck on 0.2.20.
const INSTALLED_VERSION = "0.2.20";
const CHANNEL_LATEST_STUCK = "0.2.20";
const SERVER_REQUIRED = "0.2.21";
const COMMAND_CONTRACT_VERSION =
  "openmeld-cli-command-contract-2026-05-local-components-v1";

function buildChannelAssessment(
  overrides: Partial<CliUpdateAssessment> = {}
): CliUpdateAssessment {
  return {
    checked: true,
    currentVersion: INSTALLED_VERSION,
    floorBreached: false,
    latestVersion: CHANNEL_LATEST_STUCK,
    requiredFloor: null,
    updateAvailable: false,
    ...overrides,
  };
}

function buildCliProjection(
  overrides: Partial<LocalCliComponentUpdateProjection> = {}
): LocalCliComponentUpdateProjection {
  return {
    commandContractVersion: COMMAND_CONTRACT_VERSION,
    installedPackageVersion: INSTALLED_VERSION,
    latestPackageVersion: SERVER_REQUIRED,
    reasonCodes: ["cli.package_update_available"],
    requiredCommandContractVersion: COMMAND_CONTRACT_VERSION,
    status: "update_required",
    updatePolicy: "required",
    wakeBlocked: false,
    ...overrides,
  };
}

function buildServiceProjection(
  overrides: Partial<LocalServiceComponentUpdateProjection> = {}
): LocalServiceComponentUpdateProjection {
  return {
    installedVersion: INSTALLED_VERSION,
    latestVersion: SERVER_REQUIRED,
    reasonCodes: ["service.version_outdated"],
    requiredVersion: SERVER_REQUIRED,
    status: "update_required",
    updatePolicy: "required",
    wakeBlocked: true,
    ...overrides,
  };
}

function buildAvailableServer(
  input: {
    cli?: Partial<LocalCliComponentUpdateProjection>;
    service?: Partial<LocalServiceComponentUpdateProjection>;
  } = {}
): Extract<ServerRequiredVersionAssessment, { available: true }> {
  return {
    available: true,
    cli: buildCliProjection(input.cli),
    generatedAt: "2026-07-10T12:00:00.000Z",
    service: buildServiceProjection(input.service),
  };
}

describe("reconcileCliVersionView", () => {
  it("flags channel_behind with the exact incident wording when the server requires a newer version than the channel has", () => {
    const verdict = reconcileCliVersionView({
      channel: buildChannelAssessment(),
      server: buildAvailableServer(),
    });

    expect(verdict.kind).toBe("channel_behind");
    expect(verdict.message).toBe(
      "Server requires 0.2.21 but the release channel only has 0.2.20 — the release channel is behind. Wait for OpenMeld to publish 0.2.21; re-running setup will not help."
    );
  });

  it("reports aligned when the channel already caught up to the server-required version", () => {
    const verdict = reconcileCliVersionView({
      channel: buildChannelAssessment({
        currentVersion: SERVER_REQUIRED,
        latestVersion: SERVER_REQUIRED,
      }),
      server: buildAvailableServer({
        cli: {
          installedPackageVersion: SERVER_REQUIRED,
          latestPackageVersion: SERVER_REQUIRED,
          reasonCodes: [],
          status: "current",
        },
      }),
    });

    expect(verdict).toEqual({
      kind: "aligned",
      message:
        "Release channel and server agree: OpenMeld CLI 0.2.21 is current.",
    });
  });

  it("flags channel_ahead when the channel already publishes a version newer than the server's release manifest", () => {
    const verdict = reconcileCliVersionView({
      channel: buildChannelAssessment({
        latestVersion: "0.2.22",
      }),
      server: buildAvailableServer({
        cli: {
          latestPackageVersion: "0.2.21",
          reasonCodes: [],
          status: "current",
        },
      }),
    });

    expect(verdict.kind).toBe("channel_ahead");
    expect(verdict.message).toContain("0.2.22");
    expect(verdict.message).toContain("0.2.21");
    expect(verdict.message).toContain("may not be stamped yet");
  });

  it("describes a non-required server latest without saying the server requires it", () => {
    const verdict = reconcileCliVersionView({
      channel: buildChannelAssessment(),
      server: buildAvailableServer({
        cli: {
          latestPackageVersion: SERVER_REQUIRED,
          reasonCodes: ["cli.package_update_available"],
          status: "update_available",
          updatePolicy: "available",
        },
      }),
    });

    expect(verdict.kind).toBe("channel_behind");
    expect(verdict.message).toContain("Server expects 0.2.21");
    expect(verdict.message).toContain("server-side manifest may be ahead");
    expect(verdict.message).not.toContain("requires");
  });

  it("degrades to server_unavailable when the server visor could not be resolved (never claims 'aligned')", () => {
    const verdict = reconcileCliVersionView({
      channel: buildChannelAssessment(),
      server: { available: false, detail: null, reason: "signed_out" },
    });

    expect(verdict.kind).toBe("server_unavailable");
    expect(verdict.message).toContain("not signed in");
    expect(verdict.message).not.toContain("aligned");
  });

  it("degrades to channel_unavailable when the release-channel check did not run (e.g. dev lane)", () => {
    const verdict = reconcileCliVersionView({
      channel: buildChannelAssessment({ checked: false, latestVersion: null }),
      server: buildAvailableServer(),
    });

    expect(verdict.kind).toBe("channel_unavailable");
    expect(verdict.message).toContain("0.2.21");
  });
});

describe("reconcileServiceVersionView", () => {
  it("reports update_required with the installed and required versions", () => {
    const verdict = reconcileServiceVersionView({
      installedVersion: INSTALLED_VERSION,
      server: buildAvailableServer(),
    });

    expect(verdict.kind).toBe("update_required");
    expect(verdict.message).toContain("0.2.21");
    expect(verdict.message).toContain("installed: 0.2.20");
    expect(verdict.message).toContain("openmeld service update");
  });

  it("reports update_available when the policy is not required", () => {
    const verdict = reconcileServiceVersionView({
      installedVersion: INSTALLED_VERSION,
      server: buildAvailableServer({
        service: {
          requiredVersion: null,
          status: "update_available",
          updatePolicy: "available",
        },
      }),
    });

    expect(verdict.kind).toBe("update_available");
  });

  it("reports aligned when the service is current", () => {
    const verdict = reconcileServiceVersionView({
      installedVersion: SERVER_REQUIRED,
      server: buildAvailableServer({
        service: {
          installedVersion: SERVER_REQUIRED,
          latestVersion: SERVER_REQUIRED,
          reasonCodes: [],
          requiredVersion: null,
          status: "current",
          wakeBlocked: false,
        },
      }),
    });

    expect(verdict.kind).toBe("aligned");
  });

  it("reports unknown for the unknown server status", () => {
    const verdict = reconcileServiceVersionView({
      installedVersion: null,
      server: buildAvailableServer({
        service: { status: "unknown" },
      }),
    });

    expect(verdict.kind).toBe("unknown");
  });

  it("degrades to server_unavailable without inventing an installed-version comparison", () => {
    const verdict = reconcileServiceVersionView({
      installedVersion: INSTALLED_VERSION,
      server: { available: false, detail: "offline", reason: "offline" },
    });

    expect(verdict.kind).toBe("server_unavailable");
    expect(verdict.message).toContain("offline");
  });
});
