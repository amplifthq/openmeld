import type { SignalEnvelope, SignalTextReplyTo } from "@openmeld/protocol";
import {
  type NavigationAction,
  normalizeMessageEnvelope,
  sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import type {
  DispatchResult,
  MessageEnvelope,
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
  SpaceMessageReactions,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import {
  createSpaceMemberIdentityIndex,
  type SpaceMemberIdentityIndex,
} from "./member-identity-index";

export type SpaceMessageReadTargetRef = {
  profileId: string;
  profileKind: "human" | "agent" | "system" | null;
  displayName: string;
  displaySource:
    | "identity_directory"
    | "member_snapshot"
    | "signal_history"
    | "profile_id";
  resolutionReasonCode?: SpaceMessageReadTargetResolutionReasonCode;
  resolutionStatus?: SpaceMessageReadTargetResolutionStatus;
};

export type SpaceMessageReadRelationSummary = {
  relation: "wake" | "reference" | "mention";
  targets: readonly SpaceMessageReadTargetRef[];
};

export type SpaceMessageReadTargetResolutionReasonCode =
  | "addressing.target_kind_unresolved"
  | "addressing.target_stale_signal_history"
  | "addressing.target_unresolved";

export type SpaceMessageReadTargetResolutionStatus = "stale" | "unresolved";

export type SpaceMessageReplyContext = {
  signalId: string;
  actorProfileId: string | null;
  actorProfileKind: "human" | "agent" | "system" | null;
  actorDisplayName: string | null;
  previewText: string | null;
  relationSummary: readonly SpaceMessageReadRelationSummary[] | null;
  resolved: boolean;
};

export type SpaceMessageThreadRef = SpaceThreadContext;

export type SpaceMessageReadProjection = {
  reactions?: SpaceMessageReactions;
  navigationAction: NavigationAction | null;
  text: string;
  threadRef: SpaceMessageThreadRef | null;
  wakeTargets: readonly SpaceMessageReadTargetRef[];
  referenceTargets: readonly SpaceMessageReadTargetRef[];
  mentionTargets: readonly SpaceMessageReadTargetRef[];
  replyToSignalId: string | null;
  replyToContext: SpaceMessageReplyContext | null;
};

export type SpaceSignalIndex = ReadonlyMap<string, SignalEnvelope>;

export function buildSignalIndex(
  events: readonly SignalEnvelope[]
): SpaceSignalIndex {
  return new Map(events.map((event) => [event.id, event] as const));
}

export function buildSignalMessageReadProjection(input: {
  signal: SignalEnvelope;
  identityDirectory?: SpaceIdentityDirectory | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
  threadRef?: SpaceMessageThreadRef | null;
}): SpaceMessageReadProjection {
  const memberIdentityIndex = buildMemberIdentityIndex(
    input.identityDirectory ?? null,
    input.membersSnapshot ?? null,
    input.signalIndex ?? null
  );
  const envelope = readSignalMessageEnvelope(input.signal);
  const replyTo = readSignalReplyTo(input.signal);
  const replyToSignalId = normalizeOptionalText(
    envelope?.replyToSignalId ?? replyTo?.signalId
  );

  return {
    navigationAction: envelope?.navigationAction ?? null,
    text: readSignalText(input.signal),
    ...(input.signal.type === "signal.text" && input.signal.reactions
      ? { reactions: input.signal.reactions }
      : {}),
    threadRef: input.threadRef ?? null,
    wakeTargets: resolveTargetRefs(
      envelope?.activationTargets,
      memberIdentityIndex
    ),
    referenceTargets: resolveTargetRefs(
      envelope?.referenceTargets,
      memberIdentityIndex
    ),
    mentionTargets: resolveTargetRefs(
      envelope?.mentionTargets,
      memberIdentityIndex
    ),
    replyToSignalId,
    replyToContext: resolveReplyToContext({
      replyToSignalId,
      signalIndex: input.signalIndex ?? null,
      memberIdentityIndex,
      fallbackReplyTo: replyTo,
    }),
  };
}

export function buildDispatchResultMessageReadProjection(input: {
  result: DispatchResult;
  identityDirectory?: SpaceIdentityDirectory | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
}): SpaceMessageReadProjection {
  const memberIdentityIndex = buildMemberIdentityIndex(
    input.identityDirectory ?? null,
    input.membersSnapshot ?? null,
    input.signalIndex ?? null
  );
  const envelope = input.result.messageEnvelope
    ? normalizeMessageEnvelope(input.result.messageEnvelope)
    : null;
  const replyToSignalId = normalizeOptionalText(
    envelope?.replyToSignalId ?? input.result.replyToSignalId
  );

  return {
    navigationAction: envelope?.navigationAction ?? null,
    text: normalizeOptionalText(envelope?.text ?? input.result.finalText) ?? "",
    threadRef: input.result.threadContext ?? null,
    wakeTargets: resolveTargetRefs(
      envelope?.activationTargets,
      memberIdentityIndex
    ),
    referenceTargets: resolveTargetRefs(
      envelope?.referenceTargets,
      memberIdentityIndex
    ),
    mentionTargets: resolveTargetRefs(
      envelope?.mentionTargets,
      memberIdentityIndex
    ),
    replyToSignalId,
    replyToContext: resolveReplyToContext({
      replyToSignalId,
      signalIndex: input.signalIndex ?? null,
      memberIdentityIndex,
    }),
  };
}

export function resolveReplyToContext(input: {
  replyToSignalId: string | null | undefined;
  signalIndex?: SpaceSignalIndex | null;
  memberIdentityIndex?: SpaceMemberIdentityIndex | null;
  fallbackReplyTo?: SignalTextReplyTo | null;
}): SpaceMessageReplyContext | null {
  const signalId = normalizeOptionalText(input.replyToSignalId);
  if (!signalId) {
    return null;
  }

  const referencedSignal = input.signalIndex?.get(signalId) ?? null;
  if (referencedSignal) {
    return {
      signalId,
      actorProfileId: normalizeOptionalText(
        referencedSignal.profile?.profileId
      ),
      actorProfileKind: normalizeProfileKind(referencedSignal.profile?.kind),
      actorDisplayName: resolveReplyActorDisplayName({
        actorProfileId: normalizeOptionalText(
          referencedSignal.profile?.profileId
        ),
        actorProfileName: normalizeOptionalText(
          referencedSignal.profile?.profileName
        ),
        memberIdentityIndex: input.memberIdentityIndex ?? null,
      }),
      previewText: sanitizeSignalTextPreview(readSignalText(referencedSignal)),
      relationSummary: buildSignalRelationSummary({
        signal: referencedSignal,
        memberIdentityIndex: input.memberIdentityIndex ?? null,
      }),
      resolved: true,
    };
  }

  const fallbackReplyTo = input.fallbackReplyTo ?? null;
  if (
    fallbackReplyTo &&
    normalizeOptionalText(fallbackReplyTo.signalId) === signalId
  ) {
    return {
      signalId,
      actorProfileId: normalizeOptionalText(fallbackReplyTo.profileId),
      actorProfileKind: normalizeProfileKind(fallbackReplyTo.profileKind),
      actorDisplayName: resolveReplyActorDisplayName({
        actorProfileId: normalizeOptionalText(fallbackReplyTo.profileId),
        actorProfileName: normalizeOptionalText(fallbackReplyTo.profileName),
        memberIdentityIndex: input.memberIdentityIndex ?? null,
      }),
      previewText: normalizeOptionalText(fallbackReplyTo.previewText),
      relationSummary: null,
      resolved: false,
    };
  }

  return {
    signalId,
    actorProfileId: null,
    actorProfileKind: null,
    actorDisplayName: null,
    previewText: null,
    relationSummary: null,
    resolved: false,
  };
}

export function buildSpaceMessageReadRelationSummary(input: {
  wakeTargets: readonly SpaceMessageReadTargetRef[];
  referenceTargets: readonly SpaceMessageReadTargetRef[];
  mentionTargets: readonly SpaceMessageReadTargetRef[];
}): readonly SpaceMessageReadRelationSummary[] {
  const summary: SpaceMessageReadRelationSummary[] = [];
  if (input.wakeTargets.length > 0) {
    summary.push({
      relation: "wake",
      targets: input.wakeTargets,
    });
  }
  if (input.referenceTargets.length > 0) {
    summary.push({
      relation: "reference",
      targets: input.referenceTargets,
    });
  }
  if (input.mentionTargets.length > 0) {
    summary.push({
      relation: "mention",
      targets: input.mentionTargets,
    });
  }
  return summary;
}

function readSignalMessageEnvelope(
  signal: SignalEnvelope
): MessageEnvelope | null {
  if (signal.type !== "signal.text") {
    return null;
  }
  const messageEnvelope = signal.data.messageEnvelope;
  return messageEnvelope && typeof messageEnvelope === "object"
    ? normalizeMessageEnvelope(messageEnvelope)
    : null;
}

function readSignalReplyTo(signal: SignalEnvelope): SignalTextReplyTo | null {
  if (
    signal.type !== "signal.text" &&
    signal.type !== "signal.status" &&
    signal.type !== "signal.system_notice"
  ) {
    return null;
  }
  const replyTo = signal.data.replyTo;
  return replyTo && typeof replyTo === "object" ? replyTo : null;
}

function readSignalText(signal: SignalEnvelope): string {
  if (
    signal.type === "signal.text" ||
    signal.type === "signal.status" ||
    signal.type === "signal.system_notice"
  ) {
    return normalizeOptionalText(signal.data.text) ?? "";
  }
  return "";
}

function buildSignalRelationSummary(input: {
  signal: SignalEnvelope;
  memberIdentityIndex: SpaceMemberIdentityIndex | null;
}): readonly SpaceMessageReadRelationSummary[] | null {
  const envelope = readSignalMessageEnvelope(input.signal);
  if (!envelope) {
    return null;
  }
  const summary = buildSpaceMessageReadRelationSummary({
    wakeTargets: resolveTargetRefs(
      envelope.activationTargets,
      input.memberIdentityIndex
    ),
    referenceTargets: resolveTargetRefs(
      envelope.referenceTargets,
      input.memberIdentityIndex
    ),
    mentionTargets: resolveTargetRefs(
      envelope.mentionTargets,
      input.memberIdentityIndex
    ),
  });
  return summary.length > 0 ? summary : null;
}

function resolveTargetRefs(
  targetProfileIds: readonly string[] | undefined,
  memberIdentityIndex: SpaceMemberIdentityIndex | null | undefined
): readonly SpaceMessageReadTargetRef[] {
  if (!(targetProfileIds && targetProfileIds.length > 0)) {
    return [];
  }
  return targetProfileIds.map((profileId) =>
    resolveTargetRef(profileId, memberIdentityIndex ?? null)
  );
}

function resolveTargetRef(
  profileId: string,
  memberIdentityIndex: SpaceMemberIdentityIndex | null
): SpaceMessageReadTargetRef {
  const target = resolveTargetByProfileId(profileId, memberIdentityIndex);
  if (!target) {
    return {
      profileId,
      profileKind: null,
      displayName: profileId,
      displaySource: "profile_id",
      resolutionReasonCode: "addressing.target_unresolved",
      resolutionStatus: "unresolved",
    };
  }

  return {
    profileId,
    profileKind: target.profileKind,
    displayName: target.profileName,
    displaySource: target.source,
    ...resolveTargetResolution(target),
  };
}

function resolveTargetResolution(
  target: NonNullable<
    ReturnType<SpaceMemberIdentityIndex["byProfileId"]["get"]>
  >
): Pick<
  SpaceMessageReadTargetRef,
  "resolutionReasonCode" | "resolutionStatus"
> {
  if (target.profileKind === null) {
    return {
      resolutionReasonCode: "addressing.target_kind_unresolved",
      resolutionStatus: "unresolved",
    };
  }

  if (target.source === "signal_history") {
    return {
      resolutionReasonCode: "addressing.target_stale_signal_history",
      resolutionStatus: "stale",
    };
  }

  return {};
}

function resolveReplyActorDisplayName(input: {
  actorProfileId: string | null;
  actorProfileName: string | null;
  memberIdentityIndex: SpaceMemberIdentityIndex | null;
}): string | null {
  if (input.actorProfileId) {
    const target = resolveTargetByProfileId(
      input.actorProfileId,
      input.memberIdentityIndex
    );
    if (target) {
      return target.profileName;
    }
  }

  return input.actorProfileName ?? input.actorProfileId ?? null;
}

function resolveTargetByProfileId(
  profileId: string,
  memberIdentityIndex: SpaceMemberIdentityIndex | null
): ReturnType<SpaceMemberIdentityIndex["byProfileId"]["get"]> | null {
  if (!memberIdentityIndex) {
    return null;
  }

  return memberIdentityIndex.byProfileId.get(profileId) ?? null;
}

function buildMemberIdentityIndex(
  identityDirectory: SpaceIdentityDirectory | null,
  membersSnapshot: SpaceMembersSnapshot | null,
  signalIndex: SpaceSignalIndex | null
): SpaceMemberIdentityIndex | null {
  if (!(identityDirectory || membersSnapshot || signalIndex)) {
    return null;
  }

  return createSpaceMemberIdentityIndex({
    identityDirectory,
    snapshot: identityDirectory ? null : membersSnapshot,
    signals: signalIndex ? signalIndex.values() : null,
  });
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeProfileKind(
  value: string | null | undefined
): "human" | "agent" | "system" | null {
  return value === "human" || value === "agent" || value === "system"
    ? value
    : null;
}
