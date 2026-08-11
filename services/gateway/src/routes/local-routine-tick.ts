import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";

export const LOCAL_ROUTINE_TICK_ROUTE = "/__dev/routines/tick";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);

export function registerLocalRoutineTickRoute(app: Hono<HonoBindings>): void {
  app.post(LOCAL_ROUTINE_TICK_ROUTE, async (c) => {
    if (
      c.env.OPENMELD_WORKER_ENVIRONMENT !== "local" ||
      c.req.header("x-forwarded-for") !== undefined ||
      !LOOPBACK_ADDRESSES.has(c.req.header("cf-connecting-ip") ?? "")
    ) {
      return c.notFound();
    }

    return c.json(
      await c.env.OPENMELD_CORE_WORKER.runLocalRoutineSchedulerTick()
    );
  });
}
