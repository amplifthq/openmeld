import { electron } from "@better-auth/electron";
import { passkey } from "@better-auth/passkey";
import {
  getPostgresDatabase,
  isPostgresUniqueViolation,
  type PostgreSQLBinding,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  desktopAuthIdentity,
  ORGANIZATION_INVITATION_LIFETIME_SECONDS,
} from "@openmeld/schemas";
import { APIError, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  bearer,
  deviceAuthorization,
  getOrgAdapter,
  lastLoginMethod,
  magicLink,
  multiSession,
  type OrganizationOptions,
  oneTimeToken,
  organization,
  username,
} from "better-auth/plugins";
import { requireActiveAccount } from "../account/active-account";
import { createAuthCodegenDatabase, createAuthDatabase } from "../db";
import { schema } from "../db/schema";
import {
  organizationAccessControl,
  organizationRoles,
} from "../organization/access-control";
import type { AgentActivitySessionInventoryLifecycleWorker } from "../organization/agent-activity-session-inventory-lifecycle";
import {
  type CenterAgentMemoryLifecycleWorker,
  deleteCenterAgentOrganizationMemoryOnOrganizationDeletion,
} from "../organization/center-agent-memory-lifecycle";
import {
  finalizeOrganizationMemberDeparture,
  prepareOrganizationMemberDeparture,
} from "../organization/member-departure-lifecycle";
import {
  assertManualOrganizationSlugAllowed,
  createWithGeneratedOrganizationSlug,
} from "../organization/organization-slug";
import { withOwnerRetentionError } from "../organization/owner-retention-error";
import {
  isPersonalOrganization,
  PERSONAL_ORGANIZATION_METADATA,
  readOrganizationMetadata,
  resolvePersonalOrganizationName,
  resolveUserDisplayName,
} from "../organization/personal-organization";
import { createActiveAccountPlugin } from "../plugins/active-account";
import { createCliCredentialPlugin } from "../plugins/cli-credential";
import { createOpenMeldEmailIdentityPlugin } from "../plugins/openmeld-email-identity";
import { createOrganizationMemberDeparturePlugin } from "../plugins/organization-member-departure";
import { createDrizzleOpenMeldProfileRepository } from "../profiles/profile-repository";
import { createOpenMeldProfileService } from "../profiles/profile-service";
import { validateAuthEmailAddress } from "../utils/auth-email-validation";
import {
  type AuthConfigInput,
  validateAuthConfig,
} from "../utils/config-validator";
import { inferCookieDomain } from "../utils/cookie-domain";
import {
  type CloudflareEmailSender,
  sendCloudflareEmail,
} from "../utils/email";
import {
  buildMagicLinkEmailContent,
  buildOrganizationInvitationEmailContent,
  buildPasswordResetEmailContent,
  buildVerificationEmailContent,
} from "../utils/email-templates";
import { buildOrganizationInvitationWebUrl } from "../utils/invitation-url";
import { resolveTrustedOrigins } from "../utils/trusted-origins";
import {
  AUTH_COOKIE_CACHE_CONFIG,
  AUTHENTICATION_RATE_LIMIT_CONFIG,
  DEFAULT_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  DEFAULT_OTT_EXPIRES_IN_MINUTES,
  DEFAULT_PASSWORD_RESET_EXPIRES_IN_SECONDS,
  LAST_USED_LOGIN_METHOD_COOKIE_NAME,
} from "./constants";
export type AuthConfigEnv = AuthConfigInput & {
  AUTH_EMAIL?: CloudflareEmailSender;
  OPENMELD_CORE_WORKER?: AgentActivitySessionInventoryLifecycleWorker &
    CenterAgentMemoryLifecycleWorker &
    import("@openmeld/schemas").SpaceInvitationWorker &
    import("@openmeld/schemas").SpaceOwnerDepartureWorker;
  OPENMELD_POSTGRESQL?: PostgreSQLBinding;
  AUTH_SCHEMA_CODEGEN?: boolean;
};
const TRAILING_SLASH_PATTERN = /\/$/;
const ADD_ACCOUNT_AUTH_INTENT = "add-account";
const PERSONAL_ORGANIZATION_OWNER_UNIQUE_CONSTRAINT =
  "organizations_personal_created_by_user_uidx";
const PERSONAL_MEMBERSHIP_ID_UNIQUE_CONSTRAINT = "members_pkey";
type OrganizationHookContext = Parameters<typeof getOrgAdapter>[0];
type DatabaseHookContext =
  | OrganizationHookContext
  | {
      context: OrganizationHookContext;
    }
  | null;
