import { describe, expect, it } from "vitest";
import { resolveDaemonServiceStartupRecoveryDecision } from "../src/local-service/lifecycle/daemon-service-startup-recovery";

describe("daemon service startup recovery decision", () => {
  it("attempts recovery for stale runtime and bundle mismatch startup failures", () => {
    expect(
      resolveDaemonServiceStartupRecoveryDecision({
        anomalyCodes: [
          "runtime_stale",
          "manager_running_without_runtime",
          "runtime_bundle_mismatch",
        ],
      })
    ).toEqual({
      shouldAttempt: true,
      reasonCodes: [
        "runtime_stale",
        "manager_running_without_runtime",
        "runtime_bundle_mismatch",
      ],
    });
  });

  it("does not recover ownership or foreground/background conflicts", () => {
    expect(
      resolveDaemonServiceStartupRecoveryDecision({
        anomalyCodes: [
          "multiple_active_owners",
          "foreground_background_conflict",
          "duplicate_owned_processes",
        ],
      })
    ).toEqual({
      shouldAttempt: false,
      reason: "no_recoverable_anomalies",
      reasonCodes: [],
    });
  });

  it("never attempts a second startup recovery pass", () => {
    expect(
      resolveDaemonServiceStartupRecoveryDecision({
        alreadyAttempted: true,
        anomalyCodes: ["runtime_stale"],
      })
    ).toEqual({
      shouldAttempt: false,
      reason: "already_attempted",
      reasonCodes: ["runtime_stale"],
    });
  });
});
