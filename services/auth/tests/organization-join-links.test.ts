import { randomUUID } from "node:crypto";
import {
  createD1Db,
  createDrizzleOrganizationJoinLinkRepository,
} from "@openmeld/auth/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import { createHonoApp } from "../src/lib/hono/create-hono-app";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";
import {
  organizationJoinLinkSchema as legacyJoinLinkSchema,
  previewOrganizationJoinLinkResponseSchema as legacyPreviewSchema,
} from "./support/legacy-join-link-contract";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

const AUTH_BASE_URL = "http://localhost:8788";
const WEB_APP_URL = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const ORGANIZATION_JOIN_LINK_TOKEN_PATTERN = /^joinlink_[0-9a-f]{64}$/;
const SET_COOKIE_SEPARATOR_PATTERN = /,(?=\s*[^;,]+=)/;
const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

type TestContext = ReturnType<typeof createTestContext>;

const contexts: TestContext[] = [];

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.harness.close();
  }
});

describe("organization join link HTTP API", () => {
  it("lets an owner create and an admin reuse one active link without resetting it", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const admin = await createSignedInUser(context, {
      email: "admin@example.com",
      name: "Admin",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [
        { role: "owner", userId: owner.userId },
        { role: "admin", userId: admin.userId },
      ],
      name: "Acme Research",
      slug: "acme-research",
    });

    const first = await ensureJoinLinkOnBehalfOf(context, {
      actorUserId: owner.userId,
      organizationId,
    });
    expect(first).toMatchObject({
      ok: true,
      organizationName: "Acme Research",
    });
    if (!first.ok) {
      throw new Error("Expected owner ensure to return an invite link");
    }
    expect(first.joinLink.token).toMatch(ORGANIZATION_JOIN_LINK_TOKEN_PATTERN);
    expect(first.joinLink).toMatchObject({
      createdBy: owner.userId,
      organizationId,
      role: "member",
      url: `${WEB_APP_URL}/join-organization?token=${first.joinLink.token}`,
    });

    await expect(
      ensureJoinLinkOnBehalfOf(context, {
        actorUserId: admin.userId,
        organizationId,
      })
    ).resolves.toEqual(first);
  });

  it("lets members share a request link but rejects personal Organizations", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const member = await createSignedInUser(context, {
      email: "member@example.com",
      name: "Member",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [
        { role: "owner", userId: owner.userId },
        { role: "member", userId: member.userId },
      ],
      name: "Acme Research",
      slug: "acme-research",
    });

    await expect(
      ensureJoinLinkOnBehalfOf(context, {
        actorUserId: member.userId,
        organizationId,
      })
    ).resolves.toMatchObject({ ok: true });

    const personalOrganizationId = readPersonalOrganizationId(
      context.harness,
      owner.userId
    );
    await expect(
      ensureJoinLinkOnBehalfOf(context, {
        actorUserId: owner.userId,
        organizationId: personalOrganizationId,
      })
    ).resolves.toEqual({
      code: "organization.personal_no_members",
      message: "Personal organizations cannot invite members.",
      ok: false,
    });
  });

  it("rejects a caller-supplied role instead of trusting it", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const member = await createSignedInUser(context, {
      email: "member@example.com",
      name: "Member",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [
        { role: "owner", userId: owner.userId },
        { role: "member", userId: member.userId },
      ],
      name: "Acme Research",
      slug: "acme-research",
    });

    await expect(
      ensureJoinLinkOnBehalfOf(context, {
        actorUserId: member.userId,
        organizationId,
        role: "owner",
      })
    ).resolves.toEqual({
      code: "organization.join_link.invalid_input",
      message: "Organization invite-link ensure request is invalid.",
      ok: false,
    });
  });

  it("lets members read a link while only owner and admin can reset or revoke it", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const admin = await createSignedInUser(context, {
      email: "admin@example.com",
      name: "Admin",
    });
    const member = await createSignedInUser(context, {
      email: "member@example.com",
      name: "Member",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [
        { role: "owner", userId: owner.userId },
        { role: "admin", userId: admin.userId },
        { role: "member", userId: member.userId },
      ],
      name: "Acme Research",
      slug: "acme-research",
    });

    const emptyResponse = await requestJoinLink(context, {
      headers: owner.headers,
      organizationId,
    });
    expect(emptyResponse.status).toBe(200);
    await expect(emptyResponse.json()).resolves.toEqual({
      joinLink: null,
      ok: true,
    });

    const createResponse = await requestJoinLink(context, {
      headers: owner.headers,
      method: "POST",
      organizationId,
    });
    expect(createResponse.status).toBe(201);
    const created = await readJoinLink(createResponse);
    expect(legacyJoinLinkSchema.safeParse(created).success).toBe(true);
    const legacyPreview = await previewJoinLink(context, created.token);
    expect(legacyPreviewSchema.safeParse(legacyPreview).success).toBe(true);
    // The scope is stored server-side, never trusted from the preview caller.
    await context.harness.db
      .prepare(
        "UPDATE organization_join_links SET space_id = ? WHERE token = ?"
      )
      .bind("client-launch", created.token)
      .run();
    const scopedLegacyPreview = await previewJoinLink(context, created.token);
    expect(legacyPreviewSchema.safeParse(scopedLegacyPreview).success).toBe(
      true
    );
    const scopedPreview = await context.app.fetch(
      new Request(
        `${AUTH_BASE_URL}/api/auth/organization/join-link/preview?token=${created.token}&responseVersion=2`
      ),
      context.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(scopedPreview.status).toBe(200);
    await expect(scopedPreview.json()).resolves.toMatchObject({
      active: true,
      spaceId: "client-launch",
    });
    await context.harness.db
      .prepare(
        "UPDATE organization_join_links SET space_id = NULL WHERE token = ?"
      )
      .bind(created.token)
      .run();
    expect(created.token).toMatch(ORGANIZATION_JOIN_LINK_TOKEN_PATTERN);
    expect(created).toMatchObject({
      createdBy: owner.userId,
      organizationId,
      role: "member",
      url: `${WEB_APP_URL}/join-organization?token=${created.token}`,
    });

    const adminGetResponse = await requestJoinLink(context, {
      headers: admin.headers,
      organizationId,
    });
    expect(adminGetResponse.status).toBe(200);
    await expect(readJoinLink(adminGetResponse)).resolves.toEqual(created);

    expect(
      (
        await requestJoinLink(context, {
          headers: member.headers,
          organizationId,
        })
      ).status
    ).toBe(200);
    for (const method of ["POST", "DELETE"] as const) {
      const forbiddenResponse = await requestJoinLink(context, {
        headers: member.headers,
        method,
        organizationId,
      });
      expect(forbiddenResponse.status).toBe(403);
      await expect(readErrorCode(forbiddenResponse)).resolves.toBe(
        "organization.join_link.forbidden"
      );
    }

    const resetResponse = await requestJoinLink(context, {
      headers: admin.headers,
      method: "POST",
      organizationId,
    });
    expect(resetResponse.status).toBe(201);
    const reset = await readJoinLink(resetResponse);
    expect(reset.token).not.toBe(created.token);

    await expect(previewJoinLink(context, created.token)).resolves.toEqual({
      active: false,
      ok: true,
    });
    const oldTokenAcceptResponse = await acceptJoinLink(
      context,
      created.token,
      admin.headers
    );
    expect(oldTokenAcceptResponse.status).toBe(404);
    await expect(readErrorCode(oldTokenAcceptResponse)).resolves.toBe(
      "organization.join_link.inactive"
    );
    await expect(previewJoinLink(context, reset.token)).resolves.toEqual({
      active: true,
      ok: true,
      organizationName: "Acme Research",
      organizationSlug: "acme-research",
    });
    await expect(
      previewJoinLink(context, `joinlink_${"f".repeat(64)}`)
    ).resolves.toEqual({ active: false, ok: true });

    const revokeResponse = await requestJoinLink(context, {
      headers: owner.headers,
      method: "DELETE",
      organizationId,
    });
    expect(revokeResponse.status).toBe(200);
    await expect(revokeResponse.json()).resolves.toEqual({
      ok: true,
      revoked: true,
    });
    const idempotentRevokeResponse = await requestJoinLink(context, {
      headers: owner.headers,
      method: "DELETE",
      organizationId,
    });
    expect(idempotentRevokeResponse.status).toBe(200);
    await expect(idempotentRevokeResponse.json()).resolves.toEqual({
      ok: true,
      revoked: false,
    });
    await expect(previewJoinLink(context, reset.token)).resolves.toEqual({
      active: false,
      ok: true,
    });
  });

  it("keeps the active link when a reset insert fails", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [{ role: "owner", userId: owner.userId }],
      name: "Acme Research",
      slug: "acme-research",
    });
    const activeLinkId = `join_link_${randomUUID()}`;
    const activeToken = `joinlink_${"a".repeat(64)}`;
    context.harness.run({
      params: [activeLinkId, organizationId, activeToken, owner.userId],
      sql: `
        INSERT INTO organization_join_links (
          id,
          organization_id,
          token,
          role,
          created_by
        ) VALUES (?, ?, ?, 'member', ?)
      `,
    });
    const repository = createDrizzleOrganizationJoinLinkRepository(
      createD1Db(context.harness.db)
    );

    await expect(
      repository.resetActive({
        createdBy: owner.userId,
        id: `join_link_${randomUUID()}`,
        organizationId,
        token: activeToken,
      })
    ).rejects.toThrow("UNIQUE constraint failed");
    await expect(
      repository.findActiveByOrganizationId(organizationId)
    ).resolves.toMatchObject({
      id: activeLinkId,
      revokedAt: null,
      token: activeToken,
    });
  });

  it("never enrolls a nonmember through the legacy accept endpoint", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const joiningUser = await createSignedInUser(context, {
      email: "joiner@example.com",
      name: "Joiner",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [{ role: "owner", userId: owner.userId }],
      name: "Acme Research",
      slug: "acme-research",
    });
    const created = await readJoinLink(
      await requestJoinLink(context, {
        headers: owner.headers,
        method: "POST",
        organizationId,
      })
    );

    const firstAcceptResponse = await acceptJoinLink(
      context,
      created.token,
      joiningUser.headers
    );
    expect(firstAcceptResponse.status).toBe(400);
    await expect(readErrorCode(firstAcceptResponse)).resolves.toBe(
      "organization.join_link.approval_required"
    );
    expect(
      readMembershipRole(context.harness, organizationId, joiningUser.userId)
    ).toBeNull();

    const secondAcceptResponse = await acceptJoinLink(
      context,
      created.token,
      joiningUser.headers
    );
    expect(secondAcceptResponse.status).toBe(400);
    await expect(readErrorCode(secondAcceptResponse)).resolves.toBe(
      "organization.join_link.approval_required"
    );
  });

  it("requires approval even when the account belongs to other organizations", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const joiningUser = await createSignedInUser(context, {
      email: "joiner@example.com",
      name: "Joiner",
    });
    for (let index = 2; index <= 5; index += 1) {
      insertSharedOrganization(context.harness, {
        memberships: [{ role: "member", userId: joiningUser.userId }],
        name: `Existing Organization ${index}`,
        slug: `existing-organization-${index}`,
      });
    }
    expect(
      readOrganizationMembershipCount(context.harness, joiningUser.userId)
    ).toBe(5);

    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [{ role: "owner", userId: owner.userId }],
      name: "Sixth Organization",
      slug: "sixth-organization",
    });
    const created = await readJoinLink(
      await requestJoinLink(context, {
        headers: owner.headers,
        method: "POST",
        organizationId,
      })
    );

    const response = await acceptJoinLink(
      context,
      created.token,
      joiningUser.headers
    );

    expect(response.status).toBe(400);
    expect(
      readMembershipRole(context.harness, organizationId, joiningUser.userId)
    ).toBeNull();
    expect(
      readOrganizationMembershipCount(context.harness, joiningUser.userId)
    ).toBe(5);
  });

  it("rate limits join-link acceptance per client IP before adding a member", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const context = createTestContext({
      joinLinkAcceptRateLimit: { limit } as RateLimit,
    });
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const joiningUser = await createSignedInUser(context, {
      email: "joiner@example.com",
      name: "Joiner",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [{ role: "owner", userId: owner.userId }],
      name: "Acme Research",
      slug: "acme-research",
    });
    const created = await readJoinLink(
      await requestJoinLink(context, {
        headers: owner.headers,
        method: "POST",
        organizationId,
      })
    );
    const joiningHeaders = new Headers(joiningUser.headers);
    joiningHeaders.set("CF-Connecting-IP", "203.0.113.10");

    const response = await acceptJoinLink(
      context,
      created.token,
      joiningHeaders
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: "organization.join_link.accept.rate_limited",
      message: "Too many join attempts. Try again in a minute.",
      ok: false,
    });
    expect(limit).toHaveBeenCalledWith({ key: "ip:203.0.113.10" });
    expect(
      readMembershipRole(context.harness, organizationId, joiningUser.userId)
    ).toBeNull();
  });

  it("keeps an existing admin role when that user accepts", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const admin = await createSignedInUser(context, {
      email: "admin@example.com",
      name: "Admin",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [
        { role: "owner", userId: owner.userId },
        { role: "admin", userId: admin.userId },
      ],
      name: "Acme Research",
      slug: "acme-research",
    });
    const created = await readJoinLink(
      await requestJoinLink(context, {
        headers: owner.headers,
        method: "POST",
        organizationId,
      })
    );

    const response = await acceptJoinLink(
      context,
      created.token,
      admin.headers
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      alreadyMember: true,
      ok: true,
      role: "admin",
    });
    expect(
      readMembershipRole(context.harness, organizationId, admin.userId)
    ).toBe("admin");
  });

  it("rejects unverified users with an actionable error code", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const joiningUser = await createSignedInUser(context, {
      email: "unverified@example.com",
      name: "Unverified",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [{ role: "owner", userId: owner.userId }],
      name: "Acme Research",
      slug: "acme-research",
    });
    const created = await readJoinLink(
      await requestJoinLink(context, {
        headers: owner.headers,
        method: "POST",
        organizationId,
      })
    );
    setEmailVerified(context.harness, joiningUser.email, false);

    const response = await acceptJoinLink(
      context,
      created.token,
      withoutSessionDataCookie(joiningUser.headers)
    );

    expect(response.status).toBe(403);
    await expect(readErrorCode(response)).resolves.toBe(
      "organization.join_link.email_verification_required"
    );
    expect(
      readMembershipRole(context.harness, organizationId, joiningUser.userId)
    ).toBeNull();
  });

  it("rejects creating or accepting a personal organization link", async () => {
    const context = createTestContext();
    const personalOwner = await createSignedInUser(context, {
      email: "personal-owner@example.com",
      name: "Personal Owner",
    });
    const joiningUser = await createSignedInUser(context, {
      email: "joiner@example.com",
      name: "Joiner",
    });
    const personalOrganizationId = readPersonalOrganizationId(
      context.harness,
      personalOwner.userId
    );

    const createResponse = await requestJoinLink(context, {
      headers: personalOwner.headers,
      method: "POST",
      organizationId: personalOrganizationId,
    });
    expect(createResponse.status).toBe(400);
    await expect(readErrorCode(createResponse)).resolves.toBe(
      "organization.personal_no_members"
    );

    const personalToken = `joinlink_${"a".repeat(64)}`;
    context.harness.run({
      params: [
        randomUUID(),
        personalOrganizationId,
        personalToken,
        personalOwner.userId,
        Date.now(),
      ],
      sql: `
        insert into organization_join_links (
          id,
          organization_id,
          token,
          role,
          created_by,
          created_at
        ) values (?, ?, ?, 'member', ?, ?)
      `,
    });

    const acceptResponse = await acceptJoinLink(
      context,
      personalToken,
      joiningUser.headers
    );
    expect(acceptResponse.status).toBe(400);
    await expect(readErrorCode(acceptResponse)).resolves.toBe(
      "organization.personal_no_members"
    );
    expect(
      readMembershipRole(
        context.harness,
        personalOrganizationId,
        joiningUser.userId
      )
    ).toBeNull();
  });

  it("rejects cookie-authenticated mutations without a trusted origin", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const joiningUser = await createSignedInUser(context, {
      email: "joiner@example.com",
      name: "Joiner",
    });
    const organizationId = insertSharedOrganization(context.harness, {
      memberships: [{ role: "owner", userId: owner.userId }],
      name: "Acme Research",
      slug: "acme-research",
    });
    const created = await readJoinLink(
      await requestJoinLink(context, {
        headers: owner.headers,
        method: "POST",
        organizationId,
      })
    );

    const resetResponse = await requestJoinLink(context, {
      headers: owner.headers,
      method: "POST",
      organizationId,
      origin: "https://attacker.example",
    });
    expect(resetResponse.status).toBe(403);
    await expect(readErrorCode(resetResponse)).resolves.toBe(
      "auth.invalid_origin"
    );

    const revokeResponse = await requestJoinLink(context, {
      headers: owner.headers,
      method: "DELETE",
      organizationId,
      origin: null,
    });
    expect(revokeResponse.status).toBe(403);
    await expect(readErrorCode(revokeResponse)).resolves.toBe(
      "auth.invalid_origin"
    );

    const unchanged = await readJoinLink(
      await requestJoinLink(context, {
        headers: owner.headers,
        organizationId,
      })
    );
    expect(unchanged.token).toBe(created.token);

    const acceptResponse = await acceptJoinLink(
      context,
      created.token,
      joiningUser.headers,
      "https://attacker.example"
    );
    expect(acceptResponse.status).toBe(403);
    await expect(readErrorCode(acceptResponse)).resolves.toBe(
      "auth.invalid_origin"
    );
    expect(
      readMembershipRole(context.harness, organizationId, joiningUser.userId)
    ).toBeNull();
  });
});

