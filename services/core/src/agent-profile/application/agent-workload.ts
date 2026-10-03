import type {
  AgentWorkloadSnapshot,
  WakeProgressItem,
} from "@openmeld/schemas/types";

type ReadyWorkload = Extract<AgentWorkloadSnapshot, { status: "ready" }>;

/** Compose read models; never admit, reorder, or execute work here. */
export function projectSpaceAgentWorkload(input: {
  location: { spaceId: string; spaceName: string };
  canReadSource: boolean;
  hasMore: boolean;
  wakes: readonly WakeProgressItem[];
  queuedMessages: readonly {
    inputId: string;
    text: string;
    state: string;
    blocked: boolean;
  }[];
}): AgentWorkloadSnapshot {
  if (input.hasMore) {
    return { status: "unavailable" };
  }
  const result: ReadyWorkload = {
    status: "ready",
    activeCount: 0,
    waitingCount: 0,
    queuedMessageCount: 0,
    pausedMessageCount: 0,
    items: [],
  };
  for (const wake of input.wakes) {
    if (wake.terminal) {
      continue;
    }
    const kind =
      wake.phase === "queued" ||
      wake.phase === "request_sent" ||
      wake.phase === "connecting" ||
      wake.phase === "retrying" ||
      wake.phase === "sending"
        ? "waiting"
        : "active";
    if (kind === "active") {
      result.activeCount += 1;
    } else {
      result.waitingCount += 1;
    }
    if (input.canReadSource) {
      result.items.push({
        id: `${input.location.spaceId}:wake:${wake.dispatchId}`,
        kind,
        location: input.location,
        text:
          wake.sourceContext?.messagePreview ??
          wake.previewText ??
          wake.message,
      });
    }
  }
  for (const message of input.queuedMessages) {
    const paused = message.blocked || message.state === "unconfirmed";
    if (paused) {
      result.pausedMessageCount += 1;
    } else {
      result.queuedMessageCount += 1;
    }
    if (input.canReadSource) {
      result.items.push({
        id: `${input.location.spaceId}:input:${message.inputId}`,
        kind: paused ? "paused_message" : "queued_message",
        location: input.location,
        text: message.text,
      });
    }
  }
  return result;
}

export function combineAgentWorkloads(
  snapshots: readonly AgentWorkloadSnapshot[]
): AgentWorkloadSnapshot {
  const combined: ReadyWorkload = {
    status: "ready",
    activeCount: 0,
    waitingCount: 0,
    queuedMessageCount: 0,
    pausedMessageCount: 0,
    items: [],
  };
  for (const snapshot of snapshots) {
    if (snapshot.status !== "ready") {
      return { status: "unavailable" };
    }
    combined.activeCount += snapshot.activeCount;
    combined.waitingCount += snapshot.waitingCount;
    combined.queuedMessageCount += snapshot.queuedMessageCount;
    combined.pausedMessageCount += snapshot.pausedMessageCount;
    combined.items.push(...snapshot.items);
  }
  return combined;
}
