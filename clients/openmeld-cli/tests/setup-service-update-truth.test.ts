import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSetupServiceUpdateComplete,
  resolveSetupServiceUpdateTruth,
} from "../src/commands/setup-service-update-truth";
import { OPENMELD_VERSION } from "../src/runtime/version";

const { expectedServiceVersion, inventory, update } = vi.hoisted(() => ({
  expectedServiceVersion: vi.fn(async (selectedVersion: string) =>
    Promise.resolve(selectedVersion)
  ),
  inventory: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../src/local-service/lifecycle/current-daemon-version", () => ({
  resolveCurrentDaemonExpectedVersion: expectedServiceVersion,
}));
vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: inventory,
}));
vi.mock("../src/local-service/maintenance/openmeld-tools-update-join", () => ({
  waitForOpenMeldToolsUpdateCompletion: update,
}));

function operation(
  phase: OpenMeldToolsUpdateOperation["phase"]
): OpenMeldToolsUpdateOperation {
  return {
    operationId: "update-1",
    phase,
    requestedAt: "2026-09-05T00:00:00.000Z",
    requestSource: "cli",
    targetVersion: "0.8.0",
    updatedAt: "2026-09-05T00:00:01.000Z",
    urgency: "required",
  };
}

describe("setup service update truth", () => {
  beforeEach(() => {
    expectedServiceVersion.mockClear();
    inventory.mockReset();
    update.mockReset();
  });

  it("uses the current Service contract, not a retained legacy install record", async () => {
    update.mockResolvedValue({
      ...operation("needs_help"),
      targetVersion: OPENMELD_VERSION,
    });
    inventory.mockResolvedValue({
      serviceContract: { daemonVersion: OPENMELD_VERSION },
      installStatus: { state: { daemonVersion: "0.0.1" } },
      runtimeStatus: { status: "running" },
      anomalies: [],
    });
    await expect(assertSetupServiceUpdateComplete()).resolves.toBeUndefined();
  });

  it("verifies a retained Service against the operation target", async () => {
    const retainedServiceVersion = "0.7.99";
    update.mockResolvedValue({
      ...operation("updated"),
      targetCliVersion: OPENMELD_VERSION,
      targetServiceVersion: retainedServiceVersion,
    });
    inventory.mockImplementation(
      async ({ expectedVersion }: { expectedVersion: string }) => ({
        serviceContract: { daemonVersion: retainedServiceVersion },
        installStatus: { state: { daemonVersion: retainedServiceVersion } },
        runtimeStatus: { status: "running" },
        anomalies:
          expectedVersion === retainedServiceVersion
            ? []
            : ["bundle_version_mismatch"],
      })
    );

    await expect(assertSetupServiceUpdateComplete()).resolves.toBeUndefined();
    expect(expectedServiceVersion).toHaveBeenCalledWith(retainedServiceVersion);
    expect(inventory).toHaveBeenCalledWith({
      expectedVersion: retainedServiceVersion,
      intent: "status_cleanup",
    });
  });

  it("rejects a damaged retained Service", async () => {
    const retainedServiceVersion = "0.7.99";
    update.mockResolvedValue({
      ...operation("updated"),
      targetCliVersion: OPENMELD_VERSION,
      targetServiceVersion: retainedServiceVersion,
    });
    inventory.mockResolvedValue({
      serviceContract: { daemonVersion: retainedServiceVersion },
      installStatus: { state: { daemonVersion: retainedServiceVersion } },
      runtimeStatus: { status: "running" },
      anomalies: ["bundle_version_mismatch"],
    });

    await expect(assertSetupServiceUpdateComplete()).rejects.toThrow(
      "OpenMeld Service update could not be verified"
    );
  });

  it("does not hide an in-flight older update behind a newer CLI", () => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.9.0",
        installedServiceVersion: "0.9.0",
        currentServiceVerified: true,
        operation: operation("waiting_for_work"),
      })
    ).toMatchObject({ status: "updating" });
  });
  it("keeps the historical failure but accepts a verified newer replacement", () => {
    const historicalOperation = {
      ...operation("needs_help"),
      targetVersion: "0.7.99",
    };
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: historicalOperation,
        currentServiceVerified: true,
      })
    ).toEqual({ status: "ready" });
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.7.98",
        operation: historicalOperation,
        currentServiceVerified: true,
      })
    ).toMatchObject({ status: "failed" });
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: historicalOperation,
        currentServiceVerified: false,
      })
    ).toMatchObject({ status: "failed" });
  });

  it("accepts a verified newer installation after an older completed update", () => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: {
          ...operation("updated"),
          targetVersion: "0.7.99",
        },
        currentServiceVerified: true,
      })
    ).toEqual({ status: "ready" });
  });
  it.each([
    "waiting_for_work",
    "updating",
  ] as const)("does not treat %s as aligned even when exact target artifacts are visible", (phase) => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: operation(phase),
      })
    ).toMatchObject({ status: "updating" });
  });

  it("requires updated and exact target CLI plus Service versions", () => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: operation("updated"),
        currentServiceVerified: true,
      })
    ).toEqual({ status: "ready" });
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.7.99",
        installedServiceVersion: "0.8.0",
        operation: operation("updated"),
      })
    ).toMatchObject({ status: "verifying" });
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.7.99",
        operation: operation("updated"),
      })
    ).toMatchObject({ status: "verifying" });
  });

  it("accepts separately observed CLI and Service targets", () => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.9.0",
        installedServiceVersion: "0.8.0",
        operation: {
          ...operation("updated"),
          targetCliVersion: "0.9.0",
          targetServiceVersion: "0.8.0",
        },
        currentServiceVerified: true,
      })
    ).toEqual({ status: "ready" });
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.9.0",
        installedServiceVersion: "0.7.99",
        operation: {
          ...operation("updated"),
          targetCliVersion: "0.9.0",
          targetServiceVersion: "0.8.0",
        },
        currentServiceVerified: true,
      })
    ).toMatchObject({ status: "verifying" });
  });

  it("does not finish setup just because updated artifacts are installed", () => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: operation("updated"),
        currentServiceVerified: false,
      })
    ).toMatchObject({ status: "verifying" });
  });

  it.each([
    "restored",
    "needs_help",
  ] as const)("reports %s as failure even when exact target artifacts are visible", (phase) => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: operation(phase),
      })
    ).toEqual({
      message: "OpenMeld Service update failed. Run `openmeld service update`.",
      status: "failed",
    });
  });
});
