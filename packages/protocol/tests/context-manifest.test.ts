import type { SignalEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildCenterAgentContextMessageProjection,
  buildSpaceMessageEvidence,
  buildSpaceThreadEvidence,
  decodeCenterAgentContextCursor,
  encodeCenterAgentContextCursor,
} from "../src/context-manifest";

const SHA_256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

describe("Center Agent context manifest projection", () => {
  it("pins every thread page and leaves long messages available at their exact source version", async () => {
    const thread = {
      threadId: "thr_11111111-1111-4111-8111-111111111111",
      spaceId: "space-1",
      rootSignalId: "root",
      createdByProfileId: "human-1",
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(2).toISOString(),
    };
    const signals = [
      textSignal({ id: "root", text: "😀".repeat(4500), ts: 1 }),
      ...Array.from({ length: 35 }, (_, i) =>
        textSignal({ id: `reply-${i}`, text: `Original reply ${i}`, ts: i + 2 })
      ),
    ];
    const first = await buildSpaceThreadEvidence({ thread, signals });
    const firstMessage = first.messages[0];
    const root = signals[0];
    if (!(firstMessage && root)) {
      throw new Error("Expected the source root page");
    }
    expect(first.messages).toHaveLength(1);
    expect(firstMessage.content.truncated).toBe(true);
    expect(first.nextOffset).toBe(1);
    const rest = await buildSpaceMessageEvidence({
      signal: root,
      spaceId: thread.spaceId,
      version: firstMessage.sourceRef.version,
      offset: 4000,
    });
    expect(
      Array.from(firstMessage.content.text + rest.message.content.text)
    ).toHaveLength(4500);
    const second = await buildSpaceThreadEvidence({
      thread,
      signals,
      version: first.sourceRef.version,
      offset: 1,
    });
    const third = await buildSpaceThreadEvidence({
      thread,
      signals,
      version: first.sourceRef.version,
      offset: second.nextOffset ?? 0,
    });
    expect(
      [...second.messages, ...third.messages].map((entry) => entry.sourceRef.id)
    ).toEqual(signals.slice(1).map((signal) => signal.id));
    expect(third.nextOffset).toBeNull();
    for (const changed of [
      {
        thread: {
          ...thread,
          threadId: "thr_22222222-2222-4222-8222-222222222222",
        },
        signals,
      },
      {
        thread,
        signals: [...signals, textSignal({ id: "new", text: "later", ts: 99 })],
      },
      {
        thread,
        signals: signals.map((signal, i) =>
          i === 30
            ? { ...signal, data: { ...signal.data, meta: { recalledAt: 99 } } }
            : signal
        ),
      },
      {
        thread,
        signals: signals.map((signal, i) =>
          i === 30
            ? { ...signal, data: { ...signal.data, text: "replaced" } }
            : signal
        ),
      },
    ]) {
      await expect(
        buildSpaceThreadEvidence({
          ...changed,
          version: first.sourceRef.version,
          offset: 1,
        })
      ).rejects.toThrow("evidence_version_unavailable");
    }
  });

  it("pages an exact source without splitting Unicode and rejects changed or recalled versions", async () => {
    const text = "😀".repeat(4500);
    const signal = textSignal({ id: "selected-source", text, ts: 1 });
    const first = await buildSpaceMessageEvidence({
      signal,
      spaceId: "space-1",
    });
    const second = await buildSpaceMessageEvidence({
      signal,
      spaceId: "space-1",
      version: first.message.sourceRef.version,
      offset: first.nextOffset ?? 0,
    });
    expect(first.nextOffset).toBe(4000);
    expect(second.nextOffset).toBeNull();
    expect(first.message.content.text + second.message.content.text).toBe(text);
    expect(first.message.sourceRef).toEqual(second.message.sourceRef);
    expect(first.message.materializedContentHash).not.toBe(
      second.message.materializedContentHash
    );
    await expect(
      buildSpaceMessageEvidence({
        signal: { ...signal, data: { ...signal.data, text: "new version" } },
        spaceId: "space-1",
        version: first.message.sourceRef.version,
      })
    ).rejects.toThrow("evidence_version_unavailable");
    await expect(
      buildSpaceMessageEvidence({
        signal: {
          ...signal,
          data: { ...signal.data, meta: { recalledAt: 2 } },
        },
        spaceId: "space-1",
        version: first.message.sourceRef.version,
      })
    ).rejects.toThrow("evidence_unavailable");
  });
  it("returns recent visible messages in conversation order with stable source refs", async () => {
    const result = await buildCenterAgentContextMessageProjection({
      hasOlderMessages: true,
      limit: 2,
      maxContextTokens: 8000,
      signals: [
        textSignal({ id: "signal-1", text: "old", ts: 1 }),
        textSignal({ id: "signal-2", text: "question", ts: 2 }),
        textSignal({
          id: "signal-3",
          source: { client: "codex", kind: "local_agent", sessionId: "secret" },
          text: "answer",
          ts: 3,
        }),
      ],
      spaceId: "space-1",
    });

    expect(result.entries.map((entry) => entry.sourceRef.id)).toEqual([
      "signal-2",
      "signal-3",
    ]);
    expect(result.entries[1]).toMatchObject({
      carrier: { client: "codex", kind: "local_agent" },
      redactions: ["local_session_locator_omitted"],
      sourceRef: {
        uri: "openmeld://spaces/space-1/signals/signal-3",
      },
    });
    expect(JSON.stringify(result.entries)).not.toContain("secret");
    expect(result.entries[1]?.sourceRef.version).toMatch(SHA_256_PATTERN);
    expect(result.materializations).toEqual(
      result.entries.map((entry) => ({
        estimatedTokens: expect.any(Number),
        materializedContentHash: entry.materializedContentHash,
        sourceRef: entry.sourceRef,
      }))
    );
    expect(
      result.materializations.every((entry) => entry.estimatedTokens > 0)
    ).toBe(true);
    expect(result.budget.truncationReasons).toEqual([
      "message_limit",
      "older_messages_available",
    ]);
    expect(result.continuation.hasMore).toBe(true);
    expect(
      decodeCenterAgentContextCursor(result.continuation.cursor ?? "")
    ).toEqual({ signalId: "signal-2" });
  });

  it("truncates the newest message instead of exceeding the token budget", async () => {
    const result = await buildCenterAgentContextMessageProjection({
      hasOlderMessages: false,
      limit: 20,
      maxContextTokens: 256,
      signals: [textSignal({ id: "large", text: "x".repeat(5000), ts: 1 })],
      spaceId: "space-1",
    });

    expect(result.budget.estimatedTokens).toBeLessThanOrEqual(256);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.content.truncated).toBe(true);
    expect(result.entries[0]?.content.originalCharacterCount).toBe(5000);
    expect(result.entries[0]?.redactions).toContain("message_content_budget");
    expect(result.budget.truncationReasons).toEqual([
      "context_token_budget",
      "message_content_budget",
    ]);
    expect(result.continuation).toEqual({ cursor: null, hasMore: false });
  });

  it("keeps token-budget pages contiguous so every visible message remains reachable", async () => {
    const oldSmall = textSignal({ id: "old-small", text: "old", ts: 1 });
    const middleLarge = textSignal({
      id: "middle-large",
      text: "x".repeat(5000),
      ts: 2,
    });
    const newSmall = textSignal({ id: "new-small", text: "new", ts: 3 });

    const firstPage = await buildCenterAgentContextMessageProjection({
      hasOlderMessages: false,
      limit: 20,
      maxContextTokens: 400,
      signals: [oldSmall, middleLarge, newSmall],
      spaceId: "space-1",
    });
    const secondPage = await buildCenterAgentContextMessageProjection({
      hasOlderMessages: false,
      limit: 20,
      maxContextTokens: 400,
      signals: [oldSmall, middleLarge],
      spaceId: "space-1",
    });
    const thirdPage = await buildCenterAgentContextMessageProjection({
      hasOlderMessages: false,
      limit: 20,
      maxContextTokens: 400,
      signals: [oldSmall],
      spaceId: "space-1",
    });

    expect({
      firstPage: pageResult(firstPage),
      secondPage: pageResult(secondPage),
      thirdPage: pageResult(thirdPage),
    }).toEqual({
      firstPage: {
        cursorSignalId: "new-small",
        hasMore: true,
        ids: ["new-small"],
      },
      secondPage: {
        cursorSignalId: "middle-large",
        hasMore: true,
        ids: ["middle-large"],
      },
      thirdPage: {
        cursorSignalId: null,
        hasMore: false,
        ids: ["old-small"],
      },
    });
  });

  it("fails instead of skipping a message whose required metadata exceeds the token budget", async () => {
    const oldSmall = textSignal({ id: "old-small", text: "old", ts: 1 });
    const metadataHeavy = textSignal({
      id: "s".repeat(64),
      profileId: "p".repeat(64),
      profileName: "n".repeat(64),
      replyToSignalId: "r".repeat(64),
      source: {
        client: "c".repeat(80),
        kind: "local_agent",
        sessionId: "secret",
      },
      text: "newer boundary message",
      ts: 2,
    });

    await expect(
      buildCenterAgentContextMessageProjection({
        hasOlderMessages: false,
        limit: 20,
        maxContextTokens: 256,
        signals: [oldSmall, metadataHeavy],
        spaceId: "space-1",
      })
    ).rejects.toMatchObject({
      code: "center_agent.context_token_budget_too_small",
      minimumRequiredTokens: expect.any(Number),
    });
  });

  it("rejects cursors that do not use the versioned context contract", () => {
    expect(() => decodeCenterAgentContextCursor("signal-1")).toThrow(
      "Unsupported Center Agent context cursor."
    );
    expect(
      decodeCenterAgentContextCursor(
        encodeCenterAgentContextCursor({ signalId: "signal:1" })
      )
    ).toEqual({ signalId: "signal:1" });
  });
});

