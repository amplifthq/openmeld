import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import {
  replayMissedSignals,
  replayRecentSignals,
  type SpaceWatchReadState,
} from "./connect-catchup";
import type { SpaceJoinReadModelSeed } from "./join-read-model-seed";
import {
  buildSpaceSessionProfileContextFromIdentity,
  type SpaceSessionProfileIdentity,
} from "./session-profile";
import type { SpaceTranscriptItem } from "./state/space-screen-state";
import { buildHumanTranscriptItemFromEvent } from "./transcript/transcript-item-builder";
import {
  buildHumanTranscriptProjection,
  renderTranscriptBlocks,
} from "./transcript/transcript-render";

export type ConnectHistoryTranscriptBootstrapResult = {
  synced: boolean;
  confirmedAnchorSignalId: string | null;
  latestReplayedSignalTs: number | null;
  lastTranscriptGroupKey: string | null;
};

// Neutral connect/runtime seam: owns initial and anchored replay and shared
// transcript-pipeline parity, without owning join handoff or read seed state.
export async function replayConnectHistoryBootstrap(input: {
  profileIdentity: SpaceSessionProfileIdentity;
  baseUrl: string;
  space: string;
  password?: string;
  recentHistoryLimit: number;
  afterSignalId?: string;
  shouldContinue?: () => boolean;
  readModelSeed: Pick<
    SpaceJoinReadModelSeed,
    | "rememberSignal"
    | "getMentionHighlightIndex"
    | "getMembersSnapshot"
    | "getSignalIndex"
  >;
  ownerDisplayNameByUserId: Map<string, string>;
  seenSignalIds: Set<string>;
  onReplayEvent: (event: SignalEnvelope | HelloAck) => void;
  onError: (error: unknown) => void;
  onReplayTranscriptRendered?: (input: {
    lines: readonly string[];
    lastTranscriptGroupKey: string | null;
  }) => void;
  renderWidth?: number;
}): Promise<ConnectHistoryTranscriptBootstrapResult> {
  let latestReplayedSignalTs: number | null = null;
  let confirmedAnchorSignalId: string | null = null;
  const replayedTranscriptItems: SpaceTranscriptItem[] = [];

  try {
    const replayInput = {
      profileIdentity: input.profileIdentity,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      seenSignalIds: input.seenSignalIds,
      onEvent: (event: SignalEnvelope | HelloAck) => {
        if (isSignalEnvelope(event)) {
          input.readModelSeed.rememberSignal(event);
          latestReplayedSignalTs = Math.max(
            latestReplayedSignalTs ?? event.ts,
            event.ts
          );
        }

        if (input.onReplayTranscriptRendered) {
          emitHumanConnectTranscriptEvent({
            event,
            ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
            readModelSeed: input.readModelSeed,
            sessionProfileIdentity: input.profileIdentity,
            onTranscriptItem: (transcriptItem) => {
              replayedTranscriptItems.push(transcriptItem);
            },
          });
        }

        input.onReplayEvent(event);
      },
    };
    if (input.afterSignalId) {
      confirmedAnchorSignalId = await replayMissedSignals({
        ...replayInput,
        afterSignalId: input.afterSignalId,
        shouldContinue: input.shouldContinue,
      });
    } else {
      await replayRecentSignals({
        ...replayInput,
        limit: input.recentHistoryLimit,
      });
    }
  } catch (error) {
    input.onError(error);
    return {
      synced: false,
      confirmedAnchorSignalId,
      latestReplayedSignalTs,
      lastTranscriptGroupKey: replayedTranscriptItems.at(-1)?.groupKey ?? null,
    };
  }

  if (input.onReplayTranscriptRendered) {
    const projection = buildHumanTranscriptProjection({
      items: replayedTranscriptItems,
      membersSnapshot: input.readModelSeed.getMembersSnapshot(),
      sessionProfile: buildSpaceSessionProfileContextFromIdentity({
        kind: input.profileIdentity.kind,
        openMeldProfileId: input.profileIdentity.openMeldProfileId,
        ownerName: input.profileIdentity.ownerName,
        ownerUserId: input.profileIdentity.ownerUserId,
        profileName: input.profileIdentity.profileName,
      }),
    });
    input.onReplayTranscriptRendered({
      lines: renderTranscriptBlocks(
        projection.transcriptBlocks,
        Math.max(input.renderWidth ?? process.stdout.columns ?? 100, 40)
      ),
      lastTranscriptGroupKey: replayedTranscriptItems.at(-1)?.groupKey ?? null,
    });
  }

  return {
    synced: true,
    confirmedAnchorSignalId,
    latestReplayedSignalTs,
    lastTranscriptGroupKey: replayedTranscriptItems.at(-1)?.groupKey ?? null,
  };
}

export async function replaySpaceWatchHistory(
  input: Omit<
    Parameters<typeof replayConnectHistoryBootstrap>[0],
    "afterSignalId"
  > & { watchReadState: SpaceWatchReadState }
): Promise<ConnectHistoryTranscriptBootstrapResult> {
  const afterSignalId = input.watchReadState.anchorSignalId;
  if (!afterSignalId) {
    throw new Error(
      "Space watch has no saved message anchor. Read Space history before starting another watch."
    );
  }
  const replay = await replayConnectHistoryBootstrap({
    ...input,
    afterSignalId,
  });
  if (input.shouldContinue?.() === false) {
    return { ...replay, synced: false };
  }
  if (!replay.synced) {
    throw new Error(
      "Space watch could not complete catch-up. Read Space history before starting another watch."
    );
  }
  if (replay.confirmedAnchorSignalId) {
    input.watchReadState.anchorSignalId = replay.confirmedAnchorSignalId;
  }
  return replay;
}

export function emitHumanConnectTranscriptEvent(input: {
  event: SignalEnvelope | HelloAck;
  ownerDisplayNameByUserId: Map<string, string>;
  readModelSeed: Pick<
    SpaceJoinReadModelSeed,
    "getMentionHighlightIndex" | "getMembersSnapshot" | "getSignalIndex"
  >;
  sessionProfileIdentity: SpaceSessionProfileIdentity;
  onTranscriptItem: (item: SpaceTranscriptItem) => void;
}): SpaceTranscriptItem | null {
  const transcriptItem = buildHumanTranscriptItemFromEvent({
    event: input.event,
    mentionHighlightIndex: input.readModelSeed.getMentionHighlightIndex(),
    ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
    selfProfileId: input.sessionProfileIdentity.openMeldProfileId,
    sessionProfileIdentity: input.sessionProfileIdentity,
    signalIndex: input.readModelSeed.getSignalIndex(),
    spaceMembersSnapshot: input.readModelSeed.getMembersSnapshot(),
  });
  if (!transcriptItem) {
    return null;
  }
  input.onTranscriptItem(transcriptItem);
  return transcriptItem;
}

function isSignalEnvelope(
  event: SignalEnvelope | HelloAck
): event is SignalEnvelope {
  return "id" in event && typeof event.id === "string";
}
