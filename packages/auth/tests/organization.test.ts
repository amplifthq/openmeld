import { PostgresDatabase, withPostgresRequest } from "@openmeld/db/postgresql";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";
import {
  type AuthConfigEnv,
  createAuthConfig,
} from "../src/configs/auth.config";
import { organizationRoles } from "../src/organization/access-control";
import { assertCenterAgentIdentityBeforeMemberRemoval } from "../src/organization/center-agent-member-removal-guard";
import type { CloudflareEmailSender } from "../src/utils/email";

type AuthInstance = Pick<ReturnType<typeof betterAuth>, "handler">;
type SentEmail = {
  from: string | EmailAddress;
  html?: string;
  subject: string;
  text?: string;
  to: string | EmailAddress | (string | EmailAddress)[];
};

const AUTH_BASE_URL = "http://localhost:8788";
const WEB_APP_URL = "http://localhost:3000";
const validSecret = "12345678901234567890123456789012345678901234";
const password = "correct-horse-battery-staple";
const SET_COOKIE_SEPARATOR_PATTERN = /,(?=\s*[^;,]+=)/;
const EMAIL_URL_PATTERN = /https?:\/\/\S+/gu;
const API_PERSONAL_ORGANIZATION_SLUG_PATTERN = /^api-[0-9a-hjkmnp-tv-z]{6}$/;
const OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN =
  /^owner-example-[0-9a-hjkmnp-tv-z]{6}$/;
const GITHUB_OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN =
  /^github-owner-[0-9a-hjkmnp-tv-z]{6}$/;
const LEGACY_PERSONAL_ORGANIZATION_SLUG_PATTERN =
  /^legacy-example-[0-9a-hjkmnp-tv-z]{6}$/;
const CENTER_AGENT_MEMBER_REMOVAL_GUARD_FAILED_MESSAGE =
  "OpenMeld couldn't verify that this member can be removed. The member was not removed.";

const harnesses: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.close();
  }
  vi.restoreAllMocks();
});

