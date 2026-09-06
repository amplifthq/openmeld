import {
  createAccountSidebarRepository,
  createD1Db,
} from "@openmeld/auth/server";
import {
  accountSidebarErrorResponseSchema,
  saveAccountSidebarBodySchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppContext } from "../context";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";
import { requireAuthenticatedUser } from "./authenticated-user";

export function registerAccountSidebarRoutes(app: Hono<AppContext>) {
  app.get("/v1/account/sidebar", async (c) => {
    const auth = requireAuthenticatedUser(c);
    if (!auth.ok) {
      return c.json(
        accountSidebarErrorResponseSchema.parse({
          ok: false,
          error: {
            code: "auth.unauthenticated",
            message: "Sign in again to continue.",
          },
        }),
        401
      );
    }
    const organizationId = c.req.query("organizationId");
    if (!organizationId || organizationId.length > 200) {
      return c.json(
        accountSidebarErrorResponseSchema.parse({
          ok: false,
          error: {
            code: "invalid_payload",
            message: "Choose an organization.",
          },
        }),
        400
      );
    }
    const repository = createAccountSidebarRepository(
      createD1Db(c.env.OPENMELD_DB)
    );
    const userId = String(auth.user.id);
    if (!(await repository.isMember(userId, organizationId))) {
      return c.json(
        accountSidebarErrorResponseSchema.parse({
          ok: false,
          error: {
            code: "organization.membership_required",
            message: "You no longer belong to this organization.",
          },
        }),
        403
      );
    }
    c.header("Cache-Control", "private, no-store");
    return c.json({
      ok: true,
      ...(await repository.read(userId, organizationId)),
    });
  });
  app.put(
    "/v1/account/sidebar",
    requireTrustedCookieOrigin,
    bodyLimit({ maxSize: 1024 * 1024 }),
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      const auth = requireAuthenticatedUser(c);
      if (!auth.ok) {
        return c.json(
          accountSidebarErrorResponseSchema.parse({
            ok: false,
            error: {
              code: "auth.unauthenticated",
              message: "Sign in again to continue.",
            },
          }),
          401
        );
      }
      const parsed = saveAccountSidebarBodySchema.safeParse(
        await c.req.json().catch(() => null)
      );
      if (!parsed.success) {
        return c.json(
          accountSidebarErrorResponseSchema.parse({
            ok: false,
            error: {
              code: "invalid_payload",
              message: "Check your sidebar settings and try again.",
            },
          }),
          400
        );
      }
      const repository = createAccountSidebarRepository(
        createD1Db(c.env.OPENMELD_DB)
      );
      const userId = String(auth.user.id);
      if (!(await repository.isMember(userId, parsed.data.organizationId))) {
        return c.json(
          accountSidebarErrorResponseSchema.parse({
            ok: false,
            error: {
              code: "organization.membership_required",
              message: "You no longer belong to this organization.",
            },
          }),
          403
        );
      }
      if (
        !(await repository.save(
          userId,
          parsed.data.organizationId,
          parsed.data
        ))
      ) {
        return c.json(
          accountSidebarErrorResponseSchema.parse({
            ok: false,
            error: {
              code: "sidebar.conflict",
              message:
                "Your sidebar changed on another device. Refresh and try again.",
            },
          }),
          409
        );
      }
      return c.json({
        ok: true,
        revision: parsed.data.revision + 1,
        preferences: parsed.data.preferences,
      });
    }
  );
}
