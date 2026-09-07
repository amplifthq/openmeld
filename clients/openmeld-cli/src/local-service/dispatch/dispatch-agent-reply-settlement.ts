import type { LocalExecutionSlotTaskResult } from "@openmeld/local-service";
import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import { DaemonServiceRunError } from "../core/types";
import type { DispatchResultOutboxSettlement } from "./dispatch-result-outbox";

function requireDispatchResultOutboxSettlement(input: {
  settlement: Promise<DispatchResultOutboxSettlement> | null;
}): Promise<DispatchResultOutboxSettlement> {
  if (!input.settlement) {
    throw new DaemonServiceRunError({
      code: "dispatch.result_settlement.not_registered",
      message:
        "OpenMeld could not wait for the Agent reply because result settlement was not registered.",
    });
  }
  return input.settlement;
}

function shouldAwaitAgentReplySettlement(
  payload: OpenMeldDaemonTaskResultPayload
): boolean {
  return (
    (payload.status === "success" || payload.status === "partial_success") &&
    payload.spaceAction?.type === "post_message"
  );
}

export async function settleAgentReplyProposals(input: {
  initialResultPayload: OpenMeldDaemonTaskResultPayload;
  reconsider: (
    agentReplyObservationCursor: string
  ) => Promise<OpenMeldDaemonTaskResultPayload>;
  submit: (payload: OpenMeldDaemonTaskResultPayload) => {
    resultSummary: LocalExecutionSlotTaskResult;
    settlement: Promise<DispatchResultOutboxSettlement> | null;
  };
}): Promise<{
  resultPayload: OpenMeldDaemonTaskResultPayload;
  resultSummary: LocalExecutionSlotTaskResult | null;
}> {
  let resultPayload = input.initialResultPayload;
  while (shouldAwaitAgentReplySettlement(resultPayload)) {
    const proposal = input.submit(resultPayload);
    const settlement = await requireDispatchResultOutboxSettlement(proposal);
    if (settlement.status === "accepted") {
      return {
        resultPayload,
        resultSummary: proposal.resultSummary,
      };
    }
    if (settlement.status === "rejected_terminal") {
      throw new DaemonServiceRunError({
        code: settlement.reasonCode,
        message: `OpenMeld rejected the Agent reply proposal: ${settlement.reasonCode}`,
      });
    }
    const previousCursor = readObservationCursor(resultPayload);
    resultPayload = await input.reconsider(previousCursor);
    if (
      shouldAwaitAgentReplySettlement(resultPayload) &&
      readObservationCursor(resultPayload) === previousCursor
    ) {
      throw new DaemonServiceRunError({
        code: "dispatch.agent_reply_observation.no_progress",
        message:
          "OpenMeld requested a reply review, but no newer Space context could be read. Open Diagnostics before waking the Agent again.",
      });
    }
  }
  return { resultPayload, resultSummary: null };
}

function readObservationCursor(
  payload: OpenMeldDaemonTaskResultPayload
): string {
  return (
    (payload.spaceAction?.type === "post_message"
      ? payload.spaceAction.observedThroughSignalId?.trim()
      : null) || payload.sourceEventId
  );
}
