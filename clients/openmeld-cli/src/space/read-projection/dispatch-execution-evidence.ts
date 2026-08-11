import type { SignalEnvelope } from "@openmeld/protocol";
import type {
  GetSpaceDispatchLookupResponse,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  buildSignalMessageReadProjection,
  createSpaceMemberIdentityIndex,
  type SpaceDispatchHistoryState,
  type SpaceSignalIndex,
} from "@openmeld/space";

export type DispatchExecutionStatus = SpaceDispatchHistoryState;

export type TargetDispatchExecutionEvidence = {
  dispatchId: string;
  dispatchStatus: string;
  latestAttemptStatus: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  status: DispatchExecutionStatus;
  targetDisplayName: string | null;
  targetProfileId: string;
};

export type DispatchExecutionEvidence = {
  sourceSignalId: string | null;
  targetDispatches: readonly TargetDispatchExecutionEvidence[];
};

const DISPATCH_RECORDED_LEDGER_STATES = new Set([
  "queued",
  "dispatching",
  "succeeded",
  "deduped",
]);

// CLI execution-surface adapter: summarize dispatch lookup/trace state for
// updates/result surfaces without re-owning shared member/read semantics.
export function buildSignalDispatchExecutionEvidence(input: {
  lookup: GetSpaceDispatchLookupResponse | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
  sourceSignal?: SignalEnvelope | null;
}): DispatchExecutionEvidence | null {
  const matches = input.lookup?.matches ?? [];
  if (matches.length === 0) {
    return null;
  }

  const orderedTargetProfileIds = readOrderedTargetProfileIds(
    input.sourceSignal
  );
  const targetDisplayNameByProfileId = buildTargetDisplayNameByProfileId({
    membersSnapshot: input.membersSnapshot ?? null,
    signalIndex: input.signalIndex ?? null,
    sourceSignal: input.sourceSignal ?? null,
  });

  return {
    sourceSignalId: normalizeOptionalText(
      input.sourceSignal?.id ?? input.lookup?.query.sourceSignalId
    ),
    targetDispatches: orderDispatchMatches({
      matches,
      orderedTargetProfileIds,
    }).map((match) => ({
      dispatchId: match.dispatchId,
      dispatchStatus: match.status,
      latestAttemptStatus: match.latestAttemptStatus,
      reasonCode: match.latestAttemptErrorCode,
      reasonText: match.latestAttemptErrorMessage,
      status: toDispatchExecutionStatus(match.status),
      targetDisplayName:
        targetDisplayNameByProfileId.get(match.targetProfileId) ?? null,
      targetProfileId: match.targetProfileId,
    })),
  };
}

function buildTargetDisplayNameByProfileId(input: {
  membersSnapshot: SpaceMembersSnapshot | null;
  signalIndex: SpaceSignalIndex | null;
  sourceSignal: SignalEnvelope | null;
}): Map<string, string> {
  const namesByProfileId = new Map<string, string>();
  if (input.sourceSignal) {
    const projection = buildSignalMessageReadProjection({
      signal: input.sourceSignal,
      membersSnapshot: input.membersSnapshot,
      signalIndex: input.signalIndex,
    });
    for (const target of projection.wakeTargets) {
      namesByProfileId.set(target.profileId, target.displayName);
    }
  }

  const memberIdentityIndex = createSpaceMemberIdentityIndex({
    snapshot: input.membersSnapshot,
    signals: input.signalIndex?.values() ?? null,
  });
  for (const [profileId, entry] of memberIdentityIndex.byProfileId) {
    if (!namesByProfileId.has(profileId)) {
      namesByProfileId.set(profileId, entry.profileName);
    }
  }
  return namesByProfileId;
}

function orderDispatchMatches(input: {
  matches: GetSpaceDispatchLookupResponse["matches"];
  orderedTargetProfileIds: readonly string[];
}): GetSpaceDispatchLookupResponse["matches"] {
  if (input.orderedTargetProfileIds.length === 0) {
    return [...input.matches];
  }

  const orderByTargetProfileId = new Map(
    input.orderedTargetProfileIds.map((profileId, index) => [profileId, index])
  );
  return [...input.matches].sort((left, right) => {
    const leftIndex =
      orderByTargetProfileId.get(left.targetProfileId) ??
      Number.MAX_SAFE_INTEGER;
    const rightIndex =
      orderByTargetProfileId.get(right.targetProfileId) ??
      Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.dispatchId.localeCompare(right.dispatchId);
  });
}

function readOrderedTargetProfileIds(
  sourceSignal: SignalEnvelope | null | undefined
): readonly string[] {
  if (sourceSignal?.type !== "signal.text") {
    return [];
  }
  return sourceSignal.data.messageEnvelope?.activationTargets ?? [];
}

function toDispatchExecutionStatus(
  dispatchStatus: string
): DispatchExecutionStatus {
  switch (dispatchStatus) {
    case "queued":
    case "dispatching":
    case "succeeded":
    case "deduped":
      return "dispatch_recorded";
    case "blocked":
      return "blocked";
    case "failed_retryable":
      return "retrying";
    case "failed_terminal":
      return "failed";
    case "cancelled":
      return "stopped";
    default:
      console.warn("[openmeld.space.dispatch_execution.status.unknown]", {
        dispatchStatus,
        knownDispatchRecordedStates: [...DISPATCH_RECORDED_LEDGER_STATES],
      });
      return "unknown";
  }
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
