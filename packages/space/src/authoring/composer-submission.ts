import {
  MESSAGE_MENTION_TYPE_VALUES,
  type MessageEnvelope,
  type MessageMentionType,
  normalizeMessageEnvelope,
  resolveMessageEnvelopeTargetField,
} from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { createSpaceTargetCatalog } from "../target-identity/target-catalog";

const CANONICAL_MENTION_TYPES = new Set<MessageMentionType>(
  MESSAGE_MENTION_TYPE_VALUES
);
const DUPLICATE_TARGET_ISSUE_PATTERN =
  /^(activationTargets|referenceTargets|mentionTargets) must not contain duplicate profileId$/u;
const DISTINCT_TARGET_ISSUE_PATTERN =
  /^(activationTargets|referenceTargets|mentionTargets) must not reuse profileId from (activationTargets|referenceTargets|mentionTargets)$/u;
const MISSING_MENTION_TARGET_GUIDANCE =
  "That mention does not match a current member. Type @ and choose a member from the list.";
const INVALID_MENTION_ACTION_GUIDANCE =
  "Mention action must be Wake, Reference, or Mention. Type @ and choose from the list.";
export function formatRemovedCcRelationMessage(
  replacement: "Reference" | "--reference"
): string {
  return `CC has been removed from Space Message Addressing. Use ${replacement} instead.`;
}

type MessageTargetField = keyof Pick<
  MessageEnvelope,
  "activationTargets" | "referenceTargets" | "mentionTargets"
>;

type MessageEnvelopeInput = {
  activationTargets: string[];
  referenceTargets: string[];
  mentionTargets: string[];
  replyToSignalId?: string;
  text: string;
};

export type SpaceAuthoredMentionInTextOrder = {
  profileId: string;
  text: string;
  type: MessageMentionType;
};

export type SpaceComposerAuthoredMentionInTextOrder = {
  profileId: string;
  relation: MessageMentionType;
  start?: number;
  text: string;
};

type PositionedSpaceComposerAuthoredMention =
  SpaceComposerAuthoredMentionInTextOrder & {
    start: number;
  };

type StructuredMentionCandidate = {
  text: string;
  profileId: string;
  relation: MessageMentionType;
  sequence: number;
  start: number;
};

export type SpaceResolvedStructuredTargetSet = {
  mentionsInTextOrder: readonly SpaceAuthoredMentionInTextOrder[];
  profileIdsInTextOrder: readonly string[];
};

export type SpaceComposerReplyTarget = {
  signalId: string;
};

export type PreparedSpaceComposerSubmission = {
  threadWakeContinuation?: true;
  authoredMentionsInTextOrder: readonly SpaceComposerAuthoredMentionInTextOrder[];
  mentionsInTextOrder: readonly SpaceAuthoredMentionInTextOrder[];
  hasStructuredTargets: boolean;
  messageEnvelope: MessageEnvelope | null;
  replyTo: SpaceComposerReplyTarget | null;
  resolvedStructuredTargets: SpaceResolvedStructuredTargetSet;
  text: string;
};

export type SpaceComposerSubmissionErrorCode =
  | "addressing.duplicate_target"
  | "addressing.invalid_message_envelope"
  | "addressing.invalid_reply_target"
  | "addressing.members_snapshot_missing"
  | "addressing.relation_incompatible"
  | "addressing.target_kind_unresolved"
  | "addressing.target_not_in_current_space"
  | "addressing.target_reused_across_relations"
  | "addressing.wake_blocked";

export class SpaceComposerSubmissionError extends Error {
  readonly targetProfileId: string | null;

  readonly code: SpaceComposerSubmissionErrorCode;

  constructor(input: {
    code: SpaceComposerSubmissionErrorCode;
    message: string;
    targetProfileId?: string | null;
  }) {
    super(input.message);
    this.name = "SpaceComposerSubmissionError";
    this.code = input.code;
    this.targetProfileId = normalizeOptionalText(input.targetProfileId);
  }
}

const SPACE_COMPOSER_SUBMISSION_ERROR_CODES = new Set<string>([
  "addressing.duplicate_target",
  "addressing.invalid_message_envelope",
  "addressing.invalid_reply_target",
  "addressing.members_snapshot_missing",
  "addressing.relation_incompatible",
  "addressing.target_kind_unresolved",
  "addressing.target_not_in_current_space",
  "addressing.target_reused_across_relations",
  "addressing.wake_blocked",
]);

