import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { readAgentTaskCompletionSubscription } from "../../agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import type { CoreBindings } from "../../lib/bindings";

/** Validate frozen envelopes against the existing task owner's recovery intent. */
export async function requireTaskContinuationSummaryPolicy(input: {
  env: CoreBindings;
  requests: (RemoteAgentWorkerSubmitTurnRequest | null)[];
  summaryOnly?: true;
}): Promise<void> {
  for (const request of input.requests) {
    if (!request) {
      continue;
    }
    const trigger = request.turnEnvelope.trigger;
    if (
      trigger.source !== "task_continuation" &&
      trigger.source !== "task_watch_continuation"
    ) {
      continue;
    }
    const db = getPostgresDatabase(input.env);
    if (!db) {
      throw new Error("agent_task_continuation.owner_store_unavailable");
    }
    const subscription = await readAgentTaskCompletionSubscription({
      db,
      subscriptionId: trigger.subscriptionId,
    });
    const ownerSummaryOnly =
      subscription?.continuation?.kind === "resume_agent" &&
      Boolean(subscription.continuation.summaryRecovery);
    const markedSummaryOnly =
      trigger.source === "task_continuation" && trigger.summaryOnly === true;
    if (
      (subscription &&
        subscription.organizationId !== request.organizationId) ||
      ((input.summaryOnly === true || ownerSummaryOnly) &&
        !markedSummaryOnly) ||
      (markedSummaryOnly && !ownerSummaryOnly)
    ) {
      // Do not rewrite the frozen request or create a different operation ID.
      throw new Error("remote_agent.task_continuation.summary_policy_mismatch");
    }
  }
}
