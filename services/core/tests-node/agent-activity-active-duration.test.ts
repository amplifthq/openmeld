import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITY_ACTIVE_WINDOW_MS,
  calculateAgentActivityDailyActiveDurations,
} from "../src/agent-activity/activity-active-duration";

const DAY_STARTED_AT_MS = Date.UTC(2026, 6, 10);

function event(input: {
  memberUserId?: string;
  observedAtMs: number;
  projectId?: string;
  providerSessionId?: string;
}) {
  return {
    eventType: "session_active" as const,
    memberUserId: input.memberUserId ?? "user-1",
    observedAtMs: input.observedAtMs,
    organizationId: "org-1",
    projectId: input.projectId ?? "project-1",
    providerSessionId: input.providerSessionId ?? "session-1",
  };
}

describe("Agent Activity daily active duration", () => {
  it("connects evidence within the active window and breaks a larger gap", () => {
    expect(
      calculateAgentActivityDailyActiveDurations([
        event({ observedAtMs: DAY_STARTED_AT_MS }),
        event({
          observedAtMs: DAY_STARTED_AT_MS + AGENT_ACTIVITY_ACTIVE_WINDOW_MS,
        }),
        event({
          observedAtMs:
            DAY_STARTED_AT_MS + AGENT_ACTIVITY_ACTIVE_WINDOW_MS * 2 + 1,
        }),
      ])
    ).toEqual([
      {
        activeDurationMs: AGENT_ACTIVITY_ACTIVE_WINDOW_MS,
        memberUserId: "user-1",
        organizationId: "org-1",
        projectId: "project-1",
        utcDate: "2026-07-10",
      },
    ]);
  });

  it("sums separate provider sessions without bridging them", () => {
    expect(
      calculateAgentActivityDailyActiveDurations([
        event({
          observedAtMs: DAY_STARTED_AT_MS,
          providerSessionId: "session-1",
        }),
        event({
          observedAtMs: DAY_STARTED_AT_MS + 30_000,
          providerSessionId: "session-1",
        }),
        event({
          observedAtMs: DAY_STARTED_AT_MS + 10_000,
          providerSessionId: "session-2",
        }),
        event({
          observedAtMs: DAY_STARTED_AT_MS + 70_000,
          providerSessionId: "session-2",
        }),
      ])
    ).toEqual([
      {
        activeDurationMs: 90_000,
        memberUserId: "user-1",
        organizationId: "org-1",
        projectId: "project-1",
        utcDate: "2026-07-10",
      },
    ]);
  });

  it("counts a single active event as zero duration", () => {
    expect(
      calculateAgentActivityDailyActiveDurations([
        event({ observedAtMs: DAY_STARTED_AT_MS }),
      ])
    ).toEqual([
      {
        activeDurationMs: 0,
        memberUserId: "user-1",
        organizationId: "org-1",
        projectId: "project-1",
        utcDate: "2026-07-10",
      },
    ]);
  });

  it("returns the same increment when the same evidence is calculated again", () => {
    const events = [
      event({ observedAtMs: DAY_STARTED_AT_MS }),
      event({ observedAtMs: DAY_STARTED_AT_MS + 30_000 }),
    ];
    const originalEvents = structuredClone(events);
    const firstIncrement = calculateAgentActivityDailyActiveDurations(events);

    expect(calculateAgentActivityDailyActiveDurations(events)).toEqual(
      firstIncrement
    );
    expect(events).toEqual(originalEvents);
  });

  it("ignores non-active evidence and keeps daily scopes independent", () => {
    expect(
      calculateAgentActivityDailyActiveDurations([
        event({ observedAtMs: DAY_STARTED_AT_MS }),
        {
          ...event({ observedAtMs: DAY_STARTED_AT_MS + 30_000 }),
          eventType: "session_idle" as const,
        },
        event({ observedAtMs: DAY_STARTED_AT_MS + 24 * 60 * 60_000 }),
      ])
    ).toEqual([
      {
        activeDurationMs: 0,
        memberUserId: "user-1",
        organizationId: "org-1",
        projectId: "project-1",
        utcDate: "2026-07-10",
      },
      {
        activeDurationMs: 0,
        memberUserId: "user-1",
        organizationId: "org-1",
        projectId: "project-1",
        utcDate: "2026-07-11",
      },
    ]);
  });
});
