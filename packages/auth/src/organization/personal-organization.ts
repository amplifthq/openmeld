export const PERSONAL_ORGANIZATION_METADATA = {
  personal: true,
} as const;

const EMAIL_LOCAL_PART_SEPARATOR = "@";
const PERSONAL_SLUG_PREFIX = "personal";

export function resolvePersonalOrganizationName(input: {
  userEmail?: string | null;
  userName?: string | null;
}): string {
  const userDisplayName = resolveUserDisplayName(input);
  if (userDisplayName) {
    return userDisplayName;
  }

  throw new Error(
    "Cannot create a personal organization without a user name or email"
  );
}

export function resolveUserDisplayName(input: {
  fallback?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}): string | null {
  return (
    normalizeDisplayText(input.userName) ??
    normalizeEmailLocalPart(input.userEmail) ??
    normalizeDisplayText(input.fallback)
  );
}

export function readOrganizationMetadata(
  value: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: {} };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ok: true, value: value as Record<string, unknown> };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
  } catch {
    return { ok: false };
  }

  return { ok: false };
}

export function isPersonalOrganization(input: {
  metadata: unknown;
  slug?: string | null;
}):
  | { ok: true; personal: boolean }
  | {
      ok: false;
      reason:
        | "organization_metadata_invalid"
        | "organization_personal_marker_invalid";
    } {
  const metadata = readOrganizationMetadata(input.metadata);
  if (!metadata.ok) {
    return { ok: false, reason: "organization_metadata_invalid" };
  }

  const personalMarker = metadata.value.personal;
  if (personalMarker !== undefined && typeof personalMarker !== "boolean") {
    return { ok: false, reason: "organization_personal_marker_invalid" };
  }

  return {
    ok: true,
    personal:
      personalMarker === true ||
      String(input.slug ?? "").startsWith(`${PERSONAL_SLUG_PREFIX}-`),
  };
}

function normalizeDisplayText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmailLocalPart(value: unknown): string | null {
  const email = normalizeDisplayText(value);
  if (!email) {
    return null;
  }

  const separatorIndex = email.indexOf(EMAIL_LOCAL_PART_SEPARATOR);
  const localPart =
    separatorIndex >= 0 ? email.slice(0, separatorIndex) : email;
  return normalizeDisplayText(localPart);
}
