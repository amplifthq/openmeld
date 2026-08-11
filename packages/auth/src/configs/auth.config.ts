import { passkey } from "@better-auth/passkey";
import { APIError, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  bearer,
  deviceAuthorization,
  getOrgAdapter,
  lastLoginMethod,
  magicLink,
  type OrganizationOptions,
  oneTimeToken,
  organization,
  username,
} from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import { createD1Db } from "../db";
import { schema } from "../db/schema";
import {
  organizationAccessControl,
  organizationRoles,
} from "../organization/access-control";
import { assertMemberDoesNotHostCenterAgent } from "../organization/center-agent-member-removal-guard";
import {
  type CenterAgentMemoryLifecycleWorker,
  deleteCenterAgentMemberMemoryOnOrganizationRemoval,
  deleteCenterAgentOrganizationMemoryOnOrganizationDeletion,
} from "../organization/center-agent-memory-lifecycle";
import {
  assertManualOrganizationSlugAllowed,
  buildUniquePersonalOrganizationSlug,
  isPersonalOrganization,
  PERSONAL_ORGANIZATION_METADATA,
  readOrganizationMetadata,
  resolvePersonalOrganizationName,
  resolveUserDisplayName,
} from "../organization/personal-organization";
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
  buildVerificationEmailContent,
} from "../utils/email-templates";
import { buildOrganizationInvitationWebUrl } from "../utils/invitation-url";
import { resolveTrustedOrigins } from "../utils/trusted-origins";
import {
  AUTH_COOKIE_CACHE_CONFIG,
  AUTHENTICATION_RATE_LIMIT_CONFIG,
  DEFAULT_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  DEFAULT_OTT_EXPIRES_IN_MINUTES,
  LAST_USED_LOGIN_METHOD_COOKIE_NAME,
} from "./constants";

export type AuthConfigEnv = AuthConfigInput & {
  AUTH_EMAIL?: CloudflareEmailSender;
  OPENMELD_CORE_WORKER?: CenterAgentMemoryLifecycleWorker;
  OPENMELD_DB?: D1Database;
};

const TRAILING_SLASH_PATTERN = /\/$/;

type OrganizationHookContext = Parameters<typeof getOrgAdapter>[0];
type DatabaseHookContext =
  | OrganizationHookContext
  | { context: OrganizationHookContext }
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

function buildMagicLinkWebUrl(webAppUrl: string, token: string): string {
  try {
    const magicLinkUrl = new URL("/magic-link", webAppUrl);
    magicLinkUrl.searchParams.set("token", token);
    return magicLinkUrl.toString();
  } catch {
    const sanitizedBaseUrl = webAppUrl.replace(TRAILING_SLASH_PATTERN, "");
    return `${sanitizedBaseUrl}/magic-link?token=${encodeURIComponent(token)}`;
  }
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

function describeError(error: unknown): { errorName: string; message: string } {
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
  const organization = await orgAdapter.createOrganization({
    organization: {
      createdAt,
      createdByUserId: userId,
      metadata: PERSONAL_ORGANIZATION_METADATA,
      name: resolvePersonalOrganizationName({
        userEmail: user.email,
        userName: user.name,
      }),
      slug: await buildUniquePersonalOrganizationSlug({
        fallbackId: user.id,
        findOrganizationBySlug: async (slug) =>
          await orgAdapter.findOrganizationBySlug(slug),
        userEmail: user.email,
        userName: user.name,
      }),
    },
  });

  await orgAdapter.createMember({
    createdAt,
    organizationId: organization.id,
    role: "owner",
    userId,
  });

  return organization.id;
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
  db?: D1Database;
  organizationId: string;
}): Promise<Record<string, unknown> | null> {
  if (!input.db) {
    throw new Error(
      "OPENMELD_DB is required to preserve personal organization classification."
    );
  }
  const organization = await input.db
    .prepare(
      `
        SELECT metadata, slug
        FROM organizations
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<{ metadata: string | null; slug: string }>();
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

export function createAuthConfig(env: AuthConfigEnv = {}): BetterAuthOptions {
  const validated = validateAuthConfig({
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    BETTER_AUTH_OPENMELD_SECRET: env.BETTER_AUTH_OPENMELD_SECRET,
    AUTH_WORKER_NODE_ENV: env.AUTH_WORKER_NODE_ENV,
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: env.AUTH_DEVICE_ALLOWED_CLIENT_IDS,
    AUTH_FROM_EMAIL: env.AUTH_FROM_EMAIL,
    AUTH_BRAND_NAME: env.AUTH_BRAND_NAME,
    WEB_APP_URL: env.WEB_APP_URL,
    AUTH_COOKIE_DOMAIN: env.AUTH_COOKIE_DOMAIN,
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

  // False-positive guard: keep this fallback for Better Auth CLI/codegen runs
  // in Node where Worker bindings are unavailable.
  // Do not replace this with a hard throw in the shared config layer.
  // Production Worker requests must provide OPENMELD_DB via bindings.
  const db = env.OPENMELD_DB
    ? createD1Db(env.OPENMELD_DB)
    : createD1Db({} as D1Database);
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
                db: env.OPENMELD_DB,
                organizationId: member.organizationId,
              });
        return personalMetadata
          ? { data: { ...organization, metadata: personalMetadata } }
          : undefined;
      },
      beforeRemoveMember: ({ member, organization, user }) =>
        assertMemberDoesNotHostCenterAgent({
          db: env.OPENMELD_DB,
          organizationId: organization.id,
          userId: user.id ?? member.userId,
        }),
      afterRemoveMember: ({ member, organization, user }) =>
        deleteCenterAgentMemberMemoryOnOrganizationRemoval({
          coreWorker: env.OPENMELD_CORE_WORKER,
          organizationId: organization.id,
          userId: user.id ?? member.userId,
        }),
      afterDeleteOrganization: ({ organization }) =>
        deleteCenterAgentOrganizationMemoryOnOrganizationDeletion({
          coreWorker: env.OPENMELD_CORE_WORKER,
          organizationId: organization.id,
        }),
    },
    requireEmailVerificationOnInvitation: true,
    roles: organizationRoles,
    sendInvitationEmail: async (data) => {
      try {
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
        const emailContent = buildOrganizationInvitationEmailContent({
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
    trustedOrigins: async (request) =>
      resolveTrustedOrigins({
        baseAuthUrl: validated.BETTER_AUTH_URL,
        appUrl: validated.WEB_APP_URL,
        env: validated.AUTH_WORKER_NODE_ENV,
        request,
      }),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      usePlural: true,
    }),
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
        const emailContent = buildVerificationEmailContent({
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
      bearer(),
      username(),
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
        sendMagicLink: async ({ email, token }) => {
          const magicLinkUrl = buildMagicLinkWebUrl(
            validated.WEB_APP_URL,
            token
          );
          const emailContent = buildMagicLinkEmailContent({
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
        expiresIn: DEFAULT_OTT_EXPIRES_IN_MINUTES,
        storeToken: "hashed",
      }),
      passkey({
        rpName: `${validated.AUTH_BRAND_NAME} Passkey`,
        rpID: passkeyRpId,
      }),
      emailHarmony({
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
