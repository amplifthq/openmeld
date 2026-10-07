import { afterEach, describe, expect, it } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
  postgresTestBinding,
} from "../../../tooling/postgresql/test-harness";
import type { AuthBindings } from "../src/lib/bindings";
import { createAuthWorkerTestApp } from "./support/auth-worker-entrypoint.test-support";

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

type TestContext = Awaited<ReturnType<typeof createTestContext>>;

const contexts: TestContext[] = [];

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.harness.close();
  }
});

describe("organization deletion guard", () => {
  it("rejects deleting a personal organization with the stable error code", async () => {
    const context = await createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const personalOrganizationId = await readPersonalOrganizationId(
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
      await context.harness.queryFirst({
        values: [personalOrganizationId],
        text: 'select id from "openmeld"."organizations" where id = $1',
      })
    ).not.toBeNull();
  });

  it("allows an ordinary organization created through the public API to be deleted", async () => {
    const context = await createTestContext();
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
      await context.harness.queryFirst({
        values: [organizationId],
        text: 'select id from "openmeld"."organizations" where id = $1',
      })
    ).toBeNull();
  });

  it("rejects deletion when organization metadata cannot be parsed", async () => {
    const context = await createTestContext();
    const owner = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const personalOrganizationId = await readPersonalOrganizationId(
      context.harness,
      owner.userId
    );
    await context.harness.query({
      values: ["{broken", personalOrganizationId],
      text: 'update "openmeld"."organizations" set metadata = $1 where id = $2',
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
      await context.harness.queryFirst({
        values: [personalOrganizationId],
        text: 'select id from "openmeld"."organizations" where id = $1',
      })
    ).not.toBeNull();
  });
});

async function createTestContext() {
  const harness = await createPostgresHarness();

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
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
    WEB_APP_URL,
  } as unknown as AuthBindings;
  const context = {
    app: createAuthWorkerTestApp(),
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

  await context.harness.query({
    values: [input.email],
    text: 'update "openmeld"."users" set email_verified = 1 where email = $1',
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

  const user = await context.harness.queryFirst<{ id: string }>({
    values: [input.email],
    text: 'select id from "openmeld"."users" where email = $1',
  });
  if (!user) {
    throw new Error(`Expected user row for ${input.email}`);
  }

  return {
    headers: convertSetCookieToCookieHeader(signInResponse.headers),
    userId: user.id,
  };
}

async function readPersonalOrganizationId(
  harness: PostgresHarness,
  userId: string
): Promise<string> {
  const organization = await harness.queryFirst<{ id: string }>({
    values: [userId],
    text: `
      select organizations.id
      from "openmeld"."organizations"
      inner join "openmeld"."members" on members.organization_id = organizations.id
      where members.user_id = $1
        and ((organizations.metadata)::jsonb #>> '{personal}') = 'true'
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
