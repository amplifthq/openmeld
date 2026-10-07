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
  const next = [
    result.nextExpiresAtMs,
    git.nextExpiresAtMs,
    selection.nextExpiresAtMs,
  ].filter((value): value is number => value !== null);
  return {
    deleted: result.deleted + git.deleted + selection.deleted,
    nextCleanupAtMs: next.length ? Math.min(...next) : null,
  };
}
