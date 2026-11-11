import type { RuntimeAgentControllerReportStatus } from "@openmeld/agent-runtime";

// Debounce for "missing on this computer" (design-plans/member-agent-program.md
// §4.1): one report without the Harness never greys an Agent. The Harness
// reads as absent once three consecutive reports miss it, or once two have
// missed it and the first miss is at least five minutes old.
export const HARNESS_MISSING_REPORT_THRESHOLD = 3;
export const HARNESS_MISSING_CONFIRMATION_REPORTS = 2;
export const HARNESS_MISSING_AFTER_MS = 5 * 60_000;

// A computer counts as reporting its catalog while Core accepted one of its
// reports within this window. It matches the OpenMeld Service's minimum
// report lifetime (ten minutes); the Service reports every minute.
export const HARNESS_CATALOG_REPORT_RECENCY_MS = 10 * 60_000;

// What one accepted catalog report says about the Harness on its computer.
// `unknown` reports neither confirm nor deny the installation and leave the
// debounce unchanged: the controller is turned off in OpenMeld, or it is
// installed but OpenMeld cannot run it yet (never a reason to create).
export type HarnessReportDetection = "detected" | "undetected" | "unknown";

const NOT_DETECTED_REASON_CODE = "local_agent_preparation.not_detected";
const NOT_ENABLED_REASON_CODE = "local_agent_preparation.not_enabled";

/**
 * The Local agents switch from one report: a turned-off controller reports
 * `disabled`, or another status with the `not_enabled` reason (the same
 * reading as the runtime registry's capability `enabled`).
 */
export function isLocalAgentReportEnabled(report: {
  reasonCodes: readonly string[];
  status: RuntimeAgentControllerReportStatus;
}): boolean {
  return (
    report.status !== "disabled" &&
    !report.reasonCodes.includes(NOT_ENABLED_REASON_CODE)
  );
}
const UNKNOWN_INSTALLATION_REASON_CODES = new Set([
  NOT_ENABLED_REASON_CODE,
  "local_agent_preparation.not_supported_yet",
]);

export function classifyHarnessReportDetection(report: {
  reasonCodes: readonly string[];
  status: RuntimeAgentControllerReportStatus;
}): HarnessReportDetection {
  if (report.reasonCodes.includes(NOT_DETECTED_REASON_CODE)) {
    return "undetected";
  }
  if (
    report.status === "disabled" ||
    report.reasonCodes.some((code) =>
      UNKNOWN_INSTALLATION_REASON_CODES.has(code)
    )
  ) {
    return "unknown";
  }
  return "detected";
}

export type RuntimeHarnessPresenceFact = {
  firstUndetectedAtMs: number | null;
  lastDetectedAtMs: number | null;
  undetectedReportCount: number;
};

/**
 * Whether one computer still has the Harness. Only confirmed, sustained
 * absence removes it: a report that detects it now always counts, and
 * without enough misses (including no stored fact yet, as right after the
 * release flag turns on) the computer keeps it. A computer that never had
 * the Harness reaches the miss threshold after a few reports.
 */
export function isHarnessPresentOnRuntime(input: {
  currentDetection: HarnessReportDetection | null;
  fact: RuntimeHarnessPresenceFact | null;
  nowMs: number;
}): boolean {
  if (input.currentDetection === "detected") {
    return true;
  }
  const undetectedReportCount =
    input.fact?.undetectedReportCount ??
    (input.currentDetection === "undetected" ? 1 : 0);
  if (undetectedReportCount >= HARNESS_MISSING_REPORT_THRESHOLD) {
    return false;
  }
  const firstUndetectedAtMs = input.fact?.firstUndetectedAtMs ?? null;
  return !(
    undetectedReportCount >= HARNESS_MISSING_CONFIRMATION_REPORTS &&
    firstUndetectedAtMs !== null &&
    input.nowMs - firstUndetectedAtMs >= HARNESS_MISSING_AFTER_MS
  );
}