describe("organization identity foundation", () => {
  it.each([
    WEB_APP_URL,
    "https://legacy.openmeld.invalid",
  ])("sends a usable password reset email from trusted App origin %s", async (appOrigin) => {
    const { auth, harness, sentEmails } = await createTestAuth({
      enforceOriginCheck: true,
      legacyAppOrigin: "https://legacy.openmeld.invalid",
    });
    const email = "reset-password@example.com";
    await signUp(auth, { email, name: "Password Reset", password });
    await verifyUserEmail(harness, email);
    sentEmails.length = 0;

    const response = await auth.handler(
      new Request(`${AUTH_BASE_URL}/api/auth/request-password-reset`, {
        body: JSON.stringify({
          email,
          redirectTo: `${appOrigin}/reset-password`,
        }),
        headers: { "content-type": "application/json", origin: appOrigin },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      to: email,
      subject: "Reset your OpenMeld password",
    });
    const urls = sentEmails[0]?.text?.match(EMAIL_URL_PATTERN) ?? [];
    expect(urls).toHaveLength(1);
    const resetLink = urls[0];
    if (!resetLink) {
      throw new Error("Expected a password reset link in the email");
    }
    const resetUrl = new URL(resetLink);
    expect(resetUrl.origin).toBe(WEB_APP_URL);
    expect(resetUrl.pathname).toBe("/reset-password");
    const token = resetUrl.searchParams.get("token");
    expect(token).toBeTruthy();
    const newPassword = "a-new-correct-horse-battery-staple";
    const resetResponse = await postAuth(auth, "/reset-password", {
      token,
      newPassword,
    });
    expect(resetResponse.status).toBe(200);
    const oldSignIn = await postAuth(auth, "/sign-in/email", {
      email,
      password,
    });
    expect(oldSignIn.status).toBe(401);
    const newSignIn = await postAuth(auth, "/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(newSignIn.status).toBe(200);
    const replay = await postAuth(auth, "/reset-password", {
      token,
      newPassword,
    });
    expect(replay.status).toBe(400);
  });

  it.each([
    { endpoint: "/sign-in/magic-link", cookie: false },
    { endpoint: "/request-password-reset", cookie: true },
  ])("rejects untrusted-origin email requests at $endpoint with cookie=$cookie", async ({
    endpoint,
    cookie,
  }) => {
    const { auth, sentEmails } = await createTestAuth({
      enforceOriginCheck: true,
    });
    const response = await auth.handler(
      new Request(`${AUTH_BASE_URL}/api/auth${endpoint}`, {
        body: JSON.stringify({ email: "attacker@example.com" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.invalid",
          ...(cookie ? { cookie: "session=untrusted" } : {}),
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
    expect(sentEmails).toEqual([]);
  });

  it.each([
    WEB_APP_URL,
    "https://legacy.openmeld.invalid",
  ])("keeps the exact add-account intent from trusted App origin %s in the final magic-link email URL", async (appOrigin) => {
    const { auth, sentEmails } = await createTestAuth({
      enforceOriginCheck: true,
      legacyAppOrigin: "https://legacy.openmeld.invalid",
    });
    const callbackUrl = new URL("/magic-link", appOrigin);
    callbackUrl.searchParams.set("intent", "add-account");
    callbackUrl.searchParams.set("redirect", "/o/acme/settings/account");
    callbackUrl.searchParams.set("untrusted", "https://attacker.invalid");

    const response = await auth.handler(
      new Request(`${AUTH_BASE_URL}/api/auth/sign-in/magic-link`, {
        body: JSON.stringify({
          callbackURL: callbackUrl.toString(),
          email: "add-account@example.com",
        }),
        headers: { "content-type": "application/json", origin: appOrigin },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    const emailUrl = requireMagicLinkEmailUrl(
      sentEmails,
      "add-account@example.com"
    );
    expect(emailUrl.origin).toBe(WEB_APP_URL);
    expect(emailUrl.pathname).toBe("/magic-link");
    expect(emailUrl.searchParams.get("token")).toBeTruthy();
    expect(emailUrl.searchParams.get("intent")).toBe("add-account");
    expect(emailUrl.searchParams.get("redirect")).toBe(
      "/o/acme/settings/account"
    );
    expect(emailUrl.searchParams.has("untrusted")).toBe(false);
  });

  it("does not mark an ordinary final magic-link email URL as add-account", async () => {
    const { auth, sentEmails } = await createTestAuth();
    const callbackUrl = new URL("/magic-link", WEB_APP_URL);
    callbackUrl.searchParams.set("redirect", "/o/acme/new-space");

    const response = await postAuth(auth, "/sign-in/magic-link", {
      callbackURL: callbackUrl.toString(),
      email: "sign-in@example.com",
    });

    expect(response.status).toBe(200);
    const emailUrl = requireMagicLinkEmailUrl(
      sentEmails,
      "sign-in@example.com"
    );
    expect(emailUrl.origin).toBe(WEB_APP_URL);
    expect(emailUrl.pathname).toBe("/magic-link");
    expect(emailUrl.searchParams.get("token")).toBeTruthy();
    expect(emailUrl.searchParams.has("intent")).toBe(false);
    expect(emailUrl.searchParams.get("redirect")).toBe("/o/acme/new-space");
  });

  it("drops untrusted magic-link callback parameters from the final email URL", async () => {
    const { auth, sentEmails } = await createTestAuth();
    const callbackUrl = new URL("/magic-link", WEB_APP_URL);
    callbackUrl.searchParams.set("intent", "add-account-later");
    callbackUrl.searchParams.set("redirect", "https://attacker.invalid");
    callbackUrl.searchParams.set("campaign", "untrusted");

    const response = await postAuth(auth, "/sign-in/magic-link", {
      callbackURL: callbackUrl.toString(),
      email: "safe-sign-in@example.com",
    });

    expect(response.status).toBe(200);
    const emailUrl = requireMagicLinkEmailUrl(
      sentEmails,
      "safe-sign-in@example.com"
    );
    expect(emailUrl.searchParams.get("token")).toBeTruthy();
    expect(emailUrl.searchParams.has("intent")).toBe(false);
    expect(emailUrl.searchParams.has("redirect")).toBe(false);
    expect(emailUrl.searchParams.has("campaign")).toBe(false);
  });

  it("creates a personal organization and stores it as the active session organization", async () => {
    const { auth, harness, sentEmails } = await createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });

    expect(
      sentEmails.some(
        (email) =>
          email.to === "owner@example.com" &&
          email.subject === "Verify your email for OpenMeld"
      )
    ).toBe(true);

    const user = requireRow<{ id: string; normalizedEmail: string }>(
      await harness.queryFirst({
        values: ["owner@example.com"],
        text: `
          select id, normalized_email as "normalizedEmail"
          from "openmeld"."users"
          where email = $1
        `,
      }),
      "Expected signed-up user"
    );
    const organization = requireRow<{
      id: string;
      metadata: string | null;
      name: string;
      slug: string;
    }>(
      await harness.queryFirst({
        values: [user.id],
        text: `
          select
            organizations.id,
            organizations.metadata,
            organizations.name,
            organizations.slug
          from "openmeld"."organizations"
          inner join "openmeld"."members" on members.organization_id = organizations.id
          where members.user_id = $1
        `,
      }),
      "Expected personal organization"
    );

    expect(organization.name).toBe("Owner Example");
    expect(user.normalizedEmail).toBe("owner@example.com");
    expect(organization.slug).toMatch(OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN);
    expect(parseOrganizationMetadata(organization.metadata)).toEqual({
      personal: true,
    });
    expect(
      await harness.queryAll({
        values: [organization.id],
        text: 'select user_id as "userId", role from "openmeld"."members" where organization_id = $1',
      })
    ).toEqual([{ role: "owner", userId: user.id }]);

    await verifyUserEmail(harness, "owner@example.com");
    await signIn(auth, {
      email: "owner@example.com",
      password,
    });

    expect(
      await harness.queryFirst({
        values: [user.id],
        text: `
          select active_organization_id as "activeOrganizationId"
          from "openmeld"."sessions"
          where user_id = $1
        `,
      })
    ).toEqual({ activeOrganizationId: organization.id });
  });

  it("rejects creating a sixth organization without changing existing memberships", async () => {
    const { auth, harness } = await createTestAuth();

    await signUp(auth, {
      email: "limit-owner@example.com",
      name: "Limit Owner",
      password,
    });
    await verifyUserEmail(harness, "limit-owner@example.com");
    const headers = await signIn(auth, {
      email: "limit-owner@example.com",
      password,
    });

    for (let index = 2; index <= 5; index += 1) {
      const response = await postAuth(
        auth,
        "/organization/create",
        {
          name: `Organization ${index}`,
          slug: `organization-${index}`,
        },
        headers
      );
      expect(response.status).toBe(200);
    }

    const rejectedResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "Organization 6",
        slug: "organization-6",
      },
      headers
    );

    expect(rejectedResponse.status).toBe(403);
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      code: "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS",
      message: "You have reached the maximum number of organizations",
    });
    expect(
      await harness.queryFirst<{ count: number }>({
        values: ["limit-owner@example.com"],
        text: `
          select count(*) as count
          from "openmeld"."organizations"
          inner join "openmeld"."members" on members.organization_id = organizations.id
          inner join "openmeld"."users" on users.id = members.user_id
          where users.email = $1
        `,
      })
    ).toEqual({ count: 5 });
  });

  it("derives the personal organization name from the email local-part when the user name is empty", async () => {
    const { auth, harness } = await createTestAuth();

    await signUp(auth, {
      email: "github-owner@example.com",
      name: "",
      password,
    });

    const user = requireRow<{ id: string }>(
      await harness.queryFirst({
        values: ["github-owner@example.com"],
        text: 'select id from "openmeld"."users" where email = $1',
      }),
      "Expected signed-up user"
    );
    const organization = requireRow<{
      name: string;
      slug: string;
    }>(
      await harness.queryFirst({
        values: [user.id],
        text: `
          select
            organizations.name,
            organizations.slug
          from "openmeld"."organizations"
          inner join "openmeld"."members" on members.organization_id = organizations.id
          where members.user_id = $1
        `,
      }),
      "Expected personal organization"
    );

    expect(organization).toMatchObject({ name: "github-owner" });
    expect(organization.slug).toMatch(
      GITHUB_OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN
    );
  });

  it("creates a personal organization lazily for existing users without organization membership", async () => {
    const { auth, harness } = await createTestAuth();
    const legacyUserId = "legacy-user";

    await insertLegacyCredentialUser(harness, {
      email: "legacy@example.com",
      id: legacyUserId,
      name: "Legacy Example",
      password,
    });

    await signIn(auth, {
      email: "legacy@example.com",
      password,
    });

    const organization = requireRow<{
      id: string;
      metadata: string | null;
      name: string;
      slug: string;
    }>(
      await harness.queryFirst({
        values: [legacyUserId],
        text: `
          select
            organizations.id,
            organizations.metadata,
            organizations.name,
            organizations.slug
          from "openmeld"."organizations"
          inner join "openmeld"."members" on members.organization_id = organizations.id
          where members.user_id = $1
        `,
      }),
      "Expected lazy personal organization"
    );

    expect(organization).toMatchObject({
      id: organization.id,
      metadata: organization.metadata,
      name: "Legacy Example",
    });
    expect(organization.slug).toMatch(
      LEGACY_PERSONAL_ORGANIZATION_SLUG_PATTERN
    );
    expect(parseOrganizationMetadata(organization.metadata)).toEqual({
      personal: true,
    });
    expect(
      await harness.queryAll({
        values: [organization.id],
        text: 'select user_id as "userId", role from "openmeld"."members" where organization_id = $1',
      })
    ).toEqual([{ role: "owner", userId: legacyUserId }]);
    expect(
      await harness.queryFirst({
        values: [legacyUserId],
        text: `
          select active_organization_id as "activeOrganizationId"
          from "openmeld"."sessions"
          where user_id = $1
        `,
      })
    ).toEqual({ activeOrganizationId: organization.id });
  });

  it("converges concurrent legacy-user sessions on one personal organization", async () => {
    const { auth, harness } = await createTestAuth();
    const legacyUserId = "concurrent-legacy-user";

    await insertLegacyCredentialUser(harness, {
      email: "concurrent-legacy@example.com",
      id: legacyUserId,
      name: "Concurrent Legacy",
      password,
    });

    const [firstHeaders, secondHeaders] = await Promise.all([
      await signIn(auth, {
        email: "concurrent-legacy@example.com",
        password,
      }),
      await signIn(auth, {
        email: "concurrent-legacy@example.com",
        password,
      }),
    ]);

    const organizations = await harness.queryAll<{ id: string }>({
      values: [legacyUserId],
      text: `
        select organizations.id
        from "openmeld"."organizations"
        where organizations.created_by_user_id = $1
          and ((organizations.metadata)::jsonb #>> '{personal}') = 'true'
      `,
    });
    const sessionOrganizationIds = (
      await harness.queryAll<{ activeOrganizationId: string }>({
        values: [legacyUserId],
        text: `
          select active_organization_id as "activeOrganizationId"
          from "openmeld"."sessions"
          where user_id = $1
          order by id
        `,
      })
    ).map((session) => session.activeOrganizationId);

    expect(firstHeaders.get("cookie")).toBeTruthy();
    expect(secondHeaders.get("cookie")).toBeTruthy();
    expect(organizations).toHaveLength(1);
    expect(new Set(sessionOrganizationIds)).toEqual(
      new Set([organizations[0]?.id])
    );
  });

  it("repairs the winning personal Organization after losing its creation race", async () => {
    const { auth, harness } = await createTestAuth();
    const legacyUserId = "race-loser-legacy-user";
    const winningOrganizationId = "11111111-1111-4111-8111-111111111111";

    await insertLegacyCredentialUser(harness, {
      email: "race-loser@example.com",
      id: legacyUserId,
      name: "Race Loser",
      password,
    });
    await harness.query({
      values: [winningOrganizationId, legacyUserId],
      text: `
        insert into "openmeld"."organizations" (
          id,
          name,
          slug,
          created_at,
          metadata,
          created_by_user_id
        ) values ($1, 'Race Winner', 'race-winner-k7m3qx', 1000, '{"personal":true}', $2)
      `,
    });

    const headers = await signIn(auth, {
      email: "race-loser@example.com",
      password,
    });

    expect(headers.get("cookie")).toBeTruthy();
    expect(
      await harness.queryAll({
        values: [legacyUserId],
        text: `
          select id
          from "openmeld"."organizations"
          where created_by_user_id = $1
            and ((metadata)::jsonb #>> '{personal}') = 'true'
        `,
      })
    ).toEqual([{ id: winningOrganizationId }]);
    expect(
      await harness.queryAll({
        values: [winningOrganizationId],
        text: `
          select organization_id as "organizationId", user_id as "userId", role
          from "openmeld"."members"
          where organization_id = $1
        `,
      })
    ).toEqual([
      {
        organizationId: winningOrganizationId,
        role: "owner",
        userId: legacyUserId,
      },
    ]);
    expect(
      await harness.queryFirst({
        values: [legacyUserId],
        text: `
          select active_organization_id as "activeOrganizationId"
          from "openmeld"."sessions"
          where user_id = $1
        `,
      })
    ).toEqual({ activeOrganizationId: winningOrganizationId });
  });

  it("derives personal organization slugs from the user identity and avoids reserved words and collisions", async () => {
    const { auth, harness } = await createTestAuth();

    await signUp(auth, {
      email: "api@example.com",
      name: "API",
      password,
    });
    await signUp(auth, {
      email: "owner-a@example.com",
      name: "Owner Example",
      password,
    });
    await signUp(auth, {
      email: "owner-b@example.com",
      name: "Owner Example",
      password,
    });

    const apiSlug = await readPersonalOrganizationSlug(
      harness,
      "api@example.com"
    );
    const firstOwnerSlug = await readPersonalOrganizationSlug(
      harness,
      "owner-a@example.com"
    );
    const secondOwnerSlug = await readPersonalOrganizationSlug(
      harness,
      "owner-b@example.com"
    );

    expect(apiSlug).toMatch(API_PERSONAL_ORGANIZATION_SLUG_PATTERN);
    expect(firstOwnerSlug).toMatch(OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN);
    expect(secondOwnerSlug).toMatch(OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN);
    expect(secondOwnerSlug).not.toBe(firstOwnerSlug);
    expect([apiSlug, firstOwnerSlug, secondOwnerSlug]).not.toContain(
      "owner-example-2"
    );
  });

  it("rejects personal organization invitations fail closed", async () => {
    const { auth, harness, sentEmails } = await createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    await verifyUserEmail(harness, "owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "owner@example.com",
      password,
    });
    const personalOrganization = requireRow<{ id: string }>(
      await harness.queryFirst({
        values: ["owner@example.com"],
        text: `
          select organizations.id
          from "openmeld"."organizations"
          inner join "openmeld"."members" on members.organization_id = organizations.id
          inner join "openmeld"."users" on users.id = members.user_id
          where users.email = $1
            and ((organizations.metadata)::jsonb #>> '{personal}') = 'true'
        `,
      }),
      "Expected personal organization"
    );

    const inviteResponse = await postAuth(
      auth,
      "/organization/invite-member",
      {
        email: "member@example.com",
        organizationId: personalOrganization.id,
        role: "member",
      },
      ownerHeaders
    );

    expect(inviteResponse.status).toBe(400);
    await expect(readErrorCode(inviteResponse)).resolves.toBe(
      "organization.personal_no_members"
    );
    expect(
      await harness.queryFirst({
        values: [personalOrganization.id],
        text: 'select id from "openmeld"."invitations" where organization_id = $1',
      })
    ).toBeNull();
    expect(sentEmails.some((email) => email.to === "member@example.com")).toBe(
      false
    );
  });

  it("allows the OpenMeld organization slug while rejecting reserved route slugs", async () => {
    const { auth, harness } = await createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    await verifyUserEmail(harness, "owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "owner@example.com",
      password,
    });

    const openMeldCreateResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "OpenMeld",
        slug: "openmeld",
      },
      ownerHeaders
    );
    expect(openMeldCreateResponse.status).toBe(200);

    const reservedCreateResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "API",
        slug: "api",
      },
      ownerHeaders
    );
    expect(reservedCreateResponse.status).toBe(400);
    await expect(readErrorCode(reservedCreateResponse)).resolves.toBe(
      "organization.slug_invalid"
    );

    const personalPrefixCreateResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "Personal Team",
        slug: "personal-team",
      },
      ownerHeaders
    );
    expect(personalPrefixCreateResponse.status).toBe(400);
    await expect(readErrorCode(personalPrefixCreateResponse)).resolves.toBe(
      "organization.slug_invalid"
    );

    const createResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "Acme Team",
        slug: "acme-team",
      },
      ownerHeaders
    );
    expect(createResponse.status).toBe(200);
    const organization = (await createResponse.json()) as { id: string };

    const reservedUpdateResponse = await postAuth(
      auth,
      "/organization/update",
      {
        data: { slug: "support" },
        organizationId: organization.id,
      },
      ownerHeaders
    );
    expect(reservedUpdateResponse.status).toBe(400);
    await expect(readErrorCode(reservedUpdateResponse)).resolves.toBe(
      "organization.slug_invalid"
    );

    const personalPrefixUpdateResponse = await postAuth(
      auth,
      "/organization/update",
      {
        data: { slug: "personal-acme-team" },
        organizationId: organization.id,
      },
      ownerHeaders
    );
    expect(personalPrefixUpdateResponse.status).toBe(400);
    await expect(readErrorCode(personalPrefixUpdateResponse)).resolves.toBe(
      "organization.slug_invalid"
    );
  });

  it("reserves organization logo writes for the managed logo endpoint", async () => {
    const { auth, harness } = await createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    await verifyUserEmail(harness, "owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "owner@example.com",
      password,
    });

    const createWithLogoResponse = await postAuth(
      auth,
      "/organization/create",
      {
        logo: "https://example.com/unmanaged.png",
        name: "Logo Team",
        slug: "logo-team",
      },
      ownerHeaders
    );
    expect(createWithLogoResponse.status).toBe(400);
    await expect(readErrorCode(createWithLogoResponse)).resolves.toBe(
      "organization.logo_managed"
    );

    const createResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "Acme Team",
        slug: "acme-team",
      },
      ownerHeaders
    );
    expect(createResponse.status).toBe(200);
    const organization = (await createResponse.json()) as { id: string };

    const updateWithLogoResponse = await postAuth(
      auth,
      "/organization/update",
      {
        data: { logo: "https://example.com/unmanaged.png" },
        organizationId: organization.id,
      },
      ownerHeaders
    );
    expect(updateWithLogoResponse.status).toBe(400);
    await expect(readErrorCode(updateWithLogoResponse)).resolves.toBe(
      "organization.logo_managed"
    );
    expect(
      await harness.queryFirst({
        values: [organization.id],
        text: 'select logo from "openmeld"."organizations" where id = $1',
      })
    ).toEqual({ logo: null });
  });

  it("keeps personal classification under OpenMeld's managed metadata boundary", async () => {
    const { auth, harness } = await createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    await verifyUserEmail(harness, "owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "owner@example.com",
      password,
    });

    const createWithMetadataResponse = await postAuth(
      auth,
      "/organization/create",
      {
        metadata: { personal: true },
        name: "Spoofed Personal Team",
        slug: "spoofed-personal-team",
      },
      ownerHeaders
    );
    expect(createWithMetadataResponse.status).toBe(400);
    await expect(readErrorCode(createWithMetadataResponse)).resolves.toBe(
      "organization.metadata_managed"
    );

    const personalOrganization = requireRow<{ id: string }>(
      await harness.queryFirst({
        values: ["owner@example.com"],
        text: `
          select organizations.id
          from "openmeld"."organizations"
          inner join "openmeld"."members" on members.organization_id = organizations.id
          inner join "openmeld"."users" on users.id = members.user_id
          where users.email = $1
        `,
      }),
      "Expected personal organization"
    );
    const updateMetadataResponse = await postAuth(
      auth,
      "/organization/update",
      {
        data: { metadata: { personal: false } },
        organizationId: personalOrganization.id,
      },
      ownerHeaders
    );
    expect(updateMetadataResponse.status).toBe(400);
    await expect(readErrorCode(updateMetadataResponse)).resolves.toBe(
      "organization.metadata_managed"
    );

    const updateSlugResponse = await postAuth(
      auth,
      "/organization/update",
      {
        data: { slug: "owner-workspace" },
        organizationId: personalOrganization.id,
      },
      ownerHeaders
    );
    expect(updateSlugResponse.status).toBe(200);
    const stored = requireRow<{ metadata: string | null; slug: string }>(
      await harness.queryFirst({
        values: [personalOrganization.id],
        text: 'select metadata, slug from "openmeld"."organizations" where id = $1',
      }),
      "Expected updated personal organization"
    );
    expect(stored.slug).toBe("owner-workspace");
    expect(parseOrganizationMetadata(stored.metadata)).toMatchObject({
      personal: true,
    });
  });

  it("rejects invitation acceptance for the wrong email and accepts it for the verified recipient", async () => {
    const { auth, harness, sentEmails } = await createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    await verifyUserEmail(harness, "owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "owner@example.com",
      password,
    });
    const createOrganizationResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "Acme Team",
        slug: "acme-team",
      },
      ownerHeaders
    );
    expect(createOrganizationResponse.status).toBe(200);
    const ownerOrganization = (await createOrganizationResponse.json()) as {
      id: string;
    };

    const inviteResponse = await postAuth(
      auth,
      "/organization/invite-member",
      {
        email: "member@example.com",
        organizationId: ownerOrganization.id,
        role: "member",
      },
      ownerHeaders
    );
    expect(inviteResponse.status).toBe(200);
    const invitation = (await inviteResponse.json()) as { id: string };
    expect(
      sentEmails.some(
        (email) =>
          email.to === "member@example.com" &&
          email.subject === "Join Acme Team on OpenMeld"
      )
    ).toBe(true);

    await signUp(auth, {
      email: "wrong@example.com",
      name: "Wrong Recipient",
      password,
    });
    await verifyUserEmail(harness, "wrong@example.com");
    const wrongRecipientHeaders = await signIn(auth, {
      email: "wrong@example.com",
      password,
    });
    const wrongAcceptResponse = await postAuth(
      auth,
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      wrongRecipientHeaders
    );

    expect(wrongAcceptResponse.status).toBe(403);
    expect(
      await harness.queryFirst({
        values: [ownerOrganization.id, "wrong@example.com"],
        text: `
          select members.id
          from "openmeld"."members"
          inner join "openmeld"."users" on users.id = members.user_id
          where members.organization_id = $1 and users.email = $2
        `,
      })
    ).toBeNull();

    await signUp(auth, {
      email: "member@example.com",
      name: "Member Example",
      password,
    });
    await verifyUserEmail(harness, "member@example.com");
    const memberHeaders = await signIn(auth, {
      email: "member@example.com",
      password,
    });
    const acceptResponse = await postAuth(
      auth,
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      memberHeaders
    );

    expect(acceptResponse.status).toBe(200);
    const acceptedMember = requireRow<{
      activeOrganizationId: string;
      invitationStatus: string;
      role: string;
    }>(
      await harness.queryFirst({
        values: [invitation.id, "member@example.com"],
        text: `
          select
            invitations.status as "invitationStatus",
            members.role as role,
            sessions.active_organization_id as "activeOrganizationId"
          from "openmeld"."invitations"
          inner join "openmeld"."members" on members.organization_id = invitations.organization_id
          inner join "openmeld"."users" on users.id = members.user_id
          inner join "openmeld"."sessions" on sessions.user_id = users.id
          where invitations.id = $1 and users.email = $2
        `,
      }),
      "Expected accepted member"
    );

    expect(acceptedMember).toEqual({
      activeOrganizationId: ownerOrganization.id,
      invitationStatus: "accepted",
      role: "member",
    });
  });

  it("falls back to the inviter email local-part when the inviter name is empty", async () => {
    const { auth, harness, sentEmails } = await createTestAuth();

    await signUp(auth, {
      email: "github-owner@example.com",
      name: "",
      password,
    });
    await verifyUserEmail(harness, "github-owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "github-owner@example.com",
      password,
    });
    const createOrganizationResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "Acme Team",
        slug: "acme-team",
      },
      ownerHeaders
    );
    expect(createOrganizationResponse.status).toBe(200);
    const ownerOrganization = (await createOrganizationResponse.json()) as {
      id: string;
    };

    const inviteResponse = await postAuth(
      auth,
      "/organization/invite-member",
      {
        email: "member@example.com",
        organizationId: ownerOrganization.id,
        role: "member",
      },
      ownerHeaders
    );

    expect(inviteResponse.status).toBe(200);
    expect(
      sentEmails.some(
        (email) =>
          email.to === "member@example.com" &&
          email.subject === "Join Acme Team on OpenMeld" &&
          email.text?.includes("github-owner invited you to join Acme Team")
      )
    ).toBe(true);
  });

  it("logs organization invitation email failures with the invitation id", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const emailError = new Error("Cloudflare Email unavailable");
    const emailSender: CloudflareEmailSender = {
      send: (message) => {
        if (toSentEmail(message).subject === "Join Acme Team on OpenMeld") {
          return Promise.reject(emailError);
        }

        return Promise.resolve({ messageId: "sent" });
      },
    };
    const { auth, harness } = await createTestAuth({ sender: emailSender });

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    await verifyUserEmail(harness, "owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "owner@example.com",
      password,
    });
    const createOrganizationResponse = await postAuth(
      auth,
      "/organization/create",
      {
        name: "Acme Team",
        slug: "acme-team",
      },
      ownerHeaders
    );
    expect(createOrganizationResponse.status).toBe(200);
    const ownerOrganization = (await createOrganizationResponse.json()) as {
      id: string;
    };

    const inviteResponse = await postAuth(
      auth,
      "/organization/invite-member",
      {
        email: "member@example.com",
        organizationId: ownerOrganization.id,
        role: "member",
      },
      ownerHeaders
    );
    expect(inviteResponse.status).toBe(200);
    const invitation = (await inviteResponse.json()) as { id: string };

    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorName: "Error",
        event: "auth.organization.invitation_email_failed",
        invitationId: invitation.id,
        message: "Cloudflare Email unavailable",
        organizationId: ownerOrganization.id,
      })
    );
  });

  it("fails closed when the member removal guard database is unbound", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auth, harness } = await createTestAuth();
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    await expect(
      assertCenterAgentIdentityBeforeMemberRemoval({
        organizationId: membership.organizationId,
        userId: membership.memberUserId,
      })
    ).rejects.toMatchObject({
      status: "SERVICE_UNAVAILABLE",
      body: {
        code: "organization.center_agent_member_removal_guard_failed",
        message: CENTER_AGENT_MEMBER_REMOVAL_GUARD_FAILED_MESSAGE,
      },
    });
    expect(log).toHaveBeenCalledWith(
      "[auth.center_agent_member_removal_guard_failed]",
      expect.objectContaining({
        organizationId: membership.organizationId,
        reason: "openmeld_db_unbound",
        userId: membership.memberUserId,
      })
    );
    expect(
      await harness.queryFirst({
        text: 'SELECT id FROM "openmeld"."members" WHERE id=$1 AND organization_id=$2 AND user_id=$3',
        values: [
          membership.memberId,
          membership.organizationId,
          membership.memberUserId,
        ],
      })
    ).toEqual({ id: membership.memberId });
  });

  it("fails closed when the Center Agent identity query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auth, harness } = await createTestAuth({
      centerAgentRemovalGuardDatabase: "query_failure",
    });
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });

    const outcome = await readMemberRemovalGuardOutcome({
      auth,
      harness,
      membership,
    });

    expect(outcome).toMatchObject({
      guardLog: [
        "[auth.center_agent_member_removal_guard_failed]",
        {
          error: "Center Agent identity query unavailable",
          event: "auth.center_agent_member_removal_guard_failed",
          organizationId: membership.organizationId,
          reason: "center_agent_identity_query_failed",
          userId: membership.memberUserId,
        },
      ],
      memberId: membership.memberId,
      message: CENTER_AGENT_MEMBER_REMOVAL_GUARD_FAILED_MESSAGE,
      status: 503,
    });
  });

  it("fails closed when the designated Center Agent profile is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auth, harness } = await createTestAuth();
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    await insertCenterAgentDesignation(harness, {
      createdByUserId: membership.ownerUserId,
      designatedByUserId: membership.ownerUserId,
      organizationId: membership.organizationId,
      profileId: "agt_00000000-0000-4000-8000-000000000003",
    });
    injectCenterAgentIdentityReadFault((row) => ({ ...row, profile_id: null }));

    const outcome = await readMemberRemovalGuardOutcome({
      auth,
      harness,
      membership,
    });

    expect(outcome).toMatchObject({
      guardLog: [
        "[auth.center_agent_member_removal_guard_failed]",
        {
          event: "auth.center_agent_member_removal_guard_failed",
          organizationId: membership.organizationId,
          reason: "center_agent_profile_missing",
          userId: membership.memberUserId,
        },
      ],
      memberId: membership.memberId,
      message: CENTER_AGENT_MEMBER_REMOVAL_GUARD_FAILED_MESSAGE,
      status: 503,
    });
  });

  it.each([
    { field: "organization_id", value: "another-organization" },
    { field: "profile_kind", value: "human" },
    { field: "managed_role", value: null },
    { field: "owner_user_id", value: "unexpected-owner" },
  ])("fails closed for a mismatched Center Agent identity ($field)", async ({
    field,
    value,
  }) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auth, harness } = await createTestAuth();
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    await insertCenterAgentDesignation(harness, {
      designatedByUserId: membership.ownerUserId,
      createdByUserId: membership.ownerUserId,
      organizationId: membership.organizationId,
      profileId: "agt_00000000-0000-4000-8000-000000000004",
    });
    // Corrupt the captured native read result to exercise the API guard while
    // preserving the current database's foreign keys and identity constraints.
    injectCenterAgentIdentityReadFault((row) => ({ ...row, [field]: value }));
    expect(
      await readMemberRemovalGuardOutcome({ auth, harness, membership })
    ).toMatchObject({
      guardLog: [
        "[auth.center_agent_member_removal_guard_failed]",
        {
          reason: "center_agent_identity_mismatch",
          organizationId: membership.organizationId,
        },
      ],
      memberId: membership.memberId,
      message: CENTER_AGENT_MEMBER_REMOVAL_GUARD_FAILED_MESSAGE,
      status: 503,
    });
  });

  it.each([
    "remove",
    "leave",
  ] as const)("requires Space handoff through the native Organization %s endpoint", async (action) => {
    const checkSpaceOwnerDeparture = vi.fn(async () => ({
      spaces: [{ spaceId: "handoff-space", name: "Engineering" }],
    }));
    const { auth, harness } = await createTestAuth({
      checkSpaceOwnerDeparture,
    });
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    const headers =
      action === "remove"
        ? membership.ownerHeaders
        : await signIn(auth, { email: "member@example.com", password });
    const response = await postAuth(
      auth,
      action === "remove"
        ? "/organization/remove-member"
        : "/organization/leave",
      {
        organizationId: membership.organizationId,
        ...(action === "remove"
          ? { memberIdOrEmail: membership.memberId }
          : {}),
      },
      headers
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "space.ownership_handoff_required",
      message: expect.stringContaining("Engineering"),
    });
    expect(checkSpaceOwnerDeparture).toHaveBeenCalledWith({
      organizationId: membership.organizationId,
      userId: membership.memberUserId,
    });
    expect(
      await harness.queryFirst({
        text: 'select id from "openmeld"."members" where id = $1',
        values: [membership.memberId],
      })
    ).toBeTruthy();
  });

  it.each([
    "creator and designator",
    "another member",
  ])("allows removing %s while preserving the Center Agent and member cleanup", async (removedActor) => {
    const requestSessionInventoryCleanup = vi
      .fn()
      .mockResolvedValueOnce({
        accepted: true,
        deleted: { candidateCount: 1, inventoryCount: 2, sourceCount: 1 },
        ok: true,
        pending: true,
      })
      .mockResolvedValueOnce({
        accepted: true,
        deleted: { candidateCount: 0, inventoryCount: 0, sourceCount: 0 },
        ok: true,
        pending: false,
      });
    const coreWorker = {
      checkSpaceOwnerDeparture: vi.fn(async () => ({ spaces: [] })),
      organizationJoinRequest: vi.fn(() => {
        throw new Error(
          "Member removal must not invoke the Organization join receiver."
        );
      }),
      spaceInvitation: vi.fn(() => {
        throw new Error(
          "Member removal must not invoke the Space invitation receiver."
        );
      }),
      requestAgentActivitySessionInventoryCleanupForOrganizationMember:
        requestSessionInventoryCleanup,
      deleteCenterAgentMemberMemory: vi
        .fn()
        .mockResolvedValue({ ok: true, status: "not_found" }),
      deleteCenterAgentOrganizationMemory: vi
        .fn()
        .mockResolvedValue({ ok: true, status: "not_found" }),
    } satisfies NonNullable<AuthConfigEnv["OPENMELD_CORE_WORKER"]>;
    const { auth, harness } = await createTestAuth({ coreWorker });
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    const attributionUserId =
      removedActor === "creator and designator"
        ? membership.memberUserId
        : membership.ownerUserId;
    const profileId = "agt_00000000-0000-4000-8000-000000000002";
    await insertCenterAgentDesignation(harness, {
      designatedByUserId: attributionUserId,
      organizationId: membership.organizationId,
      createdByUserId: attributionUserId,
      profileId,
    });

    const response = await postAuth(
      auth,
      "/organization/remove-member",
      {
        memberIdOrEmail: membership.memberId,
        organizationId: membership.organizationId,
      },
      membership.ownerHeaders
    );

    expect(response.status).toBe(200);
    expect(
      await harness.queryFirst({
        values: [membership.memberId],
        text: 'select id from "openmeld"."members" where id = $1',
      })
    ).toBeNull();
    expect(requestSessionInventoryCleanup).toHaveBeenCalledTimes(2);
    expect(
      await harness.queryFirst({
        values: [profileId],
        text: 'select organization_id, owner_user_id, created_by_user_id from "openmeld"."openmeld_profiles" where profile_id = $1',
      })
    ).toEqual({
      organization_id: membership.organizationId,
      owner_user_id: null,
      created_by_user_id: attributionUserId,
    });
    expect(
      await harness.queryFirst({
        values: [membership.organizationId],
        text: 'select agent_profile_id, designated_by from "openmeld"."center_agent_designations" where organization_id = $1',
      })
    ).toEqual({
      agent_profile_id: profileId,
      designated_by: attributionUserId,
    });
    expect(requestSessionInventoryCleanup).toHaveBeenCalledWith({
      organizationId: membership.organizationId,
      userId: membership.memberUserId,
    });
  });

  it("enforces the default owner, admin, and member organization statements", () => {
    expect(
      organizationRoles.owner.authorize({
        centerAgent: ["designate"],
        joinLink: ["create", "read", "revoke"],
        organizationLogo: ["update"],
        organization: ["delete"],
        routine: ["create", "read", "update", "delete"],
        space: ["delete"],
      })
    ).toEqual({ success: true });

    expect(
      organizationRoles.admin.authorize({
        centerAgent: ["designate"],
        joinLink: ["create", "read", "revoke"],
        organization: ["update"],
        routine: ["create", "read", "update", "delete"],
        space: ["create", "read", "update", "delete"],
      })
    ).toEqual({ success: true });
    expect(
      organizationRoles.admin.authorize({ organizationLogo: ["update"] })
        .success
    ).toBe(false);
    expect(
      organizationRoles.admin.authorize({ organization: ["delete"] }).success
    ).toBe(false);

    expect(
      organizationRoles.member.authorize({
        centerAgent: ["read"],
        routine: ["create", "read"],
        space: ["read"],
      })
    ).toEqual({ success: true });
    expect(
      organizationRoles.member.authorize({ space: ["create"] }).success
    ).toBe(false);
    expect(
      organizationRoles.member.authorize({ invitation: ["create"] }).success
    ).toBe(false);
    expect(
      organizationRoles.member.authorize({ organizationLogo: ["update"] })
        .success
    ).toBe(false);
    expect(
      organizationRoles.member.authorize({ joinLink: ["create"] }).success
    ).toBe(false);
    expect(
      organizationRoles.member.authorize({ routine: ["update"] }).success
    ).toBe(false);
    expect(
      organizationRoles.member.authorize({ routine: ["delete"] }).success
    ).toBe(false);
  });
});

