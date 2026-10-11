import type { RemoteAgentStorage } from "./callback-context";

export const REMOTE_AGENT_RETAINED_RESULT_PREFIX = "retained-tool-result:v1:";
export const REMOTE_AGENT_MESSAGE_READ_PREFIX = "message-read:";

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
  const git = await input.storage.deleteExpired({
    prefix: "github-working-copy:",
    limit: 64,
    nowMs: input.nowMs ?? Date.now(),
  });
  const selection = await input.storage.deleteExpired({
    prefix: "capability-selection:",
    limit: 64,
    nowMs: input.nowMs ?? Date.now(),
  });
  const reads = await input.storage.deleteExpired({
    prefix: REMOTE_AGENT_MESSAGE_READ_PREFIX,
    limit: 64,
    nowMs: input.nowMs ?? Date.now(),
  });
  const next = [
    reads.nextExpiresAtMs,
    result.nextExpiresAtMs,
    git.nextExpiresAtMs,
    selection.nextExpiresAtMs,
  ].filter((value): value is number => value !== null);
  return {
    deleted: result.deleted + git.deleted + selection.deleted + reads.deleted,
    nextCleanupAtMs: next.length ? Math.min(...next) : null,
  };
}
