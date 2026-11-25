import { expect, it } from "vitest";
import { env } from "./worker-env";

it("reads real SDK schedules after legacy storage migration without disclosing payloads", async () => {
  const id = env.SCHEDULE_DIAGNOSTIC_PROBE.idFromName(crypto.randomUUID());
  const { schedule, diagnostics, legacyTableCount } =
    await env.SCHEDULE_DIAGNOSTIC_PROBE.get(id).inspect();
  expect(legacyTableCount).toBe(0);
  expect(diagnostics.v).toBe(3);
  expect(diagnostics.schedules).toContainEqual({
    id: schedule.id,
    callback: "retryCallback",
    type: "delayed",
    timeMs: schedule.time * 1000,
    delayInSeconds: 3600.5,
  });
  expect(JSON.stringify(diagnostics)).not.toContain("private");
});