async function createTestAuth(
  input: {
    centerAgentRemovalGuardDatabase?: "bound" | "query_failure";
    coreWorker?: AuthConfigEnv["OPENMELD_CORE_WORKER"];
    checkSpaceOwnerDeparture?: NonNullable<
      AuthConfigEnv["OPENMELD_CORE_WORKER"]
    >["checkSpaceOwnerDeparture"];
    enforceOriginCheck?: boolean;
    legacyAppOrigin?: string;
    sender?: CloudflareEmailSender;
  } = {}
): Promise<{
  auth: AuthInstance;
  harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  sentEmails: SentEmail[];
}> {
  const harness = await createPostgresHarness();
  harnesses.push(harness);
  const fakeEmailSender = createFakeEmailSender();
  const sender = input.sender ?? fakeEmailSender.sender;
  const unexpectedCoreCall = () => {
    throw new Error("Unexpected Core call in Organization identity test");
  };
  const coreWorker =
    input.coreWorker ??
    ({
      checkSpaceOwnerDeparture:
        input.checkSpaceOwnerDeparture ?? (async () => ({ spaces: [] })),
      organizationJoinRequest: unexpectedCoreCall,
      spaceInvitation: unexpectedCoreCall,
      requestAgentActivitySessionInventoryCleanupForOrganizationMember:
        unexpectedCoreCall,
      deleteCenterAgentMemberMemory: unexpectedCoreCall,
      deleteCenterAgentOrganizationMemory: unexpectedCoreCall,
    } satisfies NonNullable<AuthConfigEnv["OPENMELD_CORE_WORKER"]>);
  const authConfigInput = {
    OPENMELD_CORE_WORKER: coreWorker,
    AUTH_BRAND_NAME: "OpenMeld",
    AUTH_COOKIE_DOMAIN: "localhost",
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli",
    AUTH_EMAIL: sender,
    AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS: "300",
    AUTH_LEGACY_APP_ORIGIN: input.legacyAppOrigin,
    AUTH_WORKER_NODE_ENV: input.enforceOriginCheck
      ? "production"
      : "development",
    BETTER_AUTH_OPENMELD_SECRET: validSecret,
    BETTER_AUTH_URL: AUTH_BASE_URL,
    PASSKEY_RP_ID: "localhost",
    WEB_APP_URL,
  } as const;
  if (input.centerAgentRemovalGuardDatabase === "query_failure") {
    const native = PostgresDatabase.prototype.query;
    vi.spyOn(PostgresDatabase.prototype, "query").mockImplementation(function (
      this: PostgresDatabase,
      query,
      values
    ) {
      const text = typeof query === "string" ? query : query.text;
      if (text.includes('"center_agent_designations"')) {
        throw new Error("Center Agent identity query unavailable");
      }
      return native.call(this, query, values);
    });
  }
  const auth: AuthInstance = {
    handler: (request) =>
      withPostgresRequest(harness.binding, async () => {
        const baseAuthConfig = createAuthConfig({
          ...authConfigInput,
          OPENMELD_POSTGRESQL: harness.binding,
        });
        const authConfig = input.enforceOriginCheck
          ? {
              ...baseAuthConfig,
              advanced: {
                ...baseAuthConfig.advanced,
                disableOriginCheck: false,
              },
            }
          : baseAuthConfig;
        return await betterAuth(authConfig).handler(request);
      }),
  };

  return { auth, harness, sentEmails: fakeEmailSender.sentEmails };
}

