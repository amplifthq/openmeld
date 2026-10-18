import {
  type DetectedHarnessKind,
  detectedHarnessKindSchema,
  harnessKindFromAgentControllerRef,
} from "@openmeld/schemas";
import type { RuntimeHarnessCatalogEntry } from "../infrastructure/postgresql/runtime-harness-presence-repo";
import {
  classifyHarnessReportDetection,
  type HarnessReportDetection,
  isHarnessPresentOnRuntime,
} from "./harness-presence-policy";

export type RuntimeHarness = {
  agentControllerRef: string;
  currentDetection: HarnessReportDetection;
  deviceId: string;
  harnessKind: DetectedHarnessKind;
  lane: RuntimeHarnessCatalogEntry["lane"];
  openMeldServiceRuntimeId: string;
  // Debounced: still counts as installed through a short absence.
  present: boolean;
  // The latest report is current, so the computer is reporting now.
  reportCurrent: boolean;
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
    return [
      {
        agentControllerRef: entry.agentControllerRef,
        currentDetection,
        deviceId: entry.deviceId,
        harnessKind: harnessKind.data,
        lane: entry.lane,
        openMeldServiceRuntimeId: entry.openMeldServiceRuntimeId,
        present: isHarnessPresentOnRuntime({
          currentDetection,
          fact: entry.fact,
          nowMs: input.nowMs,
        }),
        reportCurrent,
        reportObservedAtMs: entry.reportObservedAtMs,
        reportReady: reportCurrent && entry.reportStatus === "ready",
      },
    ];
  });
}

/**
 * Creation needs positive, current evidence: a reporting computer that
 * detects the Harness now. The debounce only delays removal.
 */
export function isRuntimeHarnessCreatable(harness: RuntimeHarness): boolean {
  return harness.reportCurrent && harness.currentDetection === "detected";
}
