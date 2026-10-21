import { createHash } from "node:crypto";

const CANONICAL_OPENCLAW_SPACE_SESSION_KEY_RE =
  /^agent:[a-z0-9-]+:openmeld-space:[a-z0-9-]+--[a-z0-9]{8}$/u;

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
  const spaceIdPrefix = normalizeOpenClawSpaceIdPrefix(input.spaceId);
  return `agent:${normalizedAgentId}:openmeld-space:${spaceSlug}--${spaceIdPrefix}`;
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

export function normalizeOpenClawSpaceIdPrefix(spaceId: string): string {
  const normalized = normalizeOptionalText(spaceId)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
  const prefix = normalized?.slice(0, 8);
  return prefix && prefix.length === 8 ? prefix : "00000000";
}

function normalizeProfileName(profileName: string): string {
  const normalized = String(profileName).trim();
  return normalized.length > 0 ? normalized : "Agent";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
