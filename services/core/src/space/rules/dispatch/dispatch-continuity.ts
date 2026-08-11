import type { SignalEnvelope } from "@openmeld/protocol";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { isViewerAncestorOfTargetProfile } from "../privacy/agent-profile-visibility";

type CreatorProfileIdByProfileId =
  | ReadonlyMap<string, string | null>
  | Readonly<Record<string, string | null | undefined>>;

type ActiveMemberOwnerSnapshot = {
  ownerUserIdSnapshot: string | null;
};

type OwnerCreatorProfileIdsByOwnerUserId = ReadonlyMap<
  string,
  CreatorProfileIdByProfileId
>;

export function buildDispatchContinuitySnapshot(input: {
  signals: SignalEnvelope[];
  targetProfileId: string;
  creatorProfileIdByProfileId?: CreatorProfileIdByProfileId;
}): OpenMeldDaemonDispatchQueueMessage["continuitySnapshot"] {
  const lastPublicReplyIndex = findLastPublicReplyIndex({
    signals: input.signals,
    targetProfileId: input.targetProfileId,
  });
  const signalsSinceThen =
    lastPublicReplyIndex >= 0
      ? input.signals.slice(lastPublicReplyIndex + 1)
      : input.signals;

  let messagesSinceThen = 0;
  let higherAuthorityUpdates = false;
  for (const signal of signalsSinceThen) {
    if (!isPublicContinuitySignal(signal)) {
      continue;
    }
    messagesSinceThen += 1;
    if (
      !higherAuthorityUpdates &&
      isHigherAuthorityContinuitySignal({
        signal,
        targetProfileId: input.targetProfileId,
        creatorProfileIdByProfileId: input.creatorProfileIdByProfileId,
      })
    ) {
      higherAuthorityUpdates = true;
    }
  }

  return {
    messagesSinceThen,
    higherAuthorityUpdates,
  };
}

export function resolveDispatchContinuitySnapshotForDecision(input: {
  activeMemberByProfileId: ReadonlyMap<string, ActiveMemberOwnerSnapshot>;
  ownerCreatorProfileIdsByOwnerUserId?: OwnerCreatorProfileIdsByOwnerUserId;
  recentSignals: SignalEnvelope[];
  targetProfileId: string;
}): OpenMeldDaemonDispatchQueueMessage["continuitySnapshot"] {
  const targetOwnerUserId =
    input.activeMemberByProfileId.get(input.targetProfileId)
      ?.ownerUserIdSnapshot ?? null;
  const creatorProfileIdByProfileId =
    targetOwnerUserId && input.ownerCreatorProfileIdsByOwnerUserId
      ? input.ownerCreatorProfileIdsByOwnerUserId.get(targetOwnerUserId)
      : undefined;

  return buildDispatchContinuitySnapshot({
    signals: input.recentSignals,
    targetProfileId: input.targetProfileId,
    creatorProfileIdByProfileId,
  });
}

export function isPublicContinuitySignal(signal: SignalEnvelope): boolean {
  if (signal.type === "signal.status") {
    return signal.profile.kind !== "system";
  }
  if (signal.type !== "signal.text") {
    return false;
  }
  if (signal.profile.kind === "system") {
    return false;
  }

  const signalData = toSignalDataRecord(signal.data);
  const signalMeta = toSignalMetaRecord(signalData?.meta);
  return signalMeta?.transient !== true;
}

export function isHigherAuthorityContinuitySignal(input: {
  signal: SignalEnvelope;
  targetProfileId: string;
  creatorProfileIdByProfileId?: CreatorProfileIdByProfileId;
}): boolean {
  if (input.signal.profile.kind !== "human") {
    return false;
  }

  return isViewerAncestorOfTargetProfile({
    viewerProfileId: input.signal.profile.profileId,
    targetProfileId: input.targetProfileId,
    creatorProfileIdByProfileId: input.creatorProfileIdByProfileId,
  });
}

function findLastPublicReplyIndex(input: {
  signals: SignalEnvelope[];
  targetProfileId: string;
}): number {
  for (let index = input.signals.length - 1; index >= 0; index -= 1) {
    const signal = input.signals[index];
    if (!signal || signal.profile.profileId !== input.targetProfileId) {
      continue;
    }
    if (isPublicContinuitySignal(signal)) {
      return index;
    }
  }
  return -1;
}

function toSignalDataRecord(value: unknown): { meta?: unknown } | null {
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    return null;
  }
  return value as { meta?: unknown };
}

function toSignalMetaRecord(value: unknown): { transient?: boolean } | null {
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    return null;
  }
  return value as { transient?: boolean };
}
