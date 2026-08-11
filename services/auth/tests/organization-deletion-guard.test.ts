import { afterEach, describe, expect, it } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import { createHonoApp } from "../src/lib/hono/create-hono-app";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

const AUTH_BASE_URL = "http://localhost:8788";
const WEB_APP_URL = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
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

describe("organization deletion guard", () => {
  it("rejects deleting a personal organization with the stable error code", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const personalOrganizationId = readPersonalOrganizationId(
      context.harness,
      owner.userId
    );

    const response = await deleteOrganization(context, {
      headers: owner.headers,
      organizationId: personalOrganizationId,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "organization.personal_undeletable",
      message: "Personal organizations can’t be deleted.",
    });
    expect(
      context.harness.queryFirst({
        params: [personalOrganizationId],
        sql: "select id from organizations where id = ?",
      })
    ).not.toBeNull();
  });

  it("allows an ordinary organization created through the public API to be deleted", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const organizationId = await createOrganization(context, {
      headers: owner.headers,
      name: "Acme Research",
      slug: "acme-research",
    });

    const response = await deleteOrganization(context, {
      headers: owner.headers,
      organizationId,
    });

    expect(response.status).toBe(200);
    expect(
      context.harness.queryFirst({
        params: [organizationId],
        sql: "select id from organizations where id = ?",
      })
    ).toBeNull();
  });

  it("rejects deletion when organization metadata cannot be parsed", async () => {
    const context = createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const personalOrganizationId = readPersonalOrganizationId(
      context.harness,
      owner.userId
    );
    context.harness.run({
      params: ["{broken", personalOrganizationId],
      sql: "update organizations set metadata = ? where id = ?",
    });

    const response = await deleteOrganization(context, {
      headers: owner.headers,
      organizationId: personalOrganizationId,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "organization.deletion_guard_failed",
    });
    expect(
      context.harness.queryFirst({
        params: [personalOrganizationId],
        sql: "select id from organizations where id = ?",
      })
    ).not.toBeNull();
  });
});

function createTestContext() {
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
): Promise<{ headers: Headers; userId: string }> {
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

  context.harness.run({
    params: [input.email],
    sql: "update users set email_verified = 1 where email = ?",
  });
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
    headers: convertSetCookieToCookieHeader(signInResponse.headers),
    userId: user.id,
  };
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

async function createOrganization(
  context: TestContext,
  input: { headers: Headers; name: string; slug: string }
): Promise<string> {
  const response = await postJson(
    context,
    "/api/auth/organization/create",
    { name: input.name, slug: input.slug },
    input.headers
  );
  if (!response.ok) {
    throw new Error(
      `Organization creation failed: ${response.status} ${await response.text()}`
    );
  }
  const organization = (await response.json()) as { id?: unknown };
  if (typeof organization.id !== "string" || organization.id.length === 0) {
    throw new Error("Organization creation returned an invalid id.");
  }
  return organization.id;
}

function deleteOrganization(
  context: TestContext,
  input: { headers: Headers; organizationId: string }
): Promise<Response> {
  return postJson(
    context,
    "/api/auth/organization/delete",
    { organizationId: input.organizationId },
    input.headers
  );
}

function postJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers?: Headers
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  requestHeaders.set("origin", WEB_APP_URL);
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
