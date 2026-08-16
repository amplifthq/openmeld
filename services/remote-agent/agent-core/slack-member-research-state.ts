import type { RemoteAgentStorage } from "./callback-context";

export const REMOTE_AGENT_SLACK_MEMBER_RESEARCH_STATE_PREFIX =
  "remote-agent:slack-member-research-";
export const REMOTE_AGENT_SLACK_MEMBER_RESEARCH_STATE_CLEANUP_BATCH_SIZE = 64;

export async function cleanupExpiredRemoteAgentSlackMemberResearchState(input: {
  nowMs?: number;
  storage: RemoteAgentStorage;
}): Promise<{ deleted: number; nextCleanupAtMs: number | null }> {
  const cleanup = await input.storage.deleteExpired({
    limit: REMOTE_AGENT_SLACK_MEMBER_RESEARCH_STATE_CLEANUP_BATCH_SIZE,
    nowMs: input.nowMs ?? Date.now(),
    prefix: REMOTE_AGENT_SLACK_MEMBER_RESEARCH_STATE_PREFIX,
  });
  return {
    deleted: cleanup.deleted,
    nextCleanupAtMs: cleanup.nextExpiresAtMs,
  };
}
