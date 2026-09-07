import { afterEach, describe, expect, it } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import { createHonoApp } from "../src/lib/hono/create-hono-app";
import { getOpenMeldProfileService } from "../src/lib/profiles/service";
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

describe("account display name HTTP API", () => {
  it.each([
    "TRUE",
    "1",
    " true ",
  ])("fails closed for a malformed additional Human Profile capability value: %s", (capabilityValue) => {
    const context = createTestContext({ capabilityValue });

    expect(
      getOpenMeldProfileService(context.env).getProfileCapabilities()
    ).toEqual({
      additionalHumanProfileCreationEnabled: false,
    });
  });

  it("publishes the disabled capability and rejects additional Human Profile creation by default", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "single-human-profile@example.com",
      name: "Felix Lu",
    });
    const defaultHumanProfile = await readDefaultHumanProfile(
      context,
      account.headers
    );

    const capabilitiesResponse = await context.app.fetch(
      new Request(`${AUTH_BASE_URL}/v1/profiles/capabilities`, {
        headers: account.headers,
      }),
      context.env,
      TEST_EXECUTION_CONTEXT
    );

    expect(capabilitiesResponse.status).toBe(200);
    await expect(capabilitiesResponse.json()).resolves.toEqual({
      additionalHumanProfileCreationEnabled: false,
      ok: true,
    });

    const createResponse = await postJson(
      context,
      "/v1/profiles/humans",
      {
        creatorProfileId: defaultHumanProfile.openMeldProfileId,
        profileName: "Secondary Human",
      },
      account.headers
    );

    expect(createResponse.status).toBe(409);
    await expect(createResponse.json()).resolves.toEqual({
      code: "profile.additional_human_profile_creation_disabled",
      message:
        "Creating additional profiles for people is currently unavailable. Use your default profile, or create an Agent.",
      ok: false,
    });
    await expect(
      readDefaultHumanProfileName(context, account.headers)
    ).resolves.toBe("Felix Lu");
  });

  it("keeps the account display name and default Human Profile name synchronized", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "felix@example.com",
      name: "felix lu",
    });

    const updateResponse = await patchJson(
      context,
      "/v1/account/display-name",
      { displayName: "Felix Lu" },
      account.headers
    );

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.headers.get("set-cookie")).toContain("session_data=");
    await expect(updateResponse.json()).resolves.toMatchObject({
      displayName: "Felix Lu",
      ok: true,
      defaultHumanProfile: {
        profileName: "Felix Lu",
      },
    });

    await expect(
      readCurrentAccountName(context, account.headers)
    ).resolves.toBe("Felix Lu");
    await expect(
      readDefaultHumanProfileName(context, account.headers)
    ).resolves.toBe("Felix Lu");
  });

  it("routes a default Human Profile rename through the same paired command", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "default-profile@example.com",
      name: "Initial Name",
    });
    const defaultHumanProfile = await readDefaultHumanProfile(
      context,
      account.headers
    );

    const renameResponse = await patchJson(
      context,
      `/v1/profiles/${defaultHumanProfile.openMeldProfileId}`,
      { profileName: "Profile Route Name" },
      account.headers
    );

    expect(renameResponse.status).toBe(200);
    expect(renameResponse.headers.get("set-cookie")).toContain("session_data=");
    await expect(renameResponse.json()).resolves.toMatchObject({
      ok: true,
      profile: {
        ownerName: "Profile Route Name",
        profileName: "Profile Route Name",
      },
    });
    await expect(
      readCurrentAccountName(context, account.headers)
    ).resolves.toBe("Profile Route Name");
    await expect(
      readDefaultHumanProfileName(context, account.headers)
    ).resolves.toBe("Profile Route Name");
  });

  it("keeps non-default Human Profile names independent from the Account Display Name", async () => {
    const context = createTestContext({
      additionalHumanProfileCreationEnabled: true,
    });
    const account = await createSignedInUser(context, {
      email: "secondary-profile@example.com",
      name: "Account Name",
    });
    const defaultHumanProfile = await readDefaultHumanProfile(
      context,
      account.headers
    );

    const createResponse = await postJson(
      context,
      "/v1/profiles/humans",
      {
        creatorProfileId: defaultHumanProfile.openMeldProfileId,
        profileName: "Secondary Human",
      },
      account.headers
    );
    expect(createResponse.status).toBe(201);
    const created = await readProfileResponse(createResponse);

    const renameResponse = await patchJson(
      context,
      `/v1/profiles/${created.openMeldProfileId}`,
      { profileName: "Independent Human" },
      account.headers
    );

    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toMatchObject({
      profile: {
        isDefault: false,
        profileName: "Independent Human",
      },
    });
    await expect(
      readCurrentAccountName(context, account.headers)
    ).resolves.toBe("Account Name");
    await expect(
      readDefaultHumanProfileName(context, account.headers)
    ).resolves.toBe("Account Name");
  });

  it("routes the legacy name-only endpoint through the paired command", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "bypass@example.com",
      name: "Original Name",
    });

    const bypassResponse = await postJson(
      context,
      "/api/auth/update-user",
      { name: "Bypass Name" },
      account.headers
    );

    expect(bypassResponse.status).toBe(200);
    await expect(
      readCurrentAccountName(context, account.headers)
    ).resolves.toBe("Bypass Name");
    await expect(
      readDefaultHumanProfileName(context, account.headers)
    ).resolves.toBe("Bypass Name");
  });

  it("rejects other Better Auth user fields instead of reopening a generic writer", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "generic-writer@example.com",
      name: "Original Name",
    });

    const bypassResponse = await postJson(
      context,
      "/api/auth/update-user",
      {
        image: "https://example.com/avatar.png",
        name: "Bypass Name",
      },
      account.headers
    );

    expect(bypassResponse.status).toBe(400);
    await expect(
      readCurrentAccountName(context, account.headers)
    ).resolves.toBe("Original Name");
    await expect(
      readDefaultHumanProfileName(context, account.headers)
    ).resolves.toBe("Original Name");
  });

  it("rolls back the Account Display Name when the default Human Profile update fails", async () => {
    const context = createTestContext();
    const account = await createSignedInUser(context, {
      email: "rollback@example.com",
      name: "Stable Name",
    });
    context.harness.database.exec(`
      create trigger reject_default_human_profile_name
      before update of profile_name on openmeld_profiles
      when new.profile_name = 'Rejected Name'
      begin
        select raise(abort, 'profile name rejected by test');
      end
    `);

    const updateResponse = await patchJson(
      context,
      "/v1/account/display-name",
      { displayName: "Rejected Name" },
      account.headers
    );

    expect(updateResponse.status).toBe(500);
    await expect(
      readCurrentAccountName(context, account.headers)
    ).resolves.toBe("Stable Name");
    await expect(
      readDefaultHumanProfileName(context, account.headers)
    ).resolves.toBe("Stable Name");
  });
});

