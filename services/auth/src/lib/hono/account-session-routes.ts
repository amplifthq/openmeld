import { ACCOUNT_SESSION_PATH, accountSessionSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { AppContext } from "../context";
import { requireAuthenticatedUser } from "./authenticated-user";

export function registerAccountSessionRoutes(app: Hono<AppContext>) {
  app.get(ACCOUNT_SESSION_PATH, (c) => {
    const auth = requireAuthenticatedUser(c);
    if (!auth.ok) {
      return auth.response;
    }
    const user = auth.user;
    const projection = accountSessionSchema.safeParse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image ?? null,
        emailVerified: user.emailVerified,
        createdAt:
          user.createdAt instanceof Date &&
          Number.isFinite(user.createdAt.getTime())
            ? user.createdAt.toISOString()
            : undefined,
      },
      session: { id: c.var.session?.id },
    });
    if (!projection.success) {
      throw new Error("Invalid authenticated account session projection.");
    }
    return c.json(projection.data);
  });
}
