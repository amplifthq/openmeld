import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthConfigEnv,
  createAuthConfig,
} from "../src/configs/auth.config";
import { organizationRoles } from "../src/organization/access-control";
import type { CloudflareEmailSender } from "../src/utils/email";

type SqliteBindValue = number | string | null;
type AuthInstance = ReturnType<typeof betterAuth>;
type TestPreparedStatement = D1PreparedStatement & {
  __runInTransaction: () => unknown;
};
type SentEmail = {
  from: string | EmailAddress;
  html?: string;
  subject: string;
  text?: string;
  to: string | EmailAddress | (string | EmailAddress)[];
};

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const AUTH_BASE_URL = "http://localhost:8788";
const WEB_APP_URL = "http://localhost:3000";
const validSecret = "12345678901234567890123456789012345678901234";
const password = "correct-horse-battery-staple";
const SET_COOKIE_SEPARATOR_PATTERN = /,(?=\s*[^;,]+=)/;
const API_PERSONAL_ORGANIZATION_SLUG_PATTERN = /^api-[0-9a-hjkmnp-tv-z]{6}$/;
const OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN =
  /^owner-example-[0-9a-hjkmnp-tv-z]{6}$/;
const GITHUB_OWNER_PERSONAL_ORGANIZATION_SLUG_PATTERN =
  /^github-owner-[0-9a-hjkmnp-tv-z]{6}$/;
const LEGACY_PERSONAL_ORGANIZATION_SLUG_PATTERN =
  /^legacy-example-[0-9a-hjkmnp-tv-z]{6}$/;
const CENTER_AGENT_HOST_GUARD_FAILED_MESSAGE =
  "OpenMeld couldn't verify that this member can be removed. The member was not removed.";

const harnesses: { close(): void }[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
  vi.restoreAllMocks();
});

