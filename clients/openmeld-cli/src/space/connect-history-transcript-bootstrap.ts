import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import { replayRecentSignals } from "./connect-catchup";
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
  latestReplayedSignalTs: number | null;
  lastTranscriptGroupKey: string | null;
};

// Neutral connect/runtime seam: owns initial replay bootstrap and shared
// transcript-pipeline parity, without owning join handoff or read seed state.
export async function replayConnectInitialHistoryBootstrap(input: {
  profileIdentity: SpaceSessionProfileIdentity;
  baseUrl: string;
  space: string;
  password?: string;
  recentHistoryLimit: number;
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
  const replayedTranscriptItems: SpaceTranscriptItem[] = [];

  try {
    await replayRecentSignals({
      profileIdentity: input.profileIdentity,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      limit: input.recentHistoryLimit,
      seenSignalIds: input.seenSignalIds,
      onEvent: (event) => {
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
    });
  } catch (error) {
    input.onError(error);
    return {
      synced: false,
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
    latestReplayedSignalTs,
    lastTranscriptGroupKey: replayedTranscriptItems.at(-1)?.groupKey ?? null,
  };
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