function createTestContext(
  options: {
    additionalHumanProfileCreationEnabled?: boolean;
    capabilityValue?: string;
  } = {}
) {
  const harness = createSqliteD1Harness({
    rejectExplicitTransactions: true,
  });
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
    OPENMELD_ADDITIONAL_HUMAN_PROFILE_CREATION_ENABLED:
      options.capabilityValue ??
      (options.additionalHumanProfileCreationEnabled === true
        ? "true"
        : "false"),
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
): Promise<{ headers: Headers }> {
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

  return {
    headers: convertSetCookieToCookieHeader(signInResponse.headers),
  };
}

async function readCurrentAccountName(
  context: TestContext,
  headers: Headers
): Promise<string | undefined> {
  const response = await context.app.fetch(
    new Request(
      `${AUTH_BASE_URL}/api/auth/get-session?disableCookieCache=true`,
      {
        headers,
      }
    ),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
  if (response.status !== 200) {
    throw new Error(
      `Expected session response: ${response.status} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { user?: { name?: string } };
  return body.user?.name;
}

async function readDefaultHumanProfileName(
  context: TestContext,
  headers: Headers
): Promise<string | undefined> {
  return (await readDefaultHumanProfile(context, headers)).profileName;
}

async function readDefaultHumanProfile(
  context: TestContext,
  headers: Headers
): Promise<{
  profileName: string;
  openMeldProfileId: string;
}> {
  const response = await context.app.fetch(
    new Request(`${AUTH_BASE_URL}/v1/profiles`, { headers }),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
  if (response.status !== 200) {
    throw new Error(
      `Expected Profile list response: ${response.status} ${await response.text()}`
    );
  }
  const body = (await response.json()) as {
    profiles?: Array<{
      isDefault?: boolean;
      profileKind?: string;
      profileName?: string;
      openMeldProfileId?: string;
    }>;
  };
  const profile = body.profiles?.find(
    (profile) => profile.profileKind === "human" && profile.isDefault
  );
  if (!(profile?.profileName && profile.openMeldProfileId)) {
    throw new Error("Expected default Human Profile response");
  }
  return {
    profileName: profile.profileName,
    openMeldProfileId: profile.openMeldProfileId,
  };
}

function postJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers = new Headers()
): Promise<Response> {
  return requestJson(context, pathname, body, headers, "POST");
}

function patchJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers: Headers
): Promise<Response> {
  return requestJson(context, pathname, body, headers, "PATCH");
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

async function readProfileResponse(response: Response): Promise<{
  openMeldProfileId: string;
}> {
  const body = (await response.json()) as {
    profile?: { openMeldProfileId?: string };
  };
  if (!body.profile?.openMeldProfileId) {
    throw new Error("Expected Profile response");
  }
  return {
    openMeldProfileId: body.profile.openMeldProfileId,
  };
}
