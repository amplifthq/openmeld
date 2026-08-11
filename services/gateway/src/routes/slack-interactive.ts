import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { verifySlackRequestSignature } from "../lib/slack-request-signature";

export function registerSlackInteractiveRoute(app: Hono<HonoBindings>): void {
  app.post("/slack/interactive", async (c) => {
    const body = new TextDecoder().decode(await c.req.arrayBuffer());
    const verified = await verifySlackRequestSignature({
      body,
      nowSeconds: Math.floor(Date.now() / 1000),
      signature: c.req.header("x-slack-signature"),
      signingSecret: c.env.SLACK_OPENMELD_SIGNING_SECRET,
      timestamp: c.req.header("x-slack-request-timestamp"),
    });
    if (!verified) {
      return c.text("Invalid Slack signature", 401);
    }

    return c.body(null, 200);
  });
}
