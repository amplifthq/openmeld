import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
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
const KEEP_ALIVE = "setInterval(() => undefined, 1000)";
const spawnDetached = (script = KEEP_ALIVE) => {
  const child = spawn(process.execPath, ["-e", script], {
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return { child, pid: child.pid ?? null };
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
if (mode === "lingering-group") {
  // The provider root exits while a child stays in its process group; the
  // root's exit is reported and the slots then go idle.
  const provider = spawnDetached(
    `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(KEEP_ALIVE)}], { stdio: "ignore" }).unref();`
  );
  providerPid = provider.pid;
  owner.observeOwnedProcess({
    phase: "process_spawned",
    processId: providerPid,
    signalTarget,
    taskId: "task-a",
  });
  provider.child.ref();
  await once(provider.child, "exit");
  owner.observeOwnedProcess({
    phase: "process_exit",
    processId: providerPid,
    signalTarget,
    taskId: "task-a",
  });
  owner.observeWork({
    localQuiescent: true,
    unattributedWork: false,
    runningTaskIds: [],
  });
} else if (mode !== undefined) {
  providerPid = spawnDetached().pid;
  owner.observeOwnedProcess({
    phase: "process_spawned",
    processId: providerPid,
    signalTarget,
    taskId: "task-a",
  });
}
if (mode === "concurrent" || mode === "concurrent-started") {
  work(["task-a", "task-b"]);
  unrecordedPid = spawnDetached().pid;
}
writeFileSync(join(stateRoot, "execution-started"), "once", { flag: "wx" });
process.send?.({ providerPid, unrecordedPid, ready: true });
process.on("message", () => undefined);
