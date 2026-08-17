import { afterEach, describe, expect, it } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import { createHonoApp } from "../src/lib/hono/create-hono-app";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
} from "./support/sqlite-d1-harness";

const AUTH_BASE_URL = "http://localhost:8788";
const WEB_APP_URL = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const SET_COOKIE_SEPARATOR_PATTERN = /,(?=\s*[^;,]+=)/;
const GENERATED_ORGANIZATION_SLUG_PATTERN = /^amplift-[0-9a-hjkmnp-tv-z]{6}$/;
const ORDINAL_TWO_SLUG_PATTERN = /-2$/;
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

describe("Organization creation", () => {
  it("creates same-named Organizations with distinct opaque URL slugs", async () => {
    const context = createTestContext();
    const headers = await createSignedInUser(context, {
      email: "owner@example.com",
      name: "Owner",
    });
    const initialSession = context.harness.queryFirst<{
      activeOrganizationId: string;
    }>({
      params: ["owner@example.com"],
      sql: `
        select sessions.active_organization_id as activeOrganizationId
        from sessions
        inner join users on users.id = sessions.user_id
        where users.email = ?
      `,
    });

    const firstResponse = await postJson(
      context,
      "/api/auth/organization/create",
      { name: "Amplift" },
      headers
    );
    const secondResponse = await postJson(
      context,
      "/api/auth/organization/create",
      {
        name: "Amplift",
        // Already-deployed Web clients still send this field. Auth owns the
        // generated URL and must not turn the legacy value into an ordinal.
        slug: "amplift",
      },
      headers
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const firstOrganization = (await firstResponse.json()) as {
      id: string;
      name: string;
      slug: string;
    };
    const secondOrganization = (await secondResponse.json()) as {
      id: string;
      name: string;
      slug: string;
    };
    expect(firstOrganization).toMatchObject({ name: "Amplift" });
    expect(secondOrganization).toMatchObject({ name: "Amplift" });
    expect(firstOrganization.slug).toMatch(GENERATED_ORGANIZATION_SLUG_PATTERN);
    expect(secondOrganization.slug).toMatch(
      GENERATED_ORGANIZATION_SLUG_PATTERN
    );
    expect(secondOrganization.slug).not.toBe(firstOrganization.slug);
    expect(secondOrganization.slug).not.toMatch(ORDINAL_TWO_SLUG_PATTERN);
    expect(initialSession?.activeOrganizationId).toBeTruthy();
    expect(
      context.harness.queryFirst({
        params: ["owner@example.com"],
        sql: `
          select sessions.active_organization_id as activeOrganizationId
          from sessions
          inner join users on users.id = sessions.user_id
          where users.email = ?
        `,
      })
    ).toEqual(initialSession);
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
    OPENMELD_AUTH_KV: {},
    OPENMELD_DB: harness.db,
    PASSKEY_RP_ID: "localhost",
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
): Promise<Headers> {
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

  return convertSetCookieToCookieHeader(signInResponse.headers);
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
