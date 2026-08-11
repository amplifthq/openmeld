import type { AgentActivityEventType } from "@openmeld/schemas/types";

export const AGENT_ACTIVITY_ACTIVE_WINDOW_MS = 2 * 60_000;

const ACTIVE_EVIDENCE_TYPES = new Set<AgentActivityEventType>([
  "heartbeat",
  "session_active",
  "session_started",
]);

export type AgentActivityDurationEvent = {
  eventType: AgentActivityEventType;
  memberUserId: string;
  observedAtMs: number;
  organizationId: string;
  projectId: string;
  providerSessionId: string;
};

export type AgentActivityDailyActiveDuration = {
  activeDurationMs: number;
  memberUserId: string;
  organizationId: string;
  projectId: string;
  utcDate: string;
};

type SessionEvidence = Omit<
  AgentActivityDailyActiveDuration,
  "activeDurationMs"
> & {
  observedAtMs: number[];
};

export function calculateAgentActivityDailyActiveDurations(
  events: readonly AgentActivityDurationEvent[]
): AgentActivityDailyActiveDuration[] {
  const sessions = new Map<string, SessionEvidence>();
  for (const event of events) {
    if (!ACTIVE_EVIDENCE_TYPES.has(event.eventType)) {
      continue;
    }
    const utcDate = new Date(event.observedAtMs).toISOString().slice(0, 10);
    const sessionKey = JSON.stringify([
      event.organizationId,
      event.projectId,
      event.memberUserId,
      event.providerSessionId,
      utcDate,
    ]);
    const session = sessions.get(sessionKey);
    if (session) {
      session.observedAtMs.push(event.observedAtMs);
      continue;
    }
    sessions.set(sessionKey, {
      memberUserId: event.memberUserId,
      observedAtMs: [event.observedAtMs],
      organizationId: event.organizationId,
      projectId: event.projectId,
      utcDate,
    });
  }

  const dailyDurations = new Map<string, AgentActivityDailyActiveDuration>();
  for (const session of sessions.values()) {
    session.observedAtMs.sort((left, right) => left - right);
    let activeDurationMs = 0;
    let previousObservedAtMs: number | undefined;
    for (const observedAtMs of session.observedAtMs) {
      if (previousObservedAtMs !== undefined) {
        const gapMs = observedAtMs - previousObservedAtMs;
        if (gapMs <= AGENT_ACTIVITY_ACTIVE_WINDOW_MS) {
          activeDurationMs += gapMs;
        }
      }
      previousObservedAtMs = observedAtMs;
    }

    const dailyKey = JSON.stringify([
      session.organizationId,
      session.projectId,
      session.memberUserId,
      session.utcDate,
    ]);
    const existing = dailyDurations.get(dailyKey);
    if (existing) {
      existing.activeDurationMs += activeDurationMs;
      continue;
    }
    dailyDurations.set(dailyKey, {
      activeDurationMs,
      memberUserId: session.memberUserId,
      organizationId: session.organizationId,
      projectId: session.projectId,
      utcDate: session.utcDate,
    });
  }

  return [...dailyDurations.values()].sort(compareDailyDurations);
}

function compareDailyDurations(
  left: AgentActivityDailyActiveDuration,
  right: AgentActivityDailyActiveDuration
): number {
  return (
    left.organizationId.localeCompare(right.organizationId) ||
    left.projectId.localeCompare(right.projectId) ||
    left.memberUserId.localeCompare(right.memberUserId) ||
    left.utcDate.localeCompare(right.utcDate)
  );
}
