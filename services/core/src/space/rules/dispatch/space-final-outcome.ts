import {
  AGENT_REPLY_FINAL_PURPOSE,
  projectSpaceDispatchTraceFinalVisibleOutcome as projectSharedSpaceDispatchTraceFinalVisibleOutcome,
  REMOTE_AGENT_FAILURE_PURPOSE,
} from "@openmeld/schemas";
import type {
  SpaceDispatchTraceFinalVisibleOutcome,
  SpaceDispatchTraceSnapshot,
} from "@openmeld/schemas/types";

export function isFinalOutcomeTextPurpose(
  value: unknown
): value is
  | typeof AGENT_REPLY_FINAL_PURPOSE
  | typeof REMOTE_AGENT_FAILURE_PURPOSE {
  return (
    value === AGENT_REPLY_FINAL_PURPOSE ||
    value === REMOTE_AGENT_FAILURE_PURPOSE
  );
}

export function projectSpaceDispatchTraceFinalVisibleOutcome(
  trace: SpaceDispatchTraceSnapshot
): SpaceDispatchTraceFinalVisibleOutcome {
  const finalVisibleMessage = trace.finalVisibleMessage;
  if (
    finalVisibleMessage?.signalType === "signal.text" &&
    finalVisibleMessage.reasonCode !== null
  ) {
    return {
      delivered: true,
      publicationErrorCode: null,
      publicationKind: "failure_notice",
      reasonCode: finalVisibleMessage.reasonCode,
      signalId: finalVisibleMessage.signalId,
      sourceFact: "final_visible_message",
      sourceReasonCode: finalVisibleMessage.reasonCode,
      sourceStatus: finalVisibleMessage.signalType,
      status: "visible_failure",
    };
  }

  return projectSharedSpaceDispatchTraceFinalVisibleOutcome(trace);
}
