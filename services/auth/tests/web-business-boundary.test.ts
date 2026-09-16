import {
  createAgentProfileBodySchema,
  createdAgentProfileActionResponseSchema,
  DESKTOP_APP_ORIGIN,
  organizationActionSuccessSchema,
  organizationIdActionSchema,
  spaceInvitationRequestSchema,
  spaceInvitationResponseSchema,
} from "@openmeld/schemas";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authBusinessRequest } from "../../../clients/web/src/lib/auth-business.server";
import { Route as createOrganizationRoute } from "../../../clients/web/src/routes/v1/organizations";
import { deleteAgentProfileRequest } from "../../../clients/web/src/routes/v1/profiles/agents/$profileId";
import type { AuthBindings } from "../src/lib/bindings";
import { createHonoApp } from "../src/lib/hono/create-hono-app";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
} from "./support/sqlite-d1-harness";

vi.mock("#/env", () => ({
  getRequiredServerEnv: (name: string) =>
    name === "BETTER_AUTH_URL"
      ? "http://localhost:8788"
      : "http://localhost:3000",
}));
vi.mock("#/lib/openmeld-api/proxy-cloudflare-runtime.server", () => ({
  readWebProxyCloudflareRuntimeEvidence: () => ({
    workerEnvironment: "test",
    analytics: null,
  }),
}));

