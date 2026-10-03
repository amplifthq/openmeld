import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../src/lib/context";
import { requireTrustedCookieOrigin } from "../src/lib/middlewares/trusted-origin";

describe("App origin migration cookie writes", () => {
  it("accepts old and new pages plus native Desktop, rejects other subdomains, and retires the old origin explicitly", async () => {
    const write = vi.fn(() => new Response("saved"));
    const app = new Hono<AppContext>().post(
      "/write",
      requireTrustedCookieOrigin,
      write
    );
    const env = {
      AUTH_WORKER_NODE_ENV: "production",
      BETTER_AUTH_URL: "https://auth.openmeld.ai",
      WEB_APP_URL: "https://app.openmeld.ai",
      AUTH_LEGACY_APP_ORIGIN: "https://openmeld.ai",
    } as AppContext["Bindings"];
    const send = (origin: string, bindings = env) =>
      app.request(
        "https://auth.openmeld.ai/write",
        {
          method: "POST",
          headers: {
            cookie: "session=example",
            origin,
            "x-forwarded-host": "app.openmeld.ai",
          },
        },
        bindings
      );

    for (const origin of [
      "https://openmeld.ai",
      "https://app.openmeld.ai",
      "openmeld-desktop://app",
    ]) {
      expect((await send(origin)).status).toBe(200);
    }
    for (const origin of [
      "https://evil.openmeld.ai",
      "https://staging.openmeld.ai",
      "null",
      "https://app.openmeld.ai.evil.test",
    ]) {
      expect((await send(origin)).status).toBe(403);
    }
    expect(
      (
        await send("https://openmeld.ai", {
          ...env,
          AUTH_LEGACY_APP_ORIGIN: undefined,
        })
      ).status
    ).toBe(403);
    expect(write).toHaveBeenCalledTimes(3);
  });
});
