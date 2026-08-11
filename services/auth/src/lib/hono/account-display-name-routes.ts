import { AccountDisplayNameValidationError } from "@openmeld/auth/server";
import {
  updateAccountDisplayNameBodySchema,
  updateAccountDisplayNameCompatibilityBodySchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import { refreshAuthSessionCookie } from "../better-auth/refresh-session-cookie";
import type { AppContext } from "../context";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";
import { toProfileView } from "../profiles/profile-view";
import { ACCOUNT_ROUTE_BASE } from "./account-route-paths";
import { requireAuthenticatedUser } from "./authenticated-user";

export const ACCOUNT_DISPLAY_NAME_COMPATIBILITY_ROUTE = "/api/auth/update-user";

export function registerAccountDisplayNameRoutes(app: Hono<AppContext>) {
  app.patch(
    `${ACCOUNT_ROUTE_BASE}/display-name`,
    requireTrustedCookieOrigin,
    async (c) => {
      const authenticated = requireAuthenticatedUser(c);
      if (!authenticated.ok) {
        return authenticated.response;
      }

      const parsedBody = updateAccountDisplayNameBodySchema.safeParse(
        await readJsonBody(c)
      );
      if (!parsedBody.success) {
        return c.json(
          {
            code: "account.display_name.invalid_input",
            message:
              parsedBody.error.issues[0]?.message ?? "Display name is invalid.",
            ok: false,
          },
          400
        );
      }

      const result = await updateDisplayNamePair(c, {
        displayName: parsedBody.data.displayName,
        user: authenticated.user,
      });
      if (result instanceof Response) {
        return result;
      }
      return c.json({
        defaultHumanProfile: toProfileView(result.defaultHumanProfile, {
          ownerName: result.displayName,
        }),
        displayName: result.displayName,
        ok: true,
      });
    }
  );

  // Compatibility adapter for already-deployed Web clients. Better Auth's
  // generic writer is disabled; this exact legacy shape delegates to the same
  // paired account/profile transaction and rejects every other user field.
  app.post(
    ACCOUNT_DISPLAY_NAME_COMPATIBILITY_ROUTE,
    requireTrustedCookieOrigin,
    async (c) => {
      const authenticated = requireAuthenticatedUser(c);
      if (!authenticated.ok) {
        return authenticated.response;
      }
      const parsedBody =
        updateAccountDisplayNameCompatibilityBodySchema.safeParse(
          await readJsonBody(c)
        );
      if (!parsedBody.success) {
        return c.json(
          {
            code: "account.display_name.invalid_input",
            message:
              parsedBody.error.issues[0]?.message ?? "Display name is invalid.",
            ok: false,
          },
          400
        );
      }

      const result = await updateDisplayNamePair(c, {
        displayName: parsedBody.data.name,
        user: authenticated.user,
      });
      if (result instanceof Response) {
        return result;
      }
      return c.json({ status: true as const });
    }
  );
}

async function updateDisplayNamePair(
  c: Context<AppContext>,
  input: {
    displayName: string;
    user: NonNullable<AppContext["Variables"]["user"]>;
  }
) {
  const ownerUserId = String(input.user.id);
  await c.var.profileService.ensurePrimaryHumanProfile({
    userEmail: normalizeOptionalText(input.user.email),
    userId: ownerUserId,
    userName: normalizeOptionalText(input.user.name),
  });

  try {
    const result = await c.var.accountDisplayNameService.update({
      displayName: input.displayName,
      ownerUserId,
    });
    await refreshAuthSessionCookie(c);
    return result;
  } catch (error) {
    if (error instanceof AccountDisplayNameValidationError) {
      return c.json(
        {
          code: "account.display_name.invalid_input",
          message: error.message,
          ok: false,
        },
        400
      );
    }
    throw error;
  }
}

async function readJsonBody(c: {
  req: { text: () => Promise<string> };
}): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
