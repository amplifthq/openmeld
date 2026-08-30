import { collectCanonicalMentionTextFragments } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  assertValidSpaceCanonicalMentionSyntax,
  type PreparedSpaceComposerSubmission,
  prepareSpaceComposerSubmission,
  type SpaceComposerReplyTarget,
  spaceTextHasOneShotMentionAttempts,
} from "@openmeld/space";

export type PreparedCliSpaceComposerSubmission = {
  outboundMessageEnvelope?: NonNullable<
    PreparedSpaceComposerSubmission["messageEnvelope"]
  >;
  outboundReplyTo?: SpaceComposerReplyTarget;
  outboundText: string;
  preparedSubmission: PreparedSpaceComposerSubmission;
};

export async function prepareCliSpaceComposerSubmission(input: {
  missingSnapshotMessage: string;
  onMembersSnapshotLoaded?: (snapshot: SpaceMembersSnapshot) => void;
  onSnapshotLoadFailure?: (error: unknown) => void;
  replyTo?: SpaceComposerReplyTarget | null;
  loadMembersSnapshot?: () => Promise<SpaceMembersSnapshot | null>;
  text: string;
}): Promise<PreparedCliSpaceComposerSubmission> {
  const hasCanonicalMentionAttempts = spaceTextHasOneShotMentionAttempts(
    input.text
  );
  if (hasCanonicalMentionAttempts) {
    assertValidSpaceCanonicalMentionSyntax(input.text);
  }

  let membersSnapshot: SpaceMembersSnapshot | null = null;
  if (hasCanonicalMentionAttempts && input.loadMembersSnapshot) {
    try {
      membersSnapshot = await input.loadMembersSnapshot();
      if (membersSnapshot) {
        input.onMembersSnapshotLoaded?.(membersSnapshot);
      }
    } catch (error) {
      input.onSnapshotLoadFailure?.(error);
      throw error;
    }
  }

  const preparedSubmission = prepareSpaceComposerSubmission({
    missingSnapshotMessage: input.missingSnapshotMessage,
    replyTo: input.replyTo,
    snapshot: membersSnapshot,
    text: input.text,
  });
  const outboundText = resolvePublishedMessageText(preparedSubmission.text);
  const outboundMessageEnvelope = preparedSubmission.messageEnvelope
    ? {
        ...preparedSubmission.messageEnvelope,
        text: outboundText,
      }
    : undefined;

  return {
    ...(outboundMessageEnvelope ? { outboundMessageEnvelope } : {}),
    ...(preparedSubmission.replyTo
      ? { outboundReplyTo: preparedSubmission.replyTo }
      : {}),
    outboundText,
    preparedSubmission,
  };
}

function resolvePublishedMessageText(text: string): string {
  const canonicalMentions = collectCanonicalMentionTextFragments(text).flatMap(
    (fragment) =>
      fragment.parsedLiteral
        ? [{ ...fragment, parsedLiteral: fragment.parsedLiteral }]
        : []
  );
  if (canonicalMentions.length === 0) {
    return text;
  }

  let cursor = 0;
  const parts: string[] = [];
  for (const mention of canonicalMentions) {
    parts.push(text.slice(cursor, mention.start));
    parts.push(`@${mention.parsedLiteral.name}`);
    cursor = mention.end;
  }
  parts.push(text.slice(cursor));

  return parts.join("");
}
