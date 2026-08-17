const GENERATED_SLUG_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const GENERATED_SLUG_DISCRIMINATOR_LENGTH = 6;
const GENERATED_SLUG_MAX_ATTEMPTS = 8;
const ORGANIZATION_SLUG_MAX_LENGTH = 63;
const PERSONAL_SLUG_PREFIX = "personal";
const SLUG_EDGE_SEPARATOR_PATTERN = /^-|-$/g;
const SLUG_PART_PATTERN = /[^a-z0-9]+/g;
const SLUG_REPEAT_SEPARATOR_PATTERN = /-+/g;
const SLUG_SEPARATOR = "-";
const SQLITE_ORGANIZATION_SLUG_CONSTRAINT =
  "UNIQUE constraint failed: organizations.slug";

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

type CreateGeneratedOrganizationInput<Result> = {
  allowPersonalPrefix?: boolean;
  create: (slug: string) => Promise<Result>;
  generateDiscriminator?: () => string;
  name: string;
};

export class OrganizationSlugAllocationError extends Error {
  constructor() {
    super("Could not allocate a unique Organization URL.");
    this.name = "OrganizationSlugAllocationError";
  }
}

export class OrganizationSlugConflictError extends Error {
  constructor() {
    super("Organization URL slug already exists.");
    this.name = "OrganizationSlugConflictError";
  }
}

export async function createWithGeneratedOrganizationSlug<Result>(
  input: CreateGeneratedOrganizationInput<Result>
): Promise<Result> {
  for (let attempt = 0; attempt < GENERATED_SLUG_MAX_ATTEMPTS; attempt += 1) {
    const slug = buildGeneratedOrganizationSlug({
      allowPersonalPrefix: input.allowPersonalPrefix,
      discriminator:
        input.generateDiscriminator?.() ??
        generateOrganizationSlugDiscriminator(),
      name: input.name,
    });
    try {
      return await input.create(slug);
    } catch (error) {
      if (!isOrganizationSlugConflictError(error)) {
        throw error;
      }
    }
  }

  throw new OrganizationSlugAllocationError();
}

export function buildGeneratedOrganizationSlug(input: {
  allowPersonalPrefix?: boolean;
  discriminator: string;
  name: string;
}): string {
  const discriminator = normalizeGeneratedDiscriminator(input.discriminator);
  const maximumBaseLength =
    ORGANIZATION_SLUG_MAX_LENGTH - SLUG_SEPARATOR.length - discriminator.length;
  const normalizedName = normalizeOrganizationSlug(input.name);
  const requestedBase = normalizedName || "org";
  const safeBase =
    input.allowPersonalPrefix ||
    !(
      requestedBase === PERSONAL_SLUG_PREFIX ||
      requestedBase.startsWith(`${PERSONAL_SLUG_PREFIX}-`)
    )
      ? requestedBase
      : `org-${requestedBase}`;
  const base = safeBase
    .slice(0, maximumBaseLength)
    .replace(SLUG_EDGE_SEPARATOR_PATTERN, "");
  return `${base || "org"}${SLUG_SEPARATOR}${discriminator}`;
}

export function generateOrganizationSlugDiscriminator(): string {
  const randomValues = crypto.getRandomValues(
    new Uint8Array(GENERATED_SLUG_DISCRIMINATOR_LENGTH)
  );
  return Array.from(
    randomValues,
    (value) => GENERATED_SLUG_ALPHABET[value % GENERATED_SLUG_ALPHABET.length]
  ).join("");
}

export function isOrganizationSlugConflictError(error: unknown): boolean {
  if (error instanceof OrganizationSlugConflictError) {
    return true;
  }

  const code = readErrorText(error, "code") ?? readNestedErrorCode(error);
  if (code === "ORGANIZATION_ALREADY_EXISTS") {
    return true;
  }

  return readErrorMessages(error).some((message) =>
    message.includes(SQLITE_ORGANIZATION_SLUG_CONSTRAINT)
  );
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

function normalizeGeneratedDiscriminator(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length !== GENERATED_SLUG_DISCRIMINATOR_LENGTH ||
    Array.from(normalized).some(
      (character) => !GENERATED_SLUG_ALPHABET.includes(character)
    )
  ) {
    throw new Error("Generated Organization URL discriminator is invalid.");
  }
  return normalized;
}

function normalizeDisplayText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function readNestedErrorCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "body" in error)) {
    return null;
  }
  return readErrorText((error as { body: unknown }).body, "code");
}

function readErrorText(error: unknown, key: string): string | null {
  if (!(error && typeof error === "object" && key in error)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
      continue;
    }
    if (!(current && typeof current === "object")) {
      break;
    }
    const message = readErrorText(current, "message");
    if (message) {
      messages.push(message);
    }
    current = "cause" in current ? current.cause : null;
  }
  return messages;
}
