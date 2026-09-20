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
writeFileSync(join(stateRoot, "execution-started"), "once", { flag: "wx" });
process.send?.({ ready: true });
process.on("message", () => undefined);