type EnsureJoinLinkOnBehalfOfResult =
  | {
      joinLink: Awaited<ReturnType<typeof readJoinLink>>;
      ok: true;
      organizationName: string;
    }
  | {
      code: string;
      message: string;
      ok: false;
    };

function ensureJoinLinkOnBehalfOf(
  context: TestContext,
  input: {
    actorUserId: string;
    organizationId: string;
    role?: string;
  }
): Promise<EnsureJoinLinkOnBehalfOfResult> {
  const rpc = new AuthRpcEntrypoint(
    TEST_EXECUTION_CONTEXT,
    context.env
  ) as AuthRpcEntrypoint & {
    ensureOrganizationJoinLinkOnBehalfOf(
      rpcInput: typeof input
    ): Promise<EnsureJoinLinkOnBehalfOfResult>;
  };
  return rpc.ensureOrganizationJoinLinkOnBehalfOf(input);
}

function createTestContext(
  input: { joinLinkAcceptRateLimit?: RateLimit } = {}
) {
  const harness = createSqliteD1Harness();
  applyDrizzleMigrations(harness.database);
  const env = {
    AUTH_BRAND_NAME: "OpenMeld",
    AUTH_COOKIE_DOMAIN: "localhost",
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli",
    AUTH_EMAIL: {
      send: () => Promise.resolve(),
    },
    AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    AUTH_WORKER_NODE_ENV: "development",
    BETTER_AUTH_OPENMELD_SECRET:
      "1234567890123456789012345678901234567890123456789012345678901234",
    BETTER_AUTH_URL: AUTH_BASE_URL,
    PASSKEY_RP_ID: "localhost",
    OPENMELD_ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITER:
      input.joinLinkAcceptRateLimit ?? {
        limit: vi.fn(async () => ({ success: true })),
      },
    OPENMELD_AUTH_KV: {},
    OPENMELD_DB: harness.db,
    WEB_APP_URL,
  } as unknown as AuthBindings;
  const context = {
    app: createHonoApp(),
    env,
    harness,
  };
  contexts.push(context);
  return context;
}