function textSignal(input: {
  id: string;
  profileId?: string;
  profileName?: string;
  replyToSignalId?: string;
  source?: {
    client: string;
    kind: "local_agent";
    sessionId?: string;
  };
  text: string;
  ts: number;
}): Extract<SignalEnvelope, { type: "signal.text" }> {
  return {
    data: {
      ...(input.replyToSignalId
        ? {
            messageEnvelope: {
              activationTargets: [],
              referenceTargets: [],
              replyToSignalId: input.replyToSignalId,
              text: input.text,
            },
          }
        : {}),
      ...(input.source
        ? { meta: { centerAgentInteractionSource: input.source } }
        : {}),
      text: input.text,
    },
    id: input.id,
    profile: {
      kind: input.id === "signal-3" ? "agent" : "human",
      profileId:
        input.profileId ?? (input.id === "signal-3" ? "agent-1" : "human-1"),
      profileName:
        input.profileName ??
        (input.id === "signal-3" ? "Center Agent" : "Mira"),
    },
    spaceId: "space-1",
    ts: input.ts,
    type: "signal.text",
    v: 1,
  };
}

function pageResult(
  result: Awaited<ReturnType<typeof buildCenterAgentContextMessageProjection>>
): {
  cursorSignalId: string | null;
  hasMore: boolean;
  ids: string[];
} {
  return {
    cursorSignalId: result.continuation.cursor
      ? decodeCenterAgentContextCursor(result.continuation.cursor).signalId
      : null,
    hasMore: result.continuation.hasMore,
    ids: result.entries.map((entry) => entry.sourceRef.id),
  };
}
