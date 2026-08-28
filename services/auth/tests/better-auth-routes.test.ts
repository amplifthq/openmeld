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

import type { AppContext } from "../src/lib/context";
import { registerBetterAuthRoutes } from "../src/lib/hono/better-auth-routes";

const TEST_ENV = {
  AUTH_WORKER_NODE_ENV: "test",
  OPENMELD_DB: {},
} as unknown as CloudflareBindings;

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
      new Error("D1 preference read unavailable")
    );
    const app = createTestApp(
      new Response(
        JSON.stringify({
          session: { id: "session-123" },
          user: { id: "user-123", email: "felix@openmeld.invalid" },
        }),
        {
          headers: {
            "content-type": "application/json",
            "set-cookie":
              "better-auth.session_token=renewed; Path=/; HttpOnly; Secure",
            "x-request-id": "auth-upstream-123",
          },
          status: 200,
        }
      )
    );

    const response = await app.fetch(
      new Request("https://auth.openmeld.test/api/auth/get-session"),
      TEST_ENV
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=renewed"
    );
    expect(response.headers.get("x-request-id")).toBe("auth-upstream-123");
    await expect(response.json()).resolves.toEqual({
      session: { id: "session-123" },
      user: { id: "user-123", email: "felix@openmeld.invalid" },
    });
    expect(warning).toHaveBeenCalledWith(
      "[auth.account_organization_preference_projection_failed]",
      expect.objectContaining({
        error: "D1 preference read unavailable",
        requestId: "request-123",
        userId: "user-123",
      })
    );
  });
});

function createTestApp(handlerResponse: Response): Hono<AppContext> {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-123");
    c.set("betterAuth", {
      handler: vi.fn(async () => handlerResponse),
    } as never);
    await next();
  });
  registerBetterAuthRoutes(app);
  return app;
}
