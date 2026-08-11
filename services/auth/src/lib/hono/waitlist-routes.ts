import {
  joinWaitlistBodySchema,
  joinWaitlistResponseSchema,
  waitlistErrorResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { AppContext } from "../context";
import { getWaitlistService } from "../waitlist/service";

const INVALID_INPUT_RESPONSE = waitlistErrorResponseSchema.parse({
  code: "waitlist.invalid_input",
  message: "invalid request body",
  ok: false,
});

export function registerWaitlistRoutes(app: Hono<AppContext>) {
  app.post("/v1/waitlist", async (c) => {
    const bodyResult = joinWaitlistBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );

    if (!bodyResult.success) {
      return c.json(INVALID_INPUT_RESPONSE, 400);
    }

    const result = await getWaitlistService(c.env).joinWaitlist({
      email: bodyResult.data.email,
    });

    const response = joinWaitlistResponseSchema.parse({
      ok: true,
      status: result.status,
    });

    return c.json(response, result.status === "created" ? 201 : 200);
  });
}
