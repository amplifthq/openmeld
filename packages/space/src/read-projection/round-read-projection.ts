import type { SignalEnvelope } from "@openmeld/protocol";
import { sanitizeSignalTextPreview } from "@openmeld/schemas";
import type {
  DispatchResult,
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceDispatchHistoryState } from "./dispatch-history";
import {
  buildSignalMessageReadProjection,
  type SpaceMessageReadProjection,
  type SpaceMessageReadTargetRef,
  type SpaceMessageReadTargetResolutionReasonCode,
  type SpaceMessageReadTargetResolutionStatus,
  type SpaceSignalIndex,
} from "./message-read-projection";

export type SpaceRoundReadTargetRelation = "wake" | "reference";

export type SpaceRoundReadDispatchState =
  | "no_dispatch"
  | SpaceDispatchHistoryState;

export type SpaceRoundReadPublicOutcome =
  | DispatchResult["publicOutcome"]
  | "post_message"
  | "post_status"
  | "stay_silent"
  | "system_notice";

export type SpaceRoundReadPublishedSignalType =
  | "signal.text"
  | "signal.status"
  | "signal.system_notice";

export type SpaceRoundSignalPublication = {
  actorProfileId: string | null;
  dispatchId: string | null;
  publicOutcome: SpaceRoundReadPublicOutcome;
  replyToSignalId: string | null;
};

export type SpaceRoundReadTargetDispatchEvidence = {
  dispatchId: string;
  dispatchStatus: string;
  latestAttemptStatus: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  status: SpaceDispatchHistoryState;
  targetDisplayName: string | null;
  targetProfileId: string;
};

export type SpaceRoundReadDispatchExecutionEvidence = {
  sourceSignalId: string | null;
  targetDispatches: readonly SpaceRoundReadTargetDispatchEvidence[];
};

export type SpaceRoundReadTargetProjection = {
  profileId: string;
  profileKind: "human" | "agent" | "system" | null;
  displayName: string;
  relation: SpaceRoundReadTargetRelation;
  dispatchState: SpaceRoundReadDispatchState | null;
  dispatchId: string | null;
  dispatchStatus: string | null;
  latestAttemptStatus: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  publicOutcome: SpaceRoundReadPublicOutcome | null;
  resultRef: string | null;
  publishedSignalId: string | null;
  publishedSignalType: SpaceRoundReadPublishedSignalType | null;
  finalPreview: string | null;
  targetResolutionReasonCode: SpaceMessageReadTargetResolutionReasonCode | null;
  targetResolutionStatus: SpaceMessageReadTargetResolutionStatus | null;
};

export type SpaceRoundReadProjection = {
  sourceSignalId: string;
  sourceMessageReadProjection: SpaceMessageReadProjection | null;
  targets: readonly SpaceRoundReadTargetProjection[];
};

type MutableRoundReadTargetProjection = SpaceRoundReadTargetProjection;

type PublicationFact = {
  actorProfileId: string | null;
  dispatchId: string | null;
  finalPreview: string | null;
  publicOutcome: SpaceRoundReadPublicOutcome;
  publishedSignalId: string | null;
  publishedSignalType: SpaceRoundReadPublishedSignalType | null;
  rank: number;
  replyToSignalId: string | null;
  resultRef: string | null;
};

