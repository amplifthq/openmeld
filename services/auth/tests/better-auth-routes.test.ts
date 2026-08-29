import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const preferenceRepositoryMock = {
  getLastSelectedOrganizationId: vi.fn(),
};

vi.mock("../src/lib/account/organization-preference-service", () => ({
  getAccountOrganizationPreferenceRepository: vi.fn(
    () => preferenceRepositoryMock
  ),
}));

import type { AppContext, AppVariables } from "../src/lib/context";
import { registerBetterAuthRoutes } from "../src/lib/hono/better-auth-routes";

// Real captured GET /api/auth/get-session body (Better Auth 1.6.23 with the
// organization plugin's default configuration). Values are sanitized; field
// names and serialized value shapes are preserved from the captured response.
const CAPTURED_BETTER_AUTH_SESSION_RESPONSE = {
  session: {
    id: "0c1f16d7-3986-4706-badb-0b92c9c0154e",
    token: "redacted-session-token",
    userId: "6707746e-6b5c-43a0-b14f-0fc720fa6713",
    activeOrganizationId: "5ccb175d-2eef-4e6e-a6f9-b25a1e66d359",
    expiresAt: "2026-07-14T03:13:22.505Z",
    createdAt: "2026-07-07T03:13:22.505Z",
    updatedAt: "2026-07-07T03:13:22.505Z",
    ipAddress: "127.0.0.1",
    userAgent: "",
  },
  user: {
    id: "6707746e-6b5c-43a0-b14f-0fc720fa6713",
    name: "Probe User",
    email: "probe@example.com",
    emailVerified: true,
    image: null,
    username: null,
    displayUsername: null,
    createdAt: "2026-07-07T03:13:22.453Z",
    updatedAt: "2026-07-07T03:13:22.453Z",
  },
};

describe("Better Auth session projection", () => {
  beforeEach(() => {
    preferenceRepositoryMock.getLastSelectedOrganizationId.mockReset();
    vi.restoreAllMocks();
  });

  it("keeps a valid session usable when the entry preference read fails", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    preferenceRepositoryMock.getLastSelectedOrganizationId.mockRejectedValue(
      new Error("D1 preference read unavailable", {
        cause: new TypeError("D1 binding rejected the query"),
      })
    );
    const app = createTestApp(
      new Response(JSON.stringify(CAPTURED_BETTER_AUTH_SESSION_RESPONSE), {
        headers: {
          "content-type": "application/json",
          "set-cookie":
            "better-auth.session_token=renewed; Path=/; HttpOnly; Secure",
          "x-request-id": "auth-upstream-123",
        },
        status: 200,
      })
    );

    const response = await app.fetch(
      new Request("https://auth.openmeld.test/api/auth/get-session")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=renewed"
    );
    expect(response.headers.get("x-request-id")).toBe("auth-upstream-123");
    await expect(response.json()).resolves.toEqual(
      CAPTURED_BETTER_AUTH_SESSION_RESPONSE
    );
    expect(warning).toHaveBeenCalledWith(
      "[auth.account_organization_preference_projection_failed]",
      expect.objectContaining({
        error: expect.objectContaining({
          cause: expect.objectContaining({
            message: "D1 binding rejected the query",
            name: "TypeError",
            stack: expect.any(String),
          }),
          message: "D1 preference read unavailable",
          name: "Error",
          stack: expect.any(String),
        }),
        requestId: "request-123",
        userId: "6707746e-6b5c-43a0-b14f-0fc720fa6713",
      })
    );
  });
});

function createTestApp(handlerResponse: Response): Hono<AppContext> {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-123");
    const betterAuthHandler = {
      handler: vi.fn(async () => handlerResponse),
    } satisfies Pick<AppVariables["betterAuth"], "handler">;
    c.set("betterAuth", betterAuthHandler as AppVariables["betterAuth"]);
    await next();
  });
  registerBetterAuthRoutes(app);
  return app;
}
