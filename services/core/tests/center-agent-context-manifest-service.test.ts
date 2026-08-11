import type { SignalEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildCenterAgentContextMessageProjection,
  decodeCenterAgentContextCursor,
  encodeCenterAgentContextCursor,
} from "../src/center-agent/application/center-agent-context-manifest-service";

const SHA_256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

describe("Center Agent context manifest projection", () => {
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
}): SignalEnvelope {
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