async function createOrganizationWithAcceptedMember(input: {
  auth: AuthInstance;
  harness: Awaited<ReturnType<typeof createPostgresHarness>>;
}): Promise<{
  memberId: string;
  memberUserId: string;
  organizationId: string;
  ownerHeaders: Headers;
  ownerUserId: string;
}> {
  await signUp(input.auth, {
    email: "owner@example.com",
    name: "Owner Example",
    password,
  });
  await verifyUserEmail(input.harness, "owner@example.com");
  const ownerHeaders = await signIn(input.auth, {
    email: "owner@example.com",
    password,
  });
  const createOrganizationResponse = await postAuth(
    input.auth,
    "/organization/create",
    { name: "Acme Team", slug: "acme-team" },
    ownerHeaders
  );
  if (!createOrganizationResponse.ok) {
    throw new Error("Expected test organization creation to succeed");
  }
  const organization = (await createOrganizationResponse.json()) as {
    id: string;
  };
  const inviteResponse = await postAuth(
    input.auth,
    "/organization/invite-member",
    {
      email: "member@example.com",
      organizationId: organization.id,
      role: "member",
    },
    ownerHeaders
  );
  if (!inviteResponse.ok) {
    throw new Error("Expected test organization invitation to succeed");
  }
  const invitation = (await inviteResponse.json()) as { id: string };
  await signUp(input.auth, {
    email: "member@example.com",
    name: "Member Example",
    password,
  });
  await verifyUserEmail(input.harness, "member@example.com");
  const memberHeaders = await signIn(input.auth, {
    email: "member@example.com",
    password,
  });
  const acceptResponse = await postAuth(
    input.auth,
    "/organization/accept-invitation",
    { invitationId: invitation.id },
    memberHeaders
  );
  if (!acceptResponse.ok) {
    throw new Error(
      "Expected test organization invitation acceptance to succeed"
    );
  }
  const owner = requireRow<{ id: string }>(
    await input.harness.queryFirst({
      values: ["owner@example.com"],
      text: 'select id from "openmeld"."users" where email = $1',
    }),
    "Expected organization owner"
  );
  const member = requireRow<{ id: string; userId: string }>(
    await input.harness.queryFirst({
      values: [organization.id, "member@example.com"],
      text: `
        select members.id, members.user_id as "userId"
        from "openmeld"."members"
        inner join "openmeld"."users" on users.id = members.user_id
        where members.organization_id = $1 and users.email = $2
      `,
    }),
    "Expected accepted organization member"
  );
  return {
    memberId: member.id,
    memberUserId: member.userId,
    organizationId: organization.id,
    ownerHeaders,
    ownerUserId: owner.id,
  };
}

