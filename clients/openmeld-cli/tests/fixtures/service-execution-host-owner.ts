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
owner.observeLocalQuiescence(false);
let providerPid: number | null = null;
if (process.argv[3] === "with-provider") {
  const provider = spawn(
    process.execPath,
    ["-e", "setInterval(() => undefined, 1000)"],
    {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    }
  );
  providerPid = provider.pid ?? null;
  provider.unref();
  owner.observeOwnedProcess({
    phase: "process_spawned",
    processId: providerPid,
    signalTarget: process.platform === "win32" ? "process" : "process_group",
  });
}
writeFileSync(join(stateRoot, "execution-started"), "once", { flag: "wx" });
process.send?.({ providerPid, ready: true });
process.on("message", () => undefined);
