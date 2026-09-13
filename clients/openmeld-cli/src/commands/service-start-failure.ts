import type { LocalMachineIssue } from "@openmeld/schemas";
import { toErrorMessage } from "@openmeld/utils";
import {
  type DaemonServiceRuntimeStatus,
  daemonLifecycleJournalPath,
} from "../config/daemon-state";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
  inspectDaemonServiceInventory,
} from "../local-service/lifecycle/daemon-service-inventory";
import {
  type DaemonServiceJobDiagnostics,
  type DaemonServiceManager,
  type DaemonServiceManagerRuntimeStatus,
  formatDaemonServiceJobDiagnosticsEvidence,
  getDaemonServiceLaunchdLabel,
  getDaemonSystemServiceLogPath,
  isDaemonServiceJobSpawnPending,
  readDaemonServiceJobCrashExitCode,
} from "../local-service/lifecycle/daemon-service-manager";
import {
  isDaemonInventoryRunningAndStartReady as isDaemonInventoryRunningAndStartReadyWithBlockers,
  isSystemServiceStartupTimeoutError as isStartupTimeoutError,
  waitForSystemServiceStartup as waitForSystemServiceStartupWithPredicate,
} from "../local-service/lifecycle/daemon-service-startup-wait";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliTextBlock,
} from "../runtime/cli-entry-command";
import {
  assessLocalMachineFailure,
  createServiceSpawnPendingIssue,
} from "../system/local-machine-recovery";
import { buildDaemonStartNeedsAttentionCard } from "../system/local-service-start-decision";
import { sanitizeSystemServiceErrorMessage } from "./service-error-text";

export const DAEMON_STARTUP_BLOCKING_ANOMALIES =
  new Set<DaemonServiceAnomalyCode>([
    "duplicate_owned_processes",
    "multiple_active_owners",
    "runtime_bundle_mismatch",
    "runtime_contract_mismatch",
  ]);

export type SystemServiceStartupFailureReport = {
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string }>;
};

export type SystemServiceStartupRecoveryReport = {
  attempted: boolean;
  reasonCodes: DaemonServiceAnomalyCode[];
  preflightStatus?: string;
  retryStarted?: boolean;
  failureMessage?: string;
};

export type SystemServiceStartupRecoveryOutcome =
  | {
      recovered: true;
      autoRepairAttempted: boolean;
      recovery: SystemServiceStartupRecoveryReport;
      startupStatus: Awaited<ReturnType<typeof waitForSystemServiceStartup>>;
    }
  | {
      recovered: false;
      error: unknown;
      recovery: SystemServiceStartupRecoveryReport | null;
    };

// Presentation-only verdict distilled from a failed service startup. It carries
// exactly what the failure card needs (controller, launchd job diagnostics, the
// sanitized error message, and any explicit detail) so the card can be rebuilt
// far from the original error object — e.g. after a silent reinstall start has
// already discarded the SystemServiceStartupTimeoutError. Diagnostic evidence
// only: it must never gate readiness, availability, or lifecycle decisions.
export type SystemServiceStartupFailureVerdict = {
  controller: DaemonServiceManager["controller"];
  jobDiagnostics: DaemonServiceJobDiagnostics | null;
  localMachineIssue: LocalMachineIssue | null;
  message: string;
  detail: string | null;
};

export type DaemonBackgroundStartFailure = {
  outcome: "failed_with_card";
  errorMessage: string;
  localMachineIssue?: LocalMachineIssue;
};

// Keep evidence in the returned value even when a caller suppresses output.
// Account recovery persists this message; printing a card is not propagation.
export function buildDaemonBackgroundStartFailure(
  verdict: SystemServiceStartupFailureVerdict | null
): DaemonBackgroundStartFailure {
  const report = verdict
    ? buildSystemServiceStartupFailureReportFromVerdict(verdict)
    : null;
  const evidence = verdict?.jobDiagnostics
    ? formatDaemonServiceJobDiagnosticsEvidence(verdict.jobDiagnostics)
    : null;
  return {
    outcome: "failed_with_card",
    errorMessage: [
      report?.summary ?? "OpenMeld could not finish starting OpenMeld Service.",
      verdict?.message,
      evidence && !verdict?.message.includes(evidence) ? evidence : null,
    ]
      .filter(Boolean)
      .join("\n"),
    ...(verdict?.localMachineIssue
      ? { localMachineIssue: verdict.localMachineIssue }
      : {}),
  };
}

