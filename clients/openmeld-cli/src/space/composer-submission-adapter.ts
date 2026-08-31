import { collectCanonicalMentionTextFragments } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  assertValidSpaceCanonicalMentionSyntax,
  createSpaceTargetCatalog,
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
  resolvedAddressingTargets: readonly CliSpaceAddressingTarget[];
};

export type CliSpaceAddressingTarget = {
  primaryMentionLabel: string;
  profileId: string;
  relation: PreparedSpaceComposerSubmission["canonicalMentionsInTextOrder"][number]["type"];
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
  const publishedMessage = resolvePublishedMessage({
    membersSnapshot,
    preparedSubmission,
  });
  const outboundText = publishedMessage.text;
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
    resolvedAddressingTargets: publishedMessage.resolvedAddressingTargets,
  };
}

function resolvePublishedMessage(input: {
  membersSnapshot: SpaceMembersSnapshot | null;
  preparedSubmission: PreparedSpaceComposerSubmission;
}): {
  resolvedAddressingTargets: readonly CliSpaceAddressingTarget[];
  text: string;
} {
  const text = input.preparedSubmission.text;
  const canonicalMentions = collectCanonicalMentionTextFragments(text).flatMap(
    (fragment) =>
      fragment.parsedLiteral
        ? [{ ...fragment, parsedLiteral: fragment.parsedLiteral }]
        : []
  );
  if (canonicalMentions.length === 0) {
    return { resolvedAddressingTargets: [], text };
  }
  if (!input.membersSnapshot) {
    throw new Error(
      "Space message addressing invariant failed: resolved mentions require the current members snapshot."
    );
  }

  const targetCatalog = createSpaceTargetCatalog(input.membersSnapshot);
  let cursor = 0;
  const parts: string[] = [];
  for (const mention of canonicalMentions) {
    const target = targetCatalog.byExactMentionLabel.get(
      mention.parsedLiteral.name
    );
    if (!target) {
      throw new Error(
        `Space message addressing invariant failed: resolved target ${mention.parsedLiteral.name} is not in the current members snapshot.`
      );
    }
    parts.push(text.slice(cursor, mention.start));
    parts.push(`@${target.primaryMentionLabel}`);
    cursor = mention.end;
  }
  parts.push(text.slice(cursor));

  return {
    resolvedAddressingTargets:
      input.preparedSubmission.canonicalMentionsInTextOrder.map((mention) => {
        const target = targetCatalog.byProfileId.get(mention.profileId);
        if (!target) {
          throw new Error(
            `Space message addressing invariant failed: resolved profile ${mention.profileId} is not in the current members snapshot.`
          );
        }
        return {
          primaryMentionLabel: target.primaryMentionLabel,
          profileId: target.profileId,
          relation: mention.type,
        };
      }),
    text: parts.join(""),
  };
}
