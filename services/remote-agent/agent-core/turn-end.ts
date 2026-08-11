import type { RemoteAgentStorage } from "./callback-context";

const REMOTE_AGENT_TURN_END_MARKER_PREFIX =
  "openmeld:remote-agent:turn-end-marker:";
const REMOTE_AGENT_TURN_END_MARKER_RETENTION_MS = 60 * 60 * 1000;
const REMOTE_AGENT_TURN_END_MARKER_CLEANUP_BATCH_SIZE = 64;

type RemoteAgentTurnEndMarker = {
  endedAtMs: number;
  toolName: string;
  v: 1;
};

export class RemoteAgentTurnEndedError extends Error {
  constructor(toolName: string) {
    super(
      `The current Agent work loop already ended after ${toolName}. Wait for OpenMeld to create the declared continuation.`
    );
    this.name = "RemoteAgentTurnEndedError";
  }
}

export async function assertRemoteAgentTurnAllowsToolExecution(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<void> {
  const marker = await input.storage.get<RemoteAgentTurnEndMarker>(
    buildRemoteAgentTurnEndMarkerKey(input.submissionId)
  );
  if (marker?.v === 1) {
    throw new RemoteAgentTurnEndedError(marker.toolName);
  }
}

export async function markRemoteAgentTurnEnded(input: {
  nowMs?: number;
  storage: RemoteAgentStorage;
  submissionId: string;
  toolName: string;
}): Promise<void> {
  const nowMs = input.nowMs ?? Date.now();
  await input.storage.putExpiring(
    buildRemoteAgentTurnEndMarkerKey(input.submissionId),
    {
      endedAtMs: nowMs,
      toolName: input.toolName,
      v: 1,
    } satisfies RemoteAgentTurnEndMarker,
    nowMs + REMOTE_AGENT_TURN_END_MARKER_RETENTION_MS
  );
}

export async function cleanupExpiredRemoteAgentTurnEndMarkers(input: {
  nowMs?: number;
  storage: RemoteAgentStorage;
}): Promise<{ deleted: number; nextCleanupAtMs: number | null }> {
  const cleanup = await input.storage.deleteExpired({
    limit: REMOTE_AGENT_TURN_END_MARKER_CLEANUP_BATCH_SIZE,
    nowMs: input.nowMs ?? Date.now(),
    prefix: REMOTE_AGENT_TURN_END_MARKER_PREFIX,
  });
  return {
    deleted: cleanup.deleted,
    nextCleanupAtMs: cleanup.nextExpiresAtMs,
  };
}

function buildRemoteAgentTurnEndMarkerKey(submissionId: string): string {
  return `${REMOTE_AGENT_TURN_END_MARKER_PREFIX}${encodeURIComponent(
    submissionId
  )}`;
}
