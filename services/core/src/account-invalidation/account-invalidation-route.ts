import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";

export function registerAccountInvalidationRoute(
  app: Hono<HonoBindings>
): void {
  app.get(
    "/v1/account/invalidation-stream",
    (c): Response | Promise<Response> => {
      const context = c.get("openMeldRequestContext");
      const organizationId = context.activeOrganizationId;
      const userId = context.actorContext.callerPrincipalId;
      if (
        !(organizationId && userId) ||
        c.req.query("organizationId") !== organizationId
      ) {
        return c.json(
          { ok: false, code: "organization.context_required" },
          403
        );
      }
      if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
        return c.json({ ok: false, code: "bad_request" }, 400);
      }
      const namespace = c.env.OPENMELD_ACCOUNT_INVALIDATIONS;
      if (!namespace) {
        return c.json(
          { ok: false, code: "account_invalidation.unavailable" },
          503
        );
      }
      const id = namespace.idFromName(`${organizationId}:${userId}`);
      return namespace.get(id).fetch(new Request(c.req.url, c.req.raw));
    }
  );
}
