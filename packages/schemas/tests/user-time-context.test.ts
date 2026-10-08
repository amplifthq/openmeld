import { describe, expect, it } from "vitest";
import { remoteAgentWorkerExecutionInputRequestSchema } from "../src/schemas/runtime/remote-agent-execution-input";
import {
  normalizeUserTimeZone,
  resolveUserTimeContext,
  userTimeZoneObservationSchema,
} from "../src/user-time-context";

describe("user time context contract", () => {
  it.each([
    "",
    "Mars/Olympus",
    "+08:00",
    "2026-10-09",
    null,
  ])("rejects %s as a user timezone and labels the UTC fallback", (timeZone) => {
    expect(normalizeUserTimeZone(timeZone)).toBeNull();
    expect(
      resolveUserTimeContext({ timeZone, source: "web", observedAtMs: 1 })
    ).toEqual({ timeZone: "UTC", source: "utc", observedAtMs: null });
  });
  it("keeps valid historical observations usable offline and rejects an unknown source", () => {
    expect(
      resolveUserTimeContext({
        timeZone: "US/Pacific",
        source: "desktop",
        observedAtMs: 1,
      })
    ).toEqual({
      timeZone: "America/Los_Angeles",
      source: "desktop",
      observedAtMs: 1,
    });
    expect(
      userTimeZoneObservationSchema.safeParse({
        timeZone: "Asia/Taipei",
        source: "model",
      }).success
    ).toBe(false);
  });
  it("uses the same optional accepted time context for queued and active execution inputs", () => {
    const request = {
      target: {
        v: 1 as const,
        organizationId: "org",
        spaceId: "space",
        conversationId: "space",
        idempotencyKey: "key",
        submissionId: "submission",
      },
      inputId: "input",
      authorProfileId: "human",
      sourceSignalId: "signal",
      text: "In ten minutes",
      requestTimeContext: {
        submittedAtMs: 1000,
        userTime: {
          timeZone: "Asia/Taipei",
          source: "web" as const,
          observedAtMs: 1000,
        },
      },
    };
    expect(remoteAgentWorkerExecutionInputRequestSchema.parse(request)).toEqual(
      request
    );
    expect(request.requestTimeContext.submittedAtMs).toBe(1000);
  });
});
