import {
  accountOrganizationContextSchema,
  selectLastSelectedOrganizationErrorResponseSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
});

describe("Account Organization preference HTTP API", () => {
  it("reads only the current account and follows membership-checked entry preferences", async () => {
    const context = createTestContext({ environment: "production" });
    const account = await createSignedInUser(context, {
      email: "context@example.com",
      name: "Context",
    });
    const other = await createSignedInUser(context, {
      email: "other-context@example.com",
      name: "Other",
    });
    const otherOrganizationId = await createOrganization(context, {
      headers: other.headers,
      name: "Private",
      slug: "private",
    });
    const beta = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "context-beta",
    });
    const read = async () => {
      const response = await context.app.fetch(
        new Request(
          `${AUTH_BASE_URL}/v1/account/organization-context?userId=other&profileId=other`,
          { headers: account.headers }
        ),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const payload = await response.json();
      expect(accountOrganizationContextSchema.safeParse(payload).success).toBe(
        true
      );
      return accountOrganizationContextSchema.parse(payload);
    };
    const initial = await read();
    expect(initial.account).toEqual({
      email: account.email,
      name: "Context",
      image: null,
    });
    expect(
      initial.organizations.some(
        (organization) => organization.id === otherOrganizationId
      )
    ).toBe(false);
    expect(initial.defaultOrganizationId).toBe(initial.organizations[0]?.id);
    const selection = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: beta },
      account.headers
    );
    expect(selection.status).toBe(200);
    expect((await read()).defaultOrganizationId).toBe(beta);
    context.harness.run({
      sql: "UPDATE users SET last_selected_organization_id = ? WHERE id = ?",
      params: [otherOrganizationId, initial.currentUserId],
    });
    const activeSelection = await postJson(
      context,
      "/api/auth/organization/set-active",
      { organizationId: beta },
      account.headers
    );
    expect(activeSelection.status).toBe(200);
    expect((await read()).defaultOrganizationId).toBe(beta);
    context.harness.run({
      sql: "DELETE FROM members WHERE user_id = ? AND organization_id = ?",
      params: [initial.currentUserId, beta],
    });
    expect((await read()).defaultOrganizationId).toBe(
      initial.organizations[0]?.id
    );
    context.harness.run({
      sql: "DELETE FROM members WHERE user_id = ?",
      params: [initial.currentUserId],
    });
    expect(await read()).toMatchObject({
      organizations: [],
      defaultOrganizationId: null,
    });
  });

  it("distinguishes missing authentication from unavailable account reads", async () => {
    const context = createTestContext();
    const request = (headers = new Headers()) =>
      context.app.fetch(
        new Request(`${AUTH_BASE_URL}/v1/account/organization-context`, {
          headers,
        }),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
    expect((await request()).status).toBe(401);
    const account = await createSignedInUser(context, {
      email: "context-failure@example.com",
      name: "Context Failure",
    });
    context.env.OPENMELD_DB = createLocalUserVerificationFailureDatabase(
      context.env.OPENMELD_DB,
      new Error("local verification unavailable")
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await request(account.headers)).status).toBe(500);
  });

  it("returns the shared error contract when the authenticated session is missing", async () => {
    const context = createTestContext();

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "org-beta" }
    );

    expect(selectionResponse.status).toBe(401);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "auth.unauthenticated",
        message: "Sign in again to continue.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns the shared error contract when local session verification fails", async () => {
    const verificationFailure = new Error("D1 local user lookup unavailable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "session-verification-failure@example.com",
      name: "Session Verification Failure",
    });
    context.env.OPENMELD_DB = createLocalUserVerificationFailureDatabase(
      context.env.OPENMELD_DB,
      verificationFailure
    );

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "org-beta" },
      account.headers
    );

    expect(selectionResponse.status).toBe(500);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "upstream_error",
        message: "OpenMeld couldn't verify your session. Try again.",
        requestId: expect.any(String),
      },
      ok: false,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[auth.context_middleware.local_session_state_failed]",
      expect.objectContaining({
        error: expect.objectContaining({
          message: verificationFailure.message,
        }),
        method: "PATCH",
        path: "/v1/account/last-selected-organization",
      })
    );
  });

  it("returns the shared error contract when the request origin is not trusted", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "invalid-origin@example.com",
      name: "Invalid Origin",
    });
    const headers = new Headers(account.headers);
    headers.set("content-type", "application/json");
    headers.set("origin", "https://untrusted.example.com");

    const selectionResponse = await context.app.fetch(
      new Request(`${AUTH_BASE_URL}/v1/account/last-selected-organization`, {
        body: JSON.stringify({ organizationId: "org-beta" }),
        headers,
        method: "PATCH",
      }),
      context.env,
      TEST_EXECUTION_CONTEXT
    );

    expect(selectionResponse.status).toBe(403);
    expect(
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      )
    ).toMatchObject({
      error: {
        code: "auth.invalid_origin",
        message: "Refresh the page and try again.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns the shared error contract for an invalid Organization selection", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "invalid-selection@example.com",
      name: "Invalid Selection",
    });

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "" },
      account.headers
    );

    expect(selectionResponse.status).toBe(400);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "invalid_payload",
        message: "Choose a valid organization.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns the saved Organization through a later authenticated session", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "felix@example.com",
      name: "Felix",
    });
    const organizationId = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "beta",
    });

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId },
      account.headers
    );
    expect(selectionResponse.status).toBe(200);
    await expect(selectionResponse.json()).resolves.toEqual({
      ok: true,
      organizationId,
    });

    const laterSessionHeaders = await signIn(context, {
      email: account.email,
      password: PASSWORD,
    });
    await expect(
      readLastSelectedOrganizationId(context, laterSessionHeaders)
    ).resolves.toBe(organizationId);
  });

  it("returns the saved Organization through cached production sessions", async () => {
    const context = createTestContext({ environment: "production" });
    const account = await createSignedInUser(context, {
      email: "cached-session@example.com",
      name: "Cached Session",
    });
    const otherSessionHeaders = await signIn(context, {
      email: account.email,
      password: PASSWORD,
    });
    const organizationId = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "beta",
    });

    await expect(
      readLastSelectedOrganizationId(context, account.headers)
    ).resolves.toBeNull();
    await expect(
      readLastSelectedOrganizationId(context, otherSessionHeaders)
    ).resolves.toBeNull();

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId },
      account.headers
    );
    expect(selectionResponse.status).toBe(200);

    await expect(
      readLastSelectedOrganizationId(context, account.headers)
    ).resolves.toBe(organizationId);
    await expect(
      readLastSelectedOrganizationId(context, otherSessionHeaders)
    ).resolves.toBe(organizationId);
  });

  it("rejects an Organization outside or missing from the authenticated account", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "member@example.com",
      name: "Member",
    });
    const otherAccount = await createSignedInUser(context, {
      email: "other@example.com",
      name: "Other",
    });
    const otherOrganizationId = await createOrganization(context, {
      headers: otherAccount.headers,
      name: "Other Organization",
      slug: "other-organization",
    });

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: otherOrganizationId },
      account.headers
    );

    expect(selectionResponse.status).toBe(403);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "organization.membership_required",
        message:
          "You must be a member of this organization before selecting it.",
        requestId: expect.any(String),
      },
      ok: false,
    });
    await expect(
      readLastSelectedOrganizationId(context, account.headers)
    ).resolves.toBeNull();

    const missingOrganizationResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "org-missing" },
      account.headers
    );
    expect(missingOrganizationResponse.status).toBe(403);
    expect(
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await missingOrganizationResponse.json()
      )
    ).toMatchObject({
      error: {
        code: "organization.membership_required",
        message:
          "You must be a member of this organization before selecting it.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns a shared error envelope when the preference write fails", async () => {
    const writeFailure = new Error("D1 preference update unavailable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "write-failure@example.com",
      name: "Write Failure",
    });
    const organizationId = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "beta",
    });
    context.env.OPENMELD_DB = createPreferenceWriteFailureDatabase(
      context.env.OPENMELD_DB,
      writeFailure
    );

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId },
      account.headers
    );

    expect(selectionResponse.status).toBe(500);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "upstream_error",
        message: "OpenMeld couldn't save your organization. Try again.",
        requestId: expect.any(String),
      },
      ok: false,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[auth.account_organization_preference_selection_failed]",
      expect.objectContaining({
        error: expect.objectContaining({
          cause: expect.objectContaining({ message: writeFailure.message }),
          message: expect.stringContaining("Failed query"),
        }),
        requestId: errorEnvelope.error.requestId,
      })
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      "[auth.internal_error]",
      expect.anything()
    );
  });
});

