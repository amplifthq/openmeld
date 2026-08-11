import type { SignalEnvelope } from "@openmeld/protocol";
import {
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
} from "@openmeld/schemas";

export type FormalSpaceUpdateSignal = Extract<
  SignalEnvelope,
  {
    type: "signal.text" | "signal.status" | "signal.system_notice";
  }
>;

/**
 * The signal types that make up the user-visible Space conversation timeline.
 * The durable signal stream also carries operational signals (e.g.
 * `presence.join` / `presence.quit`) that are NOT part of the conversation.
 */
export const VISIBLE_SPACE_TIMELINE_SIGNAL_TYPES = [
  "signal.text",
  "signal.status",
  "signal.system_notice",
] as const;

export type VisibleSpaceTimelineSignalType =
  (typeof VISIBLE_SPACE_TIMELINE_SIGNAL_TYPES)[number];

/**
 * Resolve the effective signal-type filter for a Space *timeline* read.
 *
 * The timeline is a VISIBLE read model. A read that does not pin specific
 * visible types must still default to the full visible set — NOT to "every
 * stored signal type". Operational signals (presence.join/quit) share the same
 * durable stream, so an unfiltered recent/window read can be filled entirely by
 * presence churn, burying real messages out of the window and rendering the
 * timeline empty even though messages exist. Defaulting to the visible set
 * server-side keeps every timeline read (recent, page, after, around) consistent
 * with `status.latestVisibleUpdate`, which is already visibility-aware.
 */
export function resolveVisibleTimelineSignalTypes(
  requestedTypes: readonly VisibleSpaceTimelineSignalType[]
): readonly VisibleSpaceTimelineSignalType[] {
  return requestedTypes.length > 0
    ? requestedTypes
    : VISIBLE_SPACE_TIMELINE_SIGNAL_TYPES;
}

const OPENMELD_SYSTEM_PROFILE_ID = "openmeld-system";

export function isFormalSpaceUpdateSignal(
  signal: SignalEnvelope
): signal is FormalSpaceUpdateSignal {
  if (
    signal.type === "signal.status" ||
    signal.type === "signal.system_notice"
  ) {
    return true;
  }
  if (signal.type !== "signal.text") {
    return false;
  }

  if (isOpenMeldSystemTextSignal(signal)) {
    return false;
  }

  const meta = readSignalTextMeta(signal);
  if (meta?.transient === true) {
    return false;
  }

  return (
    meta?.purpose !== SPACE_MEMBER_JOIN_NOTICE_PURPOSE &&
    meta?.purpose !== SPACE_MEMBER_REMOVE_NOTICE_PURPOSE
  );
}

export function resolveFormalSpaceUpdateActorProfileId(
  signal: FormalSpaceUpdateSignal
): string | null {
  if (signal.type === "signal.system_notice") {
    return (
      normalizeOptionalText(signal.data.actorProfileId) ??
      normalizeOptionalText(signal.profile?.profileId)
    );
  }

  if (signal.type === "signal.status") {
    return (
      normalizeOptionalText(signal.data.actorProfileId) ??
      normalizeOptionalText(signal.profile?.profileId)
    );
  }

  return normalizeOptionalText(signal.profile?.profileId);
}

export function resolveFormalSpaceUpdateActorName(
  signal: FormalSpaceUpdateSignal
): string | null {
  if (signal.type === "signal.system_notice") {
    return (
      normalizeOptionalText(signal.data.actorName) ??
      normalizeOptionalText(signal.profile?.profileName)
    );
  }

  return normalizeOptionalText(signal.profile?.profileName);
}

export function resolveFormalSpaceUpdatePreviewText(
  signal: FormalSpaceUpdateSignal
): string | null {
  if (signal.type === "signal.text") {
    return normalizeOptionalText(signal.data.text);
  }
  return normalizeOptionalText(signal.data.text);
}

function readSignalTextMeta(
  signal: Extract<SignalEnvelope, { type: "signal.text" }>
): { purpose?: string; transient?: boolean } | null {
  const data = signal.data;
  if (!(data && typeof data === "object" && "meta" in data)) {
    return null;
  }
  const meta = data.meta;
  if (!(meta && typeof meta === "object" && !Array.isArray(meta))) {
    return null;
  }
  return {
    ...(typeof meta.purpose === "string"
      ? { purpose: meta.purpose.trim() }
      : {}),
    ...(typeof meta.transient === "boolean"
      ? { transient: meta.transient }
      : {}),
  };
}

function isOpenMeldSystemTextSignal(
  signal: Extract<SignalEnvelope, { type: "signal.text" }>
): boolean {
  return (
    normalizeOptionalText(signal.profile?.profileId) ===
    OPENMELD_SYSTEM_PROFILE_ID
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
