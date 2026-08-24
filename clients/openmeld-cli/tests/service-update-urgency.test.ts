import { describe, expect, it } from "vitest";
import { resolveServiceUpdateUrgencyFromAssessment } from "../src/command-entry-checks/service-update-urgency";

describe("service update urgency", () => {
  it("makes a server-required safety version stop accepting new Wake work", () => {
    expect(
      resolveServiceUpdateUrgencyFromAssessment({
        available: true,
        generatedAt: "2026-08-25T00:00:00.000Z",
        cli: {
          commandContractVersion: null,
          installedPackageVersion: "0.3.97",
          latestPackageVersion: "0.3.98",
          reasonCodes: [],
          requiredCommandContractVersion: null,
          status: "update_available",
          updatePolicy: "available",
          wakeBlocked: false,
        },
        service: {
          installedVersion: "0.3.97",
          latestVersion: "0.3.98",
          reasonCodes: ["service.version_outdated"],
          requiredVersion: "0.3.98",
          status: "update_required",
          updatePolicy: "required",
          wakeBlocked: true,
        },
      })
    ).toBe("required");
  });

  it("keeps ordinary and unavailable update signals non-blocking", () => {
    expect(
      resolveServiceUpdateUrgencyFromAssessment({
        available: false,
        reason: "offline",
        detail: "request failed",
      })
    ).toBe("available");
  });
});
