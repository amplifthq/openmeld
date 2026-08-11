import { describe, expect, it } from "vitest";
import {
  AGENT_CONTEXT_ENVELOPE_VERSION,
  AGENT_CONTEXT_PROGRESSIVE_POLICY_VERSION,
  agentContextEnvelopeSchema,
  renderAgentContextEnvelope,
} from "../src";

describe("Agent Context Envelope", () => {
  it("owns the shared render model with one strict versioned schema", () => {
    expect(
      agentContextEnvelopeSchema.parse({
        action: ["Reply in the current Space."],
        environment: ["Space: Launch Room"],
        task: ["Source signal: signal-1"],
      })
    ).toEqual({
      action: ["Reply in the current Space."],
      environment: ["Space: Launch Room"],
      task: ["Source signal: signal-1"],
      v: AGENT_CONTEXT_ENVELOPE_VERSION,
    });
    expect(
      agentContextEnvelopeSchema.safeParse({
        action: [],
        environment: ["Space: Launch Room"],
        task: ["Source signal: signal-1"],
      }).success
    ).toBe(false);
  });

  it("renders one stable four-section prompt vocabulary", () => {
    expect(
      renderAgentContextEnvelope({
        action: ["Reply in the current Space."],
        environment: ["Space: Launch Room"],
        task: ["Source signal: signal-1"],
      })
    ).toBe(
      [
        `[Agent Context Envelope: ${AGENT_CONTEXT_ENVELOPE_VERSION}]`,
        "[Task]",
        "- Source signal: signal-1",
        "[Environment]",
        "- Space: Launch Room",
        "[Rules]",
        `- Context policy: ${AGENT_CONTEXT_PROGRESSIVE_POLICY_VERSION}.`,
        "[Action]",
        "- Reply in the current Space.",
      ].join("\n")
    );
  });
});