function resolveStartupLocalMachineIssue(input: {
  assessedIssue: LocalMachineIssue;
  jobDiagnostics: DaemonServiceJobDiagnostics | null;
}): LocalMachineIssue | null {
  if (
    input.jobDiagnostics &&
    isDaemonServiceJobSpawnPending(input.jobDiagnostics)
  ) {
    return createServiceSpawnPendingIssue({
      detail: formatDaemonServiceJobDiagnosticsEvidence(input.jobDiagnostics),
    });
  }
  if (input.assessedIssue.code === "local_machine.failure.unknown") {
    return null;
  }
  return input.assessedIssue;
}

export function resolveSystemServiceStartupFailureVerdict(input: {
  controller: DaemonServiceManager["controller"];
  error: unknown;
  detail?: string | null;
}): SystemServiceStartupFailureVerdict {
  const jobDiagnostics = isStartupTimeoutError(input.error)
    ? (input.error.jobDiagnostics ?? null)
    : null;
  const assessedIssue = assessLocalMachineFailure({
    operation: "start_background_service",
    error: input.error,
  });
  const localMachineIssue = resolveStartupLocalMachineIssue({
    assessedIssue,
    jobDiagnostics,
  });
  return {
    controller: input.controller,
    jobDiagnostics,
    localMachineIssue,
    message: sanitizeSystemServiceErrorMessage(toErrorMessage(input.error)),
    detail: input.detail ?? null,
  };
}

export function buildSystemServiceStartupFailureReport(input: {
  controller: DaemonServiceManager["controller"];
  error: unknown;
  autoRepairAttempted?: boolean;
  detail?: string | null;
}): SystemServiceStartupFailureReport {
  return buildSystemServiceStartupFailureReportFromVerdict(
    resolveSystemServiceStartupFailureVerdict({
      controller: input.controller,
      error: input.error,
      detail: input.detail,
    }),
    { autoRepairAttempted: input.autoRepairAttempted }
  );
}

export function buildSystemServiceStartupFailureReportFromVerdict(
  verdict: SystemServiceStartupFailureVerdict,
  options?: { autoRepairAttempted?: boolean }
): SystemServiceStartupFailureReport {
  const autoRepairAttempted = options?.autoRepairAttempted;
  const { message, jobDiagnostics, localMachineIssue } = verdict;
  if (localMachineIssue) {
    const card = buildDaemonStartNeedsAttentionCard({
      summary: localMachineIssue.summary,
      nextStep: localMachineIssue.primaryAction ?? "Open diagnostics.",
      autoRepairAttempted,
    });
    return {
      title: card.title,
      summary: localMachineIssue.summary,
      rows: card.rows,
    };
  }
  const crashExitCode = jobDiagnostics
    ? readDaemonServiceJobCrashExitCode(jobDiagnostics)
    : null;
  if (jobDiagnostics && crashExitCode !== null) {
    const summary = "OpenMeld Service keeps stopping after it starts.";
    const card = buildDaemonStartNeedsAttentionCard({
      summary,
      nextStep: formatInlineOpenMeldCliCommands(
        "Run `openmeld service repair` once. OpenMeld saved the startup evidence for diagnostics."
      ),
      autoRepairAttempted,
    });
    return {
      title: card.title,
      summary,
      rows: card.rows,
    };
  }
  if (isLaunchdBootstrapIosError(message)) {
    const launchdLabel = getDaemonServiceLaunchdLabel();
    const card = buildDaemonStartNeedsAttentionCard({
      summary:
        "OpenMeld could not finish starting OpenMeld Service on this Mac.",
      nextStep: formatInlineOpenMeldCliCommands(
        `Run \`launchctl enable gui/$(id -u)/${launchdLabel}\`, then run \`openmeld service start\` again.`
      ),
      autoRepairAttempted,
    });
    return {
      title: card.title,
      summary:
        "OpenMeld could not finish starting OpenMeld Service on this Mac.",
      rows: card.rows,
    };
  }
  if (isPermissionOrAuthorizationError(message)) {
    const card = buildDaemonStartNeedsAttentionCard({
      summary:
        "OpenMeld needs local OS permission before it can start OpenMeld Service.",
      nextStep: formatInlineOpenMeldCliCommands(
        "Approve the local permission prompt, then run `openmeld service start` again."
      ),
      autoRepairAttempted,
    });
    return {
      title: card.title,
      summary:
        "OpenMeld needs local OS permission before it can start OpenMeld Service.",
      rows: card.rows,
    };
  }
  const card = buildDaemonStartNeedsAttentionCard({
    summary: "OpenMeld could not finish starting OpenMeld Service.",
    nextStep: formatInlineOpenMeldCliCommands(
      "Run `openmeld service repair` once. OpenMeld saved the startup evidence for diagnostics."
    ),
    autoRepairAttempted,
  });
  return {
    title: card.title,
    summary: `OpenMeld could not finish starting OpenMeld Service (${verdict.controller}).`,
    rows: card.rows,
  };
}

