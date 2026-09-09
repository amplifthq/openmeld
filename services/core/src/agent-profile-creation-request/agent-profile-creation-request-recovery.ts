import type { CoreBindings } from "../lib/bindings";
import { scheduleAgentProfileCreation } from "./agent-profile-creation-execution";
import { createD1AgentProfileCreationRequestRepository } from "./agent-profile-creation-request-repository";
import { failStaleAgentProfileCreationRequests } from "./agent-profile-creation-request-service";

export async function recoverAgentProfileCreationRequests(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
}): Promise<{
  markedFailed: number;
  scanned: number;
  superseded: number;
  redelivered: number;
}> {
  const repository = createD1AgentProfileCreationRequestRepository(input.db);
  const pending = await repository.listUnclaimedProfileCreations({ limit: 25 });
  let redelivered = 0;
  for (const request of pending) {
    try {
      await scheduleAgentProfileCreation(input.env, request);
      redelivered += 1;
    } catch (error) {
      console.error("[core.agent_profile_creation_request.redelivery_failed]", {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const stale = await failStaleAgentProfileCreationRequests({
    nowMs: input.nowMs,
    repository,
  });
  return { ...stale, redelivered };
}