type OrganizationRecord = {
  createdAt: Date;
  id: string;
};
type UserIdentity = {
  email?: string | null;
  id: string;
  name?: string | null;
};
type UserLookupContext = {
  internalAdapter?: {
    findUserById?: (userId: string) => Promise<unknown>;
  };
};
function buildMagicLinkWebUrl(
  webAppUrl: string,
  token: string,
  sourceUrl?: string,
  legacyAppOrigin?: string
): string {
  const searchParams = new URLSearchParams({ token });
  const redirectTarget = resolveVerificationRedirectTarget(sourceUrl);
  if (redirectTarget) {
    searchParams.set("redirect", redirectTarget);
  }
  if (
    hasTrustedAddAccountMagicLinkIntent(webAppUrl, sourceUrl, legacyAppOrigin)
  ) {
    searchParams.set("intent", ADD_ACCOUNT_AUTH_INTENT);
  }
  try {
    const magicLinkUrl = new URL("/magic-link", webAppUrl);
    magicLinkUrl.search = searchParams.toString();
    return magicLinkUrl.toString();
  } catch {
    const sanitizedBaseUrl = webAppUrl.replace(TRAILING_SLASH_PATTERN, "");
    return `${sanitizedBaseUrl}/magic-link?${searchParams.toString()}`;
  }
}
function hasTrustedAddAccountMagicLinkIntent(
  webAppUrl: string,
  sourceUrl: string | undefined,
  legacyAppOrigin: string | undefined
): boolean {
  const parsedWebAppUrl = parseUrl(webAppUrl);
  const parsedSourceUrl = parseUrl(sourceUrl);
  const callbackUrl = parseUrl(
    parsedSourceUrl?.searchParams.get("callbackURL")
  );
  if (!(parsedWebAppUrl && callbackUrl)) {
    return false;
  }
  const expectedCallbackUrl = new URL("/magic-link", parsedWebAppUrl);
  const intentValues = callbackUrl.searchParams.getAll("intent");
  return (
    (callbackUrl.origin === expectedCallbackUrl.origin ||
      callbackUrl.origin === legacyAppOrigin) &&
    callbackUrl.pathname === expectedCallbackUrl.pathname &&
    intentValues.length === 1 &&
    intentValues[0] === ADD_ACCOUNT_AUTH_INTENT
  );
}
function buildVerifyEmailWebUrl(
  webAppUrl: string,
  token: string,
  sourceUrl?: string
): string {
  const redirectTarget = resolveVerificationRedirectTarget(sourceUrl);
  try {
    const verifyEmailUrl = new URL("/verify-email", webAppUrl);
    verifyEmailUrl.searchParams.set("token", token);
    if (redirectTarget) {
      verifyEmailUrl.searchParams.set("redirect", redirectTarget);
    }
    return verifyEmailUrl.toString();
  } catch {
    const sanitizedBaseUrl = webAppUrl.replace(TRAILING_SLASH_PATTERN, "");
    const searchParams = new URLSearchParams({ token });
    if (redirectTarget) {
      searchParams.set("redirect", redirectTarget);
    }
    return `${sanitizedBaseUrl}/verify-email?${searchParams.toString()}`;
  }
}
const AUTH_ERROR_LANDING_PATH = "/login";
// Better Auth's own default `/api/auth/error` page is a raw developer-facing
// HTML page (see https://better-auth.com/docs/reference/options#erroru-rl).
// Every browser-visible redirect failure that cannot recover a per-flow
// `errorCallbackURL` — including an abandoned or canceled OAuth sign-in,
// where the callback's `state` can no longer be verified — must land on this
// product page instead, so it never looks like OpenMeld crashed. Login owns
// classifying the arriving `?error=` code into a calm "sign-in didn't
// complete" state versus a real, visible failure (see
// `clients/web/src/lib/auth-sign-in-error.ts`); Better Auth still fails
// closed either way by never creating a session on a state/callback error.
function buildAuthErrorLandingUrl(webAppUrl: string): string {
  try {
    return new URL(AUTH_ERROR_LANDING_PATH, webAppUrl).toString();
  } catch {
    const sanitizedBaseUrl = webAppUrl.replace(TRAILING_SLASH_PATTERN, "");
    return `${sanitizedBaseUrl}${AUTH_ERROR_LANDING_PATH}`;
  }
}
function resolveVerificationRedirectTarget(sourceUrl: string | undefined) {
  const parsedSourceUrl = parseUrl(sourceUrl);
  if (!parsedSourceUrl) {
    return null;
  }
  const directRedirect = normalizeRelativeRedirect(
    parsedSourceUrl.searchParams.get("redirect")
  );
  if (directRedirect) {
    return directRedirect;
  }
  const callbackUrl = parseUrl(parsedSourceUrl.searchParams.get("callbackURL"));
  return normalizeRelativeRedirect(callbackUrl?.searchParams.get("redirect"));
}
function parseUrl(value: string | null | undefined): URL | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return new URL(value, "http://localhost");
  } catch {
    return null;
  }
}
function normalizeRelativeRedirect(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith("/") && !trimmed.startsWith("//"))) {
    return null;
  }
  try {
    const redirectUrl = new URL(trimmed, "http://localhost");
    if (redirectUrl.origin !== "http://localhost") {
      return null;
    }
    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
  } catch {
    return null;
  }
}
function requireAuthEmailSender(
  sender: CloudflareEmailSender | undefined
): CloudflareEmailSender {
  if (!sender) {
    throw new Error("AUTH_EMAIL binding is not configured");
  }
  return sender;
}
function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}
function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}
function readRecordString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  return readOptionalString((record as Record<string, unknown>)[key]);
}
function resolveInvitationInviterName(user: {
  email?: string | null;
  name?: string | null;
}): string {
  return (
    resolveUserDisplayName({
      fallback: "A teammate",
      userEmail: user.email,
      userName: user.name,
    }) ?? "A teammate"
  );
}
function describeError(error: unknown): {
  errorName: string;
  message: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      message: error.message,
    };
  }
  return {
    errorName: typeof error,
    message: String(error),
  };
}
function requireOrganizationHookContext(
  context: DatabaseHookContext,
  operation: string
): OrganizationHookContext {
  if (!context) {
    throw new Error(`Better Auth context is required to ${operation}`);
  }
  if ("context" in context) {
    return context.context;
  }
  return context;
}
function readOrganizationCreatedAtMs(organization: OrganizationRecord): number {
  const timestamp = organization.createdAt.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `Organization ${organization.id} is missing a valid createdAt timestamp`
    );
  }
  return timestamp;
}
function selectInitialOrganization(
  organizations: OrganizationRecord[]
): OrganizationRecord {
  const [organization] = [...organizations].sort((left, right) => {
    const createdAtDelta =
      readOrganizationCreatedAtMs(left) - readOrganizationCreatedAtMs(right);
    return createdAtDelta || left.id.localeCompare(right.id);
  });
  if (!organization) {
    throw new Error("Cannot create a session without organization membership");
  }
  return organization;
}
async function ensurePersonalOrganizationForUser({
  context,
  organizationOptions,
  userEmail,
  userId,
  userName,
}: {
  context: OrganizationHookContext;
  organizationOptions: OrganizationOptions;
  userEmail?: string | null;
  userId: string;
  userName?: string | null;
}): Promise<string> {
  const orgAdapter = getOrgAdapter(context, organizationOptions);
  const existingOrganizations = await orgAdapter.listOrganizations(userId);
  if (existingOrganizations.length > 0) {
    return selectInitialOrganization(existingOrganizations).id;
  }
  const user = await resolveUserIdentity({
    context,
    userEmail,
    userId,
    userName,
  });
  const createdAt = new Date();
  const organizationName = resolvePersonalOrganizationName({
    userEmail: user.email,
    userName: user.name,
  });
  let organization: OrganizationRecord;
  try {
    organization = await createWithGeneratedOrganizationSlug({
      allowPersonalPrefix: true,
      create: async (slug) =>
        await orgAdapter.createOrganization({
          organization: {
            createdAt,
            createdByUserId: userId,
            metadata: PERSONAL_ORGANIZATION_METADATA,
            name: organizationName,
            slug,
          },
        }),
      name: organizationName,
    });
  } catch (error) {
    if (
      !isPostgresUniqueViolation(
        error,
        PERSONAL_ORGANIZATION_OWNER_UNIQUE_CONSTRAINT
      )
    ) {
      throw error;
    }
    organization = await readPersonalOrganizationByOwner({ context, userId });
  }
  await ensurePersonalOrganizationMembership({
    context,
    createdAt,
    organizationId: organization.id,
    userId,
  });
  return organization.id;
}
async function readPersonalOrganizationByOwner(input: {
  context: OrganizationHookContext;
  userId: string;
}): Promise<OrganizationRecord> {
  const organizations = await input.context.adapter.findMany({
    model: "organization",
    where: [{ field: "createdByUserId", value: input.userId }],
  });
  const personalOrganizations = organizations.filter((organization) => {
    if (!(organization && typeof organization === "object")) {
      return false;
    }
    const metadata = readOrganizationMetadata(
      (organization as Record<string, unknown>).metadata
    );
    return metadata.ok && metadata.value.personal === true;
  });
  if (personalOrganizations.length !== 1) {
    throw new Error(
      "Personal Organization owner conflict did not resolve to exactly one Organization."
    );
  }
  const [organization] = personalOrganizations;
  const id = readRecordString(organization, "id");
  const createdAt =
    organization &&
    typeof organization === "object" &&
    (organization as Record<string, unknown>).createdAt instanceof Date
      ? (
          organization as {
            createdAt: Date;
          }
        ).createdAt
      : null;
  if (!(id && createdAt)) {
    throw new Error(
      "Personal Organization owner conflict did not resolve to a valid Organization."
    );
  }
  return { createdAt, id };
}
async function ensurePersonalOrganizationMembership(input: {
  context: OrganizationHookContext;
  createdAt: Date;
  organizationId: string;
  userId: string;
}): Promise<void> {
  // A personal Organization has exactly one owner membership, so its
  // Organization UUID is also a stable, valid UUID for that membership. This
  // lets concurrent session creation converge at the database boundary.
  const membershipId = input.organizationId;
  try {
    await input.context.adapter.create({
      data: {
        createdAt: input.createdAt,
        id: membershipId,
        organizationId: input.organizationId,
        role: "owner",
        userId: input.userId,
      },
      forceAllowId: true,
      model: "member",
    });
  } catch (error) {
    if (
      !isPostgresUniqueViolation(
        error,
        PERSONAL_MEMBERSHIP_ID_UNIQUE_CONSTRAINT
      )
    ) {
      throw error;
    }
    const existingMembership = await input.context.adapter.findOne({
      model: "member",
      where: [{ field: "id", value: membershipId }],
    });
    if (
      readRecordString(existingMembership, "organizationId") !==
        input.organizationId ||
      readRecordString(existingMembership, "userId") !== input.userId ||
      readRecordString(existingMembership, "role") !== "owner"
    ) {
      throw error;
    }
  }
}
async function resolveUserIdentity(input: {
  context: OrganizationHookContext;
  userEmail?: string | null;
  userId: string;
  userName?: string | null;
}): Promise<UserIdentity> {
  if (input.userName || input.userEmail) {
    return {
      email: input.userEmail,
      id: input.userId,
      name: input.userName,
    };
  }
  const user = await (
    input.context as UserLookupContext
  ).internalAdapter?.findUserById?.(input.userId);
  if (user && typeof user === "object") {
    const record = user as Record<string, unknown>;
    return {
      email: typeof record.email === "string" ? record.email : null,
      id: input.userId,
      name: typeof record.name === "string" ? record.name : null,
    };
  }
  return {
    id: input.userId,
  };
}
function rejectOrganizationSlug(error: unknown): never {
  throw new APIError("BAD_REQUEST", {
    code: "organization.slug_invalid",
    message:
      error instanceof Error ? error.message : "Organization slug is invalid.",
  });
}
function rejectMalformedOrganizationMetadata(): never {
  throw new APIError("BAD_REQUEST", {
    code: "organization.metadata_invalid",
    message: "Organization metadata is invalid.",
  });
}
function rejectPersonalOrganizationInvitation(): never {
  throw new APIError("BAD_REQUEST", {
    code: "organization.personal_no_members",
    message: "Personal organizations cannot invite members.",
  });
}
function rejectManagedOrganizationLogoWrite(
  organization: Record<string, unknown>
): void {
  if (!Object.hasOwn(organization, "logo")) {
    return;
  }
  throw new APIError("BAD_REQUEST", {
    code: "organization.logo_managed",
    message: "Use the Organization logo settings to change this logo.",
  });
}
function rejectManagedOrganizationMetadataWrite(
  organization: Record<string, unknown>
): void {
  if (!Object.hasOwn(organization, "metadata")) {
    return;
  }
  throw new APIError("BAD_REQUEST", {
    code: "organization.metadata_managed",
    message: "Organization metadata is managed by OpenMeld.",
  });
}
async function preservePersonalOrganizationClassification(input: {
  db?: PostgresDatabase;
  organizationId: string;
}): Promise<Record<string, unknown> | null> {
  if (!input.db) {
    throw new Error(
      "OPENMELD_POSTGRESQL is required to preserve personal organization classification."
    );
  }
  const organization = await input.db
    .query<{
      metadata: string | null;
      slug: string;
    }>({
      text: `
        SELECT metadata, slug
        FROM "openmeld"."organizations"
        WHERE id = $1
        LIMIT 1
      `,
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!organization) {
    throw new APIError("BAD_REQUEST", {
      code: "organization.not_found",
      message: "Organization not found.",
    });
  }
  const metadata = readOrganizationMetadata(organization.metadata);
  if (!metadata.ok) {
    rejectMalformedOrganizationMetadata();
  }
  const personal = isPersonalOrganization({
    metadata: organization.metadata,
    slug: organization.slug,
  });
  if (!personal.ok) {
    rejectMalformedOrganizationMetadata();
  }
  return personal.personal ? { ...metadata.value, personal: true } : null;
}
export function createAuthConfig(
  env: AuthConfigEnv = {},
  database?: ReturnType<typeof createAuthDatabase>
): BetterAuthOptions {
  const validated = validateAuthConfig({
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    BETTER_AUTH_OPENMELD_SECRET: env.BETTER_AUTH_OPENMELD_SECRET,
    AUTH_WORKER_NODE_ENV: env.AUTH_WORKER_NODE_ENV,
    AUTH_DESKTOP_DEVELOPMENT_TARGET: env.AUTH_DESKTOP_DEVELOPMENT_TARGET,
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: env.AUTH_DEVICE_ALLOWED_CLIENT_IDS,
    AUTH_FROM_EMAIL: env.AUTH_FROM_EMAIL,
    AUTH_BRAND_NAME: env.AUTH_BRAND_NAME,
    WEB_APP_URL: env.WEB_APP_URL,
    AUTH_COOKIE_DOMAIN: env.AUTH_COOKIE_DOMAIN,
    AUTH_LEGACY_APP_ORIGIN: env.AUTH_LEGACY_APP_ORIGIN,
    AUTH_COOKIE_PREFIX: env.AUTH_COOKIE_PREFIX,
    PASSKEY_RP_ID: env.PASSKEY_RP_ID,
    GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID:
      env.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID,
    GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET:
      env.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET,
    GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID:
      env.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID,
    GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET:
      env.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET,
    AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS: env.AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS,
  });
  const db = env.AUTH_SCHEMA_CODEGEN
    ? createAuthCodegenDatabase()
    : (database ?? createAuthDatabase());
  const profileService = createOpenMeldProfileService(
    createDrizzleOpenMeldProfileRepository(db)
  );
  const authEmail = env.AUTH_EMAIL;
  if (validated.AUTH_WORKER_NODE_ENV === "production" && !authEmail) {
    throw new Error("AUTH_EMAIL binding is required in production mode");
  }
  const allowedClientIds = new Set(validated.AUTH_DEVICE_ALLOWED_CLIENT_IDS);
  const cookieDomain = inferCookieDomain({
    authUrl: validated.BETTER_AUTH_URL,
    appUrl: validated.WEB_APP_URL,
    explicitCookieDomain: validated.AUTH_COOKIE_DOMAIN,
  });
  const passkeyRpId =
    validated.PASSKEY_RP_ID ??
    (validated.AUTH_WORKER_NODE_ENV === "development"
      ? "localhost"
      : (cookieDomain ?? new URL(validated.WEB_APP_URL).hostname));
  const authOrigin = new URL(validated.BETTER_AUTH_URL).origin;
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  const trustedProviders: ("google" | "github")[] = [];
  if (
    validated.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID &&
    validated.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET
  ) {
    socialProviders.github = {
      clientId: validated.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID,
      clientSecret: validated.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET,
      redirectURI: `${authOrigin}/api/auth/callback/github`,
    };
    trustedProviders.push("github");
  }
  if (
    validated.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID &&
    validated.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET
  ) {
    socialProviders.google = {
      clientId: validated.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID,
      clientSecret: validated.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET,
    };
    trustedProviders.push("google");
  }
  const hasSocialProviders = Object.keys(socialProviders).length > 0;
  const webDeviceVerificationUri = `${validated.WEB_APP_URL}/device/approve`;
  if (validated.AUTH_COOKIE_DOMAIN && !cookieDomain) {
    const setterHost = new URL(validated.BETTER_AUTH_URL).hostname;
    console.warn(
      `[auth] AUTH_COOKIE_DOMAIN="${validated.AUTH_COOKIE_DOMAIN}" is not compatible with auth host "${setterHost}". Cross-subdomain cookies disabled.`
    );
  }
  const nativeDatabaseAdapter = drizzleAdapter(db, {
    provider: "pg",
    // Profile bootstrap hooks cross their own business-owner boundary.
    // Keep the existing post-create/recovery contract; each paired
    // business mutation uses its own explicit PostgreSQL transaction.
    transaction: false,
    schema,
    usePlural: true,
  });
  const organizationOptions = {
    ac: organizationAccessControl,
    organizationLimit: 5,
    schema: {
      organization: {
        additionalFields: {
          createdByUserId: {
            input: false,
            required: false,
            returned: false,
            type: "string",
          },
        },
      },
    },
    organizationHooks: {
      beforeDeleteOrganization: async ({ organization }) => {
        if (!getPostgresDatabase(env)) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Couldn't check this organization's Spaces.",
          });
        }
        const ownedSpace = await getPostgresDatabase(env)
          .query({
            text: 'SELECT r.space_id FROM "openmeld"."space_owner_member_references" r JOIN "openmeld"."members" m ON m.id = r.member_id WHERE m.organization_id = $1 LIMIT 1',
            values: [organization.id],
          })
          .then((result) => result.rows[0] ?? null);
        if (ownedSpace) {
          throw new APIError("CONFLICT", {
            code: "organization.spaces_must_be_deleted",
            message:
              "Delete this organization's Spaces before deleting the organization. This keeps their history from being left without an owner.",
          });
        }
      },
      beforeCreateInvitation: ({ organization }) => {
        const personal = isPersonalOrganization({
          metadata: organization.metadata,
          slug: organization.slug,
        });
        if (!personal.ok) {
          rejectMalformedOrganizationMetadata();
        }
        if (personal.personal) {
          rejectPersonalOrganizationInvitation();
        }
        return Promise.resolve();
      },
      beforeCreateOrganization: ({ organization, user }) => {
        rejectManagedOrganizationLogoWrite(organization);
        rejectManagedOrganizationMetadataWrite(organization);
        if (organization.slug !== undefined) {
          try {
            assertManualOrganizationSlugAllowed(organization.slug);
          } catch (error) {
            rejectOrganizationSlug(error);
          }
        }
        return Promise.resolve({
          data: {
            ...organization,
            createdByUserId: user.id,
          },
        });
      },
      beforeUpdateOrganization: async ({ member, organization }) => {
        rejectManagedOrganizationLogoWrite(organization);
        rejectManagedOrganizationMetadataWrite(organization);
        if (organization.slug !== undefined) {
          try {
            assertManualOrganizationSlugAllowed(organization.slug);
          } catch (error) {
            rejectOrganizationSlug(error);
          }
        }
        const personalMetadata =
          organization.slug === undefined
            ? null
            : await preservePersonalOrganizationClassification({
                db: getPostgresDatabase(env),
                organizationId: member.organizationId,
              });
        return personalMetadata
          ? { data: { ...organization, metadata: personalMetadata } }
          : undefined;
      },
      beforeRemoveMember: async ({ member, organization, user }) => {
        const userId = user.id ?? member.userId;
        await prepareOrganizationMemberDeparture({
          coreWorker: env.OPENMELD_CORE_WORKER,
          db: getPostgresDatabase(env),
          organizationId: organization.id,
          userId,
        });
      },
      afterRemoveMember: async ({ member, organization, user }) => {
        const userId = user.id ?? member.userId;
        await finalizeOrganizationMemberDeparture({
          coreWorker: env.OPENMELD_CORE_WORKER,
          organizationId: organization.id,
          userId,
        });
      },
      afterDeleteOrganization: ({ organization }) =>
        deleteCenterAgentOrganizationMemoryOnOrganizationDeletion({
          coreWorker: env.OPENMELD_CORE_WORKER,
          organizationId: organization.id,
        }),
    },
    invitationExpiresIn: ORGANIZATION_INVITATION_LIFETIME_SECONDS,
    requireEmailVerificationOnInvitation: true,
    roles: organizationRoles,
    sendInvitationEmail: async (data, request) => {
      try {
        const spaceInvitationId = request?.headers.get(
          "x-openmeld-space-invitation-id"
        );
        if (spaceInvitationId) {
          const core = env.OPENMELD_CORE_WORKER;
          if (!core) {
            throw new Error("Core is required for a Space invitation");
          }
          const bound = await core.spaceInvitation({
            userId: data.inviter.user.id,
            email: data.inviter.user.email,
            emailVerified: data.inviter.user.emailVerified,
            request: {
              action: "bind",
              invitationId: spaceInvitationId,
              organizationInvitationId: data.id,
              organizationInvitationOwned:
                request?.headers.get(
                  "x-openmeld-space-invitation-owns-organization"
                ) === "true",
            },
          });
          if (!bound.result.ok) {
            throw new Error(bound.result.message);
          }
          // The Auth-managed Space invitation route sends the single targeted
          // email after this native Organization prerequisite succeeds.
          return;
        }
        const organizationName = readRequiredString(
          data.organization.name,
          "Organization name"
        );
        const inviterName = resolveInvitationInviterName(data.inviter.user);
        const invitationUrl = buildOrganizationInvitationWebUrl({
          invitationId: data.id,
          organizationName,
          organizationSlug: readRecordString(data.organization, "slug"),
          recipientEmail: readOptionalString(data.email),
          webAppUrl: validated.WEB_APP_URL,
        });
        const emailContent = await buildOrganizationInvitationEmailContent({
          brandName: validated.AUTH_BRAND_NAME,
          expiresAt: data.invitation.expiresAt,
          invitationUrl,
          inviterName,
          organizationName,
          role: data.role,
        });
        await sendCloudflareEmail(requireAuthEmailSender(authEmail), {
          from: validated.AUTH_FROM_EMAIL,
          html: emailContent.html,
          subject: `Join ${organizationName} on ${validated.AUTH_BRAND_NAME}`,
          text: emailContent.text,
          to: data.email,
        });
      } catch (error) {
        const { errorName, message } = describeError(error);
        console.error({
          errorName,
          event: "auth.organization.invitation_email_failed",
          invitationId: readOptionalString(data.id),
          message,
          organizationId: readRecordString(data.organization, "id"),
        });
        throw error;
      }
    },
    teams: {
      enabled: false,
    },
  } satisfies OrganizationOptions;
  return {
    baseURL: validated.BETTER_AUTH_URL,
    secret: validated.BETTER_AUTH_OPENMELD_SECRET,
    onAPIError: {
      errorURL: buildAuthErrorLandingUrl(validated.WEB_APP_URL),
    },
    trustedOrigins: async (request) =>
      resolveTrustedOrigins({
        baseAuthUrl: validated.BETTER_AUTH_URL,
        appUrl: validated.WEB_APP_URL,
        legacyAppOrigin: validated.AUTH_LEGACY_APP_ORIGIN,
        env: validated.AUTH_WORKER_NODE_ENV,
        developmentTarget: validated.AUTH_DESKTOP_DEVELOPMENT_TARGET,
        request,
      }),
    database: (options: BetterAuthOptions) => {
      const adapter = nativeDatabaseAdapter(options);
      return {
        ...adapter,
        update: <T>(input: Parameters<typeof adapter.update>[0]) =>
          withOwnerRetentionError(() => adapter.update<T>(input)),
        updateMany: (input: Parameters<typeof adapter.updateMany>[0]) =>
          withOwnerRetentionError(() => adapter.updateMany(input)),
        delete: <T>(input: Parameters<typeof adapter.delete>[0]) =>
          withOwnerRetentionError(() => adapter.delete<T>(input)),
        deleteMany: (input: Parameters<typeof adapter.deleteMany>[0]) =>
          withOwnerRetentionError(() => adapter.deleteMany(input)),
      };
    },
    // Account Display Name is owned by OpenMeld's paired account/profile
    // transaction. Leaving Better Auth's generic writer enabled would create a
    // second authority path that can drift from the default Human Profile.
    disabledPaths: ["/update-user"],
    user: {
      additionalFields: {
        lastSelectedOrganizationId: {
          input: false,
          required: false,
          type: "string",
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            const userId = readRequiredString(user.id, "User id");
            const organizationContext = requireOrganizationHookContext(
              context,
              "create a personal organization"
            );
            await ensurePersonalOrganizationForUser({
              context: organizationContext,
              organizationOptions,
              userEmail: typeof user.email === "string" ? user.email : null,
              userId,
              userName: typeof user.name === "string" ? user.name : null,
            });
            try {
              await profileService.ensurePrimaryHumanProfile({
                userId,
                userName: typeof user.name === "string" ? user.name : null,
                userEmail: typeof user.email === "string" ? user.email : null,
              });
            } catch (error) {
              console.error(
                "[auth.profile.ensure_primary_human_profile_failed]",
                {
                  userId,
                  error,
                }
              );
            }
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            const userId = readRequiredString(
              session.userId,
              "Session user id"
            );
            await requireActiveAccount(getPostgresDatabase(env), userId);
            const organizationContext = requireOrganizationHookContext(
              context,
              "set the active organization"
            );
            const activeOrganizationId =
              await ensurePersonalOrganizationForUser({
                context: organizationContext,
                organizationOptions,
                userId,
              });
            return {
              data: {
                ...session,
                activeOrganizationId,
              },
            };
          },
        },
      },
    },
    session: {
      storeSessionInDatabase: true,
      cookieCache: AUTH_COOKIE_CACHE_CONFIG,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: DEFAULT_PASSWORD_RESET_EXPIRES_IN_SECONDS,
      sendResetPassword: async ({ user, token }) => {
        const resetPasswordUrl = new URL(
          "/reset-password",
          validated.WEB_APP_URL
        );
        resetPasswordUrl.searchParams.set("token", token);
        const emailContent = await buildPasswordResetEmailContent({
          brandName: validated.AUTH_BRAND_NAME,
          expiresInSeconds: DEFAULT_PASSWORD_RESET_EXPIRES_IN_SECONDS,
          resetPasswordUrl: resetPasswordUrl.href,
        });
        await sendCloudflareEmail(requireAuthEmailSender(authEmail), {
          to: user.email,
          from: validated.AUTH_FROM_EMAIL,
          subject: `Reset your ${validated.AUTH_BRAND_NAME} password`,
          html: emailContent.html,
          text: emailContent.text,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: DEFAULT_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      sendVerificationEmail: async ({ user, token, url }) => {
        const verificationUrl =
          typeof token === "string" && token
            ? buildVerifyEmailWebUrl(validated.WEB_APP_URL, token, url)
            : url;
        const emailContent = await buildVerificationEmailContent({
          brandName: validated.AUTH_BRAND_NAME,
          expiresInSeconds: DEFAULT_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
          verificationUrl,
        });
        await sendCloudflareEmail(requireAuthEmailSender(authEmail), {
          to: user.email,
          from: validated.AUTH_FROM_EMAIL,
          subject: `Verify your email for ${validated.AUTH_BRAND_NAME}`,
          html: emailContent.html,
          text: emailContent.text,
        });
      },
    },
    plugins: [
      ...(env.AUTH_SCHEMA_CODEGEN
        ? []
        : [createActiveAccountPlugin(getPostgresDatabase(env))]),
      electron({
        clientID: desktopAuthIdentity(
          validated.AUTH_WORKER_NODE_ENV === "production",
          validated.AUTH_DESKTOP_DEVELOPMENT_TARGET
        ).clientId,
      }),
      createOrganizationMemberDeparturePlugin({
        coreWorker: env.OPENMELD_CORE_WORKER,
        db: env.AUTH_SCHEMA_CODEGEN ? undefined : getPostgresDatabase(env),
      }),
      // Replace the OTT result before Bearer exposes its signed session token.
      createCliCredentialPlugin(),
      bearer(),
      username(),
      multiSession({
        maximumSessions: 5,
      }),
      organization({
        ...organizationOptions,
      }),
      deviceAuthorization({
        verificationUri: webDeviceVerificationUri,
        validateClient: (clientId) => {
          return allowedClientIds.has(clientId);
        },
      }),
      magicLink({
        expiresIn: validated.AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS,
        sendMagicLink: async ({ email, token, url }) => {
          const magicLinkUrl = buildMagicLinkWebUrl(
            validated.WEB_APP_URL,
            token,
            url,
            validated.AUTH_LEGACY_APP_ORIGIN
          );
          const emailContent = await buildMagicLinkEmailContent({
            brandName: validated.AUTH_BRAND_NAME,
            expiresInSeconds: validated.AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS,
            magicLinkUrl,
          });
          await sendCloudflareEmail(requireAuthEmailSender(authEmail), {
            to: email,
            from: validated.AUTH_FROM_EMAIL,
            subject: `Sign in to ${validated.AUTH_BRAND_NAME}`,
            html: emailContent.html,
            text: emailContent.text,
          });
        },
      }),
      oneTimeToken({
        // The CLI credential hook issues its own session and cookies.
        disableSetSessionCookie: true,
        expiresIn: DEFAULT_OTT_EXPIRES_IN_MINUTES,
        storeToken: "hashed",
      }),
      passkey({
        rpName: `${validated.AUTH_BRAND_NAME} Passkey`,
        rpID: passkeyRpId,
      }),
      createOpenMeldEmailIdentityPlugin({
        validator: validateAuthEmailAddress,
      }),
      lastLoginMethod({
        cookieName: LAST_USED_LOGIN_METHOD_COOKIE_NAME,
        customResolveMethod: (ctx) => {
          if (ctx.path === "/magic-link/verify") {
            return "magic-link";
          }
          if (ctx.path === "/passkey/verify-authentication") {
            return "passkey";
          }
          if (ctx.path === "/sign-in/email" || ctx.path === "/sign-up/email") {
            return "email";
          }
          if (ctx.path.startsWith("/callback/")) {
            return ctx.path.split("/").pop() ?? null;
          }
          if (ctx.path.startsWith("/oauth2/callback/")) {
            return ctx.path.split("/").pop() ?? null;
          }
          return null;
        },
      }),
    ],
    ...(hasSocialProviders
      ? {
          socialProviders,
          account: {
            accountLinking: {
              enabled: true,
              trustedProviders,
            },
          },
        }
      : {}),
    rateLimit: AUTHENTICATION_RATE_LIMIT_CONFIG,
    experimental: {
      joins: true,
    },
    advanced: {
      ...(validated.AUTH_COOKIE_PREFIX
        ? { cookiePrefix: validated.AUTH_COOKIE_PREFIX }
        : {}),
      database: {
        generateId: "uuid",
      },
      useSecureCookies: validated.AUTH_WORKER_NODE_ENV === "production",
      ...(cookieDomain && validated.AUTH_WORKER_NODE_ENV === "production"
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: cookieDomain,
            },
          }
        : {}),
    },
  };
}
