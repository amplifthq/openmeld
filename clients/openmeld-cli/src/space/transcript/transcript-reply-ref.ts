import type { SignalEnvelope, SignalTextReplyTo } from "@openmeld/protocol";
import { sanitizeTerminalDisplayText } from "../../ui/terminal-safe-text";
import type {
  SpaceTranscriptItem,
  SpaceTranscriptReplyRef,
} from "../state/space-screen-state";

export function resolveTranscriptReplyRef(input: {
  event: SignalEnvelope;
  messageReadProjection: SpaceTranscriptItem["messageReadProjection"] | null;
}): SpaceTranscriptReplyRef | undefined {
  const replyToSignalId = input.messageReadProjection?.replyToSignalId ?? null;
  const replyToContext = input.messageReadProjection?.replyToContext ?? null;
  if (!(replyToSignalId && replyToContext)) {
    return undefined;
  }
  const signalId = sanitizeTranscriptReplyText(replyToSignalId);
  const profileId = sanitizeTranscriptReplyText(replyToContext.actorProfileId);
  const profileName = sanitizeTranscriptReplyText(
    replyToContext.actorDisplayName
  );
  if (!(signalId && (profileName || profileId))) {
    return undefined;
  }

  return {
    signalId,
    profileId,
    profileKind: resolveTranscriptReplyProfileKind({
      event: input.event,
      messageReadProjection: input.messageReadProjection,
      profileId,
    }),
    profileName,
    previewText: sanitizeTranscriptReplyText(replyToContext.previewText),
  };
}

function resolveSignalReplyToRecord(
  event: SignalEnvelope
): SignalTextReplyTo | null {
  if (
    event.type !== "signal.text" &&
    event.type !== "signal.status" &&
    event.type !== "signal.system_notice"
  ) {
    return null;
  }
  const replyTo = event.data.replyTo;
  return replyTo && typeof replyTo === "object" ? replyTo : null;
}

function resolveTranscriptReplyProfileKind(input: {
  event: SignalEnvelope;
  messageReadProjection: SpaceTranscriptItem["messageReadProjection"] | null;
  profileId: string;
}): SpaceTranscriptReplyRef["profileKind"] {
  const projectionProfileKind =
    input.messageReadProjection?.replyToContext?.actorProfileKind ?? null;
  if (projectionProfileKind) {
    return projectionProfileKind;
  }

  const replyToRecord = resolveSignalReplyToRecord(input.event);
  if (
    replyToRecord &&
    sanitizeTranscriptReplyText(replyToRecord.profileId) === input.profileId &&
    (replyToRecord.profileKind === "human" ||
      replyToRecord.profileKind === "agent" ||
      replyToRecord.profileKind === "system")
  ) {
    return replyToRecord.profileKind;
  }

  return null;
}

function sanitizeTranscriptReplyText(value: unknown): string {
  return sanitizeTerminalDisplayText(
    typeof value === "string" ? value : "",
    "single-line"
  )
    .replace(/\s+/gu, " ")
    .trim();
}
