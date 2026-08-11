import type { SignalEnvelope } from "@openmeld/protocol";
import {
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
} from "@openmeld/schemas";
import { sanitizeTerminalDisplayText } from "../../ui/terminal-safe-text";
import type { SpaceMembershipNotice } from "../state/space-screen-state";

const LEGACY_MENTION_LABEL_PREFIX_PATTERN = /^@+/u;

export function resolveMembershipNoticeFromSignalEnvelope(
  event: SignalEnvelope
): SpaceMembershipNotice | null {
  if (event.type !== "signal.text") {
    return null;
  }

  const meta = resolveSignalTextMeta(event);
  if (!meta || meta.transient === true) {
    return null;
  }

  const action = resolveMembershipNoticeAction(
    readSignalMetaText(meta, "purpose")
  );
  if (!action) {
    return null;
  }

  const targetProfileKind = resolveMembershipTargetKind(
    readSignalMetaText(meta, "targetProfileKind")
  );
  if (!targetProfileKind) {
    return null;
  }

  const targetProfileId = readSignalMetaText(meta, "targetProfileId") || null;
  const targetProfileLabel =
    readSignalMetaText(meta, "targetProfileName") || targetProfileId || "";
  if (!targetProfileLabel) {
    return null;
  }
  const mentionLabel =
    readSignalMetaText(meta, "targetMentionLabel") ||
    // Legacy read-only seam: old stored notices may only have targetProfileHandle.
    // This fallback must not be treated as active mention truth for new producers.
    normalizeLegacyMentionLabel(
      readSignalMetaText(meta, "targetProfileHandle")
    ) ||
    null;

  const actorProfileId =
    readSignalMetaText(
      meta,
      action === "member_added" ? "addedByProfileId" : "removedByProfileId"
    ) ||
    sanitizeSingleLineText(event.profile?.profileId) ||
    "";
  const actorLabel =
    readSignalMetaText(
      meta,
      action === "member_added" ? "addedByDisplayName" : "removedByDisplayName"
    ) ||
    sanitizeSingleLineText(event.profile?.profileName) ||
    "";
  if (!actorLabel) {
    return null;
  }

  return {
    action,
    actorProfileId: actorProfileId || null,
    actorKind: resolveMembershipActorKind(event.profile?.kind),
    actorLabel,
    targetProfileId,
    targetProfileKind,
    targetProfileLabel,
    mentionLabel,
    ts: event.ts,
  };
}

function resolveMembershipNoticeAction(
  purpose: string
): SpaceMembershipNotice["action"] | null {
  if (purpose === SPACE_MEMBER_JOIN_NOTICE_PURPOSE) {
    return "member_added";
  }
  if (purpose === SPACE_MEMBER_REMOVE_NOTICE_PURPOSE) {
    return "member_removed";
  }
  return null;
}

function resolveSignalTextMeta(
  event: SignalEnvelope
): Record<string, unknown> | null {
  if (
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    return null;
  }
  const meta = (event.data as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

function readSignalMetaText(
  meta: Record<string, unknown>,
  key: string
): string {
  const value = meta[key];
  return typeof value === "string" || typeof value === "number"
    ? sanitizeSingleLineText(value)
    : "";
}

function sanitizeSingleLineText(value: unknown): string {
  return sanitizeTerminalDisplayText(String(value ?? ""), "single-line").trim();
}

function normalizeLegacyMentionLabel(value: string): string {
  return value.replace(LEGACY_MENTION_LABEL_PREFIX_PATTERN, "").trim();
}

function resolveMembershipTargetKind(
  kind: string
): SpaceMembershipNotice["targetProfileKind"] | null {
  return kind === "human" || kind === "agent" ? kind : null;
}

function resolveMembershipActorKind(
  kind: unknown
): SpaceMembershipNotice["actorKind"] {
  return kind === "human" || kind === "agent" ? kind : "unknown";
}