export function isSpaceComposerSubmissionError(
  error: unknown
): error is SpaceComposerSubmissionError {
  return (
    error instanceof SpaceComposerSubmissionError ||
    (error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      SPACE_COMPOSER_SUBMISSION_ERROR_CODES.has(error.code))
  );
}

export function prepareSpaceComposerSubmission(input: {
  authoredMentionsInTextOrder?: readonly SpaceComposerAuthoredMentionInTextOrder[];
  missingSnapshotMessage: string;
  replyTo?: SpaceComposerReplyTarget | null;
  snapshot: SpaceMembersSnapshot | null;
  text: string;
}): PreparedSpaceComposerSubmission {
  const authoredMentionsInTextOrder = normalizeAuthoredMentionsInTextOrder({
    mentions: input.authoredMentionsInTextOrder,
    text: input.text,
  });
  const replyToSignalId = normalizeReplyToSignalId(input.replyTo);
  const replyTo = replyToSignalId ? { signalId: replyToSignalId } : null;

  if (authoredMentionsInTextOrder.length === 0) {
    const normalizedText = normalizePlainTextOrThrow(input.text);
    const messageEnvelope = createMessageEnvelopeOrNull({
      activationTargets: [],
      referenceTargets: [],
      mentionTargets: [],
      ...(replyToSignalId ? { replyToSignalId } : {}),
      text: normalizedText,
    });
    return {
      authoredMentionsInTextOrder: [],
      mentionsInTextOrder: [],
      hasStructuredTargets: false,
      messageEnvelope,
      replyTo,
      resolvedStructuredTargets: emptyResolvedStructuredTargets(),
      text: normalizedText,
    };
  }

  if (!input.snapshot) {
    throw createSubmissionError(
      "addressing.members_snapshot_missing",
      input.missingSnapshotMessage
    );
  }

  validateSnapshotTargetKindsOrThrow(input.snapshot);

  const catalog = createSpaceTargetCatalog(input.snapshot);
  const envelopeInput = createEnvelopeInput(input.text, replyToSignalId);
  const profileIdsInTextOrder: string[] = [];
  const structuredTargetProfileIds = new Set<string>();
  const structuredMentionCandidates: StructuredMentionCandidate[] = [];

  for (const authoredMention of authoredMentionsInTextOrder) {
    const target = catalog.byProfileId.get(authoredMention.profileId);
    if (!target) {
      throw createSubmissionError(
        "addressing.target_not_in_current_space",
        MISSING_MENTION_TARGET_GUIDANCE
      );
    }

    if (!target.allowedRelations[authoredMention.relation]) {
      throw createSubmissionError(
        "addressing.relation_incompatible",
        buildInvalidMentionRelationMessage({
          mentionText: authoredMention.text,
          relation: authoredMention.relation,
        })
      );
    }

    structuredMentionCandidates.push({
      profileId: target.profileId,
      relation: authoredMention.relation,
      sequence: structuredMentionCandidates.length,
      text: authoredMention.text,
      start: authoredMention.start,
    });
  }

  const resolvedMentionsInTextOrder = appendStructuredMentionCandidates({
    candidates: structuredMentionCandidates,
    envelopeInput,
    profileIdsInTextOrder,
    structuredTargetProfileIds,
  });

  const messageEnvelope = createMessageEnvelopeOrNull(envelopeInput);
  return {
    authoredMentionsInTextOrder,
    mentionsInTextOrder: resolvedMentionsInTextOrder,
    hasStructuredTargets: profileIdsInTextOrder.length > 0,
    messageEnvelope,
    replyTo,
    resolvedStructuredTargets: {
      mentionsInTextOrder: resolvedMentionsInTextOrder,
      profileIdsInTextOrder,
    },
    text: messageEnvelope?.text ?? normalizePlainTextOrThrow(input.text),
  };
}

function appendStructuredTarget(input: {
  envelopeInput: MessageEnvelopeInput;
  profileId: string;
  profileIdsInTextOrder: string[];
  relation: MessageMentionType;
  structuredTargetProfileIds: Set<string>;
}): boolean {
  if (input.structuredTargetProfileIds.has(input.profileId)) {
    return false;
  }
  input.structuredTargetProfileIds.add(input.profileId);
  const fieldName = resolveMessageEnvelopeTargetField(
    input.relation
  ) as MessageTargetField;
  input.envelopeInput[fieldName].push(input.profileId);
  input.profileIdsInTextOrder.push(input.profileId);
  return true;
}

function compareStructuredMentionCandidates(
  left: StructuredMentionCandidate,
  right: StructuredMentionCandidate
): number {
  return left.start - right.start || left.sequence - right.sequence;
}

