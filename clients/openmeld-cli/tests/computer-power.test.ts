import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComputerPower } from "../src/local-service/power/computer-power";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openmeld-power-test-"));
  roots.push(root);
  const release = vi.fn(async () => undefined);
  const acquire = vi.fn(async (_lost: (message: string) => void) => release);
  const path = join(root, "power.json");
  const power = createComputerPower({ path, supported: true, acquire });
  return { power, path, release, acquire };
}
describe("Computer sleep prevention", () => {
  it("does not misreport an unreadable preference as off", async () => {
    const { path, power } = await setup();
    await power.ready;
    await writeFile(path, "broken-json");
    const acquire = vi.fn();
    const restored = createComputerPower({ path, supported: true, acquire });
    await expect(restored.request({ operation: "read" })).rejects.toThrow(
      "Could not read sleep prevention settings"
    );
    await restored.setActiveTasks(1);
    expect(acquire).not.toHaveBeenCalled();
    await restored.stop();
    await power.stop();
  });
  it("defaults on, holds only during local tasks, and releases after the last concurrent task", async () => {
    const { power, acquire, release } = await setup();
    expect(await power.read()).toMatchObject({ enabled: true, active: false });
    expect(acquire).not.toHaveBeenCalled();
    await power.setActiveTasks(2);
    expect(await power.read()).toMatchObject({ enabled: true, active: true });
    await power.setActiveTasks(1);
    expect(release).not.toHaveBeenCalled();
    expect(acquire).toHaveBeenCalledTimes(1);
    await power.setActiveTasks(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(await power.read()).toMatchObject({ enabled: true, active: false });
    await power.setActiveTasks(1);
    expect(acquire).toHaveBeenCalledTimes(2);
    await power.request({
      operation: "update",
      enabled: false,
      expectedRevision: 0,
    });
    expect(release).toHaveBeenCalledTimes(2);
    await power.stop();
  });
  it.each([
    true,
    false,
  ])("persists enabled=%s across restarts and rejects stale concurrent writes", async (enabled) => {
    const { power, path, acquire } = await setup();
    const results = await Promise.allSettled([
      power.request({
        operation: "update",
        enabled,
        expectedRevision: 0,
      }),
      power.request({
        operation: "update",
        enabled: !enabled,
        expectedRevision: 0,
      }),
    ]);
    expect(results.map((entry) => entry.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      enabled,
      revision: 1,
    });
    const restored = createComputerPower({ path, supported: true, acquire });
    expect(await restored.read()).toMatchObject({
      enabled,
      active: false,
      revision: 1,
    });
    expect(acquire).not.toHaveBeenCalled();
    await restored.setActiveTasks(1);
    expect(acquire).toHaveBeenCalledTimes(enabled ? 1 : 0);
    await restored.stop();
    await power.stop();
  });
  it("reports acquisition and unexpected helper failures without claiming protection", async () => {
    const { power, acquire } = await setup();
    acquire.mockRejectedValueOnce(new Error("OS refused the request"));
    await power.setActiveTasks(1);
    expect(await power.read()).toMatchObject({
      enabled: true,
      active: false,
      problem: "OS refused the request",
    });
    await power.request({
      operation: "update",
      enabled: false,
      expectedRevision: 0,
    });
    await power.request({
      operation: "update",
      enabled: true,
      expectedRevision: 1,
    });
    acquire.mock.calls[1]?.[0]("Helper exited");
    expect(await power.read()).toMatchObject({
      enabled: true,
      active: false,
      problem: "Helper exited",
    });
    await power.stop();
  });
  it("releases at Service shutdown and does not reacquire", async () => {
    const { power, release, acquire } = await setup();
    await power.request({
      operation: "update",
      enabled: true,
      expectedRevision: 0,
    });
    await power.setActiveTasks(1);
    await power.stop();
    await power.setActiveTasks(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