describe("fixed business Web to Auth boundary", () => {
  const harness = createSqliteD1Harness();
  const app = createHonoApp();
  const env = {
    AUTH_BRAND_NAME: "OpenMeld",
    AUTH_COOKIE_DOMAIN: "localhost",
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli",
    AUTH_EMAIL: { send: async () => undefined },
    AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    AUTH_WORKER_NODE_ENV: "development",
    BETTER_AUTH_OPENMELD_SECRET:
      "1234567890123456789012345678901234567890123456789012345678901234",
    BETTER_AUTH_URL: "http://localhost:8788",
    OPENMELD_AUTH_KV: {},
    OPENMELD_DB: harness.db,
    PASSKEY_RP_ID: "localhost",
    WEB_APP_URL: "http://localhost:3000",
  } as unknown as AuthBindings;
  const executionContext = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: {},
    exports: {},
  } as unknown as ExecutionContext;
  let cookie: string;
  let personalId: string;
  const authFetch: typeof fetch = async (input, init) =>
    app.fetch(new Request(input, init), env, executionContext);
  beforeAll(async () => {
    applyDrizzleMigrations(harness.database);
    const response = await authFetch(
      "http://localhost:8788/api/auth/sign-up/email",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          name: "Owner",
          password: "correct-horse-battery-staple",
        }),
      }
    );
    if (!response.ok) {
      throw new Error("Fixture sign-up failed.");
    }
    harness.run({
      sql: "update users set email_verified = 1 where email = ?",
      params: ["owner@example.com"],
    });
    const signedIn = await authFetch(
      "http://localhost:8788/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "correct-horse-battery-staple",
        }),
      }
    );
    if (!signedIn.ok) {
      throw new Error("Fixture sign-in failed.");
    }
    cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const personal = harness.queryFirst<{ id: string }>({
      sql: "select id from organizations limit 1",
    });
    if (!personal) {
      throw new Error("Fixture Personal Organization missing.");
    }
    personalId = personal.id;
    vi.stubGlobal("fetch", authFetch);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    harness.close();
  });
  function request(
    path: string,
    body: unknown,
    origin: string | null = "http://localhost:3000"
  ) {
    return new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        ...(origin === null ? {} : { origin }),
      },
      body: JSON.stringify(body),
    });
  }
  const create = (origin: string | null) =>
    (
      createOrganizationRoute.options.server?.handlers as {
        POST: (input: { request: Request }) => Promise<Response>;
      }
    ).POST({
      request: request(
        "/v1/organizations",
        { name: "Shared Organization" },
        origin
      ),
    });
  it.each([
    null,
    "null",
    "https://hostile.example",
  ])("never upgrades %s Origin into trusted cookie authority", async (origin) => {
    const before = harness.queryFirst({
      sql: "select count(*) as count from organizations",
    });
    const response = await create(origin);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "auth.invalid_origin",
    });
    expect(
      harness.queryFirst({ sql: "select count(*) as count from organizations" })
    ).toEqual(before);
    const profile = await authBusinessRequest({
      request: request("/v1/profiles/agents", { profileName: "Agent" }, origin),
      upstreamPath: "/v1/profiles/agents",
      bodySchema: createAgentProfileBodySchema,
      responseSchema: createdAgentProfileActionResponseSchema,
    });
    expect(profile.status).toBe(403);
  });
  it("admits the exact development Desktop Origin, projects the real result, and preserves Personal deletion refusal", async () => {
    const response = await create(DESKTOP_APP_ORIGIN);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({
      id: expect.any(String),
      name: "Shared Organization",
      slug: expect.any(String),
      logo: null,
      isPersonal: false,
    });
    const deletion = await authBusinessRequest({
      request: request("/v1/organizations/delete", {
        organizationId: personalId,
      }),
      upstreamPath: "/api/auth/organization/delete",
      bodySchema: organizationIdActionSchema,
      responseSchema: organizationActionSuccessSchema,
      project: () => ({ ok: true }),
    });
    expect(deletion.status).toBe(400);
    expect(await deletion.json()).toMatchObject({
      code: "organization.personal_undeletable",
    });
    expect(
      harness.queryFirst({
        sql: "select id from organizations where id = ?",
        params: [personalId],
      })
    ).toEqual({ id: personalId });
  });
  it.each([
    "create_approved",
    "bind",
    "claim",
    "complete",
  ])("rejects internal invitation action %s at the public boundary", async (action) => {
    const response = await authBusinessRequest({
      request: request("/v1/space-invitations", { action, invitationId: "id" }),
      upstreamPath: "/api/auth/space-invitations",
      bodySchema: spaceInvitationRequestSchema,
      responseSchema: spaceInvitationResponseSchema,
    });
    expect(response.status).toBe(400);
  });
  it("preserves separate cookies without exposing vendor data and refuses redirects", async () => {
    const real = await authFetch(
      "http://localhost:8788/api/auth/organization/create",
      {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Cookie Test" }),
      }
    );
    const payload = await real.json();
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "session_token=renewed; HttpOnly; Path=/");
    headers.append("set-cookie", "session_data=cached; HttpOnly; Path=/");
    vi.stubGlobal("fetch", async () => Response.json(payload, { headers }));
    try {
      const result = await create("http://localhost:3000");
      expect(result.headers.getSetCookie()).toEqual(headers.getSetCookie());
      expect(await result.text()).not.toContain("session_");
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response("Redirect", {
            status: 302,
            headers: { location: "https://hostile.example" },
          })
      );
      const redirect = await create("http://localhost:3000");
      expect(redirect.status).toBe(502);
      expect(redirect.headers.has("location")).toBe(false);
      expect(await redirect.json()).toMatchObject({
        code: "response.redirect_refused",
      });
    } finally {
      vi.stubGlobal("fetch", authFetch);
    }
  });
  it("keeps deletion committed when catalog refresh fails and nudges already-removed outcomes", async () => {
    const headers = new Headers({
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-openmeld-requested-organization-id": personalId,
    });
    const created = await authFetch(
      "http://localhost:8788/v1/profiles/agents",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ profileName: "Agent" }),
      }
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { profile } = (await created.json()) as {
      profile: { openMeldProfileId: string };
    };
    let nudges = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/route-catalog-sync")) {
          nudges++;
          return new Response("unavailable", { status: 503 });
        }
        return await authFetch(input, init);
      }
    );
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      for (const status of [200, 404]) {
        const result = await deleteAgentProfileRequest(
          new Request(
            `http://localhost:3000/v1/profiles/agents/${profile.openMeldProfileId}`,
            { method: "DELETE", headers }
          ),
          profile.openMeldProfileId
        );
        expect(result.status, await result.clone().text()).toBe(status);
      }
      expect(nudges).toBe(2);
      expect(
        harness.queryFirst({
          sql: "select profile_id from openmeld_profiles where profile_id = ?",
          params: [profile.openMeldProfileId],
        })
      ).toBeNull();
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
      vi.stubGlobal("fetch", authFetch);
    }
  });
  it("refuses Human and another account's Agent before Auth cleanup", async () => {
    const primary = harness.queryFirst<{ id: string; owner: string }>({
      sql: "select profile_id as id, owner_user_id as owner from openmeld_profiles where profile_kind = 'human' and is_default = 1 limit 1",
    });
    if (!primary) {
      throw new Error("Fixture primary Human Profile missing.");
    }
    const additional = "33333333-3333-4333-8333-333333333333";
    harness.run({
      sql: "insert into openmeld_profiles (profile_id,profile_name,profile_handle,profile_kind,is_default,status,owner_user_id,source,created_at,updated_at) values (?, 'Additional', 'additional', 'human', 0, 'active', ?, 'migration', 1, 1)",
      params: [additional, primary.owner],
    });
    for (const profileId of [primary.id, additional]) {
      const response = await authFetch(
        `http://localhost:8788/v1/profiles/agents/${profileId}`,
        {
          method: "DELETE",
          headers: { cookie, origin: "http://localhost:3000" },
        }
      );
      expect(response.status).toBe(400);
      expect(
        harness.queryFirst({
          sql: "select status from openmeld_profiles where profile_id = ?",
          params: [profileId],
        })
      ).toEqual({ status: "active" });
    }
    const foreign = "agt_44444444-4444-4444-8444-444444444444";
    harness.run({
      sql: "insert into users (id,name,email,email_verified,created_at,updated_at) values ('other','Other','other@example.com',1,1,1)",
    });
    harness.run({
      sql: "insert into openmeld_profiles (profile_id,profile_name,profile_handle,profile_kind,is_default,status,owner_user_id,organization_id,source,created_at,updated_at) values (?, 'Other Agent', 'other-agent', 'agent', 0, 'active', 'other', ?, 'migration', 1, 1)",
      params: [foreign, personalId],
    });
    const response = await authFetch(
      `http://localhost:8788/v1/profiles/agents/${foreign}`,
      { method: "DELETE", headers: { cookie, origin: "http://localhost:3000" } }
    );
    expect(response.status).toBe(404);
    expect(
      harness.queryFirst({
        sql: "select status from openmeld_profiles where profile_id = ?",
        params: [foreign],
      })
    ).toEqual({ status: "active" });
  });
});