export function buildSpaceRoundReadProjection(input: {
  sourceSignalId: string;
  sourceSignal?: SignalEnvelope | null;
  signals?: readonly SignalEnvelope[];
  dispatchExecution?: SpaceRoundReadDispatchExecutionEvidence | null;
  dispatchResults?: readonly DispatchResult[];
  identityDirectory?: SpaceIdentityDirectory | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
}): SpaceRoundReadProjection {
  const sourceSignal =
    input.sourceSignal ??
    input.signalIndex?.get(normalizeRequiredText(input.sourceSignalId)) ??
    null;
  const sourceMessageReadProjection = sourceSignal
    ? buildSignalMessageReadProjection({
        signal: sourceSignal,
        identityDirectory: input.identityDirectory ?? null,
        membersSnapshot: input.membersSnapshot ?? null,
        signalIndex: input.signalIndex ?? null,
      })
    : null;
  const targets = buildInitialRoundTargets(sourceMessageReadProjection);

  applyDispatchExecutionEvidence({
    targets,
    dispatchExecution: input.dispatchExecution ?? null,
  });
  applyPublicationFacts({
    targets,
    facts: buildPublicationFacts({
      dispatchResults: input.dispatchResults ?? [],
      signals: input.signals ?? [],
    }),
    sourceSignalId: normalizeRequiredText(input.sourceSignalId),
  });

  return {
    sourceSignalId: normalizeRequiredText(input.sourceSignalId),
    sourceMessageReadProjection,
    targets,
  };
}

function buildInitialRoundTargets(
  sourceMessageReadProjection: SpaceMessageReadProjection | null
): MutableRoundReadTargetProjection[] {
  if (!sourceMessageReadProjection) {
    return [];
  }

  return [
    ...buildRelationTargets({
      dispatchState: null,
      relation: "wake",
      targets: sourceMessageReadProjection.wakeTargets,
    }),
    ...buildRelationTargets({
      dispatchState: "no_dispatch",
      relation: "reference",
      targets: sourceMessageReadProjection.referenceTargets,
    }),
  ];
}

function buildRelationTargets(input: {
  dispatchState: SpaceRoundReadDispatchState | null;
  relation: SpaceRoundReadTargetRelation;
  targets: readonly SpaceMessageReadTargetRef[];
}): MutableRoundReadTargetProjection[] {
  return input.targets.map((target) => ({
    profileId: target.profileId,
    profileKind: target.profileKind,
    displayName: target.displayName,
    relation: input.relation,
    targetResolutionReasonCode: target.resolutionReasonCode ?? null,
    targetResolutionStatus: target.resolutionStatus ?? null,
    dispatchState: input.dispatchState,
    dispatchId: null,
    dispatchStatus: null,
    latestAttemptStatus: null,
    reasonCode: null,
    reasonText: null,
    publicOutcome: null,
    resultRef: null,
    publishedSignalId: null,
    publishedSignalType: null,
    finalPreview: null,
  }));
}

function applyDispatchExecutionEvidence(input: {
  targets: MutableRoundReadTargetProjection[];
  dispatchExecution: SpaceRoundReadDispatchExecutionEvidence | null;
}): void {
  if (!input.dispatchExecution) {
    return;
  }

  for (const targetDispatch of input.dispatchExecution.targetDispatches) {
    const target =
      input.targets.find(
        (candidate) =>
          candidate.relation === "wake" &&
          candidate.profileId === targetDispatch.targetProfileId
      ) ??
      addDispatchOnlyWakeTarget({
        targets: input.targets,
        targetDispatch,
      });

    target.dispatchState = targetDispatch.status;
    target.dispatchId = targetDispatch.dispatchId;
    target.dispatchStatus = targetDispatch.dispatchStatus;
    target.latestAttemptStatus = targetDispatch.latestAttemptStatus;
    target.reasonCode = targetDispatch.reasonCode;
    target.reasonText = targetDispatch.reasonText;
  }
}

function addDispatchOnlyWakeTarget(input: {
  targets: MutableRoundReadTargetProjection[];
  targetDispatch: SpaceRoundReadTargetDispatchEvidence;
}): MutableRoundReadTargetProjection {
  const target: MutableRoundReadTargetProjection = {
    profileId: input.targetDispatch.targetProfileId,
    profileKind: null,
    displayName:
      normalizeOptionalText(input.targetDispatch.targetDisplayName) ??
      input.targetDispatch.targetProfileId,
    relation: "wake",
    dispatchState: null,
    dispatchId: null,
    dispatchStatus: null,
    latestAttemptStatus: null,
    reasonCode: null,
    reasonText: null,
    publicOutcome: null,
    resultRef: null,
    publishedSignalId: null,
    publishedSignalType: null,
    finalPreview: null,
    targetResolutionReasonCode: null,
    targetResolutionStatus: null,
  };
  input.targets.push(target);
  return target;
}

