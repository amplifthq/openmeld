import { createD1AgentProfileCreationRequestRepository } from "./agent-profile-creation-request-repository";
import { failStaleAgentProfileCreationRequests } from "./agent-profile-creation-request-service";

export async function recoverStaleAgentProfileCreationRequests(input: {
  db: D1Database;
  nowMs: number;
}): Promise<{ markedFailed: number; scanned: number; superseded: number }> {
  return await failStaleAgentProfileCreationRequests({
    nowMs: input.nowMs,
    repository: createD1AgentProfileCreationRequestRepository(input.db),
  });
}
