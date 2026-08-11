import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearDaemonRuntimeLease,
  daemonRuntimeLeasePath,
  readDaemonRuntimeLease,
  writeDaemonRuntimeLease,
} from "../src/config/daemon-runtime-lease";
import { daemonRuntimeStateRootPath } from "../src/config/daemon-state";
import { withTempHome } from "./helpers/fs";

describe("local service runtime lease store", () => {
  it("writes lease into runtime local service state root", async () => {
    await withTempHome(async () => {
      await writeDaemonRuntimeLease({
        schema: "openmeld-daemon-runtime-lease-v1",
        v: 1,
        generation: 1,
        bundleId: "service-bundle-1",
        pid: 12_345,
        mode: "background",
        startedAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:01.000Z",
        heartbeatAt: "2026-03-14T00:00:01.000Z",
        serviceController: "launchd",
        managedBySystemService: true,
      });

      expect(daemonRuntimeLeasePath()).toBe(
        join(daemonRuntimeStateRootPath(), "runtime-lease.json")
      );
      expect(await readDaemonRuntimeLease()).toEqual({
        schema: "openmeld-daemon-runtime-lease-v1",
        v: 1,
        generation: 1,
        bundleId: "service-bundle-1",
        pid: 12_345,
        mode: "background",
        startedAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:01.000Z",
        heartbeatAt: "2026-03-14T00:00:01.000Z",
        serviceController: "launchd",
        managedBySystemService: true,
      });
    });
  });

  it("returns null for malformed files and clears lease state", async () => {
    await withTempHome(async () => {
      await mkdir(dirname(daemonRuntimeLeasePath()), { recursive: true });
      await writeFile(daemonRuntimeLeasePath(), "{bad-json", "utf8");
      expect(await readDaemonRuntimeLease()).toBeNull();

      await writeDaemonRuntimeLease({
        schema: "openmeld-daemon-runtime-lease-v1",
        v: 1,
        generation: 0,
        bundleId: "service-bundle-1",
        pid: 12_345,
        mode: "foreground",
        startedAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:00.000Z",
        heartbeatAt: null,
        serviceController: "legacy-detached",
        managedBySystemService: false,
      });
      await clearDaemonRuntimeLease();
      expect(await readDaemonRuntimeLease()).toBeNull();
    });
  });

  it("writes atomically without leaving temp files behind", async () => {
    await withTempHome(async () => {
      await writeDaemonRuntimeLease({
        schema: "openmeld-daemon-runtime-lease-v1",
        v: 1,
        generation: 1,
        bundleId: "service-bundle-1",
        pid: 12_345,
        mode: "background",
        startedAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:01.000Z",
        heartbeatAt: "2026-03-14T00:00:01.000Z",
        serviceController: "launchd",
        managedBySystemService: true,
      });

      const entries = await readdir(daemonRuntimeStateRootPath());
      expect(entries.some((entry) => entry.includes(".tmp-"))).toBe(false);
    });
  });
});
