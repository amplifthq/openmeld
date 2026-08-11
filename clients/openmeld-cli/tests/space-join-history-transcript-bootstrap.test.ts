import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitHumanConnectTranscriptEvent,
  replayConnectInitialHistoryBootstrap,
} from "../src/space/connect-history-transcript-bootstrap";

const SPACE_ID = "ops-room";
const HUMAN_PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

function createMembersSnapshot(): SpaceMembersSnapshot {
  return createSpaceMembersSnapshot({
    agents: [
      createSpaceMemberAgentSnapshot({
        addedAt: "2026-04-10T00:00:00.000Z",
        addedByDisplayName: "Mira",
        addedByOwnerUserId: "user-mira",
        addedByProfileId: HUMAN_PROFILE_ID,
        createdAt: "2026-04-10T00:00:00.000Z",
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: null,
        lastSeenLabel: null,
        memberSourceLabel: "Added by member",
        ownerName: "Mira",
        ownerUserId: "user-mira",
        profileId: AGENT_PROFILE_ID,
        profileName: "Phase 2a Agent",
        updatedAt: "2026-04-10T00:00:00.000Z",
        wakeabilityReasonText: "Ready",
        workingDirectory: null,
      }),
    ],
    generatedAt: "2026-04-10T00:00:00.000Z",
    humans: [
      createSpaceMemberHumanSnapshot({
        addedAt: "2026-04-10T00:00:00.000Z",
        createdAt: "2026-04-10T00:00:00.000Z",
        firstEnteredAt: null,
        lastEnteredAt: null,
        lastSeenAt: null,
        lastSeenLabel: null,
        memberSource: "joined_directly",
        memberSourceLabel: "Joined directly",
        ownerName: "Mira",
        ownerUserId: "user-mira",
        profileId: HUMAN_PROFILE_ID,
        profileName: "Mira",
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    ],
    spaceId: SPACE_ID,
  });
}

function createReplyAnchorSignal(): Record<string, unknown> {
  return {
    v: 1,
    id: "sig-anchor-1",
    spaceId: SPACE_ID,
    ts: 1,
    profile: {
      kind: "human",
      profileId: HUMAN_PROFILE_ID,
      profileName: "Mira",
      owner: "user-mira",
      ownerName: "Mira",
    },
    type: "signal.text",
    data: {
      text: "@Phase 2a Agent(wake) anchor",
      messageEnvelope: {
        text: "@Phase 2a Agent(wake) anchor",
        activationTargets: [AGENT_PROFILE_ID],
        referenceTargets: [],
      },
    },
  };
}

function createReplySignal(input: { id: string; ts: number }): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: SPACE_ID,
    ts: input.ts,
    profile: {
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      profileName: "Phase 2a Agent",
      owner: "user-mira",
      ownerName: "Mira",
      agentControllerRef: "builtin:codex",
    },
    type: "signal.text",
    data: {
      text: "Ack",
      messageEnvelope: {
        text: "Ack",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-anchor-1",
      },
      replyTo: {
        signalId: "sig-anchor-1",
        profileId: HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Mira",
        previewText: "@Phase 2a Agent(wake) anchor",
      },
    },
  };
}

function createReadModelSeed(snapshot = createMembersSnapshot()) {
  const signalIndex = new Map<string, SignalEnvelope>();

  return {
    rememberSignal(event: SignalEnvelope) {
      signalIndex.set(event.id, event);
    },
    getMentionHighlightIndex() {
      return null;
    },
    getMembersSnapshot() {
      return snapshot;
    },
    getSignalIndex() {
      return signalIndex;
    },
  };
}

function createRecentHistoryResponse(signals: readonly unknown[]): Response {
  return new Response(
    JSON.stringify({
      signals,
      nextCursor: null,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("space join history transcript bootstrap", () => {
  it("replays recent history into the read seed before rendering transcript lines and honors historyLimit", async () => {
    let capturedLimit = "";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input));
      capturedLimit = url.searchParams.get("limit") ?? "";
      return Promise.resolve(
        createRecentHistoryResponse([
          createReplyAnchorSignal(),
          createReplySignal({
            id: "sig-reply-history",
            ts: 2,
          }),
        ])
      );
    });

    const readModelSeed = createReadModelSeed();
    const replaySeedSnapshots: string[][] = [];
    let replayedLines: readonly string[] = [];

    const result = await replayConnectInitialHistoryBootstrap({
      profileIdentity: {
        kind: "human",
        openMeldProfileId: "11111111-0000-0000-0000-000000000001",
        profileName: "Felix",
      },
      baseUrl: "https://example.com",
      space: SPACE_ID,
      recentHistoryLimit: 7,
      readModelSeed,
      ownerDisplayNameByUserId: new Map([["user-mira", "Mira"]]),
      seenSignalIds: new Set<string>(),
      onReplayEvent: (event) => {
        if ("id" in event) {
          replaySeedSnapshots.push([...readModelSeed.getSignalIndex().keys()]);
        }
      },
      onReplayTranscriptRendered: (input) => {
        replayedLines = input.lines;
      },
      onError: () => {
        throw new Error("replay should not fail");
      },
      renderWidth: 100,
    });

    expect(capturedLimit).toBe("7");
    expect(replaySeedSnapshots).toEqual([
      ["sig-anchor-1"],
      ["sig-anchor-1", "sig-reply-history"],
    ]);
    expect(replayedLines.join("\n")).toContain(
      "reply to Mira · wake: Phase 2a Agent"
    );
    expect(replayedLines.join("\n")).not.toContain(
      "reply to Mira · @Phase 2a Agent(wake) anchor"
    );
    expect(result).toMatchObject({
      synced: true,
      latestReplayedSignalTs: 2,
    });
    expect(result.lastTranscriptGroupKey).toBeTruthy();
  });

  it("emits live human transcript items with the same semantic reply cue after anchor replay", () => {
    const readModelSeed = createReadModelSeed();
    readModelSeed.rememberSignal(
      createReplyAnchorSignal() as unknown as SignalEnvelope
    );

    let transcriptLine: string | null = null;
    emitHumanConnectTranscriptEvent({
      event: createReplySignal({
        id: "sig-reply-live",
        ts: 3,
      }),
      ownerDisplayNameByUserId: new Map([["user-mira", "Mira"]]),
      readModelSeed,
      sessionProfileIdentity: {
        kind: "human",
        openMeldProfileId: "11111111-0000-0000-0000-000000000001",
        profileName: "Felix",
      },
      onTranscriptItem: (item) => {
        transcriptLine = item.line;
      },
    });

    expect(transcriptLine).toContain("reply to Mira · wake: Phase 2a Agent");
    expect(transcriptLine).toContain("Ack");
  });

  it("keeps catchup failure non-fatal and surfaces synced=false", async () => {
    const onError = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", {
        status: 500,
      })
    );

    const result = await replayConnectInitialHistoryBootstrap({
      profileIdentity: {
        kind: "agent",
        openMeldProfileId: "agt_11111111-0000-0000-0000-000000000001",
        profileName: "Codex",
      },
      baseUrl: "https://example.com",
      space: SPACE_ID,
      recentHistoryLimit: 5,
      readModelSeed: createReadModelSeed(),
      ownerDisplayNameByUserId: new Map(),
      seenSignalIds: new Set<string>(),
      onReplayEvent: (_event: SignalEnvelope | HelloAck) => undefined,
      onError,
    });

    expect(result).toEqual({
      synced: false,
      latestReplayedSignalTs: null,
      lastTranscriptGroupKey: null,
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