async function createSignedInUser(
  context: TestContext,
  input: { email: string; name: string }
): Promise<{ email: string; headers: Headers; userId: string }> {
  const signUpResponse = await postJson(context, "/api/auth/sign-up/email", {
    email: input.email,
    name: input.name,
    password: PASSWORD,
  });
  if (!signUpResponse.ok) {
    throw new Error(
      `Sign-up failed: ${signUpResponse.status} ${await signUpResponse.text()}`
    );
  }

  setEmailVerified(context.harness, input.email, true);
  const signInResponse = await postJson(context, "/api/auth/sign-in/email", {
    email: input.email,
    password: PASSWORD,
  });
  if (!signInResponse.ok) {
    throw new Error(
      `Sign-in failed: ${signInResponse.status} ${await signInResponse.text()}`
    );
  }

  const user = context.harness.queryFirst<{ id: string }>({
    params: [input.email],
    sql: "select id from users where email = ?",
  });
  if (!user) {
    throw new Error(`Expected user row for ${input.email}`);
  }

  return {
    email: input.email,
    headers: convertSetCookieToCookieHeader(signInResponse.headers),
    userId: user.id,
  };
}

function insertSharedOrganization(
  harness: SqliteD1Harness,
  input: {
    memberships: { role: "admin" | "member" | "owner"; userId: string }[];
    name: string;
    slug: string;
  }
): string {
  const organizationId = randomUUID();
  const now = Date.now();
  harness.run({
    params: [organizationId, input.name, input.slug, now],
    sql: `
      insert into organizations (id, name, slug, created_at)
      values (?, ?, ?, ?)
    `,
  });
  for (const membership of input.memberships) {
    harness.run({
      params: [
        randomUUID(),
        organizationId,
        membership.userId,
        membership.role,
        now,
      ],
      sql: `
        insert into members (id, organization_id, user_id, role, created_at)
        values (?, ?, ?, ?, ?)
      `,
    });
  }
  return organizationId;
}

