import { describe, expect, it } from "vitest";
import {
  buildDaemonServiceRefreshBlockedMessage,
  buildDaemonServiceRefreshHandoffMessage,
  buildDaemonServiceRefreshNextStep,
  buildDaemonServiceRefreshPromptMessage,
  buildDaemonServiceRefreshReadinessDetail,
  buildDaemonServiceRepairGuidance,
  buildDaemonServiceStatusReadOnlyDetail,
  buildDaemonServiceTaskRetryNextStep,
  formatDaemonServiceRefreshSummary,
} from "../src/local-service/lifecycle/daemon-service-repair-guidance";

const INTERNAL_SERVICE_REFRESH_TERMS = [
  "old CLI path",
  "older CLI build output",
  "bundle_content_drift",
  "runtime_bundle_mismatch",
  "service_manager_path_drift",
  "cleanupPlan",
  "service manager path drift",
  "bundle content drift",
  "fingerprint",
  "OpenMeld lifecycle",
  "lifecycle action",
] as const;

function collectHumanCopyViolations(copy: string): string[] {
  return INTERNAL_SERVICE_REFRESH_TERMS.filter((term) => copy.includes(term));
}

describe("local service repair guidance", () => {
  it("keeps human-facing repair copy simple and free of internal drift terms", () => {
    const guidance = buildDaemonServiceRepairGuidance();

    expect(guidance.nextSteps).toEqual(["openmeld setup"]);
    expect(guidance.summary).toBe(
      "OpenMeld Service needs repair. Run `openmeld setup`. If Wake or readiness still looks wrong after setup, run `openmeld service status`."
    );
    expect(buildDaemonServiceRefreshPromptMessage()).toBe(
      "Reconnect OpenMeld Service before this computer can receive local Wake work. OpenMeld can reconnect it for you now."
    );
    expect(buildDaemonServiceRefreshHandoffMessage()).toBe(
      "OpenMeld Service needs repair. Run `openmeld setup` in human view, then return to OpenMeld Web."
    );
    const copies = [
      guidance.summary,
      formatDaemonServiceRefreshSummary(),
      buildDaemonServiceRefreshReadinessDetail(),
      buildDaemonServiceRefreshPromptMessage(),
      buildDaemonServiceRefreshHandoffMessage(),
      buildDaemonServiceRefreshNextStep(),
    ];
    for (const copy of copies) {
      expect(copy).toContain("OpenMeld Service");
      expect(collectHumanCopyViolations(copy)).toEqual([]);
    }
  });

  it("owns standard service next-step copy for status and running tasks", () => {
    expect(buildDaemonServiceStatusReadOnlyDetail()).toBe(
      "Status is read-only. It does not change OpenMeld Service."
    );
    expect(buildDaemonServiceTaskRetryNextStep()).toBe(
      "Try again after the current OpenMeld Service task finishes."
    );
  });

  it("keeps blocked repair guidance clear without exposing lifecycle internals", () => {
    const copies = [
      buildDaemonServiceRefreshBlockedMessage({
        reason: "foreground_service_active",
      }),
      buildDaemonServiceRefreshBlockedMessage({
        reason: "lifecycle_action_in_progress",
      }),
    ];
    expect(copies[0]).toBe(
      "Reconnect OpenMeld Service before this computer can receive local Wake work. Stop the foreground service first, then run `openmeld setup`."
    );
    expect(copies[1]).toBe(
      "Reconnect OpenMeld Service before this computer can receive local Wake work. Try again after the current OpenMeld Service task finishes."
    );
    for (const copy of copies) {
      expect(copy).toContain("OpenMeld Service");
      expect(collectHumanCopyViolations(copy)).toEqual([]);
    }
  });
});
