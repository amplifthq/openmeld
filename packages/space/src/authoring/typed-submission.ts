import type {
  MessageEnvelope,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  assertValidSpaceCanonicalMentionSyntax as assertValidSpaceCanonicalMentionSyntaxFromComposer,
  type SpaceCanonicalMentionInTextOrder as ComposerSpaceCanonicalMentionInTextOrder,
  type SpaceResolvedStructuredTargetSet as ComposerSpaceResolvedStructuredTargetSet,
  prepareSpaceComposerSubmission,
  spaceTextHasCanonicalMentionAttempts as spaceTextHasCanonicalMentionAttemptsFromComposer,
} from "./composer-submission";

export const assertValidSpaceCanonicalMentionSyntax =
  assertValidSpaceCanonicalMentionSyntaxFromComposer;
export const spaceTextHasCanonicalMentionAttempts =
  spaceTextHasCanonicalMentionAttemptsFromComposer;
export type SpaceCanonicalMentionInTextOrder =
  ComposerSpaceCanonicalMentionInTextOrder;
export type SpaceResolvedStructuredTargetSet =
  ComposerSpaceResolvedStructuredTargetSet;

export type PreparedHumanSpaceTypedSubmission = {
  canonicalMentionsInTextOrder: readonly SpaceCanonicalMentionInTextOrder[];
  hasCanonicalMentions: boolean;
  messageEnvelope: MessageEnvelope | null;
  resolvedStructuredTargets: SpaceResolvedStructuredTargetSet;
  text: string;
};

export type PreparedOneShotSpaceTypedSubmission = {
  canonicalMentionsInTextOrder: readonly SpaceCanonicalMentionInTextOrder[];
  hasStructuredMentions: boolean;
  messageEnvelope: MessageEnvelope | null;
  resolvedStructuredTargets: SpaceResolvedStructuredTargetSet;
  text: string;
};

export function prepareHumanSpaceTypedSubmission(input: {
  snapshot: SpaceMembersSnapshot | null;
  text: string;
}): PreparedHumanSpaceTypedSubmission {
  const preparedSubmission = prepareSpaceComposerSubmission({
    missingSnapshotMessage:
      "Cannot validate canonical mentions right now because current space members could not be loaded.",
    snapshot: input.snapshot,
    text: input.text,
  });

  return {
    canonicalMentionsInTextOrder:
      preparedSubmission.resolvedStructuredTargets.canonicalMentionsInTextOrder,
    hasCanonicalMentions:
      preparedSubmission.resolvedStructuredTargets.canonicalMentionsInTextOrder
        .length > 0,
    messageEnvelope: preparedSubmission.messageEnvelope,
    resolvedStructuredTargets: preparedSubmission.resolvedStructuredTargets,
    text: preparedSubmission.text,
  };
}

export function prepareOneShotSpaceTypedSubmission(input: {
  snapshot: SpaceMembersSnapshot | null;
  text: string;
}): PreparedOneShotSpaceTypedSubmission {
  const preparedSubmission = prepareSpaceComposerSubmission({
    missingSnapshotMessage:
      "Cannot validate mention labels right now because current space members could not be loaded.",
    snapshot: input.snapshot,
    text: input.text,
  });

  return {
    canonicalMentionsInTextOrder:
      preparedSubmission.resolvedStructuredTargets.canonicalMentionsInTextOrder,
    hasStructuredMentions:
      preparedSubmission.resolvedStructuredTargets.profileIdsInTextOrder
        .length > 0,
    messageEnvelope: preparedSubmission.messageEnvelope,
    resolvedStructuredTargets: preparedSubmission.resolvedStructuredTargets,
    text: preparedSubmission.text,
  };
}

export function spaceTextHasOneShotMentionAttempts(text: string): boolean {
  return spaceTextHasCanonicalMentionAttempts(text);
}
