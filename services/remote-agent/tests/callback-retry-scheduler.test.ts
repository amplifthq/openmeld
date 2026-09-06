import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { unstable_dev } from "wrangler";

it("retains the next callback retry after the real SDK finishes each one-shot alarm", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmeld-callback-retry-"));
  const config = join(directory, "wrangler.json");
  const workerPath = fileURLToPath(
    new URL("./fixtures/callback-retry-worker.ts", import.meta.url)
  );
  await writeFile(
    config,
    JSON.stringify({
      name: "openmeld-callback-retry-test",
      compatibility_date: "2026-07-15",
      compatibility_flags: ["nodejs_compat"],
      durable_objects: {
        bindings: [{ name: "CALLBACKS", class_name: "CallbackRetryProbe" }],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["CallbackRetryProbe"] }],
    })
  );
  const worker = await unstable_dev(workerPath, {
    config,
    local: true,
    persist: false,
    port: 0,
    inspectorPort: 0,
    logLevel: "error",
    experimental: {
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      watch: false,
    },
  });
  try {
    expect(await (await worker.fetch("/", { method: "POST" })).json()).toEqual({
      attempts: 0,
      schedules: 1,
    });
    let result: unknown;
    for (let i = 0; i < 20; i += 1) {
      await delay(500);
      result = await (await worker.fetch("/")).json();
      if ((result as { attempts: number }).attempts === 3) {
        break;
      }
    }
    expect(result).toEqual({ attempts: 3, schedules: 0 });
  } finally {
    await worker.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);
