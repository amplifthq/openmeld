import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveSetupServiceUpdateTruth } from "../src/commands/setup-service-update-truth";

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
  it("keeps the historical failure but accepts a verified current replacement", () => {
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.8.0",
        operation: operation("needs_help"),
        currentServiceVerified: true,
      })
    ).toEqual({ status: "ready" });
    expect(
      resolveSetupServiceUpdateTruth({
        currentCliVersion: "0.8.0",
        installedServiceVersion: "0.7.99",
        operation: operation("needs_help"),
        currentServiceVerified: true,
      })
    ).toMatchObject({ status: "failed" });
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