function createTestContext(
  input: { environment?: "development" | "production" } = {}
) {
  const harness = createSqliteD1Harness({ rejectExplicitTransactions: true });
  applyDrizzleMigrations(harness.database);
  const env = {
    AUTH_BRAND_NAME: "OpenMeld",
    AUTH_COOKIE_DOMAIN: "localhost",
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli",
    AUTH_EMAIL: { send: () => Promise.resolve() },
    AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    AUTH_WORKER_NODE_ENV: input.environment ?? "development",
    BETTER_AUTH_OPENMELD_SECRET:
      "1234567890123456789012345678901234567890123456789012345678901234",
    BETTER_AUTH_URL: AUTH_BASE_URL,
    PASSKEY_RP_ID: "localhost",
    OPENMELD_AUTH_KV: createMemoryKvNamespace(),
    OPENMELD_DB: harness.db,
    WEB_APP_URL,
  } as unknown as AuthBindings;
  const context = { app: createHonoApp(), env, harness };
  contexts.push(context);
  return context;
}

function createMemoryKvNamespace(): KVNamespace {
  const values = new Map<string, string>();
  return {
    delete: (key: string) => {
      values.delete(key);
      return Promise.resolve();
    },
    get: (key: string) => Promise.resolve(values.get(key) ?? null),
    put: (key: string, value: string | ArrayBuffer | ReadableStream) => {
      if (typeof value !== "string") {
        return Promise.reject(
          new TypeError("The test KV only accepts string values.")
        );
      }
      values.set(key, value);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
}

function createPreferenceWriteFailureDatabase(
  database: D1Database,
  error: Error
): D1Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "prepare") {
        return Reflect.get(target, property, receiver);
      }
      return (sql: string): D1PreparedStatement => {
        const normalizedSql = sql.toLowerCase();
        // Better Auth also updates users; the membership EXISTS clause uniquely
        // identifies the preference repository write exercised by this test.
        if (
          normalizedSql.includes("update") &&
          normalizedSql.includes("users") &&
          normalizedSql.includes("last_selected_organization_id") &&
          normalizedSql.includes("exists") &&
          normalizedSql.includes("member")
        ) {
          return createRejectedD1PreparedStatement(error);
        }
        return target.prepare(sql);
      };
    },
  });
}

