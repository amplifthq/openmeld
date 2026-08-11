import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rootDir, mode, holdMsRaw] = process.argv.slice(2);
if (!(rootDir && (mode === "release" || mode === "crash"))) {
  throw new Error("Expected a root directory and release or crash mode.");
}
const holdMs = Number(holdMsRaw ?? 0);
const path = join(rootDir, "device", "agent-activity", ".locks", "state.lock");
mkdirSync(path, { mode: 0o700, recursive: true });
const processIdentity = `ps:${execFileSync(
  "ps",
  ["-o", "lstart=", "-p", String(process.pid)],
  { encoding: "utf8" }
).trim()}`;
writeFileSync(
  join(path, "owner.json"),
  `${JSON.stringify({
    expiresAtMs: Date.now() + 60_000,
    ownerPid: process.pid,
    ownerProcessStartedAt: processIdentity,
    token: "child-owner",
    version: 1,
  })}\n`,
  { encoding: "utf8", mode: 0o600 }
);
process.send?.({ type: "ready" });

if (mode === "release") {
  setTimeout(() => {
    rmSync(path, { force: true, recursive: true });
    process.exit(0);
  }, holdMs);
} else {
  process.on("message", (message) => {
    if (message === "crash") {
      process.exit(9);
    }
  });
}
