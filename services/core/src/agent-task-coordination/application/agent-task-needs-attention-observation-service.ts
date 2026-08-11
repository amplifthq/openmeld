import type {
  AgentTaskHandle,
  AgentTaskNeedsAttentionObservation,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { recordAgentTaskNeedsAttentionObservation } from "../infrastructure/d1/agent-task-coordination-repo";
import { enqueueAgentTaskContinuationMessages } from "./agent-task-terminal-outcome-service";

export async function recordAndEnqueueAgentTaskNeedsAttentionObservation(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  observation: AgentTaskNeedsAttentionObservation;
  task: AgentTaskHandle;
}): Promise<void> {
  const recorded = await recordAgentTaskNeedsAttentionObservation(input);
  try {
    await enqueueAgentTaskContinuationMessages({
      env: input.env,
      nowMs: input.nowMs,
      subscriptionIds: recorded.newlyReadySubscriptionIds,
    });
  } catch (error) {
    // The ready subscription is durable in Agent Task Coordination. Its
    // normal continuation redrive will retry Queue delivery without replaying
    // the interaction or creating another parent continuation.
    console.warn(
      "[core.openmeld.agent_task.needs_attention_continuation_enqueue_deferred]",
      {
        error: error instanceof Error ? error.message : String(error),
        subscriptionCount: recorded.newlyReadySubscriptionIds.length,
      }
    );
  }
}
