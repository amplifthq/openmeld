import { SPACE_WORK_HANDOFF_CAPABILITY_HEADER } from "@openmeld/schemas";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { HonoBindings } from "../src/lib/bindings";
import { registerDaemonRoutes } from "../src/routes/daemon";

describe("Service handoff capability at the Core stream boundary", () => {
  it.each([
    "1",
    "0",
    null,
  ])("forwards only the supported advertisement %s", async (advertisement) => {
    const requests: Request[] = [];
    const fetch = vi.fn((request: Request) => {
      requests.push(request);
      return Promise.resolve(new Response("captured"));
    });
    const app = new Hono<HonoBindings>();
    app.use("*", async (c, next) => {
      c.set("openMeldRequestContext", {
        actorContext: {
          requestId: "handoff-capability",
          openMeldProfileId: "human-1",
          profileKind: "human",
          profileName: "Test member",
          ownerUserId: "owner-1",
          ownerName: "Test member",
        },
      });
      await next();
    });
    registerDaemonRoutes(app);
    const headers = new Headers({ Upgrade: "websocket" });
    if (advertisement !== null) {
      headers.set(SPACE_WORK_HANDOFF_CAPABILITY_HEADER, advertisement);
    }
    const namespace = {
      idFromName: vi.fn(),
      get: () => ({ fetch }),
    } as unknown as HonoBindings["Bindings"]["OPENMELD_RUNTIME_TRANSPORT"];
    const response = await app.request(
      "/v1/daemon/stream",
      { headers },
      {
        OPENMELD_RUNTIME_TRANSPORT: namespace,
      }
    );
    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get(SPACE_WORK_HANDOFF_CAPABILITY_HEADER)).toBe(
      advertisement === "1" ? "1" : null
    );
  });
});