function setEmailVerified(
  harness: SqliteD1Harness,
  email: string,
  verified: boolean
): void {
  harness.run({
    params: [verified ? 1 : 0, email],
    sql: "update users set email_verified = ? where email = ?",
  });
}

function readPersonalOrganizationId(
  harness: SqliteD1Harness,
  userId: string
): string {
  const organization = harness.queryFirst<{ id: string }>({
    params: [userId],
    sql: `
      select organizations.id
      from organizations
      inner join members on members.organization_id = organizations.id
      where members.user_id = ?
        and json_extract(organizations.metadata, '$.personal') = 1
    `,
  });
  if (!organization) {
    throw new Error("Expected personal organization");
  }
  return organization.id;
}

function readMembershipRole(
  harness: SqliteD1Harness,
  organizationId: string,
  userId: string
): string | null {
  return (
    harness.queryFirst<{ role: string }>({
      params: [organizationId, userId],
      sql: `
        select role
        from members
        where organization_id = ? and user_id = ?
      `,
    })?.role ?? null
  );
}

function readOrganizationMembershipCount(
  harness: SqliteD1Harness,
  userId: string
): number {
  return (
    harness.queryFirst<{ count: number }>({
      params: [userId],
      sql: "select count(*) as count from members where user_id = ?",
    })?.count ?? 0
  );
}

