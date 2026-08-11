import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { daemonRuntimeDataPathMock } = vi.hoisted(() => ({
  daemonRuntimeDataPathMock: vi.fn(),
}));

vi.mock("../src/config/daemon-state", () => ({
  daemonRuntimeDataPath: (...args: unknown[]) =>
    daemonRuntimeDataPathMock(...args),
}));

import {
  readDaemonCatalogSyncSignal,
  touchDaemonCatalogSyncSignal,
} from "../src/local-service/state/catalog-sync-signal";

describe("local service catalog sync signal", () => {
  let runtimeDataDir = "";

  beforeEach(async () => {
    runtimeDataDir = await mkdtemp(join(tmpdir(), "openmeld-catalog-signal-"));
    daemonRuntimeDataPathMock.mockReset().mockReturnValue(runtimeDataDir);
  });

  afterEach(async () => {
    await rm(runtimeDataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes and reads signal with atomic temp-rename strategy", async () => {
    await touchDaemonCatalogSyncSignal({
      reason: "profile_created",
    });

    const signalPath = join(runtimeDataDir, "catalog-sync-signal.json");
    const raw = await readFile(signalPath, "utf8");
    expect(raw).toContain('"v": 1');
    expect(raw).toContain('"reason": "profile_created"');

    const signal = await readDaemonCatalogSyncSignal();
    expect(signal).toEqual({
      updatedAt: expect.any(String),
      updatedAtMs: expect.any(Number),
      reason: "profile_created",
    });
  });

  it("returns null when signal file is malformed", async () => {
    const signalPath = join(runtimeDataDir, "catalog-sync-signal.json");
    await writeFile(signalPath, "{invalid", "utf8");

    await expect(readDaemonCatalogSyncSignal()).resolves.toBeNull();
  });

  it("keeps updatedAt monotonic and normalizes empty reason", async () => {
    await touchDaemonCatalogSyncSignal({
      reason: "   ",
    });
    const first = await readDaemonCatalogSyncSignal();
    expect(first?.reason).toBe("local_state_changed");

    await touchDaemonCatalogSyncSignal({
      reason: "device_runtime_state_updated",
    });
    const second = await readDaemonCatalogSyncSignal();
    expect(second?.reason).toBe("device_runtime_state_updated");
    expect(second?.updatedAtMs ?? 0).toBeGreaterThanOrEqual(
      first?.updatedAtMs ?? 0
    );
  });
});
