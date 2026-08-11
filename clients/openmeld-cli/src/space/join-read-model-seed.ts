import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../config/openmeld-request-context";
import { buildSpaceMentionHighlightIndex } from "../ui/space-mention-highlight";
import { createCliSpaceApi } from "./cli-space-api";
import {
  rememberOwnerDisplayName,
  type SpaceSessionProfileIdentity,
} from "./session-profile";

export type SpaceJoinReadModelSeed = {
  ensureMembersSnapshotLoaded: () => Promise<SpaceMembersSnapshot | null>;
  refreshMembersSnapshot: () => Promise<SpaceMembersSnapshot | null>;
  getMembersSnapshot: () => SpaceMembersSnapshot | null;
  getMentionHighlightIndex: () => ReturnType<
    typeof buildSpaceMentionHighlightIndex
  > | null;
  getSignalIndex: () => ReadonlyMap<string, SignalEnvelope>;
  applyMembersSnapshot: (snapshot: SpaceMembersSnapshot | null) => void;
  rememberSignal: (event: SignalEnvelope) => void;
};

export function resolveSpaceJoinReadModelSeed(input: {
  baseUrl: string;
  ownerDisplayNameByUserId: Map<string, string>;
  password?: string;
  profileIdentity: SpaceSessionProfileIdentity;
  space: string;
}): SpaceJoinReadModelSeed {
  const spaceApi = createCliSpaceApi(input.baseUrl);
  const signalIndexById = new Map<string, SignalEnvelope>();
  let membersSnapshot: SpaceMembersSnapshot | null = null;
  let hasLoadedMembersSnapshot = false;
  let membersSnapshotLoadPromise: Promise<SpaceMembersSnapshot | null> | null =
    null;
  let mentionHighlightIndex: ReturnType<
    typeof buildSpaceMentionHighlightIndex
  > | null = null;

  const applyMembersSnapshot = (
    snapshot: SpaceMembersSnapshot | null
  ): void => {
    membersSnapshot = snapshot
      ? enrichSpaceMembersOwnerDisplayNames({
          snapshot,
          ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
        })
      : null;
    hasLoadedMembersSnapshot = true;
    mentionHighlightIndex = membersSnapshot
      ? buildSpaceMentionHighlightIndex(membersSnapshot)
      : null;
  };

  const fetchMembersSnapshot =
    async (): Promise<SpaceMembersSnapshot | null> => {
      const fetchedSnapshot = await spaceApi.getMembersSnapshot({
        spaceId: input.space,
        requestContext: buildOpenMeldRequestContextFromProfileIdentity({
          profileIdentity: input.profileIdentity,
        }),
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
      });
      applyMembersSnapshot(fetchedSnapshot);
      return membersSnapshot;
    };

  return {
    async ensureMembersSnapshotLoaded(): Promise<SpaceMembersSnapshot | null> {
      if (hasLoadedMembersSnapshot) {
        return membersSnapshot;
      }
      if (!membersSnapshotLoadPromise) {
        membersSnapshotLoadPromise = fetchMembersSnapshot().finally(() => {
          membersSnapshotLoadPromise = null;
        });
      }
      return await membersSnapshotLoadPromise;
    },
    async refreshMembersSnapshot(): Promise<SpaceMembersSnapshot | null> {
      membersSnapshotLoadPromise = fetchMembersSnapshot().finally(() => {
        membersSnapshotLoadPromise = null;
      });
      return await membersSnapshotLoadPromise;
    },
    getMembersSnapshot(): SpaceMembersSnapshot | null {
      return membersSnapshot;
    },
    getMentionHighlightIndex() {
      return mentionHighlightIndex;
    },
    getSignalIndex(): ReadonlyMap<string, SignalEnvelope> {
      return signalIndexById;
    },
    applyMembersSnapshot,
    rememberSignal(event: SignalEnvelope): void {
      signalIndexById.set(event.id, event);
    },
  };
}

function enrichSpaceMembersOwnerDisplayNames(input: {
  snapshot: SpaceMembersSnapshot;
  ownerDisplayNameByUserId: Map<string, string>;
}): SpaceMembersSnapshot {
  for (const human of input.snapshot.humans) {
    rememberOwnerDisplayName(
      input.ownerDisplayNameByUserId,
      human.ownerUserId,
      human.ownerName ?? human.profileName
    );
  }

  for (const agent of input.snapshot.agents) {
    rememberOwnerDisplayName(
      input.ownerDisplayNameByUserId,
      agent.ownerUserId,
      agent.ownerName
    );
  }

  let changed = false;
  const humans = input.snapshot.humans.map((human) => {
    const ownerName = resolveEnrichedOwnerName({
      ownerName: human.ownerName,
      ownerUserId: human.ownerUserId,
      ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
    });
    if (ownerName === human.ownerName) {
      return human;
    }

    changed = true;
    return {
      ...human,
      ownerName,
    };
  });
  const agents = input.snapshot.agents.map((agent) => {
    const ownerName = resolveEnrichedOwnerName({
      ownerName: agent.ownerName,
      ownerUserId: agent.ownerUserId,
      ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
    });
    if (ownerName === agent.ownerName) {
      return agent;
    }

    changed = true;
    return {
      ...agent,
      ownerName,
    };
  });

  if (!changed) {
    return input.snapshot;
  }

  return {
    ...input.snapshot,
    humans,
    agents,
  };
}

function resolveEnrichedOwnerName(input: {
  ownerName?: string | null;
  ownerUserId?: string | null;
  ownerDisplayNameByUserId: Map<string, string>;
}): string | null {
  const ownerName = String(input.ownerName ?? "").trim();
  if (ownerName) {
    return ownerName;
  }

  const ownerUserId = String(input.ownerUserId ?? "").trim();
  if (!ownerUserId) {
    return null;
  }

  return input.ownerDisplayNameByUserId.get(ownerUserId) ?? null;
}
