import { describe, expect, it } from "vitest";
import {
  buildPendingOutboundDispatchRowDrafts,
  formatPendingOutboundStatusText,
} from "../src/space/pending-outbound-status";

const SENDING_PREVIEW_PREFIX_REGEX = /^Sending: @hi-agent please sync/;

describe("formatPendingOutboundStatusText", () => {
  it("renders exact preview copy for legacy mention text", () => {
    expect(
      formatPendingOutboundStatusText({
        pendingText: "@hi-agent hey there",
        terminalColumns: 120,
      })
    ).toBe("Sending: @hi-agent hey there");
  });

  it("renders exact preview copy for canonical mention text", () => {
    expect(
      formatPendingOutboundStatusText({
        pendingText: "@Budget Analyst(wake) can you help?",
        terminalColumns: 120,
      })
    ).toBe("Sending: @Budget Analyst(wake) can you help?");
  });

  it("truncates long preview copy when terminal width is constrained", () => {
    expect(
      formatPendingOutboundStatusText({
        pendingText:
          "@hi-agent please sync with @ops-bot and keep the rollout summary detailed enough to overflow the terminal preview width",
        terminalColumns: 60,
      })
    ).toMatch(SENDING_PREVIEW_PREFIX_REGEX);
  });

  it("creates one message-scoped draft for each outbound send", () => {
    expect(
      buildPendingOutboundDispatchRowDrafts({
        pendingText: "@hi-agent please sync with @ops-bot and @hi-agent",
        terminalColumns: 120,
      })
    ).toEqual([
      {
        statusText:
          "Sending: @hi-agent please sync with @ops-bot and @hi-agent",
        targetLabel: "",
        targetMentionLabel: null,
      },
    ]);
  });

  it("creates a generic sending draft when no mention exists", () => {
    expect(
      buildPendingOutboundDispatchRowDrafts({
        pendingText: "plain text message",
        terminalColumns: 120,
      })
    ).toEqual([
      {
        statusText: "Sending: plain text message",
        targetLabel: "",
        targetMentionLabel: null,
      },
    ]);
  });

  it("shows capitalized empty-state copy for blank text", () => {
    expect(
      formatPendingOutboundStatusText({
        pendingText: "   ",
        terminalColumns: 120,
      })
    ).toBe("Sending...");
  });
});
