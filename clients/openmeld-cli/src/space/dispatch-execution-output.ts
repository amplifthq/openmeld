import pc from "picocolors";
import type { InfoCardRow } from "../ui/info-card";
import type {
  DispatchExecutionEvidence,
  DispatchExecutionStatus,
} from "./read-projection/dispatch-execution-evidence";

export function buildDispatchExecutionCardRows(
  dispatchExecution: DispatchExecutionEvidence | null
): InfoCardRow[] {
  if (!(dispatchExecution && dispatchExecution.targetDispatches.length > 0)) {
    return [];
  }

  return [
    {
      label: pc.dim("Dispatch history"),
      value: formatDispatchExecutionSummary(dispatchExecution),
    },
    ...dispatchExecution.targetDispatches.map((targetDispatch, index) => {
      const displayTarget =
        targetDispatch.targetDisplayName ?? targetDispatch.targetProfileId;
      const attemptSuffix = targetDispatch.latestAttemptStatus
        ? ` · attempt ${targetDispatch.latestAttemptStatus}`
        : "";
      const reasonSuffix = targetDispatch.reasonCode
        ? ` · ${targetDispatch.reasonCode}`
        : "";
      return {
        label: pc.dim(index === 0 ? "Targets" : ""),
        value: pc.bold(
          `${displayTarget} · ${formatDispatchExecutionStatusLabel(targetDispatch.status)} · ledger ${targetDispatch.dispatchStatus}${attemptSuffix}${reasonSuffix}`
        ),
      };
    }),
  ];
}

function formatDispatchExecutionSummary(
  dispatchExecution: DispatchExecutionEvidence
): string {
  const counts: Record<DispatchExecutionStatus, number> = {
    blocked: 0,
    dispatch_recorded: 0,
    failed: 0,
    retrying: 0,
    stopped: 0,
    unknown: 0,
  };

  for (const targetDispatch of dispatchExecution.targetDispatches) {
    counts[targetDispatch.status] += 1;
  }

  return [
    counts.dispatch_recorded > 0
      ? `${counts.dispatch_recorded} recorded`
      : null,
    counts.blocked > 0 ? `${counts.blocked} blocked` : null,
    counts.retrying > 0 ? `${counts.retrying} retrying` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.stopped > 0 ? `${counts.stopped} stopped` : null,
    counts.unknown > 0 ? `${counts.unknown} unknown` : null,
  ]
    .filter((value): value is string => value !== null)
    .map((value) => pc.bold(value))
    .join(pc.dim(" | "));
}

function formatDispatchExecutionStatusLabel(
  status: DispatchExecutionStatus
): string {
  switch (status) {
    case "dispatch_recorded":
      return "recorded";
    case "blocked":
      return "blocked";
    case "retrying":
      return "retrying";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "unknown":
      return "unknown";
    default:
      return status;
  }
}
