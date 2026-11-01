import { createHash } from "node:crypto";

const OPENCLAW_SPACE_ID_SEGMENT_RE = /^v2(?:[0-9a-f]{2})+$/u;

const CANONICAL_OPENCLAW_SPACE_SESSION_KEY_RE =
  /^agent:[a-z0-9-]+:openmeld-space:[a-z0-9-]+--v2(?:[0-9a-f]{2})+$/u;

// Segment for an id that carries no identity at all. It sits outside the
// canonical format, so a stored key carrying it never classifies as owned;
// it only keeps key derivation total for unidentifiable inputs.
const UNIDENTIFIED_OPENCLAW_SPACE_ID_SEGMENT = "unidentified";

export function buildOpenClawBootstrapAgentId(input: {
  openMeldProfileId: string;
  laneKey: string;
  profileName: string;
}): string {
  const normalizedProfileId =
    normalizeOptionalText(input.openMeldProfileId) ?? "profile";
  const normalizedLaneKey = normalizeOptionalText(input.laneKey) ?? "lane";
  const profileSlug = slugifyOpenClawNamePart(input.profileName, "agent");
  const laneSlug = slugifyOpenClawNamePart(normalizedLaneKey, "lane");
  const profileIdFragment =
    slugifyOpenClawNamePart(normalizedProfileId, "profile").slice(0, 8) ||
    "profile";
  const profileIdHash = createHash("sha256")
    .update(`${normalizedLaneKey}:${normalizedProfileId}`)
    .digest("hex")
    .slice(0, 8);
  return `openmeld-${profileSlug}-${laneSlug}-${profileIdFragment}-${profileIdHash}`;
}

export function buildOpenClawLegacyBootstrapAgentId(input: {
  openMeldProfileId: string;
  profileName: string;
}): string {
  const normalizedProfileId =
    normalizeOptionalText(input.openMeldProfileId) ?? "profile";
  const profileSlug = slugifyOpenClawNamePart(input.profileName, "agent");
  const profileIdFragment =
    slugifyOpenClawNamePart(normalizedProfileId, "profile").slice(0, 8) ||
    "profile";
  const profileIdHash = createHash("sha256")
    .update(normalizedProfileId)
    .digest("hex")
    .slice(0, 8);
  return `openmeld-${profileSlug}-${profileIdFragment}-${profileIdHash}`;
}

export function buildOpenClawBootstrapIdentityName(
  profileName: string
): string {
  const normalizedProfileName = normalizeProfileName(profileName);
  return `OpenMeld ${normalizedProfileName}`;
}

/** One colleague Wake's own session; never the Space's shared one. */
export function buildOpenClawWakeSessionKey(input: {
  agentId: string;
  scopeId: string;
}): string {
  const normalizedAgentId =
    slugifyOpenClawNamePart(input.agentId, "agent") || "agent";
  return `agent:${normalizedAgentId}:openmeld-wake:${slugifyOpenClawNamePart(input.scopeId, "wake")}`;
}

export function buildOpenClawSpaceSessionKey(input: {
  agentId: string;
  spaceId: string;
  spaceNameSnapshot?: string | null;
}): string {
  const normalizedAgentId =
    slugifyOpenClawNamePart(input.agentId, "agent") || "agent";
  const spaceSlug = slugifyOpenClawNamePart(
    input.spaceNameSnapshot ?? "space",
    "space"
  );
  const spaceIdSegment =
    encodeOpenClawSpaceId(input.spaceId) ??
    UNIDENTIFIED_OPENCLAW_SPACE_ID_SEGMENT;
  return `agent:${normalizedAgentId}:openmeld-space:${spaceSlug}--${spaceIdSegment}`;
}

export function isCanonicalOpenClawSpaceSessionKey(value: string): boolean {
  return CANONICAL_OPENCLAW_SPACE_SESSION_KEY_RE.test(
    normalizeOptionalText(value) ?? ""
  );
}

export function slugifyOpenClawNamePart(
  value: string,
  fallback: string
): string {
  const normalized = String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function encodeOpenClawSpaceId(spaceId: string): string | null {
  // Lossless hex encoding of the complete id, marked as format v2. Case,
  // separators, and every other character survive, so two distinct Space
  // ids never encode to the same segment; and because the segment is
  // marked, a prefix-era segment (bare normalized text) can never be
  // mistaken for this format. Ownership of a stored Space session is
  // decided against this value. Only an id with no text at all carries
  // no identity to encode, and returns null.
  const normalized = normalizeOptionalText(spaceId);
  if (!normalized) {
    return null;
  }
  return `v2${Buffer.from(normalized, "utf8").toString("hex")}`;
}

export function decodeOpenClawSpaceId(segment: string): string | null {
  if (!OPENCLAW_SPACE_ID_SEGMENT_RE.test(segment)) {
    return null;
  }
  const decoded = Buffer.from(segment.slice(2), "hex").toString("utf8");
  // Reject byte sequences that are not the encoding of a real id (invalid
  // UTF-8 decodes with replacement characters and cannot round-trip).
  return encodeOpenClawSpaceId(decoded) === segment ? decoded : null;
}

function normalizeProfileName(profileName: string): string {
  const normalized = String(profileName).trim();
  return normalized.length > 0 ? normalized : "Agent";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