async function readMemberRemovalGuardOutcome(input: {
  auth: AuthInstance;
  harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  membership: Awaited<ReturnType<typeof createOrganizationWithAcceptedMember>>;
}): Promise<{
  guardLog: unknown[] | undefined;
  memberId: string | null;
  message: unknown;
  status: number;
}> {
  const response = await postAuth(
    input.auth,
    "/organization/remove-member",
    {
      memberIdOrEmail: input.membership.memberId,
      organizationId: input.membership.organizationId,
    },
    input.membership.ownerHeaders
  );
  const body = (await response.json()) as { message?: unknown };
  const member = await input.harness.queryFirst<{ id: string }>({
    values: [input.membership.memberId],
    text: 'select id from "openmeld"."members" where id = $1',
  });
  const guardLog = vi
    .mocked(console.error)
    .mock.calls.find(
      ([event]) => event === "[auth.center_agent_member_removal_guard_failed]"
    );

  return {
    guardLog,
    memberId: member?.id ?? null,
    message: body.message,
    status: response.status,
  };
}

async function insertCenterAgentDesignation(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    designatedByUserId: string;
    organizationId: string;
    createdByUserId: string;
    profileId: string;
  }
): Promise<void> {
  const now = Date.now();
  await harness.query({
    values: [
      input.profileId,
      "Acme Center Agent",
      "acme-center-agent",
      input.organizationId,
      input.createdByUserId,
      now,
      now,
    ],
    text: `
      insert into "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_by_user_id,
        source,
        managed_role,
        created_at,
        updated_at
      ) values ($1, $2, $3, 'agent', 0, 'active', $4, null, $5, 'auth_bootstrap', 'center_agent', $6, $7)
    `,
  });
  await harness.query({
    values: [
      input.organizationId,
      input.profileId,
      input.designatedByUserId,
      now,
    ],
    text: `
      insert into "openmeld"."center_agent_designations" (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      ) values ($1, $2, null, $3, $4)
    `,
  });
}

