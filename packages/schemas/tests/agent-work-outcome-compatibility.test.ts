import { describe, expect, it } from "vitest";
import { spaceAgentStreamDeltaFrameSchema } from "../src";
import { toSpaceSignalReadWireValue } from "../src/compatibility/space-signal-read-wire";

const frame = {
  type: "space.agent_stream_part",
  v: 1,
  spaceId: "space-1",
  streamId: "stream-1",
  sequence: 2,
  profileId: "agt_11111111-1111-4111-8111-111111111111",
  triggerMessageId: "signal-1",
  dispatchId: "dispatch-1",
  updatedAtMs: 1000,
  part: {
    type: "tool",
    toolName: "github_create_issue_comment",
    toolCallId: "comment-1",
    state: "output-available",
    work: { v: 1, key: "github.issue.comment", outcome: "outcome_unknown" },
  },
};

describe("uncertain Agent Work legacy readers", () => {
  it.each([
    "outcome_unknown",
    "future_outcome",
  ])("preserves sequence and sends existing progress vocabulary for %s to a legacy live reader", (outcome) => {
    const input = {
      ...frame,
      part: { ...frame.part, work: { ...frame.part.work, outcome } },
    };
    const projected = toSpaceSignalReadWireValue(input);
    expect(spaceAgentStreamDeltaFrameSchema.safeParse(projected).success).toBe(
      true
    );
    expect(projected).toMatchObject({
      sequence: 2,
      dispatchId: "dispatch-1",
      type: "space.agent_stream_delta",
      kind: "progress",
      progressSnapshot: expect.stringContaining("awaiting confirmation"),
    });
    expect(projected).not.toHaveProperty("part");
    expect(toSpaceSignalReadWireValue(input, true)).toBe(input);
  });

  it.each([
    "outcome_unknown",
    "future_outcome",
  ])("uses existing public progress for retained %s history without changing stored activity", (outcome) => {
    const part = { ...frame.part, work: { ...frame.part.work, outcome } };
    const signal = {
      type: "signal.text",
      data: {
        text: "The comment needs confirmation.",
        meta: {
          clientMessageId: "client-1",
          agentPublicProgress: "Reviewed the issue.",
          agentActivity: { v: 1, steps: [part], truncated: false },
          agentWorkSummary: { v: 1, steps: [part], truncated: false },
        },
      },
    };
    const projected = toSpaceSignalReadWireValue({ signals: [signal] });
    expect(projected.signals[0]?.data.meta).toMatchObject({
      clientMessageId: "client-1",
      agentPublicProgress: expect.stringContaining("awaiting confirmation"),
    });
    expect(projected.signals[0]?.data.meta).not.toHaveProperty(
      "agentWorkSummary"
    );
    expect(projected.signals[0]?.data.meta).not.toHaveProperty("agentActivity");
    expect(signal.data.meta.agentWorkSummary.steps).toHaveLength(1);
    expect(toSpaceSignalReadWireValue(signal, true)).toBe(signal);
  });
});
