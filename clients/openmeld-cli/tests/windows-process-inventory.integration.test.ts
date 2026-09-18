import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { listWindowsProcesses } from "../src/local-service/lifecycle/daemon-service-process-inventory";

describe.skipIf(process.platform !== "win32")(
  "native Windows process inventory",
  () => {
    it("observes an owned child with Unicode arguments without mutating Service state", async () => {
      const marker = "OpenMeld inventory 测试 & spaces";
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)", marker],
        { stdio: "ignore", windowsHide: true }
      );
      const exited = once(child, "exit");
      try {
        await once(child, "spawn");
        const row = (await listWindowsProcesses()).find(
          (item) => item.pid === child.pid
        );
        expect(row?.parentPid).toBe(process.pid);
        expect(row?.command).toContain(marker);
      } finally {
        child.kill();
        await exited;
      }
    });
  }
);
