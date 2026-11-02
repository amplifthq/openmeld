import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireExecutionHostOwnership,
  readExecutionHostBootIdentity,
} from "../../src/local-service/execution-host/ownership";

// Process/persistence boundary fixture, not a provider or user-facing Wake.
// Exercise the real owner's durable pre-execution transition, then let the
// parent kill this process without a graceful ownership release.
const stateRoot = process.argv[2];
const mode = process.argv[3];
if (!stateRoot) {
  throw new Error("A disposable ownership root is required.");
}
const owner = await acquireExecutionHostOwnership({
  stateRoot,
  hostInstanceId: randomUUID(),
  ownerUserId: "test-owner",
  deviceId: "test-device",
  lane: "dev-local",
  bootIdentity: await readExecutionHostBootIdentity(),
});
const spawnDetached = () => {
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => undefined, 1000)"],
    {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    }
  );
  child.unref();
  return child.pid ?? null;
};
const signalTarget = process.platform === "win32" ? "process" : "process_group";
const work = (runningTaskIds: string[]) =>
  owner.observeWork({
    localQuiescent: false,
    unattributedWork: false,
    runningTaskIds,
  });
// Both concurrent orders: the second task starts after, or before, the first
// records its provider. Either way it then launches work it never records,
// such as a project container.
work(mode === "concurrent-started" ? ["task-a", "task-b"] : ["task-a"]);
let providerPid: number | null = null;
let unrecordedPid: number | null = null;
if (mode !== undefined) {
  providerPid = spawnDetached();
  owner.observeOwnedProcess({
    phase: "process_spawned",
    processId: providerPid,
    signalTarget,
    taskId: "task-a",
  });
}
if (mode === "concurrent" || mode === "concurrent-started") {
  work(["task-a", "task-b"]);
  unrecordedPid = spawnDetached();
}
writeFileSync(join(stateRoot, "execution-started"), "once", { flag: "wx" });
process.send?.({ providerPid, unrecordedPid, ready: true });
process.on("message", () => undefined);
