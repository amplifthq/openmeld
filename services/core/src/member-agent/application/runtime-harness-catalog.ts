import {
  type DetectedHarnessKind,
  detectedHarnessKindSchema,
  harnessKindFromAgentControllerRef,
} from "@openmeld/schemas";
import type { RuntimeHarnessCatalogEntry } from "../infrastructure/postgresql/runtime-harness-presence-repo";
import {
  classifyHarnessReportDetection,
  HARNESS_CATALOG_REPORT_RECENCY_MS,
  type HarnessReportDetection,
  isHarnessPresentOnRuntime,
  isLocalAgentReportEnabled,
} from "./harness-presence-policy";

export type RuntimeHarness = {
  agentControllerRef: string;
  currentDetection: HarnessReportDetection;
  deviceId: string;
  // The Local agents switch on this computer, from its latest report. A
  // turned-off Harness is never set up and reads as absent for presence.
  enabled: boolean;
  harnessKind: DetectedHarnessKind;
  lane: RuntimeHarnessCatalogEntry["lane"];
  openMeldServiceRuntimeId: string;
  // Debounced: still counts as installed through a short absence.
  present: boolean;
  // The latest report has not expired; a Binding can use it now.
  reportCurrent: boolean;
  // Core accepted a report recently, so the computer is reporting its
  // catalog now, whatever the report's auth-check expiry says.
  reporting: boolean;
  reportObservedAtMs: number;
  reportReady: boolean;
};

/**
 * Map the owner's catalog entries to detected Harnesses. Custom controllers,
 * unknown builtin ids, and hosted refs have no detected Harness and drop out.
 */
export function projectRuntimeHarnesses(input: {
  entries: readonly RuntimeHarnessCatalogEntry[];
  nowMs: number;
}): RuntimeHarness[] {
  return input.entries.flatMap((entry) => {
    const harnessKind = detectedHarnessKindSchema.safeParse(
      harnessKindFromAgentControllerRef(entry.agentControllerRef)
    );
    if (!harnessKind.success) {
      return [];
    }
    const currentDetection = classifyHarnessReportDetection({
      reasonCodes: entry.reasonCodes,
      status: entry.reportStatus,
    });
    const reportCurrent = entry.reportExpiresAtMs > input.nowMs;
    const reporting =
      entry.reportAcceptedAtMs + HARNESS_CATALOG_REPORT_RECENCY_MS >
      input.nowMs;
    return [
      {
        agentControllerRef: entry.agentControllerRef,
        currentDetection,
        deviceId: entry.deviceId,
        enabled: isLocalAgentReportEnabled({
          reasonCodes: entry.reasonCodes,
          status: entry.reportStatus,
        }),
        harnessKind: harnessKind.data,
        lane: entry.lane,
        openMeldServiceRuntimeId: entry.openMeldServiceRuntimeId,
        present: isHarnessPresentOnRuntime({
          currentDetection,
          fact: entry.fact,
          nowMs: input.nowMs,
        }),
        reportCurrent,
        reporting,
        reportObservedAtMs: entry.reportObservedAtMs,
        reportReady: reportCurrent && entry.reportStatus === "ready",
      },
    ];
  });
}

/**
 * Creation needs positive, current evidence: a computer that reports its
 * catalog now, with the Harness turned on in Local agents and detected (a
 * turned-off Harness classifies as `unknown`, never `detected`). Installation does not depend on the
 * report's expiry, which Core shortens to the Agent Controller auth-check
 * freshness (two minutes) for controllers that report an interface
 * snapshot; using it would skip Codex or Claude Code between checks. The
 * debounce only delays removal.
 */
export function isRuntimeHarnessCreatable(harness: RuntimeHarness): boolean {
  return harness.reporting && harness.currentDetection === "detected";
}

/**
 * A Harness the member can add: a computer that reports its catalog now has
 * it installed (not yet confirmed absent) but turned off in Local agents.
 * Adding it means turning it on.
 */
export function isRuntimeHarnessAddable(harness: RuntimeHarness): boolean {
  return harness.reporting && !harness.enabled && harness.present;
}
