import type { LocalMachineIssue } from "@openmeld/schemas";
import { sleep, toErrorMessage } from "@openmeld/utils";
import {
  type DaemonServiceRuntimeStatus,
  daemonLifecycleJournalPath,
} from "../config/daemon-state";
import {
  type DaemonServiceAnomalyCode,
  type DaemonServiceInventory,
  inspectDaemonServiceInventory,
} from "../local-service/lifecycle/daemon-service-inventory";
import {
  type DaemonServiceJobDiagnostics,
  type DaemonServiceManager,
  type DaemonServiceManagerRuntimeStatus,
  formatDaemonServiceJobDiagnosticsEvidence,
  getDaemonServiceLaunchdLabel,
  getDaemonSystemServiceLogPath,
  isDaemonServiceBackgroundExecutionBlocked,
  readDaemonServiceJobCrashExitCode,
} from "../local-service/lifecycle/daemon-service-manager";
import { readCurrentObservedDaemonRuntimeStatus } from "../local-service/lifecycle/daemon-service-runtime";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliTextBlock,
} from "../runtime/cli-entry-command";
import {
  assessLocalMachineFailure,
  createBackgroundExecutionBlockedIssue,
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

export class SystemServiceStartupTimeoutError extends Error {
  readonly code = "openmeld.service.startup_timeout";
  readonly inventory: DaemonServiceInventory | null;
  readonly managerStatus: DaemonServiceManagerRuntimeStatus | null;
  readonly runtimeStatus: DaemonServiceRuntimeStatus | null;
  readonly jobDiagnostics: DaemonServiceJobDiagnostics | null;

  constructor(input: {
    inventory: DaemonServiceInventory | null;
    managerStatus: DaemonServiceManagerRuntimeStatus | null;
    runtimeStatus: DaemonServiceRuntimeStatus | null;
    jobDiagnostics?: DaemonServiceJobDiagnostics | null;
  }) {
    super(buildSystemServiceStartupTimeoutMessage(input));
    this.name = "SystemServiceStartupTimeoutError";
    this.inventory = input.inventory;
    this.managerStatus = input.managerStatus;
    this.runtimeStatus = input.runtimeStatus;
    this.jobDiagnostics = input.jobDiagnostics ?? null;
  }
}

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

function resolveStartupLocalMachineIssue(input: {
  assessedIssue: LocalMachineIssue;
  jobDiagnostics: DaemonServiceJobDiagnostics | null;
}): LocalMachineIssue | null {
  if (
    input.jobDiagnostics &&
    isDaemonServiceBackgroundExecutionBlocked(input.jobDiagnostics)
  ) {
    return createBackgroundExecutionBlockedIssue({
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
  const jobDiagnostics = isSystemServiceStartupTimeoutError(input.error)
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
  if (
    jobDiagnostics &&
    isDaemonServiceBackgroundExecutionBlocked(jobDiagnostics)
  ) {
    const summary = "macOS didn't start OpenMeld Service.";
    const card = buildDaemonStartNeedsAttentionCard({
      summary,
      nextStep: formatInlineOpenMeldCliCommands(
        "Open System Settings > General > Login Items & Extensions, turn on OpenMeld, then run `openmeld service start` again."
      ),
      autoRepairAttempted,
    });
    return {
      title: card.title,
      summary,
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
  const timeoutError = isSystemServiceStartupTimeoutError(input.error)
    ? input.error
    : null;
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

export function buildSystemServiceStartupTimeoutMessage(input: {
  inventory: DaemonServiceInventory | null;
  managerStatus: DaemonServiceManagerRuntimeStatus | null;
  runtimeStatus: DaemonServiceRuntimeStatus | null;
  jobDiagnostics?: DaemonServiceJobDiagnostics | null;
}): string {
  const base = `OpenMeld Service failed to reach a running local service state in time. runtime=${input.runtimeStatus?.status ?? "unknown"}, reason=${input.runtimeStatus?.reason || "unknown"}, managerRunning=${String(input.managerStatus?.running ?? false)}, anomalies=${input.inventory?.anomalies.map((anomaly) => anomaly.code).join(",") || "unknown"}`;
  if (!input.jobDiagnostics) {
    return base;
  }
  return `${base}; ${formatDaemonServiceJobDiagnosticsEvidence(input.jobDiagnostics)}`;
}

export function isSystemServiceStartupTimeoutError(
  error: unknown
): error is SystemServiceStartupTimeoutError {
  return (
    error instanceof SystemServiceStartupTimeoutError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "openmeld.service.startup_timeout")
  );
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
  if (inventory.runtimeStatus.status !== "running") {
    return false;
  }
  if (inventory.runtimeStatus.mode !== "background") {
    return false;
  }
  if (inventory.runtimeStatus.managedBySystemService !== true) {
    return false;
  }

  return !inventory.anomalies.some((anomaly) =>
    DAEMON_STARTUP_BLOCKING_ANOMALIES.has(anomaly.code)
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
  const deadlineMs = Date.now() + input.waitMs;
  while (Date.now() < deadlineMs) {
    const inventory = await inspectDaemonServiceInventory({
      expectedVersion: input.expectedVersion,
      intendedMode: "background",
      intent: "run_background",
    }).catch(() => null);
    if (inventory && isDaemonInventoryRunningAndStartReady(inventory)) {
      return {
        state: "running",
        runtimeStatus: inventory.runtimeStatus,
      };
    }
    await sleep(input.pollMs);
  }

  const finalInventory = await inspectDaemonServiceInventory({
    expectedVersion: input.expectedVersion,
    intendedMode: "background",
    intent: "run_background",
  }).catch(() => null);
  if (finalInventory && isDaemonInventoryRunningAndStartReady(finalInventory)) {
    return {
      state: "running",
      runtimeStatus: finalInventory.runtimeStatus,
    };
  }

  const finalRuntimeStatus =
    await readCurrentObservedDaemonRuntimeStatus().catch(() => null);
  const finalManagerStatus = await input.manager.status().catch(() => null);
  // Diagnostic evidence only: explains why startup never became running.
  // It must not gate or reorder any lifecycle decision above.
  const finalJobDiagnostics =
    (await input.manager.readJobDiagnostics?.().catch(() => null)) ?? null;
  throw new SystemServiceStartupTimeoutError({
    inventory: finalInventory,
    managerStatus: finalManagerStatus,
    runtimeStatus: finalRuntimeStatus,
    jobDiagnostics: finalJobDiagnostics,
  });
}
