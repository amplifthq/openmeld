import type { SignalEnvelope } from "@openmeld/protocol";
import type {
  DispatchResult,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceDispatchHistoryState } from "../read-projection/dispatch-history";
import { createSpaceMemberIdentityIndex } from "../read-projection/member-identity-index";
import {
  buildDispatchResultMessageReadProjection,
  buildSignalMessageReadProjection,
  resolveReplyToContext,
  type SpaceMessageReplyContext,
  type SpaceSignalIndex,
} from "../read-projection/message-read-projection";

type ReplyWorkflowTargetDispatchEvidence = {
  dispatchId: string;
  dispatchStatus: string;
  latestAttemptStatus: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  status: SpaceDispatchHistoryState;
  targetDisplayName: string | null;
  targetProfileId: string;
};

type ReplyWorkflowDispatchExecutionEvidence = {
  sourceSignalId: string | null;
  targetDispatches: readonly ReplyWorkflowTargetDispatchEvidence[];
};

type ReplyWorkflowPublicOutcome =
  | DispatchResult["publicOutcome"]
  | "post_message"
  | "post_status"
  | "system_notice"
  | "stay_silent";

type ReplyWorkflowPublishedSignalType =
  | "signal.text"
  | "signal.status"
  | "signal.system_notice";

export type SpaceReplyWorkflowProjection = {
  sourceSignalId: string | null;
  replyToSignalId: string | null;
  publicOutcome: ReplyWorkflowPublicOutcome | null;
  publishedSignalId: string | null;
  publishedSignalType: ReplyWorkflowPublishedSignalType | null;
  hasPublicSignal: boolean;
  hasPublicAgentReplyText: boolean;
  dispatchExecution: ReplyWorkflowDispatchExecutionEvidence | null;
  replyToContext: SpaceMessageReplyContext | null;
};

export function buildDispatchResultReplyWorkflowProjection(input: {
  dispatchExecution?: ReplyWorkflowDispatchExecutionEvidence | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  result: DispatchResult;
  signalIndex?: SpaceSignalIndex | null;
}): SpaceReplyWorkflowProjection {
  const messageReadProjection = buildDispatchResultMessageReadProjection({
    result: input.result,
    membersSnapshot: input.membersSnapshot ?? null,
    signalIndex: input.signalIndex ?? null,
  });

  return {
    sourceSignalId:
      normalizeOptionalText(input.dispatchExecution?.sourceSignalId) ??
      normalizeOptionalText(messageReadProjection.replyToSignalId),
    replyToSignalId: messageReadProjection.replyToSignalId,
    publicOutcome: input.result.publicOutcome,
    publishedSignalId: normalizeOptionalText(input.result.publishedSignalId),
    publishedSignalType: resolveDispatchResultPublishedSignalType(input.result),
    hasPublicSignal:
      normalizeOptionalText(input.result.publishedSignalId) !== null,
    hasPublicAgentReplyText: dispatchResultHasPublicAgentReplyText(
      input.result
    ),
    dispatchExecution: input.dispatchExecution ?? null,
    replyToContext: messageReadProjection.replyToContext,
  };
}

export function buildUpdatesReplyWorkflowProjection(input: {
  afterSignalId: string;
  dispatchExecution?: ReplyWorkflowDispatchExecutionEvidence | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
  signals: readonly SignalEnvelope[];
}): SpaceReplyWorkflowProjection | null {
  const memberIdentityIndex = createSpaceMemberIdentityIndex({
    snapshot: input.membersSnapshot ?? null,
    signals: input.signalIndex?.values() ?? null,
  });
  const publishedCandidate = selectBestPublishedReplyWorkflowCandidate({
    afterSignalId: input.afterSignalId,
    dispatchExecution: input.dispatchExecution ?? null,
    membersSnapshot: input.membersSnapshot ?? null,
    signalIndex: input.signalIndex ?? null,
    signals: input.signals,
  });
  if (publishedCandidate) {
    return publishedCandidate;
  }

  return buildPendingReplyWorkflowProjection({
    afterSignalId: input.afterSignalId,
    dispatchExecution: input.dispatchExecution ?? null,
    memberIdentityIndex,
    signalIndex: input.signalIndex ?? null,
  });
}

export function buildSignalReplyWorkflowProjection(input: {
  dispatchExecution?: ReplyWorkflowDispatchExecutionEvidence | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signal: SignalEnvelope;
  signalIndex?: SpaceSignalIndex | null;
}): SpaceReplyWorkflowProjection | null {
  const messageReadProjection = buildSignalMessageReadProjection({
    signal: input.signal,
    membersSnapshot: input.membersSnapshot ?? null,
    signalIndex: input.signalIndex ?? null,
  });
  const publishedSignalType = resolveSignalPublishedSignalType(input.signal);
  const publicOutcome = resolveSignalPublicOutcome(input.signal);
  const replyToSignalId = messageReadProjection.replyToSignalId;
  if (
    publishedSignalType === null ||
    publicOutcome === null ||
    replyToSignalId === null
  ) {
    return null;
  }

  return {
    sourceSignalId: replyToSignalId,
    replyToSignalId,
    publicOutcome,
    publishedSignalId: normalizeOptionalText(input.signal.id),
    publishedSignalType,
    hasPublicSignal: true,
    hasPublicAgentReplyText: input.signal.type === "signal.text",
    dispatchExecution: input.dispatchExecution ?? null,
    replyToContext: messageReadProjection.replyToContext,
  };
}

