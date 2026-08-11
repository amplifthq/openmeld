import { setAuthPasswordBodySchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { AppContext } from "../context";

const INVALID_INPUT_RESPONSE = {
  code: "auth.invalid_input",
  message: "invalid request body",
  ok: false,
} as const;

export function registerPasswordRoutes(app: Hono<AppContext>) {
  app.post("/api/auth/set-password", async (c) => {
    const bodyResult = setAuthPasswordBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );

    if (!bodyResult.success) {
      return c.json(INVALID_INPUT_RESPONSE, 400);
    }

    return c.var.betterAuth.api.setPassword({
      asResponse: true,
      body: bodyResult.data,
      headers: c.req.raw.headers,
    });
  });
}