function injectCenterAgentIdentityReadFault(
  mutate: (row: Record<string, unknown>) => Record<string, unknown>
): void {
  const nativeQuery = PostgresDatabase.prototype.query;
  vi.spyOn(PostgresDatabase.prototype, "query").mockImplementation(
    async function (this: PostgresDatabase, query, values) {
      const result = await nativeQuery.call(this, query, values);
      const text = typeof query === "string" ? query : query.text;
      if (
        text.includes('"center_agent_designations" AS designations') &&
        text.includes("profiles.managed_role")
      ) {
        return { ...result, rows: result.rows.map(mutate) };
      }
      return result;
    }
  );
}

async function signUp(
  auth: AuthInstance,
  input: { email: string; name: string; password: string }
): Promise<void> {
  const response = await postAuth(auth, "/sign-up/email", input);
  if (!response.ok) {
    throw new Error(
      `Sign-up failed: ${response.status} ${await response.text()}`
    );
  }
}

async function signIn(
  auth: AuthInstance,
  input: { email: string; password: string }
): Promise<Headers> {
  const response = await postAuth(auth, "/sign-in/email", input);
  if (!response.ok) {
    throw new Error(
      `Sign-in failed: ${response.status} ${await response.text()}`
    );
  }

  return convertSetCookieToCookieHeader(response.headers);
}

