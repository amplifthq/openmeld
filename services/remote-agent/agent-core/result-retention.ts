import type { RemoteAgentStorage } from "./callback-context";

export const REMOTE_AGENT_RETAINED_RESULT_PREFIX = "retained-tool-result:v1:";

/** Uses the existing admission cleanup, not another scheduler or result service. */
export async function cleanupExpiredRemoteAgentToolResults(input: {
  storage: RemoteAgentStorage;
  nowMs?: number;
}) {
  const result = await input.storage.deleteExpired({
    prefix: REMOTE_AGENT_RETAINED_RESULT_PREFIX,
    limit: 256,
    nowMs: input.nowMs ?? Date.now(),
  });
  return { deleted: result.deleted, nextCleanupAtMs: result.nextExpiresAtMs };
}
