import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type { SpaceReplyWorkflowProjection } from "@openmeld/space";
import { sanitizeTerminalDisplayText } from "../../ui/terminal-safe-text";
import { buildHumanReplyCuePreview } from "../reply-cue-preview";
import type { SpaceTranscriptReplyRef } from "../state/space-screen-state";
import { buildHumanReplyContextLine } from "./human-message-read-display";

const TRANSCRIPT_REPLY_PREVIEW_MAX_VISIBLE_WIDTH = 32;

export function buildHumanReplyWorkflowTranscriptCueLine(input: {
  membersSnapshot: SpaceMembersSnapshot | null;
  replyRef?: SpaceTranscriptReplyRef;
  replyWorkflowProjection?: SpaceReplyWorkflowProjection | null;
}): string | null {
  const semanticReplyLine = buildHumanReplyContextLine(
    input.replyWorkflowProjection?.replyToContext ?? null
  );
  if (semanticReplyLine) {
    return semanticReplyLine;
  }

  const replyRef = input.replyRef;
  if (!replyRef) {
    return null;
  }

  const profileLabel = resolveTranscriptReplyProfileLabel({
    membersSnapshot: input.membersSnapshot,
    replyRef,
  });
  const previewText = resolveTranscriptReplyPreviewText(replyRef.previewText);

  return previewText
    ? `reply to ${profileLabel} · ${previewText}`
    : `reply to ${profileLabel}`;
}

function resolveTranscriptReplyProfileLabel(input: {
  membersSnapshot: SpaceMembersSnapshot | null;
  replyRef: NonNullable<SpaceTranscriptReplyRef>;
}): string {
  const profileId = sanitizeTranscriptReplyDisplayText(
    input.replyRef.profileId
  );
  if (profileId && input.membersSnapshot) {
    const humanMatch = input.membersSnapshot.humans.find(
      (member) => member.profileId === profileId
    );
    const agentMatch = input.membersSnapshot.agents.find(
      (member) => member.profileId === profileId
    );
    const snapshotName =
      humanMatch?.profileName?.trim() || agentMatch?.profileName?.trim() || "";
    if (snapshotName) {
      return snapshotName;
    }
  }

  return (
    sanitizeTranscriptReplyDisplayText(input.replyRef.profileName) ||
    profileId ||
    "unknown"
  );
}

function resolveTranscriptReplyPreviewText(value: string): string {
  return buildHumanReplyCuePreview(
    value,
    TRANSCRIPT_REPLY_PREVIEW_MAX_VISIBLE_WIDTH
  );
}

function sanitizeTranscriptReplyDisplayText(value: string): string {
  return sanitizeTerminalDisplayText(value, "single-line")
    .replace(/\s+/gu, " ")
    .trim();
}
