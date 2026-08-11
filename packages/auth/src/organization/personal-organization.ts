export const PERSONAL_ORGANIZATION_METADATA = {
  personal: true,
} as const;

const EMAIL_LOCAL_PART_SEPARATOR = "@";
const SLUG_SEPARATOR = "-";
const PERSONAL_SLUG_PREFIX = "personal";
const SLUG_PART_PATTERN = /[^a-z0-9]+/g;
const SLUG_EDGE_SEPARATOR_PATTERN = /^-|-$/g;
const SLUG_REPEAT_SEPARATOR_PATTERN = /-+/g;

const RESERVED_ORGANIZATION_SLUGS = new Set([
  "accept-invitation",
  "account",
  "admin",
  "agent",
  "agent-profiles",
  "agents",
  "api",
  "auth",
  "billing",
  "center-agent",
  "computer",
  "computers",
  "desktop",
  "device",
  "download",
  "downloads",
  "help",
  "login",
  "logout",
  "mail",
  "magic-link",
  "organization",
  "organizations",
  "profile",
  "profiles",
  "security",
  "settings",
  "sign-in",
  "sign-up",
  "space",
  "spaces",
  "support",
  "verify-email",
  "www",
]);

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

export function buildOrganizationSlugBaseFromIdentity(input: {
  fallbackId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}): string {
  const identityText =
    normalizeDisplayText(input.userName) ??
    normalizeEmailLocalPart(input.userEmail) ??
    normalizeDisplayText(input.fallbackId);
  if (!identityText) {
    throw new Error(
      "Cannot create an organization slug without a name, email, or fallback id"
    );
  }

  const slugBase = normalizeOrganizationSlug(identityText);
  if (slugBase) {
    return slugBase;
  }

  const fallbackSlug = normalizeOrganizationSlug(input.fallbackId);
  if (fallbackSlug) {
    return fallbackSlug;
  }

  throw new Error("Cannot derive a readable organization slug");
}

export async function buildUniquePersonalOrganizationSlug(input: {
  fallbackId: string;
  findOrganizationBySlug: (slug: string) => Promise<unknown>;
  userEmail?: string | null;
  userName?: string | null;
}): Promise<string> {
  const baseSlug = buildOrganizationSlugBaseFromIdentity(input);

  for (const candidate of buildSlugCandidates(baseSlug)) {
    if (isReservedOrganizationSlug(candidate)) {
      continue;
    }
    if (!(await input.findOrganizationBySlug(candidate))) {
      return candidate;
    }
  }

  throw new Error("Could not allocate a unique personal organization slug");
}

export function assertManualOrganizationSlugAllowed(slug: unknown): string {
  const requestedSlug = normalizeDisplayText(slug);
  if (!requestedSlug) {
    throw new Error("Organization slug is required.");
  }

  const normalizedSlug = normalizeOrganizationSlug(requestedSlug);
  if (requestedSlug !== normalizedSlug) {
    throw new Error("Organization slug must use lowercase kebab-case.");
  }

  if (isReservedOrganizationSlug(normalizedSlug)) {
    throw new Error("That organization slug is reserved.");
  }

  if (
    normalizedSlug === PERSONAL_SLUG_PREFIX ||
    normalizedSlug.startsWith(`${PERSONAL_SLUG_PREFIX}-`)
  ) {
    throw new Error("That organization slug prefix is reserved.");
  }

  return normalizedSlug;
}

export function isReservedOrganizationSlug(slug: string): boolean {
  return RESERVED_ORGANIZATION_SLUGS.has(slug);
}

export function normalizeOrganizationSlug(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(SLUG_PART_PATTERN, SLUG_SEPARATOR)
    .replace(SLUG_REPEAT_SEPARATOR_PATTERN, SLUG_SEPARATOR)
    .replace(SLUG_EDGE_SEPARATOR_PATTERN, "");
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

function* buildSlugCandidates(baseSlug: string): Generator<string> {
  yield baseSlug;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    yield `${baseSlug}-${suffix}`;
  }
}
