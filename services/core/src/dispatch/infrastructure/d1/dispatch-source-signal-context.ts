import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";

export type DispatchSourceSignalContext = {
  profileId: string | null;
  profileKind: "agent" | "human" | "system" | null;
  profileHandle: string | null;
  profileMentionLabel: string | null;
  text: string;
};

export const readDispatchSourceSignalContext = async (input: {
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<DispatchSourceSignalContext> => {
  const sourceSignalSnapshot = input.message.sourceSignalSnapshot;
  if (sourceSignalSnapshot) {
    const snapshotText = String(sourceSignalSnapshot.text ?? "").trim();
    if (snapshotText.length > 0) {
      return {
        profileId: normalizeOptionalText(sourceSignalSnapshot.profileId),
        profileKind:
          sourceSignalSnapshot.profileKind === "agent" ||
          sourceSignalSnapshot.profileKind === "human" ||
          sourceSignalSnapshot.profileKind === "system"
            ? sourceSignalSnapshot.profileKind
            : null,
        profileHandle: null,
        profileMentionLabel: normalizeOptionalText(
          (sourceSignalSnapshot as { profileMentionLabel?: unknown })
            .profileMentionLabel
        ),
        text: snapshotText,
      };
    }
  }

  const fallbackText = `reply to source event ${input.message.sourceEventId}`;
  if (typeof input.db.prepare !== "function") {
    return buildFallbackSourceSignalContext(fallbackText);
  }

  let row:
    | {
        payloadJson?: unknown;
      }
    | null
    | undefined;
  try {
    row = await input.db
      .prepare(
        `
          SELECT payload_json AS payloadJson
          FROM space_signals
          WHERE id = ?
          LIMIT 1
        `
      )
      .bind(input.message.sourceEventId)
      .first<{
        payloadJson?: unknown;
      }>();
  } catch {
    return buildFallbackSourceSignalContext(fallbackText);
  }

  const rawPayloadJson = String(row?.payloadJson ?? "").trim();
  if (rawPayloadJson.length === 0) {
    return buildFallbackSourceSignalContext(fallbackText);
  }

  let payload: {
    data?: { text?: unknown };
    profile?: { kind?: unknown; profileId?: unknown; profileHandle?: unknown };
  };
  try {
    payload = JSON.parse(rawPayloadJson);
  } catch {
    return buildFallbackSourceSignalContext(fallbackText);
  }

  const text = String(payload.data?.text ?? "").trim();
  const profileId = normalizeText(payload.profile?.profileId);
  const rawProfileKind = normalizeLowerText(payload.profile?.kind);
  const profileKind =
    rawProfileKind === "agent" ||
    rawProfileKind === "human" ||
    rawProfileKind === "system"
      ? rawProfileKind
      : null;
  return {
    profileId: profileId.length > 0 ? profileId : null,
    profileKind,
    profileHandle: normalizeOptionalText(payload.profile?.profileHandle),
    profileMentionLabel: null,
    text: text.length > 0 ? text : fallbackText,
  };
};

const buildFallbackSourceSignalContext = (
  fallbackText: string
): DispatchSourceSignalContext => {
  return {
    profileId: null,
    profileKind: null,
    profileHandle: null,
    profileMentionLabel: null,
    text: fallbackText,
  };
};

const normalizeText = (value: unknown): string => {
  return String(value ?? "").trim();
};

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};

const normalizeLowerText = (value: unknown): string => {
  return normalizeText(value).toLowerCase();
};
