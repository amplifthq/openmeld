import { describe, expect, it } from "vitest";
import {
  formatDaemonDowngradeBlockedRecommendation,
  formatDaemonVersionMismatchRecommendation,
  formatDaemonVersionMismatchStatus,
} from "../src/system/local-service-version-drift-text";

describe("local service version drift text", () => {
  it("uses the shared outdated-service recommendation wording", () => {
    expect(
      formatDaemonVersionMismatchRecommendation({
        installedVersion: "0.1.8",
        expectedVersion: "0.1.5",
      })
    ).toBe(
      "OpenMeld Service version differs from this CLI (installed v0.1.8, CLI v0.1.5). This is diagnostic unless service compatibility fails."
    );
  });

  it("formats status text for readiness summaries", () => {
    expect(
      formatDaemonVersionMismatchStatus({
        installedVersion: "0.1.8",
        expectedVersion: "0.1.5",
      })
    ).toBe("Version differs from this CLI (installed v0.1.8, CLI v0.1.5).");
  });

  it("explains when a newer service blocks downgrade", () => {
    expect(
      formatDaemonDowngradeBlockedRecommendation({
        installedVersion: "0.1.8",
        expectedVersion: "0.1.5",
      })
    ).toBe(
      "OpenMeld Service is already newer (installed v0.1.8, current CLI v0.1.5). OpenMeld will not downgrade it automatically. Run `openmeld upgrade`."
    );
  });
});
