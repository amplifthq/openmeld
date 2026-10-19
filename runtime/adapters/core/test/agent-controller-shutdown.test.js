import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Shutdown cleanup closes agent CLI launches for the rest of the process, so
// every scenario runs in its own Node process against the built package.
const coreEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const SHUTTING_DOWN_ERROR = /shutting down/;

const SCENARIO_PRELUDE = `
import { spawnAgentControllerProcess, terminateLiveAgentControllerProcesses } from ${JSON.stringify(coreEntry)};
const spawnNode = (script) => spawnAgentControllerProcess({
  bin: process.execPath, args: ["-e", script], cwd: process.cwd(), env: process.env, shell: false,
});
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
`;

async function runScenario(body) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", `${SCENARIO_PRELUDE}\n${body}`],
    { timeout: 20_000 }
  );
  return JSON.parse(stdout);
}

function killIfAlive(pid) {
  if (typeof pid !== "number") {
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

test(
  "ends a descendant that outlives its exited agent CLI root",
  { skip: process.platform === "win32" },
  async () => {
    const result = await runScenario(`
      const root = spawnNode("const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); c.unref(); console.log(c.pid);");
      let output = "";
      root.child.stdout.on("data", (chunk) => { output += chunk; });
      await new Promise((resolve) => root.child.once("exit", resolve));
      const descendantPid = Number.parseInt(output.trim(), 10);
      const aliveAfterRootExit = isAlive(descendantPid);
      await terminateLiveAgentControllerProcesses({ graceMs: 200 });
      await sleep(200);
      report({ descendantPid, aliveAfterRootExit, aliveAfterShutdown: isAlive(descendantPid) });
    `);
    killIfAlive(result.descendantPid);
    assert.equal(result.aliveAfterRootExit, true);
    assert.equal(result.aliveAfterShutdown, false);
  }
);

test(
  "force-ends an agent CLI that ignores SIGTERM within the bound",
  { skip: process.platform === "win32" },
  async () => {
    const result = await runScenario(`
      const stubborn = spawnNode("process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)");
      await new Promise((resolve) => stubborn.child.stdout.once("data", resolve));
      const exited = new Promise((resolve) => stubborn.child.once("exit", (_code, signal) => resolve(signal)));
      const startedAt = Date.now();
      await terminateLiveAgentControllerProcesses({ graceMs: 200 });
      report({ pid: stubborn.processId, signal: await exited, elapsedMs: Date.now() - startedAt });
    `);
    killIfAlive(result.pid);
    assert.equal(result.signal, "SIGKILL");
    assert.ok(result.elapsedMs < 3500);
  }
);

test(
  "leaves no tree when a probe sequence launches its next probe during shutdown",
  { skip: process.platform === "win32" },
  async () => {
    // A controller report runs probes one after another. When shutdown ends
    // the current probe, the report must not be able to start the next one
    // behind the cleanup.
    const result = await runScenario(`
      const first = spawnNode("console.log('ready'); setInterval(() => {}, 1000)");
      await new Promise((resolve) => first.child.stdout.once("data", resolve));
      let nextPid = null;
      let nextLaunchError = null;
      first.child.once("exit", () => {
        try {
          nextPid = spawnNode("setInterval(() => {}, 1000)").processId;
        } catch (error) {
          nextLaunchError = error.message;
        }
      });
      await terminateLiveAgentControllerProcesses({ graceMs: 200 });
      await sleep(200);
      report({
        firstPid: first.processId,
        firstAlive: isAlive(first.processId),
        nextPid,
        nextAlive: nextPid === null ? false : isAlive(nextPid),
        nextLaunchError,
      });
    `);
    killIfAlive(result.firstPid);
    killIfAlive(result.nextPid);
    assert.equal(result.firstAlive, false);
    assert.equal(result.nextAlive, false);
    assert.match(String(result.nextLaunchError), SHUTTING_DOWN_ERROR);
  }
);
