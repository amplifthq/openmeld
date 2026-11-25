import { describe, expect, it } from "vitest";
import {
  WAKE_TIMING_MILESTONE_NAMES,
  WAKE_TIMING_MODEL_VERSION,
  wakeTimingSchema,
} from "../../src/schemas";
import type {
  WakeTiming,
  WakeTimingSegment,
} from "../../src/types/http/space-wake-timing";

const MILESTONE_AT: Partial<Record<string, string>> = {
  request_received: "2026-05-13T00:00:00.000Z",
  agent_started: "2026-05-13T00:00:02.000Z",
  result_visible: "2026-05-13T00:00:05.000Z",
};

describe("Wake timing schema", () => {
  it("accepts contiguous segments whose totals equal end-to-end time", () => {
    expect(wakeTimingSchema.safeParse(buildSettledTiming()).success).toBe(true);
  });

  it.each<[string, (timing: WakeTiming) => void]>([
    [
      "overlapping segments summed into the totals",
      (timing) => {
        replaceAgentRun(timing, {
          startedAt: "2026-05-13T00:00:01.000Z",
          durationMs: 4000,
        });
        timing.totals.byKind.agent_run = 4000;
        timing.totals.endToEndMs = 6000;
      },
    ],
    [
      "totals that double count a segment",
      (timing) => {
        timing.totals.byKind.agent_run = 6000;
        timing.totals.endToEndMs = 8000;
      },
    ],
    [
      "an open segment in settled timing",
      (timing) => {
        replaceAgentRun(timing, { endedAt: null, durationMs: 8000 });
        timing.totals.byKind.agent_run = 8000;
        timing.totals.endToEndMs = 10_000;
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const timing = buildSettledTiming();
    mutate(timing);
    expect(wakeTimingSchema.safeParse(timing).success).toBe(false);
  });
});

function replaceAgentRun(
  timing: WakeTiming,
  patch: Partial<WakeTimingSegment>
): void {
  const segment = timing.segments[1];
  if (!segment) {
    throw new Error("fixture must include an Agent run segment");
  }
  timing.segments[1] = { ...segment, ...patch };
}

function buildSettledTiming(): WakeTiming {
  return {
    modelVersion: WAKE_TIMING_MODEL_VERSION,
    factSource: "platform_observed",
    state: "settled",
    asOf: "2026-05-13T00:00:10.000Z",
    lastEvidenceAt: "2026-05-13T00:00:05.000Z",
    milestones: WAKE_TIMING_MILESTONE_NAMES.map((name) => ({
      name,
      at: MILESTONE_AT[name] ?? null,
    })),
    segments: [
      {
        kind: "not_recorded",
        startedAt: "2026-05-13T00:00:00.000Z",
        endedAt: "2026-05-13T00:00:02.000Z",
        durationMs: 2000,
        reasonCode: null,
      },
      {
        kind: "agent_run",
        startedAt: "2026-05-13T00:00:02.000Z",
        endedAt: "2026-05-13T00:00:05.000Z",
        durationMs: 3000,
        reasonCode: null,
      },
    ],
    totals: {
      endToEndMs: 5000,
      byKind: {
        routing: 0,
        queue: 0,
        delivery: 0,
        startup: 0,
        agent_run: 3000,
        waiting_for_input: 0,
        result_delivery: 0,
        publishing: 0,
        not_recorded: 2000,
      },
    },
  };
}