function appendStructuredMentionCandidates(input: {
  candidates: StructuredMentionCandidate[];
  envelopeInput: MessageEnvelopeInput;
  profileIdsInTextOrder: string[];
  structuredTargetProfileIds: Set<string>;
}): SpaceAuthoredMentionInTextOrder[] {
  const resolvedMentionsInTextOrder: SpaceAuthoredMentionInTextOrder[] = [];
  input.candidates.sort(compareStructuredMentionCandidates);
  for (const candidate of input.candidates) {
    const appended = appendStructuredTarget({
      envelopeInput: input.envelopeInput,
      profileId: candidate.profileId,
      profileIdsInTextOrder: input.profileIdsInTextOrder,
      relation: candidate.relation,
      structuredTargetProfileIds: input.structuredTargetProfileIds,
    });
    if (appended) {
      resolvedMentionsInTextOrder.push({
        profileId: candidate.profileId,
        text: candidate.text,
        type: candidate.relation,
      });
    }
  }
  return resolvedMentionsInTextOrder;
}

export function prepareSpaceFileOnlySubmission(input?: {
  replyTo?: SpaceComposerReplyTarget | null;
}): PreparedSpaceComposerSubmission {
  const replyToSignalId = normalizeReplyToSignalId(input?.replyTo);
  return {
    authoredMentionsInTextOrder: [],
    mentionsInTextOrder: [],
    hasStructuredTargets: false,
    messageEnvelope: null,
    replyTo: replyToSignalId ? { signalId: replyToSignalId } : null,
    resolvedStructuredTargets: emptyResolvedStructuredTargets(),
    text: "",
  };
}

function normalizeAuthoredMentionsInTextOrder(input: {
  mentions:
    | readonly SpaceComposerAuthoredMentionInTextOrder[]
    | null
    | undefined;
  text: string;
}): PositionedSpaceComposerAuthoredMention[] {
  const normalizedMentions: PositionedSpaceComposerAuthoredMention[] = [];
  let searchStart = 0;

  for (const mention of input.mentions ?? []) {
    const profileId = normalizeOptionalText(mention.profileId);
    const text = normalizeOptionalText(mention.text);
    if (!(profileId && text)) {
      throw createSubmissionError(
        "addressing.invalid_message_envelope",
        "Authored mention target must include a profile and visible mention text."
      );
    }

    if (!CANONICAL_MENTION_TYPES.has(mention.relation)) {
      throw createSubmissionError(
        "addressing.invalid_message_envelope",
        INVALID_MENTION_ACTION_GUIDANCE
      );
    }

    const declaredStart = mention.start;
    const hasValidDeclaredStart =
      Number.isInteger(declaredStart) &&
      (declaredStart ?? -1) >= searchStart &&
      input.text.slice(declaredStart, (declaredStart ?? 0) + text.length) ===
        text;
    if (declaredStart !== undefined && !hasValidDeclaredStart) {
      continue;
    }
    const start = hasValidDeclaredStart
      ? (declaredStart as number)
      : input.text.indexOf(text, searchStart);
    if (start < 0) {
      continue;
    }

    normalizedMentions.push({
      profileId,
      relation: mention.relation,
      start,
      text,
    });
    searchStart = start + text.length;
  }

  return normalizedMentions;
}

function emptyResolvedStructuredTargets(): SpaceResolvedStructuredTargetSet {
  return {
    mentionsInTextOrder: [],
    profileIdsInTextOrder: [],
  };
}

function createEnvelopeInput(
  text: string,
  replyToSignalId: string | null
): MessageEnvelopeInput {
  return {
    activationTargets: [],
    referenceTargets: [],
    mentionTargets: [],
    ...(replyToSignalId ? { replyToSignalId } : {}),
    text,
  };
}

function normalizeReplyToSignalId(
  replyTo: SpaceComposerReplyTarget | null | undefined
): string | null {
  if (!replyTo) {
    return null;
  }

  const signalId = replyTo.signalId.trim();
  if (signalId.length === 0) {
    throw createSubmissionError(
      "addressing.invalid_reply_target",
      "replyTo.signalId must be a non-empty string."
    );
  }

  return signalId;
}

function normalizeEnvelopeOrThrow(
  input: MessageEnvelopeInput
): MessageEnvelope {
  try {
    return normalizeMessageEnvelope(input);
  } catch (error) {
    throw createSubmissionError(
      resolveCanonicalMentionEnvelopeErrorCode(error),
      formatCanonicalMentionEnvelopeError(error)
    );
  }
}