function applyPublicationFacts(input: {
  targets: MutableRoundReadTargetProjection[];
  facts: readonly PublicationFact[];
  sourceSignalId: string;
}): void {
  for (const target of input.targets) {
    const bestFact = selectBestPublicationFact({
      target,
      facts: input.facts,
      sourceSignalId: input.sourceSignalId,
    });
    if (!bestFact) {
      continue;
    }

    target.publicOutcome = bestFact.publicOutcome;
    target.resultRef = bestFact.resultRef;
    target.publishedSignalId = bestFact.publishedSignalId;
    target.publishedSignalType = bestFact.publishedSignalType;
    target.finalPreview = bestFact.finalPreview;
  }
}

function selectBestPublicationFact(input: {
  target: MutableRoundReadTargetProjection;
  facts: readonly PublicationFact[];
  sourceSignalId: string;
}): PublicationFact | null {
  let bestFact: PublicationFact | null = null;
  for (const fact of input.facts) {
    if (!publicationFactMatchesTarget({ ...input, fact })) {
      continue;
    }
    if (!bestFact || fact.rank > bestFact.rank) {
      bestFact = fact;
    }
  }
  return bestFact;
}

function publicationFactMatchesTarget(input: {
  target: MutableRoundReadTargetProjection;
  fact: PublicationFact;
  sourceSignalId: string;
}): boolean {
  if (input.target.dispatchId && input.fact.dispatchId) {
    return input.target.dispatchId === input.fact.dispatchId;
  }

  return (
    input.fact.replyToSignalId === input.sourceSignalId &&
    input.fact.actorProfileId === input.target.profileId
  );
}

function buildPublicationFacts(input: {
  dispatchResults: readonly DispatchResult[];
  signals: readonly SignalEnvelope[];
}): readonly PublicationFact[] {
  return [
    ...input.signals.flatMap((signal) => {
      const fact = buildSignalPublicationFact(signal);
      return fact ? [fact] : [];
    }),
    ...input.dispatchResults.map(buildDispatchResultPublicationFact),
  ];
}

function buildSignalPublicationFact(
  signal: SignalEnvelope
): PublicationFact | null {
  const publication = buildSpaceRoundSignalPublication(signal);
  if (!publication) {
    return null;
  }

  return {
    ...publication,
    finalPreview: readSignalFinalPreview(signal),
    publishedSignalId: normalizeOptionalText(signal.id),
    publishedSignalType: resolveSignalPublishedSignalType(signal),
    rank: rankPublicOutcome(publication.publicOutcome),
    resultRef: readSignalResultRef(signal),
  };
}

export function buildSpaceRoundSignalPublication(
  signal: SignalEnvelope
): SpaceRoundSignalPublication | null {
  const publicOutcome = resolveSignalPublicOutcome(signal);
  if (!publicOutcome) {
    return null;
  }
  return {
    actorProfileId: readSignalActorProfileId(signal),
    dispatchId: readSignalDispatchId(signal),
    publicOutcome,
    replyToSignalId: readSignalReplyToSignalId(signal),
  };
}

function buildDispatchResultPublicationFact(
  result: DispatchResult
): PublicationFact {
  return {
    actorProfileId: normalizeOptionalText(result.actorProfileId),
    dispatchId: normalizeOptionalText(result.dispatchId),
    finalPreview: sanitizeSignalTextPreview(
      result.previewText ?? result.finalText ?? result.statusType
    ),
    publicOutcome: result.publicOutcome,
    publishedSignalId: normalizeOptionalText(result.publishedSignalId),
    publishedSignalType: resolveDispatchResultPublishedSignalType(result),
    rank: rankPublicOutcome(result.publicOutcome) + 10,
    replyToSignalId: normalizeOptionalText(result.replyToSignalId),
    resultRef: normalizeOptionalText(result.resultRef),
  };
}