function selectBestPublishedReplyWorkflowCandidate(input: {
  afterSignalId: string;
  dispatchExecution: ReplyWorkflowDispatchExecutionEvidence | null;
  membersSnapshot: SpaceMembersSnapshot | null;
  signalIndex: SpaceSignalIndex | null;
  signals: readonly SignalEnvelope[];
}): SpaceReplyWorkflowProjection | null {
  const candidateSignals =
    input.signalIndex === null
      ? input.signals
      : [...input.signalIndex.values()];
  const dispatchIds = new Set(
    (input.dispatchExecution?.targetDispatches ?? []).map(
      (targetDispatch) => targetDispatch.dispatchId
    )
  );
  const hasDispatchEvidence = dispatchIds.size > 0;
  let bestCandidate: SpaceReplyWorkflowProjection | null = null;
  let bestRank = 0;

  for (const signal of candidateSignals) {
    const candidate = buildSignalReplyWorkflowProjection({
      dispatchExecution: input.dispatchExecution,
      membersSnapshot: input.membersSnapshot,
      signal,
      signalIndex: input.signalIndex,
    });
    if (!candidate) {
      continue;
    }

    const dispatchId = readSignalDispatchId(signal);
    const matchesDispatch = dispatchId !== null && dispatchIds.has(dispatchId);
    const matchesAnchor =
      !hasDispatchEvidence &&
      candidate.replyToSignalId === normalizeOptionalText(input.afterSignalId);
    if (!(matchesDispatch || matchesAnchor)) {
      continue;
    }

    const candidateRank = rankReplyWorkflowCandidate(candidate);
    if (candidateRank < bestRank) {
      continue;
    }

    bestCandidate = {
      ...candidate,
      sourceSignalId:
        normalizeOptionalText(input.afterSignalId) ?? candidate.sourceSignalId,
    };
    bestRank = candidateRank;
  }

  return bestCandidate;
}

function buildPendingReplyWorkflowProjection(input: {
  afterSignalId: string;
  dispatchExecution: ReplyWorkflowDispatchExecutionEvidence | null;
  memberIdentityIndex: ReturnType<typeof createSpaceMemberIdentityIndex>;
  signalIndex: SpaceSignalIndex | null;
}): SpaceReplyWorkflowProjection | null {
  const sourceSignalId = normalizeOptionalText(input.afterSignalId);
  const replyToContext =
    sourceSignalId === null
      ? null
      : resolveReplyToContext({
          replyToSignalId: sourceSignalId,
          signalIndex: input.signalIndex,
          memberIdentityIndex: input.memberIdentityIndex,
        });
  if (!(input.dispatchExecution || replyToContext)) {
    return null;
  }

  return {
    sourceSignalId,
    replyToSignalId: sourceSignalId,
    publicOutcome: null,
    publishedSignalId: null,
    publishedSignalType: null,
    hasPublicSignal: false,
    hasPublicAgentReplyText: false,
    dispatchExecution: input.dispatchExecution,
    replyToContext,
  };
}

function dispatchResultHasPublicAgentReplyText(
  result: DispatchResult
): boolean {
  return (
    result.publicOutcome === "post_message" ||
    result.publicOutcome === "raw_context_sharing"
  );
}

function resolveDispatchResultPublishedSignalType(
  result: DispatchResult
): ReplyWorkflowPublishedSignalType | null {
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

function resolveSignalPublicOutcome(
  signal: SignalEnvelope
): ReplyWorkflowPublicOutcome | null {
  switch (signal.type) {
    case "signal.text":
      return "post_message";
    case "signal.status":
      return "post_status";
    case "signal.system_notice":
      return readSystemNoticeType(signal) === "stay_silent"
        ? "stay_silent"
        : "system_notice";
    default:
      return null;
  }
}

function resolveSignalPublishedSignalType(
  signal: SignalEnvelope
): ReplyWorkflowPublishedSignalType | null {
  switch (signal.type) {
    case "signal.text":
    case "signal.status":
    case "signal.system_notice":
      return signal.type;
    default:
      return null;
  }
}

function rankReplyWorkflowCandidate(
  projection: SpaceReplyWorkflowProjection
): number {
  switch (projection.publicOutcome) {
    case "post_message":
    case "raw_context_sharing":
      return 4;
    case "post_status":
      return 3;
    case "stay_silent":
      return 2;
    case "system_notice":
      return 1;
    default:
      return 0;
  }
}

function readSignalDispatchId(signal: SignalEnvelope): string | null {
  switch (signal.type) {
    case "signal.text": {
      const meta = readSignalTextMeta(signal);
      return normalizeOptionalText(meta?.dispatchId);
    }
    case "signal.status":
    case "signal.system_notice":
      return normalizeOptionalText(signal.data.dispatchId);
    default:
      return null;
  }
}

function readSignalTextMeta(
  signal: Extract<SignalEnvelope, { type: "signal.text" }>
): Record<string, unknown> | null {
  if (
    !signal.data ||
    typeof signal.data !== "object" ||
    Array.isArray(signal.data)
  ) {
    return null;
  }
  const meta = (signal.data as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

function readSystemNoticeType(
  signal: Extract<SignalEnvelope, { type: "signal.system_notice" }>
): string | null {
  return normalizeOptionalText(signal.data.noticeType);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