function createSubmissionError(
  code: SpaceComposerSubmissionErrorCode,
  message: string,
  options: { targetProfileId?: string | null } = {}
): SpaceComposerSubmissionError {
  return new SpaceComposerSubmissionError({
    code,
    message,
    targetProfileId: options.targetProfileId,
  });
}

function validateSnapshotTargetKindsOrThrow(
  snapshot: SpaceMembersSnapshot
): void {
  for (const member of snapshot.humans) {
    if (member.status !== "active") {
      continue;
    }
    validateSnapshotTargetKindOrThrow({
      expectedKind: "human",
      profileId: member.profileId,
      profileKind: member.profileKind,
    });
  }

  for (const member of snapshot.agents) {
    if (member.status !== "active") {
      continue;
    }
    validateSnapshotTargetKindOrThrow({
      expectedKind: "agent",
      profileId: member.profileId,
      profileKind: member.profileKind,
    });
  }
}

function validateSnapshotTargetKindOrThrow(input: {
  expectedKind: "human" | "agent";
  profileId: string;
  profileKind: unknown;
}): void {
  if (input.profileKind === input.expectedKind) {
    return;
  }

  throw createSubmissionError(
    "addressing.target_kind_unresolved",
    `Cannot resolve Space Message Addressing target kind for profile ${input.profileId}.`
  );
}

function normalizePlainTextOrThrow(text: string): string {
  return normalizeEnvelopeOrThrow({
    activationTargets: [],
    referenceTargets: [],
    mentionTargets: [],
    text,
  }).text;
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function createMessageEnvelopeOrNull(
  input: MessageEnvelopeInput
): MessageEnvelope | null {
  const hasStructuredTargets =
    input.activationTargets.length > 0 ||
    input.referenceTargets.length > 0 ||
    input.mentionTargets.length > 0;

  if (!(hasStructuredTargets || input.replyToSignalId)) {
    return null;
  }

  return normalizeEnvelopeOrThrow(input);
}

function buildInvalidMentionRelationMessage(input: {
  mentionText: string;
  relation: MessageMentionType;
}): string {
  return `Invalid mention "${input.mentionText}": ${input.relation} is only allowed for ${describeRelationSupport(
    input.relation
  )} in this space.`;
}

function describeRelationSupport(relation: MessageMentionType): string {
  if (relation === "wake") {
    return "agent targets";
  }
  return relation === "reference" ? "agent targets" : "human targets";
}

function formatCanonicalMentionEnvelopeError(error: unknown): string {
  const issues = extractEnvelopeIssueMessages(error);
  for (const issueMessage of issues) {
    const duplicateMatch = issueMessage.match(DUPLICATE_TARGET_ISSUE_PATTERN);
    if (duplicateMatch?.[1]) {
      return `same target appears more than once in ${toRelationName(
        duplicateMatch[1]
      )}`;
    }

    const distinctMatch = issueMessage.match(DISTINCT_TARGET_ISSUE_PATTERN);
    if (distinctMatch?.[1] && distinctMatch[2]) {
      return `same target cannot appear in both ${toRelationName(
        distinctMatch[2]
      )} and ${toRelationName(distinctMatch[1])}`;
    }
  }

  const message =
    issues[0] ??
    (error instanceof Error
      ? error.message.trim()
      : "Invalid message envelope.");
  return message
    .replaceAll("activationTargets", "wake")
    .replaceAll("referenceTargets", "reference")
    .replaceAll("mentionTargets", "mention")
    .replaceAll("profileId", "target");
}

function resolveCanonicalMentionEnvelopeErrorCode(
  error: unknown
): SpaceComposerSubmissionErrorCode {
  const issues = extractEnvelopeIssueMessages(error);
  for (const issueMessage of issues) {
    if (DUPLICATE_TARGET_ISSUE_PATTERN.test(issueMessage)) {
      return "addressing.duplicate_target";
    }

    if (DISTINCT_TARGET_ISSUE_PATTERN.test(issueMessage)) {
      return "addressing.target_reused_across_relations";
    }
  }

  return "addressing.invalid_message_envelope";
}

function extractEnvelopeIssueMessages(error: unknown): string[] {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues
      .map((issue) =>
        issue &&
        typeof issue === "object" &&
        "message" in issue &&
        typeof issue.message === "string"
          ? issue.message.trim()
          : null
      )
      .filter((message): message is string => Boolean(message));
  }

  return [];
}

function toRelationName(fieldName: string): string {
  switch (fieldName) {
    case "activationTargets":
      return "wake";
    case "referenceTargets":
      return "reference";
    default:
      return fieldName;
  }
}
