import {
  helloSchema,
  incomingServerMessageSchema,
  profileSchema,
  serverErrorFrameSchema,
  signalEnvelopeSchema,
  signalTextSchema,
} from "@openmeld/schemas/schemas";
import { MAX_PROFILE_ID_LENGTH } from "./constants";
import type {
  Hello,
  IncomingServerMessage,
  ParseResult,
  Profile,
  ServerErrorFrame,
  SignalEnvelope,
  SignalText,
  SpaceCreator,
} from "./types";

export function parseJsonObject(
  value: string
): ParseResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "invalid_json" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export function parseProfile(value: unknown): ParseResult<Profile> {
  const parsed = profileSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const hasProfileIdIssue = parsed.error.issues.some(
    (issue) => issue.path[0] === "profileId"
  );
  return {
    ok: false,
    error: hasProfileIdIssue ? "invalid_profile_id" : "invalid_profile",
  };
}

export function parseSpaceCreator(value: unknown): SpaceCreator | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return (
    parseSpaceCreatorFromCreatorShape(value) ??
    parseSpaceCreatorFromProfileShape(value)
  );
}

export function normalizeProfileId(value: string): string | null {
  const profile = parseProfile({ profileId: value });
  if (!profile.ok) {
    return null;
  }

  return profile.value.profileId;
}

export function parseHello(obj: Record<string, unknown>): ParseResult<Hello> {
  if (obj.type !== "hello") {
    return { ok: false, error: "not_hello" };
  }

  const profile = parseProfile(obj.profile);
  if (!profile.ok) {
    return { ok: false, error: profile.error };
  }

  const parsed = helloSchema.safeParse({
    type: "hello",
    profile: profile.value,
    ...(obj.capabilities === undefined
      ? {}
      : { capabilities: obj.capabilities }),
  });
  if (!parsed.success) {
    return { ok: false, error: "invalid_profile" };
  }

  return { ok: true, value: parsed.data };
}

export function parseSignalText(
  obj: Record<string, unknown>
): ParseResult<SignalText> {
  if (obj.type !== "signal.text") {
    return { ok: false, error: "not_signal_text" };
  }

  const data = obj.data;
  if (!data || typeof data !== "object") {
    return { ok: false, error: "invalid_signal_data" };
  }
  if (Array.isArray(data)) {
    return { ok: false, error: "invalid_signal_data" };
  }

  const parsed = signalTextSchema.safeParse(obj);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const isTooLong = parsed.error.issues.some(
    (issue) =>
      issue.path[0] === "data" &&
      issue.path[1] === "text" &&
      issue.code === "too_big"
  );
  if (isTooLong) {
    return { ok: false, error: "text_too_long" };
  }

  return { ok: false, error: "empty_text" };
}

export function parseEnvelope(value: unknown): SignalEnvelope | null {
  const parsed = signalEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseIncoming(value: unknown): IncomingServerMessage | null {
  const parsed = incomingServerMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseServerErrorFrame(value: unknown): ServerErrorFrame | null {
  const parsed = serverErrorFrameSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseSpaceCreatorFromCreatorShape(
  value: unknown
): SpaceCreator | null {
  const creator = value as {
    profileId?: unknown;
    profileName?: unknown;
    kind?: unknown;
    profile?: unknown;
    ownerUserId?: unknown;
    owner?: unknown;
  };

  if (typeof creator.profileId !== "string") {
    return null;
  }

  const profileId = creator.profileId.trim();
  if (!profileId || profileId.length > MAX_PROFILE_ID_LENGTH) {
    return null;
  }

  const profileName =
    typeof creator.profileName === "string" &&
    creator.profileName.trim().length > 0
      ? creator.profileName.trim()
      : undefined;
  const kind =
    creator.kind === "human" ||
    creator.kind === "agent" ||
    creator.kind === "system"
      ? creator.kind
      : undefined;
  const profile =
    typeof creator.profile === "string" && creator.profile.trim().length > 0
      ? creator.profile.trim()
      : undefined;
  const ownerUserIdRaw = creator.ownerUserId ?? creator.owner;
  const ownerUserId =
    typeof ownerUserIdRaw === "string" && ownerUserIdRaw.trim().length > 0
      ? ownerUserIdRaw.trim().slice(0, MAX_PROFILE_ID_LENGTH)
      : undefined;

  return {
    profileId,
    ...(profileName ? { profileName } : {}),
    ...(kind ? { kind } : {}),
    ...(profile ? { profile } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
  };
}

function parseSpaceCreatorFromProfileShape(
  value: unknown
): SpaceCreator | null {
  const parsedProfile = parseProfile(value);
  if (!parsedProfile.ok) {
    return null;
  }

  const profileRaw = (value as { profile?: unknown }).profile;
  const profile =
    typeof profileRaw === "string" && profileRaw.trim().length > 0
      ? profileRaw.trim()
      : undefined;

  return {
    profileId: parsedProfile.value.profileId,
    ...(parsedProfile.value.profileName
      ? { profileName: parsedProfile.value.profileName }
      : {}),
    ...(parsedProfile.value.kind ? { kind: parsedProfile.value.kind } : {}),
    ...(profile ? { profile } : {}),
    ...(parsedProfile.value.owner
      ? {
          ownerUserId: parsedProfile.value.owner
            .trim()
            .slice(0, MAX_PROFILE_ID_LENGTH),
        }
      : {}),
  };
}