describe("organization identity foundation", () => {
  it("rejects cookieless cross-origin magic-link email requests", async () => {
    const { auth, sentEmails } = createTestAuth({ enforceOriginCheck: true });
    const response = await auth.handler(
      new Request(`${AUTH_BASE_URL}/api/auth/sign-in/magic-link`, {
        body: JSON.stringify({ email: "attacker@example.com" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.invalid",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
    expect(sentEmails).toEqual([]);
  });

  it("creates a personal organization and stores it as the active session organization", async () => {
    const { auth, harness, sentEmails } = createTestAuth();

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
      harness.queryFirst({
        params: ["owner@example.com"],
        sql: `
          select id, normalized_email as normalizedEmail
          from users
          where email = ?
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
      harness.queryFirst({
        params: [user.id],
        sql: `
          select
            organizations.id,
            organizations.metadata,
            organizations.name,
            organizations.slug
          from organizations
          inner join members on members.organization_id = organizations.id
          where members.user_id = ?
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
      harness.queryAll({
        params: [organization.id],
        sql: "select user_id as userId, role from members where organization_id = ?",
      })
    ).toEqual([{ role: "owner", userId: user.id }]);

    verifyUserEmail(harness, "owner@example.com");
    await signIn(auth, {
      email: "owner@example.com",
      password,
    });

    expect(
      harness.queryFirst({
        params: [user.id],
        sql: `
          select active_organization_id as activeOrganizationId
          from sessions
          where user_id = ?
        `,
      })
    ).toEqual({ activeOrganizationId: organization.id });
  });

  it("rejects creating a sixth organization without changing existing memberships", async () => {
    const { auth, harness } = createTestAuth();

    await signUp(auth, {
      email: "limit-owner@example.com",
      name: "Limit Owner",
      password,
    });
    verifyUserEmail(harness, "limit-owner@example.com");
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
      harness.queryFirst<{ count: number }>({
        params: ["limit-owner@example.com"],
        sql: `
          select count(*) as count
          from organizations
          inner join members on members.organization_id = organizations.id
          inner join users on users.id = members.user_id
          where users.email = ?
        `,
      })
    ).toEqual({ count: 5 });
  });

  it("derives the personal organization name from the email local-part when the user name is empty", async () => {
    const { auth, harness } = createTestAuth();

    await signUp(auth, {
      email: "github-owner@example.com",
      name: "",
      password,
    });

    const user = requireRow<{ id: string }>(
      harness.queryFirst({
        params: ["github-owner@example.com"],
        sql: "select id from users where email = ?",
      }),
      "Expected signed-up user"
    );
    const organization = requireRow<{
      name: string;
      slug: string;
    }>(
      harness.queryFirst({
        params: [user.id],
        sql: `
          select
            organizations.name,
            organizations.slug
          from organizations
          inner join members on members.organization_id = organizations.id
          where members.user_id = ?
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
    const { auth, harness } = createTestAuth();
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
      harness.queryFirst({
        params: [legacyUserId],
        sql: `
          select
            organizations.id,
            organizations.metadata,
            organizations.name,
            organizations.slug
          from organizations
          inner join members on members.organization_id = organizations.id
          where members.user_id = ?
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
      harness.queryAll({
        params: [organization.id],
        sql: "select user_id as userId, role from members where organization_id = ?",
      })
    ).toEqual([{ role: "owner", userId: legacyUserId }]);
    expect(
      harness.queryFirst({
        params: [legacyUserId],
        sql: `
          select active_organization_id as activeOrganizationId
          from sessions
          where user_id = ?
        `,
      })
    ).toEqual({ activeOrganizationId: organization.id });
  });

  it("converges concurrent legacy-user sessions on one personal organization", async () => {
    const { auth, harness } = createTestAuth();
    const legacyUserId = "concurrent-legacy-user";

    await insertLegacyCredentialUser(harness, {
      email: "concurrent-legacy@example.com",
      id: legacyUserId,
      name: "Concurrent Legacy",
      password,
    });

    const [firstHeaders, secondHeaders] = await Promise.all([
      signIn(auth, {
        email: "concurrent-legacy@example.com",
        password,
      }),
      signIn(auth, {
        email: "concurrent-legacy@example.com",
        password,
      }),
    ]);

    const organizations = harness.queryAll<{ id: string }>({
      params: [legacyUserId],
      sql: `
        select organizations.id
        from organizations
        where organizations.created_by_user_id = ?
          and json_extract(organizations.metadata, '$.personal') = 1
      `,
    });
    const sessionOrganizationIds = harness
      .queryAll<{ activeOrganizationId: string }>({
        params: [legacyUserId],
        sql: `
          select active_organization_id as activeOrganizationId
          from sessions
          where user_id = ?
          order by id
        `,
      })
      .map((session) => session.activeOrganizationId);

    expect(firstHeaders.get("cookie")).toBeTruthy();
    expect(secondHeaders.get("cookie")).toBeTruthy();
    expect(organizations).toHaveLength(1);
    expect(new Set(sessionOrganizationIds)).toEqual(
      new Set([organizations[0]?.id])
    );
  });

  it("repairs the winning personal Organization after losing its creation race", async () => {
    const { auth, harness } = createTestAuth();
    const legacyUserId = "race-loser-legacy-user";
    const winningOrganizationId = "11111111-1111-4111-8111-111111111111";

    await insertLegacyCredentialUser(harness, {
      email: "race-loser@example.com",
      id: legacyUserId,
      name: "Race Loser",
      password,
    });
    harness.run({
      params: [winningOrganizationId, legacyUserId],
      sql: `
        insert into organizations (
          id,
          name,
          slug,
          created_at,
          metadata,
          created_by_user_id
        ) values (?, 'Race Winner', 'race-winner-k7m3qx', 1000, '{"personal":true}', ?)
      `,
    });

    const headers = await signIn(auth, {
      email: "race-loser@example.com",
      password,
    });

    expect(headers.get("cookie")).toBeTruthy();
    expect(
      harness.queryAll({
        params: [legacyUserId],
        sql: `
          select id
          from organizations
          where created_by_user_id = ?
            and json_extract(metadata, '$.personal') = 1
        `,
      })
    ).toEqual([{ id: winningOrganizationId }]);
    expect(
      harness.queryAll({
        params: [winningOrganizationId],
        sql: `
          select organization_id as organizationId, user_id as userId, role
          from members
          where organization_id = ?
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
      harness.queryFirst({
        params: [legacyUserId],
        sql: `
          select active_organization_id as activeOrganizationId
          from sessions
          where user_id = ?
        `,
      })
    ).toEqual({ activeOrganizationId: winningOrganizationId });
  });

  it("derives personal organization slugs from the user identity and avoids reserved words and collisions", async () => {
    const { auth, harness } = createTestAuth();

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

    const apiSlug = readPersonalOrganizationSlug(harness, "api@example.com");
    const firstOwnerSlug = readPersonalOrganizationSlug(
      harness,
      "owner-a@example.com"
    );
    const secondOwnerSlug = readPersonalOrganizationSlug(
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
    const { auth, harness, sentEmails } = createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    verifyUserEmail(harness, "owner@example.com");
    const ownerHeaders = await signIn(auth, {
      email: "owner@example.com",
      password,
    });
    const personalOrganization = requireRow<{ id: string }>(
      harness.queryFirst({
        params: ["owner@example.com"],
        sql: `
          select organizations.id
          from organizations
          inner join members on members.organization_id = organizations.id
          inner join users on users.id = members.user_id
          where users.email = ?
            and json_extract(organizations.metadata, '$.personal') = 1
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
      harness.queryFirst({
        params: [personalOrganization.id],
        sql: "select id from invitations where organization_id = ?",
      })
    ).toBeNull();
    expect(sentEmails.some((email) => email.to === "member@example.com")).toBe(
      false
    );
  });

  it("allows the OpenMeld organization slug while rejecting reserved route slugs", async () => {
    const { auth, harness } = createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    verifyUserEmail(harness, "owner@example.com");
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
    const { auth, harness } = createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    verifyUserEmail(harness, "owner@example.com");
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
      harness.queryFirst({
        params: [organization.id],
        sql: "select logo from organizations where id = ?",
      })
    ).toEqual({ logo: null });
  });

  it("keeps personal classification under OpenMeld's managed metadata boundary", async () => {
    const { auth, harness } = createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    verifyUserEmail(harness, "owner@example.com");
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
      harness.queryFirst({
        params: ["owner@example.com"],
        sql: `
          select organizations.id
          from organizations
          inner join members on members.organization_id = organizations.id
          inner join users on users.id = members.user_id
          where users.email = ?
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
      harness.queryFirst({
        params: [personalOrganization.id],
        sql: "select metadata, slug from organizations where id = ?",
      }),
      "Expected updated personal organization"
    );
    expect(stored.slug).toBe("owner-workspace");
    expect(parseOrganizationMetadata(stored.metadata)).toMatchObject({
      personal: true,
    });
  });

  it("rejects invitation acceptance for the wrong email and accepts it for the verified recipient", async () => {
    const { auth, harness, sentEmails } = createTestAuth();

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    verifyUserEmail(harness, "owner@example.com");
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
    verifyUserEmail(harness, "wrong@example.com");
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
      harness.queryFirst({
        params: [ownerOrganization.id, "wrong@example.com"],
        sql: `
          select members.id
          from members
          inner join users on users.id = members.user_id
          where members.organization_id = ? and users.email = ?
        `,
      })
    ).toBeNull();

    await signUp(auth, {
      email: "member@example.com",
      name: "Member Example",
      password,
    });
    verifyUserEmail(harness, "member@example.com");
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
      harness.queryFirst({
        params: [invitation.id, "member@example.com"],
        sql: `
          select
            invitations.status as invitationStatus,
            members.role as role,
            sessions.active_organization_id as activeOrganizationId
          from invitations
          inner join members on members.organization_id = invitations.organization_id
          inner join users on users.id = members.user_id
          inner join sessions on sessions.user_id = users.id
          where invitations.id = ? and users.email = ?
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
    const { auth, harness, sentEmails } = createTestAuth();

    await signUp(auth, {
      email: "github-owner@example.com",
      name: "",
      password,
    });
    verifyUserEmail(harness, "github-owner@example.com");
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
          email.text?.includes(
            "github-owner invited you to join Acme Team on OpenMeld as member."
          )
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
    const { auth, harness } = createTestAuth({ sender: emailSender });

    await signUp(auth, {
      email: "owner@example.com",
      name: "Owner Example",
      password,
    });
    verifyUserEmail(harness, "owner@example.com");
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

  it("rejects removing the member who hosts the designated Center Agent", async () => {
    const { auth, harness } = createTestAuth();
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    const centerAgentProfileId = "agt_00000000-0000-4000-8000-000000000001";
    insertCenterAgentDesignation(harness, {
      designatedByUserId: membership.ownerUserId,
      organizationId: membership.organizationId,
      ownerUserId: membership.memberUserId,
      profileId: centerAgentProfileId,
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message:
        "This member activated the organization's Center Agent. Revoke or re-designate the Center Agent before removing them.",
    });
    expect(
      harness.queryFirst({
        params: [membership.memberId],
        sql: "select id from members where id = ?",
      })
    ).toEqual({ id: membership.memberId });
  });

  it("fails closed when the member removal guard database is unbound", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auth, harness } = createTestAuth({
      centerAgentRemovalGuardDatabase: "unbound",
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
          event: "auth.center_agent_member_removal_guard_failed",
          organizationId: membership.organizationId,
          reason: "openmeld_db_unbound",
          userId: membership.memberUserId,
        },
      ],
      memberId: membership.memberId,
      message: CENTER_AGENT_HOST_GUARD_FAILED_MESSAGE,
      status: 503,
    });
  });

  it("fails closed when the Center Agent host query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auth, harness } = createTestAuth({
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
          error: "Center Agent host query unavailable",
          event: "auth.center_agent_member_removal_guard_failed",
          organizationId: membership.organizationId,
          reason: "center_agent_host_query_failed",
          userId: membership.memberUserId,
        },
      ],
      memberId: membership.memberId,
      message: CENTER_AGENT_HOST_GUARD_FAILED_MESSAGE,
      status: 503,
    });
  });

  it("fails closed when the designated Center Agent profile is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auth, harness } = createTestAuth();
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    insertCenterAgentDesignationWithoutProfile(harness, {
      designatedByUserId: membership.ownerUserId,
      organizationId: membership.organizationId,
      profileId: "agt_00000000-0000-4000-8000-000000000003",
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
          event: "auth.center_agent_member_removal_guard_failed",
          organizationId: membership.organizationId,
          reason: "center_agent_host_profile_missing",
          userId: membership.memberUserId,
        },
      ],
      memberId: membership.memberId,
      message: CENTER_AGENT_HOST_GUARD_FAILED_MESSAGE,
      status: 503,
    });
  });

  it("allows removing a member who does not host the designated Center Agent", async () => {
    const deleteSessionInventory = vi.fn().mockResolvedValue({
      deleted: { candidateCount: 1, inventoryCount: 2, sourceCount: 1 },
      ok: true,
    });
    const coreWorker = {
      deleteAgentActivitySessionInventoryForOrganizationMember:
        deleteSessionInventory,
      deleteCenterAgentMemberMemory: vi
        .fn()
        .mockResolvedValue({ ok: true, status: "not_found" }),
      deleteCenterAgentOrganizationMemory: vi
        .fn()
        .mockResolvedValue({ ok: true, status: "not_found" }),
    } satisfies NonNullable<AuthConfigEnv["OPENMELD_CORE_WORKER"]>;
    const { auth, harness } = createTestAuth({ coreWorker });
    const membership = await createOrganizationWithAcceptedMember({
      auth,
      harness,
    });
    insertCenterAgentDesignation(harness, {
      designatedByUserId: membership.ownerUserId,
      organizationId: membership.organizationId,
      ownerUserId: membership.ownerUserId,
      profileId: "agt_00000000-0000-4000-8000-000000000002",
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
      harness.queryFirst({
        params: [membership.memberId],
        sql: "select id from members where id = ?",
      })
    ).toBeNull();
    expect(deleteSessionInventory).toHaveBeenCalledWith({
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

function createTestAuth(
  input: {
    centerAgentRemovalGuardDatabase?: "bound" | "query_failure" | "unbound";
    coreWorker?: AuthConfigEnv["OPENMELD_CORE_WORKER"];
    enforceOriginCheck?: boolean;
    sender?: CloudflareEmailSender;
  } = {}
): {
  auth: AuthInstance;
  harness: ReturnType<typeof createSqliteD1Harness>;
  sentEmails: SentEmail[];
} {
  const harness = createSqliteD1Harness();
  harnesses.push(harness);
  applyDrizzleMigrations(harness.database);
  const fakeEmailSender = createFakeEmailSender();
  const sender = input.sender ?? fakeEmailSender.sender;
  const authConfigInput = {
    AUTH_BRAND_NAME: "OpenMeld",
    AUTH_COOKIE_DOMAIN: "localhost",
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli",
    AUTH_EMAIL: sender,
    AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS: "300",
    AUTH_WORKER_NODE_ENV: input.enforceOriginCheck
      ? "production"
      : "development",
    BETTER_AUTH_OPENMELD_SECRET: validSecret,
    BETTER_AUTH_URL: AUTH_BASE_URL,
    PASSKEY_RP_ID: "localhost",
    WEB_APP_URL,
  } as const;
  const guardDatabase =
    input.centerAgentRemovalGuardDatabase === "query_failure"
      ? createCenterAgentHostQueryFailingD1Database(harness.db)
      : harness.db;
  const databaseConfig = createAuthConfig({
    ...authConfigInput,
    OPENMELD_CORE_WORKER: input.coreWorker,
    OPENMELD_DB: guardDatabase,
  });
  const baseAuthConfig =
    input.centerAgentRemovalGuardDatabase === "unbound"
      ? {
          ...createAuthConfig(authConfigInput),
          database: databaseConfig.database,
        }
      : databaseConfig;
  const authConfig = input.enforceOriginCheck
    ? {
        ...baseAuthConfig,
        advanced: {
          ...baseAuthConfig.advanced,
          disableOriginCheck: false,
        },
      }
    : baseAuthConfig;
  const auth = betterAuth(authConfig);

  return { auth, harness, sentEmails: fakeEmailSender.sentEmails };
}

async function createOrganizationWithAcceptedMember(input: {
  auth: AuthInstance;
  harness: ReturnType<typeof createSqliteD1Harness>;
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
  verifyUserEmail(input.harness, "owner@example.com");
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
  verifyUserEmail(input.harness, "member@example.com");
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
    input.harness.queryFirst({
      params: ["owner@example.com"],
      sql: "select id from users where email = ?",
    }),
    "Expected organization owner"
  );
  const member = requireRow<{ id: string; userId: string }>(
    input.harness.queryFirst({
      params: [organization.id, "member@example.com"],
      sql: `
        select members.id, members.user_id as userId
        from members
        inner join users on users.id = members.user_id
        where members.organization_id = ? and users.email = ?
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
  harness: ReturnType<typeof createSqliteD1Harness>;
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
  const member = input.harness.queryFirst<{ id: string }>({
    params: [input.membership.memberId],
    sql: "select id from members where id = ?",
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

function insertCenterAgentDesignation(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    designatedByUserId: string;
    organizationId: string;
    ownerUserId: string;
    profileId: string;
  }
): void {
  const now = Date.now();
  harness.run({
    params: [
      input.profileId,
      "Acme Center Agent",
      "acme-center-agent",
      input.organizationId,
      input.ownerUserId,
      input.designatedByUserId,
      now,
      now,
    ],
    sql: `
      insert into openmeld_profiles (
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
      ) values (?, ?, ?, 'agent', 0, 'active', ?, ?, ?, 'auth_bootstrap', 'center_agent', ?, ?)
    `,
  });
  harness.run({
    params: [
      input.organizationId,
      input.profileId,
      input.designatedByUserId,
      now,
    ],
    sql: `
      insert into center_agent_designations (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      ) values (?, ?, null, ?, ?)
    `,
  });
}

function insertCenterAgentDesignationWithoutProfile(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    designatedByUserId: string;
    organizationId: string;
    profileId: string;
  }
): void {
  harness.database.exec("PRAGMA foreign_keys = OFF");
  try {
    harness.run({
      params: [
        input.organizationId,
        input.profileId,
        input.designatedByUserId,
        Date.now(),
      ],
      sql: `
        insert into center_agent_designations (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        ) values (?, ?, null, ?, ?)
      `,
    });
  } finally {
    harness.database.exec("PRAGMA foreign_keys = ON");
  }
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
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: { email: string; id: string; name: string; password: string }
): Promise<void> {
  const now = Date.now();
  const passwordHash = await hashPassword(input.password);

  harness.run({
    params: [
      input.id,
      input.name,
      input.email,
      1,
      now,
      now,
      input.email.toLowerCase(),
    ],
    sql: `
      insert into users (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at,
        normalized_email
      )
      values (?, ?, ?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
      `account-${input.id}`,
      input.id,
      "credential",
      input.id,
      passwordHash,
      now,
      now,
    ],
    sql: `
      insert into accounts (
        id,
        account_id,
        provider_id,
        user_id,
        password,
        created_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

function verifyUserEmail(
  harness: ReturnType<typeof createSqliteD1Harness>,
  email: string
): void {
  harness.run({
    params: [email],
    sql: "update users set email_verified = 1 where email = ?",
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

function readPersonalOrganizationSlug(
  harness: ReturnType<typeof createSqliteD1Harness>,
  email: string
): string {
  const organization = requireRow<{ slug: string }>(
    harness.queryFirst({
      params: [email],
      sql: `
        select organizations.slug
        from organizations
        inner join members on members.organization_id = organizations.id
        inner join users on users.id = members.user_id
        where users.email = ?
          and json_extract(organizations.metadata, '$.personal') = 1
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

function createSqliteD1Harness(): {
  close(): void;
  database: DatabaseSync;
  db: D1Database;
  queryAll<TRow extends Record<string, unknown>>(input: {
    params?: readonly SqliteBindValue[];
    sql: string;
  }): TRow[];
  queryFirst<TRow extends Record<string, unknown>>(input: {
    params?: readonly SqliteBindValue[];
    sql: string;
  }): TRow | null;
  run(input: { params?: readonly SqliteBindValue[]; sql: string }): void;
} {
  const database = new DatabaseSync(":memory:");
  return {
    close: () => {
      database.close();
    },
    database,
    db: createD1Database(database),
    queryAll: <TRow extends Record<string, unknown>>(input: {
      params?: readonly SqliteBindValue[];
      sql: string;
    }) => database.prepare(input.sql).all(...(input.params ?? [])) as TRow[],
    queryFirst: <TRow extends Record<string, unknown>>(input: {
      params?: readonly SqliteBindValue[];
      sql: string;
    }) =>
      (database.prepare(input.sql).get(...(input.params ?? [])) as
        | TRow
        | undefined) ?? null,
    run: (input) => {
      database.prepare(input.sql).run(...(input.params ?? []));
    },
  };
}

function applyDrizzleMigrations(database: DatabaseSync): void {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  for (const entry of fs
    .readdirSync(migrationDirectoryPath)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))) {
    const source = fs.readFileSync(
      path.resolve(migrationDirectoryPath, entry),
      "utf8"
    );
    for (const statement of source
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)) {
      database.exec(statement);
    }
  }
}

function createD1Database(database: DatabaseSync): D1Database {
  return {
    batch: (statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          runPreparedStatementInTransaction(statement)
        );
        database.exec("COMMIT");
        return Promise.resolve(results as D1Result[]);
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error);
      }
    },
    exec: (sql: string) => {
      database.exec(sql);
      return Promise.resolve({
        count: 0,
        duration: 0,
      } as D1ExecResult);
    },
    prepare: (sql: string) =>
      createPreparedStatement(database.prepare(sql), []) as D1PreparedStatement,
  } as D1Database;
}

function createCenterAgentHostQueryFailingD1Database(
  database: D1Database
): D1Database {
  return {
    ...database,
    prepare: (sql: string) => {
      if (sql.includes("FROM center_agent_designations AS designations")) {
        throw new Error("Center Agent host query unavailable");
      }
      return database.prepare(sql);
    },
  } as D1Database;
}

function createPreparedStatement(
  statement: StatementSync,
  params: readonly SqliteBindValue[]
): TestPreparedStatement {
  return {
    __runInTransaction: () => toD1RunResult(statement.run(...params)),
    all: <TRow>() =>
      Promise.resolve({
        results: statement.all(...params) as TRow[],
        success: true,
      }),
    bind: (...nextParams: unknown[]) =>
      createPreparedStatement(
        statement,
        nextParams as readonly SqliteBindValue[]
      ) as D1PreparedStatement,
    first: <TRow>(columnName?: string) => {
      const row = statement.get(...params) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        return Promise.resolve(null as TRow | null);
      }
      if (columnName) {
        return Promise.resolve((row[columnName] as TRow | undefined) ?? null);
      }
      return Promise.resolve(row as TRow);
    },
    raw: <TRow = unknown[]>() => {
      const rows = statement.all(...params) as Record<string, unknown>[];
      return Promise.resolve(rows.map((row) => Object.values(row)) as TRow[]);
    },
    run: async () => toD1RunResult(statement.run(...params)),
  } as TestPreparedStatement;
}

function runPreparedStatementInTransaction(
  statement: D1PreparedStatement
): unknown {
  const candidate = statement as Partial<TestPreparedStatement>;
  if (typeof candidate.__runInTransaction !== "function") {
    throw new Error("sqlite D1 harness received an unknown prepared statement");
  }

  return candidate.__runInTransaction();
}

function toD1RunResult(
  result: Pick<{ changes: number | bigint }, "changes">
): D1Result {
  return {
    meta: {
      changes: Number(result.changes),
    },
    success: true,
  } as D1Result;
}
