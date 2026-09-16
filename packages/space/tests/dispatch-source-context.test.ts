import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  buildBareMentionContext,
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

  it("gives a bare Wake the same author's preceding request and its files, without replacing the trigger", () => {
    const file = {
      fileId: "screenshot",
      name: "question.png",
      revision: 1,
      mimeType: "image/png",
      sizeBytes: 1024,
    };
    const previous = {
      ...message,
      ts: 10,
      data: { text: "Explain this screenshot", files: [file] },
    } as SignalEnvelope;
    const source = {
      ...message,
      id: "wake",
      ts: 20,
      data: {
        text: "@Codex",
        messageEnvelope: {
          text: "@Codex",
          activationTargets: ["agt_codex"],
          referenceTargets: [],
        },
      },
    } as SignalEnvelope;
    const contextMessages = buildBareMentionContext({
      source,
      mentionTexts: ["@Codex"],
      readRecentSignals: () => [
        { ...previous, id: "future", ts: 30 },
        {
          ...previous,
          id: "other-author",
          profile: { kind: "human", profileId: "other" },
        },
        previous,
      ],
    });
    expect(contextMessages).toEqual([
      {
        signalId: "original",
        author: "Monica",
        text: "Explain this screenshot",
        files: [file],
        attachments: undefined,
      },
    ]);
    expect(
      renderDispatchSourceText({ text: "@Codex", contextMessages })
    ).toContain("Explain this screenshot");
    expect(source.type === "signal.text" && source.data.text).toBe("@Codex");
    const quoted = {
      ...previous,
      id: "quoted",
      data: { text: "Use this request instead" },
    } as SignalEnvelope;
    const explicit = {
      ...source,
      data: { ...source.data, replyTo: { signalId: "quoted" } },
    } as SignalEnvelope;
    expect(
      buildBareMentionContext({
        source: explicit,
        quotedSignal: quoted,
        rootSignal: quoted,
        mentionTexts: ["@Codex"],
        readRecentSignals: () => [previous],
      })?.map((item) => item.signalId)
    ).toEqual(["quoted"]);
    expect(
      buildBareMentionContext({
        source: explicit,
        quotedSignal: null,
        mentionTexts: ["@Codex"],
        readRecentSignals: () => [previous],
      })
    ).toBeUndefined();
  });

  it("does not read prior messages for a substantive request or disclose recalled context", () => {
    const source = {
      ...message,
      id: "wake",
      ts: 20,
      data: {
        text: "@Codex do this instead",
        messageEnvelope: {
          text: "@Codex do this instead",
          activationTargets: ["agt_codex"],
          referenceTargets: [],
        },
      },
    } as SignalEnvelope;
    expect(
      buildBareMentionContext({
        source,
        mentionTexts: ["@Codex"],
        readRecentSignals: () => {
          throw new Error("Unnecessary history read");
        },
      })
    ).toBeUndefined();
    const recalled = {
      ...message,
      ts: 10,
      data: { text: "Removed secret", meta: { recalledAt: 15 } },
    } as SignalEnvelope;
    expect(
      buildBareMentionContext({
        source: {
          ...source,
          data: { ...source.data, text: "@Codex" },
        } as SignalEnvelope,
        mentionTexts: ["@Codex"],
        readRecentSignals: () => [recalled],
        rootSignal: recalled,
      })
    ).toBeUndefined();
  });
});
