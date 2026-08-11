import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { LOCAL_ROUTINE_TICK_ROUTE } from "../src/routes/local-routine-tick";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

describe("local Routine scheduler tick", () => {
  it("runs one Core scheduler tick from the loopback local-development route", async () => {
    const runLocalRoutineSchedulerTick = vi.fn().mockResolvedValue({
      ok: true,
      ranAtMs: 1_700_000_000_000,
    });
    const response = await app.fetch(
      new Request(`http://localhost${LOCAL_ROUTINE_TICK_ROUTE}`, {
        headers: { "cf-connecting-ip": "::1" },
        method: "POST",
      }),
      {
        OPENMELD_CORE_WORKER: { runLocalRoutineSchedulerTick },
        OPENMELD_WORKER_ENVIRONMENT: "local",
      } as unknown as CloudflareBindings,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ranAtMs: 1_700_000_000_000,
    });
    expect(runLocalRoutineSchedulerTick).toHaveBeenCalledOnce();
  });

  it.each([
    ["production", "prod", { "cf-connecting-ip": "::1" }],
    ["non-loopback client", "local", { "cf-connecting-ip": "203.0.113.1" }],
    [
      "a forwarded tunnel request",
      "local",
      {
        "cf-connecting-ip": "::1",
        "x-forwarded-for": "203.0.113.1",
      },
    ],
  ])("does not expose the route in %s", async (_, workerEnvironment, headers) => {
    const runLocalRoutineSchedulerTick = vi.fn();
    const response = await app.fetch(
      new Request(`http://localhost${LOCAL_ROUTINE_TICK_ROUTE}`, {
        headers,
        method: "POST",
      }),
      {
        OPENMELD_CORE_WORKER: { runLocalRoutineSchedulerTick },
        OPENMELD_WORKER_ENVIRONMENT: workerEnvironment,
      } as unknown as CloudflareBindings,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(404);
    expect(runLocalRoutineSchedulerTick).not.toHaveBeenCalled();
  });
});