function postAuth(
  auth: AuthInstance,
  pathname: string,
  body: Record<string, unknown>,
  headers?: Headers
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  requestHeaders.set("origin", WEB_APP_URL);

  return auth.handler(
    new Request(`${AUTH_BASE_URL}/api/auth${pathname}`, {
      body: JSON.stringify(body),
      headers: requestHeaders,
      method: "POST",
    })
  );
}

async function insertLegacyCredentialUser(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: { email: string; id: string; name: string; password: string }
): Promise<void> {
  const now = Date.now();
  const passwordHash = await hashPassword(input.password);

  await harness.query({
    values: [
      input.id,
      input.name,
      input.email,
      1,
      now,
      now,
      input.email.toLowerCase(),
    ],
    text: `
      insert into "openmeld"."users" (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at,
        normalized_email
      )
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
  });
  await harness.query({
    values: [
      `account-${input.id}`,
      input.id,
      "credential",
      input.id,
      passwordHash,
      now,
      now,
    ],
    text: `
      insert into "openmeld"."accounts" (
        id,
        account_id,
        provider_id,
        user_id,
        password,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
  });
}

async function verifyUserEmail(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  email: string
): Promise<void> {
  await harness.query({
    values: [email],
    text: 'update "openmeld"."users" set email_verified = 1 where email = $1',
  });
}

function parseOrganizationMetadata(
  value: string | null
): Record<string, unknown> {
  if (!value) {
    return {};
  }
  return JSON.parse(value) as Record<string, unknown>;
}

async function readPersonalOrganizationSlug(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  email: string
): Promise<string> {
  const organization = requireRow<{ slug: string }>(
    await harness.queryFirst({
      values: [email],
      text: `
        select organizations.slug
        from "openmeld"."organizations"
        inner join "openmeld"."members" on members.organization_id = organizations.id
        inner join "openmeld"."users" on users.id = members.user_id
        where users.email = $1
          and ((organizations.metadata)::jsonb #>> '{personal}') = 'true'
      `,
    }),
    "Expected personal organization"
  );
  return organization.slug;
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string; message?: string };
  return body.code;
}

