import { remoteAgentWorkerCancellationResponseSchema } from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import { listActiveCenterAgentNativeDeliveryCancellationTargets } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";

export async function pauseActiveCenterAgentNativeDeliveries(input: {
  db: D1Database;
  env: CoreBindings;
  organizationId: string;
  profileId: string;
  reason?: string;
}): Promise<number> {
  const targets = await listActiveCenterAgentNativeDeliveryCancellationTargets({
    db: input.db,
    organizationId: input.organizationId,
    profileId: input.profileId,
  });
  if (targets.length === 0) {
    return 0;
  }
  const worker = input.env.OPENMELD_REMOTE_AGENT_WORKER;
  if (!worker?.cancelExecution) {
    throw new Error("remote_agent.center_agent_pause_receiver_unavailable");
  }
  const cancelExecution = worker.cancelExecution.bind(worker);
  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const response = remoteAgentWorkerCancellationResponseSchema.parse(
        await cancelExecution({
          ...(target.conversationId
            ? { conversationId: target.conversationId }
            : {}),
          idempotencyKey: target.idempotencyKey,
          organizationId: target.organizationId,
          reason:
            input.reason ??
            "Center Agent was paused by an Organization owner or admin.",
          spaceId: target.spaceId,
          submissionId: target.submissionId,
          v: 1,
        })
      );
      if (
        response.status === "identity_mismatch" ||
        response.status === "not_found"
      ) {
        throw new Error(
          response.status === "identity_mismatch"
            ? response.reasonCode
            : "remote_agent.center_agent_pause_execution_not_found"
        );
      }
      return response.status;
    })
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            submissionId: targets[index]?.submissionId ?? null,
          },
        ]
      : []
  );
  if (failures.length > 0) {
    console.error("[core.center_agent.pause_cancellation_incomplete]", {
      event: "core.center_agent.pause_cancellation_incomplete",
      failures,
      organizationId: input.organizationId,
      targetCount: targets.length,
    });
    throw new AggregateError(
      failures.map((failure) => new Error(failure.error)),
      "One or more active Center Agent tasks could not be stopped."
    );
  }
  return targets.length;
}