function createLocalUserVerificationFailureDatabase(
  database: D1Database,
  error: Error
): D1Database {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "prepare") {
        return Reflect.get(target, property, receiver);
      }
      return (sql: string): D1PreparedStatement => {
        if (
          sql
            .toLowerCase()
            .includes("select 1 as present from users where id = ? limit 1")
        ) {
          return createRejectedD1PreparedStatement(error);
        }
        return target.prepare(sql);
      };
    },
  });
}

function createRejectedD1PreparedStatement(error: Error): D1PreparedStatement {
  const reject = () => Promise.reject(error);
  const statement = {
    all: reject,
    bind: () => statement,
    first: reject,
    raw: reject,
    run: reject,
  };
  return statement as unknown as D1PreparedStatement;
}

async function createSignedInUser(
  context: TestContext,
  input: { email: string; name: string }
): Promise<{ email: string; headers: Headers }> {
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
  setEmailVerified(context.harness, input.email);
  return {
    email: input.email,
    headers: await signIn(context, {
      email: input.email,
      password: PASSWORD,
    }),
  };
}

async function signIn(
  context: TestContext,
  input: { email: string; password: string }
): Promise<Headers> {
  const response = await postJson(context, "/api/auth/sign-in/email", input);
  if (!response.ok) {
    throw new Error(
      `Sign-in failed: ${response.status} ${await response.text()}`
    );
  }
  return convertSetCookieToCookieHeader(response.headers);
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

async function readLastSelectedOrganizationId(
  context: TestContext,
  headers: Headers
): Promise<string | null> {
  const response = await context.app.fetch(
    new Request(
      `${AUTH_BASE_URL}/api/auth/get-session?disableCookieCache=true`,
      { headers }
    ),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
  if (!response.ok) {
    throw new Error(
      `Session read failed: ${response.status} ${await response.text()}`
    );
  }
  const body = (await response.json()) as {
    user?: { lastSelectedOrganizationId?: unknown };
  };
  return typeof body.user?.lastSelectedOrganizationId === "string"
    ? body.user.lastSelectedOrganizationId
    : null;
}

function patchJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers: Headers
): Promise<Response> {
  return requestJson(context, pathname, body, headers, "PATCH");
}

function postJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers = new Headers()
): Promise<Response> {
  return requestJson(context, pathname, body, headers, "POST");
}

function requestJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers: Headers,
  method: "PATCH" | "POST"
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  requestHeaders.set("origin", WEB_APP_URL);
  return context.app.fetch(
    new Request(`${AUTH_BASE_URL}${pathname}`, {
      body: JSON.stringify(body),
      headers: requestHeaders,
      method,
    }),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
}

function setEmailVerified(harness: SqliteD1Harness, email: string): void {
  harness.run({
    params: [email],
    sql: "update users set email_verified = 1 where email = ?",
  });
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
