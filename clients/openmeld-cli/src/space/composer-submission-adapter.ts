import type {
  MessageMentionType,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  createSpaceTargetCatalog,
  type PreparedSpaceComposerSubmission,
  prepareSpaceComposerSubmission,
  prepareSpaceFileOnlySubmission,
  type SpaceComposerReplyTarget,
  SpaceComposerSubmissionError,
} from "@openmeld/space";

export type CliSpaceAddressingTarget = {
  primaryMentionLabel: string;
  profileId: string;
  relation: MessageMentionType;
};

export type CliSpaceAddressingOptions = {
  wakeTargets?: readonly string[];
  referenceTargets?: readonly string[];
  mentionTargets?: readonly string[];
};

export type PreparedCliSpaceComposerSubmission = {
  outboundMessageEnvelope?: NonNullable<
    PreparedSpaceComposerSubmission["messageEnvelope"]
  >;
  outboundReplyTo?: SpaceComposerReplyTarget;
  outboundText: string;
  preparedSubmission: PreparedSpaceComposerSubmission;
  resolvedAddressingTargets: readonly CliSpaceAddressingTarget[];
};

export async function prepareCliSpaceComposerSubmission(
  input: CliSpaceAddressingOptions & {
    missingSnapshotMessage: string;
    onMembersSnapshotLoaded?: (snapshot: SpaceMembersSnapshot) => void;
    onSnapshotLoadFailure?: (error: unknown) => void;
    replyTo?: SpaceComposerReplyTarget | null;
    loadMembersSnapshot?: () => Promise<SpaceMembersSnapshot | null>;
    authoredMentionsInTextOrder?: PreparedSpaceComposerSubmission["authoredMentionsInTextOrder"];
    text: string;
  }
): Promise<PreparedCliSpaceComposerSubmission> {
  const requested = (
    [
      ["wake", input.wakeTargets ?? []],
      ["reference", input.referenceTargets ?? []],
      ["mention", input.mentionTargets ?? []],
    ] as const
  ).flatMap(([relation, ids]) =>
    ids.map((profileId) => ({ profileId, relation }))
  );
  let snapshot: SpaceMembersSnapshot | null = null;
  if (
    requested.length > 0 ||
    (input.authoredMentionsInTextOrder?.length ?? 0) > 0
  ) {
    try {
      snapshot = (await input.loadMembersSnapshot?.()) ?? null;
      if (snapshot) {
        input.onMembersSnapshotLoaded?.(snapshot);
      }
    } catch (error) {
      input.onSnapshotLoadFailure?.(error);
      throw error;
    }
    if (!snapshot) {
      throw new SpaceComposerSubmissionError({
        code: "addressing.members_snapshot_missing",
        message: input.missingSnapshotMessage,
      });
    }
  }
  const { mentions, prefix, resolvedAddressingTargets } =
    resolveRequestedRecipients(snapshot, requested);
  const preparedSubmission =
    prefix.length === 0 && input.text.length === 0
      ? prepareSpaceFileOnlySubmission({ replyTo: input.replyTo })
      : prepareSpaceComposerSubmission({
          authoredMentionsInTextOrder: [
            ...mentions,
            ...(input.authoredMentionsInTextOrder ?? []).map((mention) => ({
              ...mention,
              start:
                mention.start === undefined
                  ? undefined
                  : mention.start + prefix.length,
            })),
          ],
          missingSnapshotMessage: input.missingSnapshotMessage,
          replyTo: input.replyTo,
          snapshot,
          text: prefix + input.text,
        });
  return {
    ...(preparedSubmission.messageEnvelope
      ? { outboundMessageEnvelope: preparedSubmission.messageEnvelope }
      : {}),
    ...(preparedSubmission.replyTo
      ? { outboundReplyTo: preparedSubmission.replyTo }
      : {}),
    outboundText: preparedSubmission.text,
    preparedSubmission,
    resolvedAddressingTargets,
  };
}

function resolveRequestedRecipients(
  snapshot: SpaceMembersSnapshot | null,
  requested: readonly { profileId: string; relation: MessageMentionType }[]
) {
  const catalog = snapshot ? createSpaceTargetCatalog(snapshot) : null;
  const seen = new Map<string, MessageMentionType>();
  const resolvedAddressingTargets: CliSpaceAddressingTarget[] = [];
  const mentions: PreparedSpaceComposerSubmission["authoredMentionsInTextOrder"][number][] =
    [];
  let prefix = "";
  for (const request of requested) {
    const profileId = request.profileId.trim();
    const target = catalog?.byProfileId.get(profileId);
    if (!target) {
      throw new SpaceComposerSubmissionError({
        code: "addressing.target_not_in_current_space",
        message: `No current Space member has Profile ID "${profileId}". Run openmeld space members and use the full Profile ID.`,
      });
    }
    const previous = seen.get(profileId);
    if (previous && previous !== request.relation) {
      throw new SpaceComposerSubmissionError({
        code: "addressing.target_reused_across_relations",
        message: `Choose one relation for Profile ID "${profileId}".`,
      });
    }
    if (previous) {
      continue;
    }
    seen.set(profileId, request.relation);
    const label = target.profileName || target.primaryMentionLabel;
    const text = `@${label}`;
    mentions.push({
      profileId,
      relation: request.relation,
      start: prefix.length,
      text,
    });
    prefix += `${text} `;
    resolvedAddressingTargets.push({
      primaryMentionLabel: label,
      profileId,
      relation: request.relation,
    });
  }
  return { mentions, prefix, resolvedAddressingTargets };
}