function resolveSignalPublicOutcome(
  signal: SignalEnvelope
): SpaceRoundReadPublicOutcome | null {
  switch (signal.type) {
    case "signal.text":
      return "post_message";
    case "signal.status":
      return "post_status";
    case "signal.system_notice":
      return signal.data.noticeType === "stay_silent"
        ? "stay_silent"
        : "system_notice";
    default:
      return null;
  }
}

function resolveSignalPublishedSignalType(
  signal: SignalEnvelope
): SpaceRoundReadPublishedSignalType | null {
  switch (signal.type) {
    case "signal.text":
    case "signal.status":
    case "signal.system_notice":
      return signal.type;
    default:
      return null;
  }
}

function resolveDispatchResultPublishedSignalType(
  result: DispatchResult
): SpaceRoundReadPublishedSignalType | null {
  switch (result.publicOutcome) {
    case "post_message":
    case "raw_context_sharing":
      return "signal.text";
    case "post_status":
      return "signal.status";
    case "stay_silent":
    case "system_notice":
      return "signal.system_notice";
    default:
      return null;
  }
}

function readSignalActorProfileId(signal: SignalEnvelope): string | null {
  switch (signal.type) {
    case "signal.text":
      return normalizeOptionalText(signal.profile?.profileId);
    case "signal.status":
      return normalizeOptionalText(signal.data.actorProfileId);
    case "signal.system_notice":
      return (
        normalizeOptionalText(signal.data.actorProfileId) ??
        normalizeOptionalText(signal.profile?.profileId)
      );
    default:
      return null;
  }
}

function readSignalDispatchId(signal: SignalEnvelope): string | null {
  switch (signal.type) {
    case "signal.text":
      return readSignalTextMetaDispatchId(signal);
    case "signal.status":
    case "signal.system_notice":
      return normalizeOptionalText(signal.data.dispatchId);
    default:
      return null;
  }
}

function readSignalTextMetaDispatchId(
  signal: Extract<SignalEnvelope, { type: "signal.text" }>
): string | null {
  const meta = signal.data.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return normalizeOptionalText(meta.dispatchId);
}

function readSignalFinalPreview(signal: SignalEnvelope): string | null {
  switch (signal.type) {
    case "signal.text":
    case "signal.status":
    case "signal.system_notice":
      return sanitizeSignalTextPreview(signal.data.text);
    default:
      return null;
  }
}

function readSignalReplyToSignalId(signal: SignalEnvelope): string | null {
  switch (signal.type) {
    case "signal.text":
      return normalizeOptionalText(
        signal.data.messageEnvelope?.replyToSignalId ??
          signal.data.replyTo?.signalId
      );
    case "signal.status":
    case "signal.system_notice":
      return normalizeOptionalText(signal.data.replyTo?.signalId);
    default:
      return null;
  }
}

function readSignalResultRef(signal: SignalEnvelope): string | null {
  switch (signal.type) {
    case "signal.status":
    case "signal.system_notice":
      return normalizeOptionalText(signal.data.resultRef);
    default:
      return null;
  }
}

function rankPublicOutcome(outcome: SpaceRoundReadPublicOutcome): number {
  switch (outcome) {
    case "post_message":
    case "raw_context_sharing":
      return 4;
    case "post_status":
      return 3;
    case "stay_silent":
      return 2;
    case "system_notice":
      return 1;
    case "internal_only":
      return 0;
    default:
      return 0;
  }
}

function normalizeRequiredText(value: string): string {
  const normalized = String(value).trim();
  if (normalized.length === 0) {
    throw new Error("sourceSignalId is required");
  }
  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
