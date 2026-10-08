import { withPostgresRequest } from "@openmeld/db/postgresql";
import {
  accountDeletionAcceptedSchema,
  requestAccountDeletionSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import {
  AccountDeletionConflict,
  acceptAccountDeletion,
  readAccountDeletionPreview,
  runAccountDeletionCleanup,
} from "../account/deletion-service";
import type { AppContext } from "../context";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";
import { runDeletedProfileReconcileOutbox } from "../profiles/deleted-profile-reconcile";
import { requireAuthenticatedUser } from "./authenticated-user";

export function registerAccountDeletionRoutes(app: Hono<AppContext>) {
  app.get("/v1/account/deletion", async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }
    return c.json(
      await readAccountDeletionPreview({
        env: c.env,
        userId: authenticated.user.id,
        sessionCreatedAt: new Date(c.var.session?.createdAt ?? 0),
      })
    );
  });
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The route keeps identity, handoff, inventory, and irreversible acceptance checks in order.
  app.post("/v1/account/deletion", requireTrustedCookieOrigin, async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }
    const body = requestAccountDeletionSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json(
        {
          ok: false,
          code: "account.deletion.invalid_input",
          message: "Type DELETE to confirm account deletion.",
        },
        400
      );
    }
    // Require a live server-side session even if the normal account read used a cookie cache.
    const session = await c.var.betterAuth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    });
    if (!session || session.user.id !== authenticated.user.id) {
      return c.json(
        {
          ok: false,
          code: "account.deletion.sign_in_required",
          message: "Sign in again before deleting your account.",
        },
        401
      );
    }
    const preview = await readAccountDeletionPreview({
      env: c.env,
      userId: session.user.id,
      sessionCreatedAt: new Date(session.session.createdAt),
    });
    if (preview.requiresSignIn) {
      return c.json(
        {
          ok: false,
          code: "account.deletion.sign_in_required",
          message: "Sign in again before deleting your account.",
        },
        401
      );
    }
    if (preview.requiresPassword) {
      try {
        await c.var.betterAuth.api.verifyPassword({
          headers: c.req.raw.headers,
          body: { password: body.data.password ?? "" },
        });
      } catch {
        return c.json(
          {
            ok: false,
            code: "account.deletion.password_required",
            message: "Enter your current password to continue.",
          },
          400
        );
      }
    }
    if (preview.blockingOrganizations.length || preview.blockingSpaces.length) {
      return c.json(
        {
          ok: false,
          code: "account.deletion.handoff_required",
          message:
            "Transfer ownership of the listed workspaces and Spaces, then review again.",
        },
        409
      );
    }
    if (preview.confirmationToken !== body.data.confirmationToken) {
      return c.json(
        {
          ok: false,
          code: "account.deletion.changed",
          message:
            "Your workspaces changed. Review the list again before deleting.",
        },
        409
      );
    }
    try {
      await acceptAccountDeletion({
        env: c.env,
        userId: session.user.id,
        expected: preview,
      });
    } catch (error) {
      if (error instanceof AccountDeletionConflict) {
        return c.json(
          {
            ok: false,
            code: "account.deletion.changed",
            message: error.message,
          },
          409
        );
      }
      throw error;
    }
    // Cookie clearing is best effort after acceptance; the deleted-user authority
    // and deleted credentials already prevent access across every device.
    const signOut = await c.var.betterAuth.api
      .signOut({ headers: c.req.raw.headers, returnHeaders: true })
      .catch(() => null);
    for (const cookie of signOut?.headers.getSetCookie() ?? []) {
      c.header("set-cookie", cookie, { append: true });
    }
    c.executionCtx.waitUntil(
      withPostgresRequest(
        c.env.OPENMELD_POSTGRESQL,
        async () => {
          await runDeletedProfileReconcileOutbox(c.env);
          await runAccountDeletionCleanup(c.env);
        },
        { reuseConnection: false }
      )
    );
    return c.json(
      accountDeletionAcceptedSchema.parse({ ok: true, status: "deleting" }),
      202
    );
  });
}
