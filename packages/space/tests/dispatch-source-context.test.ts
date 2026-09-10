import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  buildDispatchQuotedMessage,
  renderDispatchSourceText,
} from "../src/read-projection/dispatch-source-context";

describe("dispatch quoted context", () => {
  const message = {
    id: "original",
    type: "signal.text",
    profile: { profileId: "human", kind: "human", profileName: "Monica" },
    data: { text: "Support batch uploads" },
  } as SignalEnvelope;

  it("carries the referenced author and content without replacing the request", () => {
    const quotedMessage = buildDispatchQuotedMessage({
      signalId: "original",
      signal: message,
    });
    expect(
      renderDispatchSourceText({
        text: "Please file this issue",
        quotedMessage,
      })
    ).toContain("Support batch uploads");
    expect(quotedMessage.author).toBe("Monica");
    expect(
      renderDispatchSourceText({
        text: "Please file this issue",
        quotedMessage,
      }).startsWith("Please file this issue")
    ).toBe(true);
  });

  it("does not disclose recalled text or accept a different message", () => {
    expect(
      buildDispatchQuotedMessage({
        signalId: "original",
        signal: {
          ...message,
          data: {
            ...message.data,
            meta: { recalledAt: 1_788_998_400_000 },
          },
        } as SignalEnvelope,
      })
    ).toEqual({
      signalId: "original",
      author: null,
      text: null,
      status: "recalled",
    });
    expect(
      buildDispatchQuotedMessage({ signalId: "other", signal: message }).status
    ).toBe("unavailable");
    expect(
      buildDispatchQuotedMessage({ signalId: "missing", signal: null }).text
    ).toBeNull();
  });
});
