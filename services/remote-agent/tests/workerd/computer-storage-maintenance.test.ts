import { runInDurableObject } from "cloudflare:test";
import { Workspace } from "@cloudflare/computer";
import { expect, it } from "vitest";
import { env } from "./worker-env";

it("uses reusable SQLite capacity after a canonical write limit, deletion and maintenance", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const workspace = new Workspace({
      storage: state.storage,
      storageCapacityBytes: 4 * 1024 ** 2,
    });
    await workspace.fs.writeFile("/keep", "completed user result");
    await workspace.fs.mkdir("/temporary");
    let files = 0;
    let rejected = false;
    for (; files < 32; files++) {
      try {
        await workspace.fs.writeFile(
          `/temporary/${files}`,
          new Uint8Array(256 * 1024).fill(files + 1)
        );
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            error.message.includes("Computer storage is full")
          )
        ) {
          throw error;
        }
        rejected = true;
        break;
      }
    }
    const full = state.storage.sql.databaseSize;
    await workspace.fs.rm("/temporary", { recursive: true });
    let pending = true;
    for (let i = 0; i < 100 && pending; i++) {
      pending = await workspace.maintainSync();
    }
    const reclaimed = state.storage.sql.databaseSize;
    await workspace.fs.writeFile(
      "/new-result",
      new Uint8Array(512 * 1024).fill(99)
    );
    const preserved = await workspace.fs.readFile("/keep", "utf8");
    const written = await new Response(
      await workspace.fs.readFile("/new-result")
    ).arrayBuffer();
    await workspace.close();
    return {
      full,
      reclaimed,
      rejected,
      files,
      pending,
      preserved,
      written: written.byteLength,
    };
  });
  expect(result.rejected).toBe(true);
  expect(result.files).toBeGreaterThan(1);
  expect(result.pending).toBe(false);
  expect(result.reclaimed).toBeLessThan(result.full);
  expect(result.preserved).toBe("completed user result");
  expect(result.written).toBe(512 * 1024);
});

it("arms the production maintenance alarm for filesystem-only work", async () => {
  const namespace = (env as { AGENT_COMPUTER: DurableObjectNamespace })
    .AGENT_COMPUTER;
  const stub = namespace.get(namespace.newUniqueId());
  await runInDurableObject(stub, async (instance, state) => {
    const computer = instance as unknown as {
      workspace: Workspace;
      alarm(): Promise<void>;
    };
    await computer.workspace.fs.mkdir("/gc-only");
    await computer.workspace.fs.writeFile("/gc-only/result", "temporary bytes");
    await computer.workspace.fs.rm("/gc-only", { recursive: true });
    expect(await state.storage.getAlarm()).not.toBeNull();
    for (let i = 0; i < 20 && (await state.storage.getAlarm()) !== null; i++) {
      await computer.alarm();
    }
    expect(
      state.storage.sql
        .exec("SELECT count(*) AS n FROM _vfs_sync_removals")
        .one().n
    ).toBe(0);
    expect(await state.storage.getAlarm()).toBeNull();
  });
});
