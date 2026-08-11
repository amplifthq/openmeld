import type { SpaceReplyWorkflowProjection } from "@openmeld/space";

export function buildHumanReplyWorkflowSummary(
  projection: SpaceReplyWorkflowProjection | null
): string | null {
  if (!projection) {
    return null;
  }

  switch (projection.publicOutcome) {
    case "post_message":
    case "raw_context_sharing":
      return "A public reply message was written back.";
    case "post_status":
      return "A public status update was written back.";
    case "stay_silent":
      return "A public stay-silent system notice was written back.";
    case "system_notice":
      return "A public system notice was written back.";
    case "internal_only":
      return "No public signal was written back.";
    default:
      return buildNoPublicSignalSummary(projection.dispatchExecution);
  }
}

export function buildHumanReplyWorkflowSurfaceNote(input: {
  surface: "result" | "updates";
}): string {
  return input.surface === "result"
    ? "`space result` reads archived dispatch results only. Use `openmeld service trace` to inspect Wake execution and the final visible Space outcome."
    : "`space updates` shows formal execution evidence for this message round. Use `openmeld service trace` to inspect Wake execution and the final visible Space outcome.";
}

export function buildHumanReplyWorkflowSignalSummary(
  projection: SpaceReplyWorkflowProjection | null
): string | null {
  if (!(projection?.hasPublicSignal && projection.publishedSignalId)) {
    return null;
  }

  const signalTypeLabel = projection.publishedSignalType ?? "signal";
  return `${signalTypeLabel} · ${projection.publishedSignalId}`;
}

function buildNoPublicSignalSummary(
  dispatchExecution: SpaceReplyWorkflowProjection["dispatchExecution"]
): string {
  if (!(dispatchExecution && dispatchExecution.targetDispatches.length > 0)) {
    return "No public signal is visible yet.";
  }

  const statusCounts = {
    blocked: 0,
    dispatch_recorded: 0,
    failed: 0,
    retrying: 0,
    stopped: 0,
    unknown: 0,
  };
  for (const targetDispatch of dispatchExecution.targetDispatches) {
    statusCounts[targetDispatch.status] += 1;
  }

  if (
    statusCounts.dispatch_recorded > 0 &&
    statusCounts.blocked === 0 &&
    statusCounts.failed === 0 &&
    statusCounts.retrying === 0 &&
    statusCounts.stopped === 0 &&
    statusCounts.unknown === 0
  ) {
    return "Dispatch history was recorded, but current execution state is unknown and no public signal is visible yet.";
  }
  if (
    statusCounts.blocked > 0 &&
    statusCounts.dispatch_recorded === 0 &&
    statusCounts.failed === 0 &&
    statusCounts.retrying === 0 &&
    statusCounts.stopped === 0 &&
    statusCounts.unknown === 0
  ) {
    return "No public signal was written back because dispatch was blocked.";
  }
  if (
    statusCounts.failed > 0 &&
    statusCounts.dispatch_recorded === 0 &&
    statusCounts.blocked === 0 &&
    statusCounts.retrying === 0 &&
    statusCounts.stopped === 0 &&
    statusCounts.unknown === 0
  ) {
    return "No public signal was written back because dispatch failed terminally.";
  }
  if (
    statusCounts.retrying > 0 &&
    statusCounts.dispatch_recorded === 0 &&
    statusCounts.blocked === 0 &&
    statusCounts.failed === 0 &&
    statusCounts.stopped === 0 &&
    statusCounts.unknown === 0
  ) {
    return "Dispatch has retryable failure evidence, but current execution state is unknown and no public signal is visible yet.";
  }
  if (
    statusCounts.stopped > 0 &&
    statusCounts.dispatch_recorded === 0 &&
    statusCounts.blocked === 0 &&
    statusCounts.failed === 0 &&
    statusCounts.retrying === 0 &&
    statusCounts.unknown === 0
  ) {
    return "No public signal was written back because dispatch was stopped.";
  }

  return "No public signal was written back for every target. Dispatch history does not establish current execution state; inspect the target evidence and current Wake trace.";
}
