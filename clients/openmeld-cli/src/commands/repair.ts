import {
  type OpenMeldLegacyLockRepairReport,
  repairOrphanedLegacyLocks,
} from "../config/lock";
import {
  formatLaneScopeSentence,
  resolveOpenMeldLaneDescriptor,
} from "../config/openmeld-lane-descriptor";
import { resolveCurrentDaemonExpectedVersion } from "../local-service/lifecycle/current-daemon-version";
import {
  type DaemonStartupPreflightResult,
  runDaemonStartupPreflight,
} from "../local-service/lifecycle/daemon-startup-preflight";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { createDaemonServiceAlignmentProgressUi } from "../system/local-service-alignment-progress-ui";
import {
  type LocalStateAlignmentReport,
  runLocalStateAlignment,
} from "../system/local-state-alignment";
import { emitTopLevelAgentOverview } from "./top-level-agent-overview";

export async function runRepairLocalState(input: {
  includeDaemonService?: boolean;
  view?: string;
}): Promise<{
  repaired: true;
  report: LocalStateAlignmentReport;
  daemonService: DaemonStartupPreflightResult | null;
  localLocks: OpenMeldLegacyLockRepairReport;
}> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const lane = resolveOpenMeldLaneDescriptor();
  if (runtime.resolvedView === "agent") {
    emitTopLevelAgentOverview({
      presenter,
      command: "repair.local_state",
    });
  }
  const localLocks = await repairOrphanedLegacyLocks();
  const report = await runLocalStateAlignment({
    mode: "repair",
  });
  const daemonService =
    input.includeDaemonService === false
      ? null
      : await runDaemonStartupPreflight({
          expectedVersion: await resolveCurrentDaemonExpectedVersion(),
          progress: createDaemonServiceAlignmentProgressUi({
            view: runtime.resolvedView,
          }),
          view: runtime.resolvedView,
        });
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "repair.local_state.completed",
      payload: {
        lane,
        localLocks,
        report,
        daemonService,
      },
    });
  } else {
    presenter.line({
      code: "repair.local_state.completed",
      text: buildRepairLocalStateSummary({
        daemonService,
        lane,
        localLocks,
        report,
      }),
    });
  }
  return {
    repaired: true,
    report,
    daemonService,
    localLocks,
  };
}

function buildRepairLocalStateSummary(input: {
  lane: ReturnType<typeof resolveOpenMeldLaneDescriptor>;
  localLocks: OpenMeldLegacyLockRepairReport;
  report: LocalStateAlignmentReport;
  daemonService: DaemonStartupPreflightResult | null;
}): string {
  return joinRepairSummaryClauses([
    formatLaneScopeSentence(input.lane),
    describeLocalLockRepairOutcome(input.localLocks),
    describeLocalStateRepairOutcome(input.report),
    describeDaemonStartupPreflightOutcome(input.daemonService),
  ]);
}

function describeLocalLockRepairOutcome(
  report: OpenMeldLegacyLockRepairReport
): string {
  if (report.removedOrphanedLegacyLocks === 0) {
    return "";
  }
  const lockLabel =
    report.removedOrphanedLegacyLocks === 1
      ? "1 lock"
      : `${report.removedOrphanedLegacyLocks} locks`;
  return `OpenMeld removed ${lockLabel} left by an older version.`;
}

function describeLocalStateRepairOutcome(
  report: LocalStateAlignmentReport
): string {
  const localStateChanged = hasAlignmentChanges(report);
  const partiallyBackedUpCorruptFiles =
    report.spaceCache.backedUpCorruptFiles > 0;

  if (report.spaceCache.requiresRepair) {
    if (partiallyBackedUpCorruptFiles) {
      return localStateChanged
        ? "Automatic local OpenMeld data upgrade and cleanup completed, and OpenMeld backed up some corrupt Space cache files, but some Space cache files still need attention."
        : "OpenMeld backed up some corrupt Space cache files, but some Space cache files still need attention.";
    }

    return localStateChanged
      ? "Automatic local OpenMeld data upgrade and cleanup completed, but some corrupt Space cache files still need attention."
      : "Local OpenMeld data still needs attention because some corrupt Space cache files could not be fully backed up.";
  }

  return localStateChanged
    ? "Automatic local OpenMeld data upgrade and cleanup completed."
    : "Local OpenMeld data is up to date.";
}

function describeDaemonStartupPreflightOutcome(
  daemonService: Pick<DaemonStartupPreflightResult, "status"> | null
): string {
  if (daemonService === null) {
    return "";
  }
  const status: DaemonStartupPreflightResult["status"] = daemonService.status;
  switch (status) {
    case "already_aligned":
      return "OpenMeld Service for this lane is already aligned.";
    case "aligned":
    case "auto_healed":
      return "OpenMeld Service for this lane was repaired.";
    case "not_installed":
      return "OpenMeld Service is not installed for this lane.";
    case "blocked":
      return "OpenMeld Service in this lane still needs attention.";
    case "failed":
      return "OpenMeld Service repair in this lane failed.";
    default: {
      const unexpectedStatus: never = status;
      throw new Error(
        `Unexpected daemon startup preflight status: ${String(unexpectedStatus)}`
      );
    }
  }
}

function joinRepairSummaryClauses(clauses: string[]): string {
  return clauses.filter((clause) => clause.length > 0).join("\n");
}

function hasAlignmentChanges(report: LocalStateAlignmentReport): boolean {
  return (
    report.storageVersionUpdated ||
    report.runtimeConfig.migratedLegacyConfig ||
    report.runtimeConfig.removedLegacyConfig ||
    report.selectedOpenMeldProfile.migratedSessionSelections > 0 ||
    report.selectedOpenMeldProfile.removedLegacyDirectory ||
    report.selectedOpenMeldProfile.removedLegacySelectionFile ||
    report.spaceCache.migratedAccountSpaceFiles > 0 ||
    report.spaceCache.removedLegacyAccountSpaceDirs > 0 ||
    report.spaceCache.migratedLegacyProfileFiles > 0 ||
    report.spaceCache.removedLegacyProfilesDir ||
    report.spaceCache.migratedLegacyViews > 0 ||
    report.spaceCache.backedUpCorruptFiles > 0 ||
    report.cleanup.removedTemporaryFiles > 0
  );
}