export function buildSystemServiceStartupFailureMessage(input: {
  controller: DaemonServiceManager["controller"];
  error: unknown;
  autoRepairAttempted?: boolean;
  detail?: string | null;
}): string {
  const report = buildSystemServiceStartupFailureReport(input);
  const rowLines = report.rows
    .map((row) => formatSystemServiceFailureRow(row))
    .filter((line) => line.length > 0);
  return [report.summary, ...rowLines].join("\n");
}

export function buildSystemServiceStartupFailureDiagnostics(input: {
  autoRepairAttempted?: boolean;
  controller?: DaemonServiceManager["controller"];
  error: unknown;
  recovery: SystemServiceStartupRecoveryReport | null;
}): {
  anomalies: DaemonServiceInventory["anomalies"];
  autoRepairAttempted: boolean;
  controller: DaemonServiceManager["controller"] | null;
  jobDiagnostics: DaemonServiceJobDiagnostics | null;
  localMachineIssue: LocalMachineIssue | null;
  launchdLabel: string | null;
  lifecycleJournalPath: string;
  managerStatus: DaemonServiceManagerRuntimeStatus | null;
  nextSteps: string[];
  recovery: SystemServiceStartupRecoveryReport | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  serviceLogPath: string;
} {
  const timeoutError = isStartupTimeoutError(input.error) ? input.error : null;
  const localMachineIssue = input.controller
    ? resolveSystemServiceStartupFailureVerdict({
        controller: input.controller,
        error: input.error,
      }).localMachineIssue
    : null;
  return {
    anomalies: timeoutError?.inventory?.anomalies ?? [],
    autoRepairAttempted: input.autoRepairAttempted === true,
    controller: input.controller ?? null,
    jobDiagnostics: timeoutError?.jobDiagnostics ?? null,
    localMachineIssue,
    launchdLabel:
      (input.controller ?? null) === "launchd"
        ? getDaemonServiceLaunchdLabel()
        : null,
    lifecycleJournalPath: daemonLifecycleJournalPath(),
    managerStatus: timeoutError?.managerStatus ?? null,
    nextSteps: localMachineIssue?.primaryAction
      ? [localMachineIssue.primaryAction]
      : [formatOpenMeldCliCommand("openmeld service repair")],
    recovery: input.recovery,
    runtimeStatus: timeoutError?.runtimeStatus ?? null,
    serviceLogPath: getDaemonSystemServiceLogPath(),
  };
}

export function formatSystemServiceFailureRow(row: {
  label: string;
  value: string;
}): string {
  const label = row.label.trim();
  const value = formatOpenMeldCliTextBlock(row.value).trim();
  if (label.length === 0 && value.length === 0) {
    return "";
  }
  if (value.length === 0) {
    return `${row.label}:`;
  }
  if (label.length === 0) {
    return row.value;
  }
  return `${row.label}: ${row.value}`;
}

export function isLaunchdBootstrapIosError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("bootstrap failed") &&
    normalized.includes("input/output error")
  );
}

export function isPermissionOrAuthorizationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("permission") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("access is denied") ||
    normalized.includes("requires admin") ||
    normalized.includes("elevation") ||
    normalized.includes("access denied") ||
    normalized.includes("not authorized")
  );
}

export function isDaemonInventoryRunningAndStartReady(
  inventory: Awaited<ReturnType<typeof inspectDaemonServiceInventory>>
): boolean {
  return isDaemonInventoryRunningAndStartReadyWithBlockers(
    inventory,
    DAEMON_STARTUP_BLOCKING_ANOMALIES
  );
}

export async function waitForSystemServiceStartup(input: {
  expectedVersion: string;
  manager: DaemonServiceManager;
  waitMs: number;
  pollMs: number;
}): Promise<{
  state: "running";
  runtimeStatus: DaemonServiceRuntimeStatus;
}> {
  return await waitForSystemServiceStartupWithPredicate({
    ...input,
    isReady: isDaemonInventoryRunningAndStartReady,
  });
}
