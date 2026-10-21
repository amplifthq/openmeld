import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import type { HonoBindings } from "../src/lib/bindings";
import { gatewayContextMiddleware } from "../src/middlewares/context";
import { publicReadRateLimitMiddleware } from "../src/middlewares/public-read-rate-limit";

function fixture(success: boolean) {
  const limit = vi.fn().mockResolvedValue({ success });
  const expensive = vi.fn(() => new Response("private data"));
  const app = new Hono<HonoBindings>();
  app.use("*", gatewayContextMiddleware, publicReadRateLimitMiddleware);
  app.all("*", expensive);
  const env = {
    OPENMELD_AUTH_WORKER: {},
    OPENMELD_CORE_WORKER: {},
    OPENMELD_PUBLIC_READ_RATE_LIMITER: { limit },
    OPENMELD_WORKER_ENVIRONMENT: "test",
  } as unknown as CloudflareBindings;
  return { app, env, limit, expensive };
}

const path = `/v1/spaces/${"a".repeat(64)}/board`;

it("rejects excess public reads before downstream work even with forged credentials", async () => {
  const { app, env, expensive, limit } = fixture(false);
  const response = await app.request(
    path,
    {
      headers: {
        "CF-Connecting-IP": "192.0.2.1",
        Authorization: "Bearer fake",
        Cookie: "fake=1",
      },
    },
    env
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(limit).toHaveBeenCalledWith({ key: "test:public-read:192.0.2.1" });
  expect(expensive).not.toHaveBeenCalled();
});

it("allows ordinary reads and excludes writes and task/stream routes", async () => {
  const { app, env, expensive, limit } = fixture(true);
  expect(
    (
      await app.request(
        path,
        {
          headers: { "CF-Connecting-IP": "192.0.2.1" },
        },
        env
      )
    ).status
  ).toBe(200);
  expect(limit).toHaveBeenCalledOnce();
  limit.mockClear();
  for (const [url, method] of [
    [path, "POST"],
    ["/v1/daemon/stream", "GET"],
  ] as const) {
    expect(
      (
        await app.request(
          url,
          {
            method,
            headers: { "CF-Connecting-IP": "192.0.2.1" },
          },
          env
        )
      ).status
    ).toBe(200);
  }
  expect(limit).not.toHaveBeenCalled();
  expect(expensive).toHaveBeenCalledTimes(3);
});