function requestJoinLink(
  context: TestContext,
  input: {
    headers: Headers;
    method?: "DELETE" | "GET" | "POST";
    organizationId: string;
    origin?: string | null;
  }
): Promise<Response> {
  const headers = new Headers(input.headers);
  const method = input.method ?? "GET";
  if (method !== "GET") {
    const origin = input.origin === undefined ? WEB_APP_URL : input.origin;
    if (origin) {
      headers.set("origin", origin);
    }
  }
  return context.app.fetch(
    new Request(
      `${AUTH_BASE_URL}/api/auth/organization/join-link?organizationId=${encodeURIComponent(input.organizationId)}`,
      {
        headers,
        method,
      }
    ),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
}

async function previewJoinLink(
  context: TestContext,
  token: string
): Promise<unknown> {
  const response = await context.app.fetch(
    new Request(
      `${AUTH_BASE_URL}/api/auth/organization/join-link/preview?token=${encodeURIComponent(token)}`
    ),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
  if (response.status !== 200) {
    throw new Error(
      `Preview failed: ${response.status} ${await response.text()}`
    );
  }
  return response.json();
}

function acceptJoinLink(
  context: TestContext,
  token: string,
  headers: Headers,
  origin: string | null = WEB_APP_URL
): Promise<Response> {
  return postJson(
    context,
    "/api/auth/organization/join-link/accept",
    { token },
    headers,
    origin
  );
}

function postJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers?: Headers,
  origin: string | null = WEB_APP_URL
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  if (origin) {
    requestHeaders.set("origin", origin);
  }
  return context.app.fetch(
    new Request(`${AUTH_BASE_URL}${pathname}`, {
      body: JSON.stringify(body),
      headers: requestHeaders,
      method: "POST",
    }),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
}

async function readJoinLink(response: Response): Promise<{
  createdAt: string;
  createdBy: string;
  id: string;
  organizationId: string;
  role: "member";
  token: string;
  url: string;
}> {
  const body = (await response.json()) as {
    joinLink?: {
      createdAt: string;
      createdBy: string;
      id: string;
      organizationId: string;
      role: "member";
      token: string;
      url: string;
    };
  };
  if (!body.joinLink) {
    throw new Error("Expected join link response");
  }
  return body.joinLink;
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

function convertSetCookieToCookieHeader(sourceHeaders: Headers): Headers {
  const headers = new Headers();
  const setCookieHeader = sourceHeaders.get("set-cookie");
  if (!setCookieHeader) {
    return headers;
  }

  headers.set(
    "cookie",
    setCookieHeader
      .split(SET_COOKIE_SEPARATOR_PATTERN)
      .map((cookie) => cookie.split(";").at(0)?.trim())
      .filter((cookie): cookie is string => Boolean(cookie))
      .join("; ")
  );
  return headers;
}

function withoutSessionDataCookie(sourceHeaders: Headers): Headers {
  const headers = new Headers(sourceHeaders);
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    return headers;
  }
  headers.set(
    "cookie",
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter((cookie) => !cookie.includes(".session_data="))
      .join("; ")
  );
  return headers;
}