function convertSetCookieToCookieHeader(sourceHeaders: Headers): Headers {
  const headers = new Headers(sourceHeaders);
  const setCookieHeader = sourceHeaders.get("set-cookie");
  if (!setCookieHeader) {
    return headers;
  }

  headers.set(
    "cookie",
    splitSetCookieHeader(setCookieHeader)
      .map((cookie) => cookie.split(";").at(0)?.trim())
      .filter((cookie): cookie is string => Boolean(cookie))
      .join("; ")
  );
  return headers;
}

function splitSetCookieHeader(value: string): string[] {
  return value
    .split(SET_COOKIE_SEPARATOR_PATTERN)
    .map((cookie) => cookie.trim());
}

function createFakeEmailSender(): {
  sender: CloudflareEmailSender;
  sentEmails: SentEmail[];
} {
  const sentEmails: SentEmail[] = [];
  const sender: CloudflareEmailSender = {
    send(message) {
      sentEmails.push(toSentEmail(message));
      return Promise.resolve({ messageId: `test-${sentEmails.length}` });
    },
  };

  return { sender, sentEmails };
}

function requireMagicLinkEmailUrl(
  sentEmails: SentEmail[],
  recipient: string
): URL {
  const sentEmail = sentEmails.find(
    (email) => email.to === recipient && email.subject === "Sign in to OpenMeld"
  );
  const urls = sentEmail?.text?.match(EMAIL_URL_PATTERN);
  if (urls?.length !== 1) {
    throw new Error(`Expected a magic-link email for ${recipient}`);
  }
  return new URL(urls[0]);
}

function toSentEmail(message: unknown): SentEmail {
  if (!message || typeof message !== "object") {
    throw new Error("Test email sender received an invalid email payload");
  }

  if (!("from" in message && "subject" in message && "to" in message)) {
    throw new Error("Test email sender only supports EmailMessageBuilder");
  }

  return message as SentEmail;
}

function requireRow<TRow>(
  row: TRow | null,
  message: string
): NonNullable<TRow> {
  if (!row) {
    throw new Error(message);
  }

  return row;
}
